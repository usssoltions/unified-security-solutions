import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getAllowedRolesForModules } from '../../shared/tenantRoles.ts';

/**
 * inviteTenantUser — securely invite a tenant-scoped user and queue the
 * tenant scoping to apply when the invitee accepts the invitation.
 *
 * Payload contract (matches the Add User form):
 *   action: "invite"
 *   email            * required, normalised (trim + lowercase)
 *   first_name       * required
 *   last_name          optional
 *   role_type        * required, validated against the customer's ENABLED
 *                        MODULES server-side (shared/tenantRoles) — fail closed
 *   customer_id        required for customer-scoped roles; must belong to the
 *                        caller's reseller (reseller admins) or the given
 *                        reseller_id (platform admins)
 *   reseller_id        resolved reseller scope (caller's own for reseller admins)
 *   phone, user_status optional
 *
 * Security model:
 *  - Platform `role: admin` (USS Platform Admin) is never granted to invitees.
 *  - Reseller Admin creation is PLATFORM-ONLY.
 *  - Reseller Admins may invite only within their own reseller, only for
 *    customers that belong to that reseller, and only roles allowed by the
 *    customer's enabled modules.
 *  - Idempotent: one PendingTenantScope per email.
 */
function escHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

/**
 * managePendingInvitation — resend / cancel an EXISTING pending invitation
 * (PendingTenantScope) by id. Reuses the stored record: resend NEVER creates a
 * duplicate scope; it re-dispatches the platform invitation to the exact
 * stored email address and updates sent_at / delivery_status. On delivery
 * failure the record is RETAINED with delivery_status "failed".
 *
 * Authorization: Platform Admin, or Reseller Admin owning the invitation's
 * reseller. A cancelled/applied/expired invitation can no longer be managed.
 */
async function managePendingInvitation(base44: any, caller: any, body: any, action: string): Promise<Response> {
  const { pending_scope_id } = body || {};
  if (!pending_scope_id) {
    return Response.json({ error: 'pending_scope_id is required', code: 'missing_scope_id' }, { status: 400 });
  }

  const rows = await base44.asServiceRole.entities.PendingTenantScope.filter({ id: pending_scope_id }).catch(() => []);
  const scope = (rows && rows[0]) ? rows[0] : null;
  if (!scope) {
    return Response.json({ error: 'Invitation not found', code: 'invitation_not_found' }, { status: 404 });
  }

  const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin';
  const isResellerAdmin = caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller';
  if (!isPlatformAdmin && !isResellerAdmin) {
    return Response.json({ error: 'You do not have permission to manage invitations', code: 'permission_denied' }, { status: 403 });
  }
  if (!isPlatformAdmin) {
    if (!scope.reseller_id || scope.reseller_id !== caller.reseller_id) {
      return Response.json({ error: 'That invitation belongs to another reseller', code: 'permission_denied' }, { status: 403 });
    }
  }
  if (scope.status !== 'pending') {
    return Response.json({
      error: `That invitation is ${scope.status} and can no longer be ${action === 'resend' ? 'resent' : 'cancelled'}.`,
      code: 'invitation_not_pending',
    }, { status: 400 });
  }

  const callerName = caller.display_name || caller.full_name || caller.email;
  const now = new Date().toISOString();

  if (action === 'cancel') {
    await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, {
      status: 'cancelled',
      cancelled_at: now,
      cancelled_by: caller.id,
    });
    try {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'invitation.cancelled', user_id: caller.id, user_name: callerName,
        reseller_id: scope.reseller_id || undefined, customer_id: scope.customer_id || undefined,
        entity_name: 'PendingTenantScope', entity_id: scope.id,
        action: 'cancel_invitation', notes: `Cancelled invitation for ${scope.email}`,
      });
    } catch (_) {}
    return Response.json({ success: true, cancelled: true });
  }

  // ── resend ──
  try {
    await base44.users.inviteUser(scope.email, 'user');
    await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, { sent_at: now, delivery_status: 'sent' });
    try {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'invitation.resent', user_id: caller.id, user_name: callerName,
        reseller_id: scope.reseller_id || undefined, customer_id: scope.customer_id || undefined,
        entity_name: 'PendingTenantScope', entity_id: scope.id,
        action: 'resend_invitation', notes: `Re-sent invitation to ${scope.email}`,
      });
    } catch (_) {}
    return Response.json({ success: true, resent: true, delivery_status: 'sent', sent_at: now });
  } catch (invErr) {
    const msg = String(invErr?.message || invErr);
    console.log('[inviteTenantUser] resend threw', msg);
    if (/already|exists|pending|invited/i.test(msg)) {
      // The platform already has an invitation outstanding for this email —
      // treat as re-sent; NO duplicate invitation or scope is created.
      await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, { sent_at: now, delivery_status: 'sent' });
      return Response.json({ success: true, resent: true, delivery_status: 'sent', sent_at: now, already_outstanding: true });
    }
    // Delivery failed — RETAIN the record with Delivery Failed status.
    await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, { delivery_status: 'failed' });
    return Response.json({
      success: true, resent: false, delivery_status: 'failed',
      error: 'The invitation email could not be sent. The invitation was kept — you can try again.',
    }, { status: 202 });
  }
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Authentication required', code: 'auth_required' }, { status: 401 });

    const body = await req.json();
    const {
      action, email: rawEmail, role_type, reseller_id, customer_id,
      first_name, last_name, display_name: providedDisplayName, phone,
      user_status, status,
    } = body;
    // Normalise the email once (trim + lowercase) so the pending scope, the
    // existing-user lookup, the invitation, and applyMyPendingScope's lookup
    // all key on the exact same value regardless of how the admin typed it.
    const email = (rawEmail || '').trim().toLowerCase();
    const firstName = String(first_name || '').trim();
    const lastName = String(last_name || '').trim();
    const displayName = String(providedDisplayName || '').trim() || [firstName, lastName].filter(Boolean).join(' ').trim() || null;
    const userStatus = user_status || status || 'active';

    if (!['invite', 'resend', 'cancel'].includes(action)) {
      return Response.json({ error: 'Unsupported action', code: 'bad_action' }, { status: 400 });
    }
    if (action === 'resend' || action === 'cancel') {
      return await managePendingInvitation(base44, caller, body, action);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'A valid email address is required', code: 'invalid_email' }, { status: 400 });
    }
    if (!firstName) {
      return Response.json({ error: 'First name is required', code: 'missing_first_name' }, { status: 400 });
    }
    if (!role_type) {
      return Response.json({ error: 'A role is required', code: 'missing_role' }, { status: 400 });
    }

    const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin';
    const isResellerAdmin = caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller';

    if (!isPlatformAdmin && !isResellerAdmin) {
      return Response.json({ error: 'You do not have permission to invite users', code: 'permission_denied' }, { status: 403 });
    }
    if (role_type === 'reseller_admin' && !isPlatformAdmin) {
      return Response.json({ error: 'Only a Platform Admin can create Reseller Administrators', code: 'permission_denied' }, { status: 403 });
    }
    if (role_type === 'platform_admin') {
      return Response.json({ error: 'Cannot create Platform Admins', code: 'permission_denied' }, { status: 403 });
    }
    if (isResellerAdmin && !isPlatformAdmin) {
      if (!caller.reseller_id || reseller_id !== caller.reseller_id) {
        return Response.json({ error: 'You can only create users within your own reseller', code: 'permission_denied' }, { status: 403 });
      }
      if (role_type === 'reseller_admin') {
        return Response.json({ error: 'Reseller Admins cannot create other Reseller Admins', code: 'permission_denied' }, { status: 403 });
      }
    }

    let admin_level = 'customer';
    if (role_type === 'reseller_admin') admin_level = 'reseller';

    // Validate customer belongs to the resolved reseller (when customer given).
    let customer;
    if (customer_id) {
      const custs = await base44.asServiceRole.entities.Customer.filter({ id: customer_id });
      customer = custs[0];
      if (!customer) return Response.json({ error: 'Selected customer not found', code: 'customer_not_found' }, { status: 404 });
      const customerReseller = customer.reseller_id || null;
      if (isResellerAdmin && !isPlatformAdmin) {
        if (!customerReseller || customerReseller !== caller.reseller_id) {
          return Response.json({ error: 'That customer does not belong to your reseller', code: 'permission_denied' }, { status: 403 });
        }
      }
      if (reseller_id && customerReseller && customerReseller !== reseller_id) {
        return Response.json({ error: 'The selected customer does not belong to that reseller', code: 'bad_customer' }, { status: 400 });
      }
    }

    // ── SERVER-SIDE module-scoped role validation (fail closed). ──
    // The UI derives role options from the same registry (shared/tenantRoles,
    // mirrored in src/lib/roleCatalog.js), but this is the authoritative
    // check: a manipulated request can never assign a role that belongs to a
    // module the customer has not enabled.
    if (customer_id && role_type !== 'reseller_admin') {
      const ents = await base44.asServiceRole.entities.ModuleEntitlement.filter({ customer_id }).catch(() => []);
      const enabledKeys = (ents || [])
        .filter((e) => e.enabled && (!e.status || e.status === 'active'))
        .map((e) => e.module_key);
      const allowed = getAllowedRolesForModules(enabledKeys);
      if (!allowed.has(role_type)) {
        return Response.json({
          error: 'The selected role is not available for this customer. Roles depend on the modules enabled for this customer.',
          code: 'role_not_allowed',
          allowed_roles: Array.from(allowed),
        }, { status: 400 });
      }
    }

    const effectiveReseller = reseller_id || (customer ? customer.reseller_id : null) || null;
    const callerName = caller.display_name || caller.full_name || caller.email;
    const moduleLabel = customer?.customer_type
      ? customer.customer_type.charAt(0).toUpperCase() + customer.customer_type.slice(1)
      : '';

    console.log('[inviteTenantUser] caller', caller.id, 'reseller_id', effectiveReseller, 'role_type', role_type, 'email', email);

    // ── Idempotency 1: if a User already exists for this email, rescope it. ──
    let existing = await base44.asServiceRole.entities.User.filter({ email }).catch(() => []);
    existing = (existing && existing[0]) ? existing[0] : null;
    if (existing) {
      const scopeUpdates = { role_type, admin_level, reseller_id: effectiveReseller, customer_id: customer_id || null };
      if (displayName) scopeUpdates.display_name = displayName;
      if (phone) scopeUpdates.phone = phone;
      try {
        await base44.asServiceRole.entities.User.update(existing.id, scopeUpdates);
      } catch (e) {
        console.log('[inviteTenantUser] existing rescope failed', String(e?.message || e));
        return Response.json({ error: 'That user already exists but could not be re-scoped. Contact support.', code: 'scope_failed' }, { status: 202 });
      }
      try {
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          event_type: 'user.updated', user_id: caller.id, user_name: callerName,
          reseller_id: effectiveReseller || undefined, customer_id: customer_id || undefined,
          entity_name: 'User', entity_id: existing.id, action: 'rescope_existing_user',
          new_values: JSON.stringify(scopeUpdates), notes: `Re-scoped existing ${email} as ${role_type}`,
        });
      } catch (_) {}
      // Existing users are registered, so SendEmail reaches them — send a
      // module/role context email (new invitees get only the platform invite,
      // since SendEmail to non-registered addresses requires a custom domain).
      try {
        const orgName = customer?.name || 'your organization';
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject: `Your access to ${orgName}${moduleLabel ? ` (${moduleLabel})` : ''} has been updated`,
          body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#1e293b">Access updated</h2>
            <p>Hi ${escHtml(displayName || '')},</p>
            <p>Your access to <b>${escHtml(orgName)}</b> has been updated to <b>${escHtml(role_type.replace(/_/g, ' '))}</b>${moduleLabel ? ` on the <b>${moduleLabel}</b> module` : ''}.</p>
            <p>Log in to the app to see your updated workspace.</p>
            <p style="color:#64748b;font-size:12px">Updated by ${escHtml(callerName)}</p>
          </div>`,
        });
      } catch (_) {}
      return Response.json({ success: true, user_id: existing.id, rescoped: true });
    }

    // ── Idempotency 2: upsert a PendingTenantScope by email. ──
    let pendingRows = await base44.asServiceRole.entities.PendingTenantScope.filter({ email }).catch(() => []);
    let pending = (pendingRows && pendingRows[0]) ? pendingRows[0] : null;
    const scopeFields = {
      email,
      role_type,
      admin_level,
      reseller_id: effectiveReseller || null,
      customer_id: customer_id || null,
      first_name: firstName || null,
      last_name: lastName || null,
      display_name: displayName || null,
      phone: phone || null,
      user_status: userStatus || 'active',
      status: 'pending',
      invited_by: caller.id,
      invited_by_name: callerName,
      notes: `Invited as ${role_type}${moduleLabel ? ` (${moduleLabel})` : ''} (${userStatus})`,
    };

    if (pending) {
      // A pending scope already exists for this email — update it and do NOT
      // send another invitation (idempotent: no duplicate invite).
      await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, scopeFields);
      console.log('[inviteTenantUser] updated existing pending scope', pending.id);
      return Response.json({ success: true, already_pending: true, pending_scope_id: pending.id });
    }

    pending = await base44.asServiceRole.entities.PendingTenantScope.create(scopeFields);
    console.log('[inviteTenantUser] created pending scope', pending.id);

    // ── Send the invitation with platform role "user" (NEVER "admin"). ──
    const nowIso = new Date().toISOString();
    try {
      await base44.users.inviteUser(email, 'user');
      console.log('[inviteTenantUser] inviteUser ok');
      try { await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { sent_at: nowIso, delivery_status: 'sent' }); } catch (_) {}
    } catch (invErr) {
      const msg = String(invErr?.message || invErr);
      console.log('[inviteTenantUser] inviteUser threw', msg);
      if (/already|exists|pending|invited/i.test(msg)) {
        // An invitation is already pending for this email; our PendingTenantScope
        // will apply when it is accepted. Not an error — no duplicate created.
        try { await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { sent_at: nowIso, delivery_status: 'sent' }); } catch (_) {}
        return Response.json({ success: true, already_pending: true, pending_scope_id: pending.id });
      }
      // The invitation email could not be sent, but the pending scope is queued.
      try { await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { delivery_status: 'failed' }); } catch (_) {}
      return Response.json({
        error: 'The invitation email could not be sent right now. The tenant scoping is queued and will apply when the user is set up. Please try sending the invite again.',
        code: 'invite_service_failed',
        pending_scope_id: pending.id,
        partial: true,
      }, { status: 202 });
    }

    try {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'user.created', user_id: caller.id, user_name: callerName,
        reseller_id: effectiveReseller || undefined, customer_id: customer_id || undefined,
        entity_name: 'PendingTenantScope', entity_id: pending.id,
        action: 'invite_tenant_user',
        new_values: JSON.stringify({ email, role_type, admin_level, reseller_id: effectiveReseller, customer_id: customer_id || null }),
        notes: `Invited ${email} as ${role_type} (scope queued)`,
      });
    } catch (_) {}

    return Response.json({ success: true, pending_scope_id: pending.id, invite_sent: true });
  } catch (error) {
    console.log('[inviteTenantUser] fatal', String(error?.message || error));
    return Response.json({ error: 'Invitation failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}