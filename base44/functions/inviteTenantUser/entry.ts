import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getAllowedRolesForModules } from '../../shared/tenantRoles.ts';
import { buildInvitationEmail } from '../../shared/tenantBranding.ts';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import {
  enforceOperationalUserLimit, USER_LIMIT_REACHED_MESSAGE,
} from '../../shared/userLicensing.ts';
import { emailsNearMatch, normaliseEmail } from '../../shared/scopeDiagnostics.ts';

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
  // CUSTOMER ADMINISTRATORS may manage invitations for their OWN customer —
  // previously only platform/reseller admins could resend or cancel, which
  // left a customer admin unable to repair their own failed deliveries.
  const isCustomerAdmin =
    !isPlatformAdmin && !isResellerAdmin &&
    ['customer_admin', 'practice_admin', 'estate_manager'].includes(caller.role_type) &&
    !!caller.customer_id && scope.customer_id === caller.customer_id;
  if (!isPlatformAdmin && !isResellerAdmin && !isCustomerAdmin) {
    return Response.json({ error: 'You do not have permission to manage invitations', code: 'permission_denied' }, { status: 403 });
  }
  if (!isPlatformAdmin && !isResellerAdmin) {
    // Customer admin: the invitation was already verified to belong to their
    // own customer above.
  } else if (!isPlatformAdmin) {
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
    // Branded, module-aware invitation email (best-effort, no duplicate scope).
    await sendBrandedInvitationEmail(base44, {
      to: scope.email, customerId: scope.customer_id || null, resellerId: scope.reseller_id || null,
      roleType: scope.role_type, inviteeName: scope.display_name || [scope.first_name, scope.last_name].filter(Boolean).join(' ') || null,
      inviterName: callerName, kind: 'resent',
    });
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

/**
 * Best-effort branded, module-aware context email (customer → reseller →
 * platform branding; friendly role display; descriptions from the customer's
 * ENABLED modules — never generic security wording). Failure is logged and
 * NEVER fails the invitation itself.
 */
async function sendBrandedInvitationEmail(base44: any, opts: {
  to: string; customerId?: string | null; resellerId?: string | null;
  roleType: string; inviteeName?: string | null; inviterName?: string | null; kind: string;
}): Promise<void> {
  // Delivery audit — every branded invitation email attempt is recorded in
  // NotificationDelivery (sent/failed + reason), so a branded email that
  // never reaches the invitee is diagnosable instead of silently swallowed.
  const auditBase = {
    event_key: `invitation_email:${opts.kind}:${opts.to}`,
    channel: 'email',
    customer_id: opts.customerId || undefined,
    reseller_id: opts.resellerId || undefined,
    recipient_name: opts.inviteeName || null,
    recipient_address: opts.to,
  };
  try {
    const ents = opts.customerId
      ? await base44.asServiceRole.entities.ModuleEntitlement.filter({ customer_id: opts.customerId }).catch(() => [])
      : [];
    const enabledKeys = (ents || [])
      .filter((e: any) => e.enabled && (!e.status || e.status === 'active'))
      .map((e: any) => e.module_key);
    // ONE AUTHORITATIVE BRAND RESOLVER — the same shared resolver
    // (Customer → Reseller → USS platform) every operational notification
    // uses. The invitation previously resolved its brand through a separate
    // duplicated resolver; both read the same authoritative tenant records,
    // but there is now exactly ONE branding implementation platform-wide.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: opts.customerId || null, reseller_id: opts.resellerId || null });
    const email = buildInvitationEmail({
      brand, displayName: brand.brand_name, role_type: opts.roleType, enabledModuleKeys: enabledKeys,
      inviteeName: opts.inviteeName, inviterName: opts.inviterName, kind: opts.kind,
    });
    // GUARDED AUDITED DELIVERY — invitation email passes the delivery-mode
    // guard like every other application email (audit row written inside).
    await sendAuditedEmail(base44.asServiceRole, {
      to: opts.to, subject: email.subject, html: email.body,
      brand,
      recipient_name: opts.inviteeName || null,
      event_type: 'tenant_invitation', reference_id: opts.to,
      template_name: 'tenant_invitation',
    });
    console.log('[inviteTenantUser] branded invitation email sent to', opts.to, 'as', brand.brand_name);
    try {
      await base44.asServiceRole.entities.NotificationDelivery.create({
        ...auditBase, status: 'sent', send_time: new Date().toISOString(),
        idempotency_key: auditBase.event_key,
      });
    } catch (_) {}
  } catch (e) {
    const reason = String(e?.message || e);
    console.log('[inviteTenantUser] branded invitation email FAILED for', opts.to, '-', reason);
    try {
      await base44.asServiceRole.entities.NotificationDelivery.create({
        ...auditBase, status: 'failed', provider_response: reason.slice(0, 500),
        retries: 0, idempotency_key: auditBase.event_key,
      });
    } catch (_) {}
  }
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Authentication required', code: 'auth_required' }, { status: 401 });

    const body = await req.json();
    let {
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
    // PROVISIONING REPAIR — invitation-verified scope only. When true, an
    // existing account is NEVER re-scoped at send time: the scope is queued
    // as a pending scope for the invited EXACT address and applies
    // server-side when the invitee signs in through the invitation flow
    // (applyMyPendingScope). A near-match address is diagnostic only.
    const isRepair = body.repair === true;

    if (!['invite', 'resend', 'cancel'].includes(action)) {
      return Response.json({ error: 'Unsupported action', code: 'bad_action' }, { status: 400 });
    }
    if (action === 'resend' || action === 'cancel') {
      return await managePendingInvitation(base44, caller, body, action);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: 'A valid email address is required', code: 'invalid_email' }, { status: 400 });
    }
    // The Customer Administrator invite dialog collects email + role only —
    // the name is optional (completed by the invitee from their profile).
    if (!role_type) {
      return Response.json({ error: 'A role is required', code: 'missing_role' }, { status: 400 });
    }

    const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin';
    const isResellerAdmin = caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller';
    // Customer Administrators may invite users into their OWN customer only.
    // The tenant scope is forced SERVER-SIDE from the caller's User record —
    // a customer admin can never select another customer or reseller, and
    // the role is validated against their customer's enabled modules below.
    // Role-based ONLY (no admin_level fallback): operational roles such as
    // Customer Admin (operations) can never invite users.
    const isCustomerAdmin =
      !isPlatformAdmin && !isResellerAdmin &&
      ['customer_admin', 'practice_admin', 'estate_manager'].includes(caller.role_type);

    if (!isPlatformAdmin && !isResellerAdmin && !isCustomerAdmin) {
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

    // admin_level marks TENANT ADMINISTRATORS only. Previously EVERY invited
    // user (including guards and Customer Admin (operations)) received the
    // 'customer' admin level, which leaked unauthorized user-management
    // capability. Operational roles now receive NO admin level.
    const TENANT_ADMIN_ROLES = ['customer_admin', 'practice_admin', 'estate_manager'];
    let admin_level: string | null = null;
    if (role_type === 'reseller_admin') admin_level = 'reseller';
    else if (TENANT_ADMIN_ROLES.includes(role_type)) admin_level = 'customer';

    // Customer Admins are pinned to their own customer. Any client-supplied
    // customer/reseller id is ignored (or rejected on mismatch) — the scope
    // comes from the caller's User record, and the reseller is resolved from
    // the Customer record server-side (effectiveReseller below).
    if (isCustomerAdmin) {
      if (!caller.customer_id) {
        return Response.json({ error: 'Your account has no customer scope. Please contact support.', code: 'permission_denied' }, { status: 403 });
      }
      if (customer_id && customer_id !== caller.customer_id) {
        return Response.json({ error: 'You can only invite users into your own organisation', code: 'permission_denied' }, { status: 403 });
      }
      customer_id = caller.customer_id;
      reseller_id = undefined;
    }

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

    // ── Site assignment (site-scoped operational roles, e.g. Security Guard
    // assigned to a specific site). Validated SERVER-SIDE: the site must
    // exist, be active, and belong to the SELECTED customer — never a
    // cross-tenant site. Stored on the pending scope and applied to the
    // invitee's User record automatically on acceptance.
    let site_id: string | null = null;
    if (body.site_id) {
      if (!customer_id) {
        return Response.json({ error: 'A site can only be assigned together with a customer', code: 'bad_site' }, { status: 400 });
      }
      const siteRows = await base44.asServiceRole.entities.Site.filter({ id: body.site_id }).catch(() => []);
      const site = (siteRows && siteRows[0]) ? siteRows[0] : null;
      if (!site || site.customer_id !== customer_id) {
        return Response.json({ error: 'The selected site does not belong to the selected customer', code: 'bad_site' }, { status: 400 });
      }
      if (site.status && site.status !== 'active') {
        return Response.json({ error: 'The selected site is not active', code: 'bad_site' }, { status: 400 });
      }
      site_id = site.id;
    }

    // SECURITY GUARD REQUIRES A SITE (2026-09-29, server-side fail closed):
    // a guard invitation that cannot result in a valid site-scoped account is
    // never created or sent. Applies to EVERY inviter class (platform, reseller
    // and customer admin) through this one canonical pipeline; the client-side
    // required field is UX only.
    if (role_type === 'guard' && !site_id) {
      return Response.json({
        error: 'Security Guard requires a site assignment. Select the site this guard will work at.',
        code: 'guard_requires_site',
      }, { status: 400 });
    }

    // ── SERVER-SIDE module-scoped role validation (fail closed). ──
    // The UI derives role options from the same registry (shared/tenantRoles,
    // mirrored in src/lib/roleCatalog.js), but this is the authoritative
    // check: a manipulated request can never assign a role that belongs to a
    // module the customer has not enabled.
    let enabledKeys: string[] = [];
    if (customer_id && role_type !== 'reseller_admin') {
      const ents = await base44.asServiceRole.entities.ModuleEntitlement.filter({ customer_id }).catch(() => []);
      enabledKeys = (ents || [])
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

    // NEAR-MISS GUARD (proven "Account Setup Incomplete" vector — mistyped
    // invitation addresses): if a fully UNSCOPED account already exists for a
    // near-identical email (typo'd domain or mistyped local part), the admin
    // is WARNED in the response — non-blocking, since either address may be
    // genuinely intended. The blocked account is invisible in the Users list,
    // so this is often the only signal at invite time.
    let similar_accounts: string[] = [];
    try {
      const unscopedUsers = await base44.asServiceRole.entities.User.filter({
        customer_id: null, reseller_id: null, role_type: null,
      }, '-created_date', 500).catch(() => []);
      similar_accounts = (unscopedUsers || [])
        .filter((u: any) => u.email && emailsNearMatch(email, u.email))
        .map((u: any) => normaliseEmail(u.email))
        .slice(0, 5);
    } catch (_) { /* diagnostics must never break the invitation */ }

    // ── Idempotency 1: if a User already exists for this email, rescope it. ──
    let existing = await base44.asServiceRole.entities.User.filter({ email }).catch(() => []);
    existing = (existing && existing[0]) ? existing[0] : null;

    if (existing && isRepair) {
      // PROVISIONING REPAIR — invitation-verified only. A near-match email is
      // diagnostic: access is NEVER granted by resemblance, and an existing
      // account is never re-scoped at send time. The scope is QUEUED as a
      // pending scope for the exact invited address and applies server-side
      // when the invitee signs in through the invitation flow. A confirmed
      // address with NO existing account falls through to the normal
      // fresh-invitation flow below (the blocked account stays untouched).
      const repairFields = {
        email, role_type, admin_level,
        reseller_id: effectiveReseller || null,
        customer_id: customer_id || null,
        site_id: site_id || null,
        first_name: firstName || null,
        last_name: lastName || null,
        display_name: displayName || null,
        phone: phone || null,
        user_status: userStatus || 'active',
        status: 'pending',
        cancelled_at: null,
        cancelled_by: null,
        invited_by: caller.id,
        invited_by_name: callerName,
        notes: `Repair invitation — ${role_type}${moduleLabel ? ` (${moduleLabel})` : ''} (${userStatus || 'active'})`,
      };
      const repairRows = await base44.asServiceRole.entities.PendingTenantScope.filter({ email }).catch(() => []);
      let repairScope = (repairRows || []).find((p: any) => p.status === 'pending') || (repairRows || [])[0] || null;
      if (repairScope && (repairRows || []).some((p: any) => p.id !== repairScope.id && p.status === 'pending')) {
        await base44.asServiceRole.entities.PendingTenantScope.updateMany(
          { email, status: 'pending', id: { $ne: repairScope.id } },
          { $set: { status: 'cancelled', cancelled_at: new Date().toISOString(), notes: `Superseded — repair re-invitation for ${email}` } },
        ).catch(() => {});
      }
      let repairQueued: any = null;
      try {
        const repairSlot = await enforceOperationalUserLimit(base44.asServiceRole, {
          customer, roleType: role_type, email, existingUser: existing,
          mutate: async () => {
            return repairScope
              ? base44.asServiceRole.entities.PendingTenantScope.update(repairScope.id, repairFields)
              : base44.asServiceRole.entities.PendingTenantScope.create({ ...repairFields, delivery_status: 'queued' });
          },
        });
        if (repairSlot.lock_error) {
          return Response.json({ error: 'The system is busy processing another user change. Please try again.', code: 'slot_lock_timeout' }, { status: 503 });
        }
        if (repairSlot.blocked) {
          return Response.json({
            error: USER_LIMIT_REACHED_MESSAGE,
            code: 'operational_user_limit_reached',
            used: repairSlot.used, limit: repairSlot.limit,
          }, { status: 409 });
        }
        repairQueued = repairSlot.result;
      } catch (e) {
        console.log('[inviteTenantUser] repair scope queue failed', String(e?.message || e));
        return Response.json({ error: 'The repair invitation could not be queued. Please try again.', code: 'scope_failed' }, { status: 500 });
      }
      if (repairQueued && repairQueued.id) repairScope = repairQueued;
      if (!repairScope || !repairScope.id) {
        return Response.json({ error: 'The repair invitation could not be queued. Please try again.', code: 'scope_failed' }, { status: 500 });
      }
      // The account is already registered, so the branded invitation email
      // reaches it directly; delivery status is stamped from the actual send.
      const repairDelivery: any = { sent_at: new Date().toISOString(), delivery_status: 'sent' };
      try {
        await sendBrandedInvitationEmail(base44, {
          to: email, customerId: customer_id || null, resellerId: effectiveReseller,
          roleType: role_type, inviteeName: displayName, inviterName: callerName, kind: 'updated',
        });
      } catch (e) {
        console.log('[inviteTenantUser] repair email failed', String(e?.message || e));
        repairDelivery.delivery_status = 'failed';
      }
      await base44.asServiceRole.entities.PendingTenantScope.update(repairScope.id, repairDelivery).catch(() => {});
      try {
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          event_type: 'tenant_user.repair_invited', user_id: caller.id, user_name: callerName,
          reseller_id: effectiveReseller || undefined, customer_id: customer_id || undefined,
          entity_name: 'PendingTenantScope', entity_id: repairScope.id,
          action: 'repair_invitation_queued',
          new_values: JSON.stringify({ email, role_type, admin_level, reseller_id: effectiveReseller, customer_id: customer_id || null }),
          notes: `Repair invitation queued for ${email} as ${role_type} — scope applies on invitation-flow sign-in`,
        });
      } catch (_) {}
      return Response.json({ success: true, repair_queued: true, pending_scope_id: repairScope.id, similar_accounts });
    }

    if (existing) {
      const scopeUpdates = { role_type, admin_level, reseller_id: effectiveReseller, customer_id: customer_id || null };
      // Guard scope includes the SITE — a rescope must be equivalent to
      // accepting a fresh pending scope (a re-invited guard gets the invited
      // site stamped immediately, never left site-less and blocked).
      scopeUpdates.site_id = site_id || null;
      if (displayName) scopeUpdates.display_name = displayName;
      if (firstName) scopeUpdates.first_name = firstName;
      if (lastName) scopeUpdates.last_name = lastName;
      scopeUpdates.user_status = userStatus || 'active';
      if (phone) scopeUpdates.phone = phone;
      try {
        // OPERATIONAL USER LICENSING — the entitlement check and the rescope
        // mutation run atomically under the per-customer slot mutex; a blocked
        // invitation is rejected BEFORE any user mutation occurs.
        const rescopeSlot = await enforceOperationalUserLimit(base44.asServiceRole, {
          customer, roleType: role_type, email, existingUser: existing,
          mutate: async () => { await base44.asServiceRole.entities.User.update(existing.id, scopeUpdates); },
        });
        if (rescopeSlot.lock_error) {
          return Response.json({ error: 'The system is busy processing another user change. Please try again.', code: 'slot_lock_timeout' }, { status: 503 });
        }
        if (rescopeSlot.blocked) {
          await base44.asServiceRole.entities.PlatformAuditLog.create({
            event_type: 'tenant_user.invite_blocked_user_limit',
            customer_id: customer_id || undefined, reseller_id: effectiveReseller || undefined,
            user_id: caller.id, user_name: callerName,
            entity_name: 'User', entity_id: existing.id, action: 'invite_blocked_user_limit',
            new_values: JSON.stringify({ email, role_type, used: rescopeSlot.used, limit: rescopeSlot.limit }),
            notes: `Operational-user limit reached — re-invite of ${email} as ${role_type} blocked`,
          }).catch(() => {});
          return Response.json({
            error: USER_LIMIT_REACHED_MESSAGE,
            code: 'operational_user_limit_reached',
            used: rescopeSlot.used, limit: rescopeSlot.limit,
          }, { status: 409 });
        }
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
      // Existing users are registered, so SendEmail reaches them — send the
      // branded, module-aware context email.
      await sendBrandedInvitationEmail(base44, {
        to: email, customerId: customer_id || null, resellerId: effectiveReseller,
        roleType: role_type, inviteeName: displayName, inviterName: callerName, kind: 'updated',
      });
      return Response.json({ success: true, user_id: existing.id, rescoped: true, similar_accounts });
    }

    // ── Idempotency 2: upsert a PendingTenantScope by email. ──
    // ONE AUTHORITATIVE RECORD per email: prefer the pending scope; any OTHER
    // still-pending duplicate for the same address is cancelled (superseded)
    // so applyMyPendingScope can never pick an arbitrary stale scope with the
    // wrong tenant/role.
    const pendingRows = await base44.asServiceRole.entities.PendingTenantScope.filter({ email }).catch(() => []);
    const rowList = pendingRows || [];
    let pending = rowList.find((p: any) => p.status === 'pending') || rowList[0] || null;
    if (pending && rowList.some((p: any) => p.id !== pending.id && p.status === 'pending')) {
      await base44.asServiceRole.entities.PendingTenantScope.updateMany(
        { email, status: 'pending', id: { $ne: pending.id } },
        { $set: { status: 'cancelled', cancelled_at: new Date().toISOString(), notes: `Superseded — duplicate invitation scope for ${email}` } },
      ).catch(() => {});
    }
    const scopeFields = {
      email,
      role_type,
      admin_level,
      reseller_id: effectiveReseller || null,
      customer_id: customer_id || null,
      site_id,
      first_name: firstName || null,
      last_name: lastName || null,
      display_name: displayName || null,
      phone: phone || null,
      user_status: userStatus || 'active',
      status: 'pending',
      // Re-inviting an invitation that was previously CANCELLED must clear the
      // cancel markers — leaving a stale cancelled_at on a status:'pending'
      // row made the pending-list query hide it forever (count 0, no
      // Resend/Cancel actions) while the by-email duplicate check still
      // matched it ("already pending"), with no way to resend from the UI.
      cancelled_at: null,
      cancelled_by: null,
      invited_by: caller.id,
      invited_by_name: callerName,
      notes: `Invited as ${role_type}${moduleLabel ? ` (${moduleLabel})` : ''} (${userStatus})`,
    };

    if (pending) {
      // A pending scope already exists for this email — update it and do NOT
      // send another invitation (idempotent: no duplicate invite, and no
      // additional operational-user slot: this identity already holds one).
      try {
        await enforceOperationalUserLimit(base44.asServiceRole, {
          customer, roleType: role_type, email,
          mutate: async () => { await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, scopeFields); },
        });
      } catch (e) {
        console.log('[inviteTenantUser] pending scope update failed', String(e?.message || e));
        return Response.json({ error: 'The invitation could not be updated. Please try again.', code: 'scope_failed' }, { status: 500 });
      }
      console.log('[inviteTenantUser] updated existing pending scope', pending.id);
      // CONTROLLED RESEND on every re-invite (the admin re-submitting the
      // form IS a resend request). The platform invitation is idempotent —
      // an outstanding invitation is never duplicated (the "already"
      // outcome below) — so this can never create a duplicate invitation,
      // but a delivery that failed or never arrived IS retried here instead
      // of the old behaviour that only retried when delivery_status was
      // already stamped 'failed' (which left a record stamped 'sent' from a
      // stale dispatch permanently un-retried).
      let resendOutcome = 'dispatched';
      try {
        await base44.users.inviteUser(email, 'user');
        await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { sent_at: new Date().toISOString(), delivery_status: 'sent' });
      } catch (retryErr) {
        const retryMsg = String(retryErr?.message || retryErr);
        if (/already|exists|pending|invited/i.test(retryMsg)) {
          // The platform already holds an outstanding invitation for this
          // address — no duplicate created. Truthfully marked: the platform
          // dispatch happened, but this attempt did not send a new email.
          resendOutcome = 'already_outstanding';
          await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { sent_at: new Date().toISOString(), delivery_status: 'sent' }).catch(() => {});
        } else {
          // Delivery failed — RETAIN the record, mark it honestly, and keep
          // the retry option (never report success on a failed send).
          resendOutcome = 'failed';
          await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { delivery_status: 'failed' }).catch(() => {});
        }
      }
      // Branded context email — same audited path as the resend action.
      if (resendOutcome !== 'failed') {
        try {
          await sendBrandedInvitationEmail(base44, {
            to: email, customerId: customer_id || null, resellerId: effectiveReseller,
            roleType: role_type, inviteeName: displayName, inviterName: callerName, kind: 'resent',
          });
        } catch (_) {}
      }
      return Response.json({
        success: true, already_pending: true, pending_scope_id: pending.id,
        resend_outcome: resendOutcome, delivery_status: resendOutcome === 'failed' ? 'failed' : 'sent',
        similar_accounts,
      });
    }

    // Delivery lifecycle: created as 'queued' the instant the invitation
    // record exists, then updated to 'sent' once the platform invitation is
    // dispatched (or 'failed' on delivery failure) — the Users tab never
    // shows a stale "Not sent yet" for a successfully dispatched invitation.
    // OPERATIONAL USER LICENSING — entitlement check + scope creation are
    // atomic (one mutex hold): two simultaneous invitations can never both
    // take the final operational-user slot, and a blocked invitation creates
    // NO user, NO invitation and NO PendingTenantScope.
    let blockedSlot: any = null;
    try {
      const createSlot = await enforceOperationalUserLimit(base44.asServiceRole, {
        customer, roleType: role_type, email,
        mutate: async () => base44.asServiceRole.entities.PendingTenantScope.create({
          ...scopeFields,
          delivery_status: 'queued',
        }),
      });
      if (createSlot.lock_error) {
        return Response.json({ error: 'The system is busy processing another user change. Please try again.', code: 'slot_lock_timeout' }, { status: 503 });
      }
      if (createSlot.blocked) {
        blockedSlot = createSlot;
      } else {
        pending = createSlot.result;
      }
    } catch (e) {
      console.log('[inviteTenantUser] pending scope create failed', String(e?.message || e));
      return Response.json({ error: 'The invitation could not be created. Please try again.', code: 'scope_failed' }, { status: 500 });
    }
    if (blockedSlot) {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'tenant_user.invite_blocked_user_limit',
        customer_id: customer_id || undefined, reseller_id: effectiveReseller || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'PendingTenantScope', action: 'invite_blocked_user_limit',
        new_values: JSON.stringify({ email, role_type, used: blockedSlot.used, limit: blockedSlot.limit }),
        notes: `Operational-user limit reached — invitation of ${email} as ${role_type} blocked`,
      }).catch(() => {});
      return Response.json({
        error: USER_LIMIT_REACHED_MESSAGE,
        code: 'operational_user_limit_reached',
        used: blockedSlot.used, limit: blockedSlot.limit,
      }, { status: 409 });
    }
    console.log('[inviteTenantUser] created pending scope', pending.id);

    // ── Send the invitation with platform role "user" (NEVER "admin"). ──
    const nowIso = new Date().toISOString();
    try {
      await base44.users.inviteUser(email, 'user');
      console.log('[inviteTenantUser] inviteUser ok');
      try { await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { sent_at: nowIso, delivery_status: 'sent' }); } catch (_) {}
      // Branded, module-aware invitation email (best-effort; the platform
      // invitation with the sign-up link has already been dispatched above).
      await sendBrandedInvitationEmail(base44, {
        to: email, customerId: customer_id || null, resellerId: effectiveReseller,
        roleType: role_type, inviteeName: displayName, inviterName: callerName, kind: 'invite',
      });
    } catch (invErr) {
      const msg = String(invErr?.message || invErr);
      console.log('[inviteTenantUser] inviteUser threw', msg);
      if (/already|exists|pending|invited/i.test(msg)) {
        // An invitation is already pending for this email; our PendingTenantScope
        // will apply when it is accepted. Not an error — no duplicate created.
        try { await base44.asServiceRole.entities.PendingTenantScope.update(pending.id, { sent_at: nowIso, delivery_status: 'sent' }); } catch (_) {}
        return Response.json({ success: true, already_pending: true, pending_scope_id: pending.id, similar_accounts });
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
        event_type: 'tenant_user.invited', user_id: caller.id, user_name: callerName,
        reseller_id: effectiveReseller || undefined, customer_id: customer_id || undefined,
        entity_name: 'PendingTenantScope', entity_id: pending.id,
        action: 'invite_tenant_user',
        new_values: JSON.stringify({ email, role_type, admin_level, reseller_id: effectiveReseller, customer_id: customer_id || null }),
        notes: `Invited ${email} as ${role_type} (scope queued)`,
      });
    } catch (_) {}

    return Response.json({ success: true, pending_scope_id: pending.id, invite_sent: true, similar_accounts });
  } catch (error) {
    const msg = String(error?.message || error);
    console.log('[inviteTenantUser] fatal', msg);
    // Surface SAFE, actionable validation detail (e.g. "Error in field X: …")
    // to the administrator — never stack traces or internals.
    if (/^Error in field /i.test(msg)) {
      return Response.json({
        error: `The invitation could not be saved: ${msg}`,
        code: 'validation_error',
      }, { status: 500 });
    }
    return Response.json({ error: 'Invitation failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}