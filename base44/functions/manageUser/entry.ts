import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getAllowedRolesForModules } from '../../shared/tenantRoles.ts';

/**
 * manageUser — Secure user management backend function.
 *
 * Enforces backend-side authorization for all user profile operations:
 *   - update:       edit allowed fields (display_name, phone, badge_number, etc.)
 *   - change_role:  change role_type (admin/management only)
 *   - deactivate:   soft-delete (sets role_type to 'inactive' equivalent)
 *   - delete:       hard delete (platform admin only)
 *
 * All actions are recorded in PlatformAuditLog. Frontend UI hiding is NOT sufficient —
 * this function is the authoritative permission gate.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Only authorized roles can manage users. Customer Administrators
    // (customer_admin, or a vertical admin role scoped to a customer) manage
    // their OWN tenant only — enforced further below by canonical customer_id.
    const authorizedRoles = ['admin', 'platform_admin', 'reseller_admin', 'practice_admin', 'estate_manager', 'customer_admin'];
    const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
    const isResellerAdmin = !isPlatformAdmin && (caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller');
    const isAuthorized = isPlatformAdmin || isResellerAdmin ||
      authorizedRoles.includes(caller.role_type) || caller.admin_level === 'customer';
    if (!isAuthorized) {
      return Response.json({ error: 'Forbidden: insufficient permissions to manage users' }, { status: 403 });
    }

    const { action, target_user_id, updates = {} } = await req.json();

    if (!action || !target_user_id) {
      return Response.json({ error: 'action and target_user_id are required' }, { status: 400 });
    }

    // Fetch target user (service role bypasses RLS for cross-user lookup)
    const targetUsers = await base44.asServiceRole.entities.User.filter({ id: target_user_id });
    const targetUser = targetUsers[0];
    if (!targetUser) {
      return Response.json({ error: 'Target user not found' }, { status: 404 });
    }

    // Prevent self-deletion and self-role-change (security control)
    if (target_user_id === caller.id && ['delete', 'change_role', 'deactivate'].includes(action)) {
      return Response.json({ error: 'Cannot delete, deactivate, or change own role' }, { status: 403 });
    }

    // Reseller admins can only manage users within their own reseller
    if (caller.role_type === 'reseller_admin' && targetUser.reseller_id !== caller.reseller_id) {
      return Response.json({ error: 'Forbidden: can only manage users within your reseller' }, { status: 403 });
    }

    // Tenant admins (customer_admin, practice_admin, estate_manager, legacy
    // admin role_type with a customer scope) can only manage users within
    // their OWN customer tenant — pinned server-side to the canonical
    // customer_id. Never customer-name matching; never cross-tenant access.
    if (!isPlatformAdmin && !isResellerAdmin && caller.customer_id &&
        targetUser.customer_id !== caller.customer_id) {
      return Response.json({ error: 'Forbidden: can only manage users within your organisation' }, { status: 403 });
    }

    const auditLog = (eventType, actionName, oldVals, newVals, notes) =>
      base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: eventType,
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name,
        customer_id: caller.customer_id,
        reseller_id: caller.reseller_id,
        entity_name: 'User',
        entity_id: target_user_id,
        action: actionName,
        old_values: oldVals ? JSON.stringify(oldVals) : undefined,
        new_values: newVals ? JSON.stringify(newVals) : undefined,
        notes
      });

    let result;

    switch (action) {
      case 'update': {
        // Whitelist allowed fields — never allow id, email, or role changes here
        const allowedFields = [
          'display_name', 'badge_number', 'phone', 'whatsapp', 'unit_number',
          'security_pin', 'customer_id', 'reseller_id', 'employer_id', 'module_context',
          'profile_photo', 'stay_awake_enabled', 'stay_awake_interval_minutes',
          'patrol_reminder_enabled', 'patrol_reminder_interval_minutes',
          'needs_daily_report', 'needs_start_of_shift_report'
        ];
        // Tenant/permission fields are platform/reseller-admin only — a
        // Customer Administrator can never move a user between tenants or
        // change their scopes through this action.
        const tenantFields = ['customer_id', 'reseller_id', 'employer_id', 'module_context'];
        const filteredUpdates = {};
        for (const [key, value] of Object.entries(updates)) {
          if (!allowedFields.includes(key)) continue;
          if (tenantFields.includes(key) && !isPlatformAdmin && !isResellerAdmin) continue;
          filteredUpdates[key] = value;
        }
        if (Object.keys(filteredUpdates).length === 0) {
          return Response.json({ error: 'No valid fields to update' }, { status: 400 });
        }
        result = await base44.asServiceRole.entities.User.update(target_user_id, filteredUpdates);
        await auditLog('user.updated', 'update', null, filteredUpdates,
          `User ${targetUser.email} updated by ${caller.display_name || caller.full_name}`);
        break;
      }

      case 'change_role': {
        const newRole = updates.role_type;
        if (!newRole) {
          return Response.json({ error: 'role_type is required in updates' }, { status: 400 });
        }
        // Only platform admin / admin / reseller admin can change roles freely.
        // Customer Administrators may change roles ONLY within their own
        // tenant and ONLY to roles allowed by the customer's ENABLED module
        // entitlements (fail closed — platform, reseller and other-vertical
        // roles are never assignable through this path).
        const isPlatformRoleChanger = isPlatformAdmin || caller.role_type === 'reseller_admin';
        if (!isPlatformRoleChanger) {
          if (caller.role_type !== 'customer_admin') {
            return Response.json({ error: 'Forbidden: insufficient permissions to change roles' }, { status: 403 });
          }
          if (targetUser.customer_id !== caller.customer_id) {
            return Response.json({ error: 'Forbidden: can only manage users within your organisation' }, { status: 403 });
          }
          const entitlements = await base44.asServiceRole.entities.ModuleEntitlement
            .filter({ customer_id: caller.customer_id });
          const enabledKeys = (entitlements || [])
            .filter((e) => e.enabled && (!e.status || e.status === 'active'))
            .map((e) => e.module_key);
          const allowedRoles = getAllowedRolesForModules(enabledKeys);
          if (!allowedRoles.has(newRole)) {
            return Response.json({ error: `Forbidden: role "${newRole}" is not available for this organisation` }, { status: 403 });
          }
        }
        result = await base44.asServiceRole.entities.User.update(target_user_id, { role_type: newRole });
        await auditLog('permission.changed', 'change_role',
          { role_type: targetUser.role_type }, { role_type: newRole },
          `Role changed from ${targetUser.role_type} to ${newRole} for ${targetUser.email}`);
        break;
      }

      case 'deactivate': {
        // Soft delete — set a flag that prevents login without destroying audit history
        result = await base44.asServiceRole.entities.User.update(target_user_id, {
          stay_awake_enabled: false,
          is_clocked_in: false,
          // Store deactivation marker — the auth layer should check this
          custom_contacts: [...(targetUser.custom_contacts || []), {
            name: '__DEACTIVATED__',
            phone: new Date().toISOString(),
            role: 'deactivated_by'
          }]
        });
        await auditLog('user.deactivated', 'deactivate', null, null,
          `User ${targetUser.email} deactivated by ${caller.display_name || caller.full_name}`);
        break;
      }

      case 'delete': {
        // Hard delete — platform admin only
        if (caller.role !== 'admin' && caller.role_type !== 'platform_admin') {
          return Response.json({ error: 'Forbidden: only platform admin can permanently delete users' }, { status: 403 });
        }
        await base44.asServiceRole.entities.User.delete(target_user_id);
        result = { deleted: true };
        await auditLog('user.deleted', 'delete', null, null,
          `User ${targetUser.email} permanently deleted by ${caller.display_name || caller.full_name}`);
        break;
      }

      default:
        return Response.json({
          error: 'Invalid action. Supported: update, change_role, deactivate, delete'
        }, { status: 400 });
    }

    return Response.json({ success: true, result, action });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}