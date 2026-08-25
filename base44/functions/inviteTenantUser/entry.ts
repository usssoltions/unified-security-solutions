import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * inviteTenantUser — securely invite a tenant-scoped user (Reseller Admin,
 * Customer Admin, or regular user) and queue the tenant scoping to apply when
 * the invitee accepts the invitation.
 *
 * Why a queue: Base44 creates the User record only when the invitee ACCEPTS the
 * invitation, not at invite time. The original implementation tried to scope a
 * non-existent User record, which threw "User not found" (HTTP 500). Now we
 * write a PendingTenantScope record keyed by email; a User-create automation
 * (applyPendingTenantScope) applies it server-side when the invitee accepts.
 *
 * Security model:
 *  - Platform `role: admin` is reserved for USS Platform Admins. The invite
 *    always uses platform role "user"; the queued scope sets a non-platform
 *    role_type + admin_level. Platform `role: admin` is NEVER granted.
 *  - Reseller Admin creation is PLATFORM-ONLY.
 *  - Reseller Admins may invite Customer Admins / users only within their own
 *    reseller, and only for customers that belong to that reseller.
 *  - Idempotent: one PendingTenantScope per email. Retrying does not create a
 *    duplicate user or a duplicate invitation.
 *  - If a User with the email already exists (already accepted), scoping is
 *    applied directly to the existing record instead of re-inviting.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Authentication required', code: 'auth_required' }, { status: 401 });

    const body = await req.json();
    const { action, email, role_type, reseller_id, customer_id, display_name, phone, status } = body;

    if (action !== 'invite') {
      return Response.json({ error: 'Only action "invite" is supported', code: 'bad_action' }, { status: 400 });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'A valid email address is required', code: 'invalid_email' }, { status: 400 });
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
    if (role_type === 'platform_admin' && !isPlatformAdmin) {
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
    else if (role_type === 'platform_admin') admin_level = 'platform';

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
    const effectiveReseller = reseller_id || (customer ? customer.reseller_id : null) || null;
    const callerName = caller.display_name || caller.full_name || caller.email;

    console.log('[inviteTenantUser] caller', caller.id, 'reseller_id', effectiveReseller, 'role_type', role_type, 'email', email);

    // ── Idempotency 1: if a User already exists for this email, rescope it. ──
    let existing = await base44.asServiceRole.entities.User.filter({ email }).catch(() => []);
    existing = (existing && existing[0]) ? existing[0] : null;
    if (existing) {
      const scopeUpdates = { role_type, admin_level, reseller_id: effectiveReseller, customer_id: customer_id || null };
      if (display_name) scopeUpdates.display_name = display_name;
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
      display_name: display_name || null,
      phone: phone || null,
      status: 'pending',
      invited_by: caller.id,
      invited_by_name: callerName,
      notes: `Invited as ${role_type}${status ? ` (${status})` : ''}`,
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
    try {
      await base44.users.inviteUser(email, 'user');
      console.log('[inviteTenantUser] inviteUser ok');
    } catch (invErr) {
      const msg = String(invErr?.message || invErr);
      console.log('[inviteTenantUser] inviteUser threw', msg);
      if (/already|exists|pending|invited/i.test(msg)) {
        // An invitation is already pending for this email; our PendingTenantScope
        // will apply when it is accepted. Not an error.
        return Response.json({ success: true, already_pending: true, pending_scope_id: pending.id });
      }
      // The invitation email could not be sent, but the pending scope is queued.
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