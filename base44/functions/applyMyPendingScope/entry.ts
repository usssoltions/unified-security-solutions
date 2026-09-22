import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * applyMyPendingScope — self-service, server-side application of a queued
 * PendingTenantScope to the CALLING user's own record.
 *
 * Why this exists: Base44 creates the User record only when an invitee accepts
 * the invitation, so tenant scoping cannot be applied at invite time.
 * inviteTenantUser instead writes a PendingTenantScope keyed by email. On the
 * invitee's first login, this function applies that scope to their own User
 * record (reseller_id / customer_id / role_type / admin_level), so they land
 * in their reseller console — never granting platform `role: admin`.
 *
 * Security: the caller can ONLY receive a scope an admin already queued for
 * THEIR email. PendingTenantScope records can only be created by admins
 * (RLS), so a user cannot escalate themselves — they merely consume a scope
 * intended for their email. Idempotent (marks the scope "applied").
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ applied: false });
    // Safe normalisation: match the pending record by a normalised email so
    // case/whitespace differences between the invitation and the signup email
    // never prevent the scope from applying. The caller can only consume a
    // scope queued for THEIR email — no cross-user application.
    const email = (caller.email || '').trim().toLowerCase();
    if (!email) return Response.json({ applied: false });

    const pending = await base44.asServiceRole.entities.PendingTenantScope.filter({
      email, status: 'pending',
    });
    if (!pending || pending.length === 0) {
      // ADMIN-SIDE DIAGNOSTIC: an authenticated caller with NO scope, NO role
      // and no pending invitation scope is exactly the "Account Setup
      // Incomplete" state. Log an actionable audit entry (WHO is stuck, WHY —
      // e.g. the invitation scope was consumed by another session, was
      // cancelled, or was keyed to a different email address) so
      // administrators can see and fix it, instead of only the end user
      // seeing a dead-end screen. Scoped users probing this endpoint never
      // trigger the diagnostic.
      const callerUnscoped = !caller.reseller_id && !caller.customer_id &&
        !caller.admin_level && !caller.role_type;
      if (callerUnscoped) {
        try {
          await base44.asServiceRole.entities.PlatformAuditLog.create({
            event_type: 'onboarding.failed',
            user_id: caller.id,
            user_name: caller.display_name || caller.full_name || caller.email,
            entity_name: 'User',
            entity_id: caller.id,
            action: 'apply_pending_tenant_scope',
            notes: `Login blocked: no pending tenant scope exists for ${email}. Invite the user (or resend their invitation) so a scope is queued for this exact email address.`,
          });
        } catch (_) { /* diagnostics must never break the response */ }
      }
      return Response.json({ applied: false, reason: 'no_pending_scope' });
    }
    const scope = pending[0];

    const updates = {};
    if (scope.role_type) updates.role_type = scope.role_type;
    if (scope.admin_level) updates.admin_level = scope.admin_level;
    if (scope.reseller_id) updates.reseller_id = scope.reseller_id;
    if (scope.customer_id !== undefined && scope.customer_id !== null) updates.customer_id = scope.customer_id;
    if (scope.display_name) updates.display_name = scope.display_name;
    if (scope.first_name) updates.first_name = scope.first_name;
    if (scope.last_name) updates.last_name = scope.last_name;
    if (scope.phone) updates.phone = scope.phone;
    if (scope.site_id) updates.site_id = scope.site_id;
    if (scope.user_status) updates.user_status = scope.user_status;

    if (Object.keys(updates).length === 0) {
      return Response.json({ applied: false });
    }

    // Reseller-only membership RLS: add the authenticated caller's own user
    // id to the intended Reseller's `members` array BEFORE scoping the user,
    // so a membership failure fails closed (user stays unscoped → no app
    // access). The reseller is resolved server-side from the pending scope;
    // the client cannot supply an arbitrary target. Idempotent + deduped.
    // Customer/Site membership is a later phase — only reseller scoping here.
    if (scope.admin_level === 'reseller' && scope.reseller_id) {
      try {
        const reseller: any = await base44.asServiceRole.entities.Reseller.get(scope.reseller_id);
        const existing: string[] = Array.isArray(reseller?.members) ? reseller.members : [];
        if (!existing.includes(caller.id)) {
          existing.push(caller.id);
          await base44.asServiceRole.entities.Reseller.update(scope.reseller_id, { members: existing });
        }
      } catch (e: any) {
        // Fail closed: membership could not be established → do not scope.
        return Response.json({ applied: false, reason: 'membership_failed' });
      }
    }

    await base44.asServiceRole.entities.User.update(caller.id, updates);

    await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, {
      status: 'applied',
      applied_user_id: caller.id,
      applied_at: new Date().toISOString(),
    });

    try {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'user.scoped',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        customer_id: scope.customer_id || undefined,
        reseller_id: scope.reseller_id || undefined,
        entity_name: 'User',
        entity_id: caller.id,
        action: 'apply_pending_tenant_scope',
        new_values: JSON.stringify(updates),
        notes: `Applied queued tenant scope to ${email} (${scope.role_type})`,
      });
    } catch (_) { /* best-effort audit */ }

    return Response.json({ applied: true, role_type: scope.role_type, reseller_id: scope.reseller_id });
  } catch (error) {
    console.log('[applyMyPendingScope] fatal', String(error?.message || error));
    return Response.json({ applied: false, reason: 'error', error: String(error?.message || error) });
  }
}