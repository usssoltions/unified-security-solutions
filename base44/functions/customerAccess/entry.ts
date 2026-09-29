import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import {
  isPlatformAdmin, isResellerAdmin, parseDeviceLimit,
  countActiveDevices, loadCustomerById,
} from '../../shared/deviceLicensing.ts';
import {
  parseOperationalUserLimit, countActiveOperationalUsers,
  countPendingOperationalInvitations, USER_LIMIT_REACHED_MESSAGE,
} from '../../shared/userLicensing.ts';

/**
 * customerAccess — AUTHORITATIVE customer lifecycle gateway.
 *
 *  • create — creates a customer. COMPULSORY entitlements, BOTH required and
 *             server-side validated (fail closed; client-side validation is
 *             UX only): Allowed Devices (device_limit — physical app
 *             installations) AND Allowed Operational Users
 *             (operational_user_limit — people who operate the security/
 *             access-control system). These are INDEPENDENT entitlements.
 *             Authorized for platform admins (any reseller or direct) and
 *             reseller administrators (their own reseller only — forced
 *             server-side, never client-supplied).
 *  • set_device_limit — the SINGLE authority for changing a customer's
 *             licensed device allowance. PLATFORM-LEVEL ONLY; a limit below
 *             the ACTIVE device count is blocked. Audited:
 *             customer.device_limit_changed.
 *  • set_operational_user_limit — the SINGLE authority for changing a
 *             customer's licensed operational-user allowance. PLATFORM-LEVEL
 *             ONLY (customer/reseller admins are denied — hiding the field
 *             is never the control); a limit below the current operational
 *             usage (active operational users + valid pending operational
 *             invitations) is blocked. Audited:
 *             customer.operational_user_limit_changed.
 *  • usage — tenant-scoped licensing usage read (operational users AND
 *             devices): platform admin (any customer), reseller admin (own
 *             reseller), customer-level admin (own customer, forced
 *             server-side — client customer_id is never trusted).
 *
 * AUDIT EVENTS: customer.created, customer.device_limit_changed,
 *               customer.operational_user_limit_changed.
 */

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const callerName = caller.display_name || caller.full_name || caller.email;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    /* ── CREATE ────────────────────────────────────────────────────────── */
    if (action === 'create') {
      const name = String(body?.name || '').trim();
      const customer_type = String(body?.customer_type || '').trim();
      if (!name) return Response.json({ error: 'Customer Name is required', code: 'missing_name' }, { status: 400 });
      if (!customer_type) return Response.json({ error: 'Customer Type is required', code: 'missing_customer_type' }, { status: 400 });

      // COMPULSORY Allowed Devices — fail closed, server-side.
      const limitCheck = parseDeviceLimit(body?.device_limit);
      if (!limitCheck.ok) return Response.json({ error: limitCheck.error, code: limitCheck.code }, { status: 400 });

      // COMPULSORY Allowed Operational Users — fail closed, server-side.
      // The SECOND, independent entitlement: creation fails without it.
      const userLimitCheck = parseOperationalUserLimit(body?.operational_user_limit);
      if (!userLimitCheck.ok) return Response.json({ error: userLimitCheck.error, code: userLimitCheck.code }, { status: 400 });

      // Authorization + reseller scope (mirrors Customer RLS):
      // platform admin → any reseller or direct; reseller admin → own reseller
      // only (forced server-side, client value ignored).
      let resellerId: string | null = null;
      if (isPlatformAdmin(caller)) {
        resellerId = body?.reseller_id ? String(body.reseller_id) : null;
      } else if (isResellerAdmin(caller)) {
        if (!caller.reseller_id) {
          return Response.json({ error: 'Your account has no reseller scope', code: 'permission_denied' }, { status: 403 });
        }
        resellerId = caller.reseller_id;
      } else {
        return Response.json({ error: 'You do not have permission to create customers', code: 'permission_denied' }, { status: 403 });
      }

      const created = await svc.entities.Customer.create({
        name,
        legal_name: String(body?.legal_name || '').trim() || undefined,
        customer_type,
        device_limit: limitCheck.value,
        operational_user_limit: userLimitCheck.value,
        reseller_id: resellerId || undefined,
        address: String(body?.address || '').trim() || undefined,
        phone: String(body?.phone || '').trim() || undefined,
        email: String(body?.email || '').trim() || undefined,
        website: String(body?.website || '').trim() || undefined,
        status: String(body?.status || 'active'),
        notes: String(body?.notes || '').trim() || undefined,
      });
      await svc.entities.PlatformAuditLog.create({
        event_type: 'customer.created',
        user_id: caller.id, user_name: callerName,
        reseller_id: resellerId || undefined,
        entity_name: 'Customer', entity_id: created.id, action: 'customer_create',
        new_values: JSON.stringify({ name, customer_type, device_limit: limitCheck.value, operational_user_limit: userLimitCheck.value, reseller_id: resellerId }),
        notes: `Customer created with device allowance ${limitCheck.value} and operational-user allowance ${userLimitCheck.value}`,
      }).catch(() => {});
      return Response.json({ success: true, customer: created });
    }

    /* ── SET DEVICE LIMIT (platform-level only, single authority) ──────── */
    if (action === 'set_device_limit') {
      if (!isPlatformAdmin(caller)) {
        return Response.json({
          error: 'Only a Platform Administrator can change a customer\'s licensed device allowance.',
          code: 'permission_denied',
        }, { status: 403 });
      }
      const customerId = String(body?.customer_id || '');
      if (!customerId) return Response.json({ error: 'customer_id required', code: 'missing_customer' }, { status: 400 });
      const cust = await loadCustomerById(svc, customerId);
      if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });

      const limitCheck = parseDeviceLimit(body?.device_limit);
      if (!limitCheck.ok) return Response.json({ error: limitCheck.error, code: limitCheck.code }, { status: 400 });

      // Controlled limit reduction: never silently strand or auto-deactivate
      // devices — a limit below the ACTIVE device count is blocked with an
      // actionable message.
      const activeCount = await countActiveDevices(svc, customerId);
      if (limitCheck.value < activeCount) {
        return Response.json({
          error: `${activeCount} device${activeCount === 1 ? ' is' : 's are'} currently active. Deactivate ${activeCount - limitCheck.value} device${activeCount - limitCheck.value === 1 ? '' : 's'} first, or choose an allowance of at least ${activeCount}.`,
          code: 'limit_below_active_devices',
          active_count: activeCount,
        }, { status: 409 });
      }

      const oldLimit = cust.device_limit ?? null;
      const updated = await svc.entities.Customer.update(customerId, { device_limit: limitCheck.value });
      await svc.entities.PlatformAuditLog.create({
        event_type: 'customer.device_limit_changed',
        customer_id: customerId, reseller_id: cust.reseller_id || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'Customer', entity_id: customerId, action: 'set_device_limit',
        old_values: JSON.stringify({ device_limit: oldLimit }),
        new_values: JSON.stringify({ device_limit: limitCheck.value }),
        notes: `Device allowance changed ${oldLimit ?? 'not configured'} → ${limitCheck.value} (${activeCount} active devices)`,
      }).catch(() => {});
      return Response.json({ success: true, customer: updated, active_count: activeCount });
    }

    /* ── SET OPERATIONAL USER LIMIT (platform-level only, single authority) */
    if (action === 'set_operational_user_limit') {
      if (!isPlatformAdmin(caller)) {
        return Response.json({
          error: 'Only a Platform Administrator can change a customer\'s licensed operational-user allowance.',
          code: 'permission_denied',
        }, { status: 403 });
      }
      const customerId = String(body?.customer_id || '');
      if (!customerId) return Response.json({ error: 'customer_id required', code: 'missing_customer' }, { status: 400 });
      const cust = await loadCustomerById(svc, customerId);
      if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });

      const userLimitCheck = parseOperationalUserLimit(body?.operational_user_limit);
      if (!userLimitCheck.ok) return Response.json({ error: userLimitCheck.error, code: userLimitCheck.code }, { status: 400 });

      // Controlled limit reduction: usage = ACTIVE operational users + VALID
      // PENDING operational invitations (pending invitations consume slots,
      // so they must not be silently orphaned by a reduction).
      const [activeUsers, pendingInvites] = await Promise.all([
        countActiveOperationalUsers(svc, customerId),
        countPendingOperationalInvitations(svc, customerId),
      ]);
      const used = activeUsers + pendingInvites;
      if (userLimitCheck.value < used) {
        return Response.json({
          error: `${used} operational-user slot${used === 1 ? ' is' : 's are'} currently in use (${activeUsers} active user${activeUsers === 1 ? '' : 's'}, ${pendingInvites} pending invitation${pendingInvites === 1 ? '' : 's'}). Cancel ${used - userLimitCheck.value} invitation${used - userLimitCheck.value === 1 ? '' : 's'} or deactivate user${used - userLimitCheck.value === 1 ? '' : 's'} first, or choose an allowance of at least ${used}.`,
          code: 'limit_below_operational_usage',
          active_users: activeUsers,
          pending_invitations: pendingInvites,
          used,
        }, { status: 409 });
      }

      const oldLimit = cust.operational_user_limit ?? null;
      const updated = await svc.entities.Customer.update(customerId, { operational_user_limit: userLimitCheck.value });
      await svc.entities.PlatformAuditLog.create({
        event_type: 'customer.operational_user_limit_changed',
        customer_id: customerId, reseller_id: cust.reseller_id || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'Customer', entity_id: customerId, action: 'set_operational_user_limit',
        old_values: JSON.stringify({ operational_user_limit: oldLimit }),
        new_values: JSON.stringify({ operational_user_limit: userLimitCheck.value }),
        notes: `Operational-user allowance changed ${oldLimit ?? 'not configured'} → ${userLimitCheck.value} (${activeUsers} active, ${pendingInvites} pending)`,
      }).catch(() => {});
      return Response.json({
        success: true, customer: updated,
        operational: { limit: userLimitCheck.value, active: activeUsers, pending: pendingInvites, used },
      });
    }

    /* ── USAGE (tenant-scoped licensing read for admin UIs) ─────────────── */
    if (action === 'usage') {
      let customerId: string | null = null;
      if (isPlatformAdmin(caller)) {
        customerId = String(body?.customer_id || '') || null;
        if (!customerId) return Response.json({ error: 'customer_id required', code: 'missing_customer' }, { status: 400 });
      } else if (isResellerAdmin(caller)) {
        customerId = String(body?.customer_id || '') || null;
        if (!customerId) return Response.json({ error: 'customer_id required', code: 'missing_customer' }, { status: 400 });
      } else if (caller.customer_id && ['customer_admin', 'admin'].includes(String(caller.role_type || ''))) {
        // Customer-level admin: OWN customer only — the client-supplied
        // customer_id is NEVER trusted for authorization (it is only used to
        // fail loudly on a mismatch, never to grant access).
        if (body?.customer_id && String(body.customer_id) !== String(caller.customer_id)) {
          return Response.json({ error: 'You can only view licensing for your own organisation.', code: 'permission_denied' }, { status: 403 });
        }
        customerId = String(caller.customer_id);
      } else {
        return Response.json({ error: 'You do not have permission to view licensing.', code: 'permission_denied' }, { status: 403 });
      }
      const cust = await loadCustomerById(svc, customerId);
      if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });
      if (isResellerAdmin(caller) && (!cust.reseller_id || String(cust.reseller_id) !== String(caller.reseller_id))) {
        return Response.json({ error: 'You do not have permission to view licensing for this customer.', code: 'permission_denied' }, { status: 403 });
      }
      const [activeUsers, pendingInvites, activeDevices] = await Promise.all([
        countActiveOperationalUsers(svc, customerId),
        countPendingOperationalInvitations(svc, customerId),
        countActiveDevices(svc, customerId),
      ]);
      const opLimit = cust.operational_user_limit ?? null;
      const devLimit = cust.device_limit ?? null;
      return Response.json({
        success: true,
        can_change_limits: isPlatformAdmin(caller),
        operational: {
          limit: opLimit,
          active: activeUsers,
          pending: pendingInvites,
          used: activeUsers + pendingInvites,
          available: opLimit == null ? null : Math.max(0, opLimit - (activeUsers + pendingInvites)),
          requires_configuration: opLimit == null,
        },
        devices: {
          limit: devLimit,
          active: activeDevices,
          available: devLimit == null ? null : Math.max(0, devLimit - activeDevices),
          requires_configuration: devLimit == null,
        },
      });
    }

    return Response.json({ error: 'Unknown action. Use create, set_device_limit, set_operational_user_limit or usage', code: 'bad_action' }, { status: 400 });
  } catch (error) {
    const msg = String((error as any)?.message || error);
    console.log('[customerAccess] fatal', msg);
    if (/^Error in field /i.test(msg)) {
      return Response.json({ error: `The customer could not be saved: ${msg}`, code: 'validation_error' }, { status: 500 });
    }
    return Response.json({ error: 'Customer operation failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}