import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { emailsNearMatch, normaliseEmail } from '../../shared/scopeDiagnostics.ts';

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
 *
 * HARDENING (2026-10-01, recurring "Account Setup Incomplete" investigation):
 *  1. VERIFY-BEFORE-CONSUME: the scope is marked "applied" only AFTER the
 *     User update is persisted AND read back verified. A failed/unconfirmed
 *     write leaves the scope "pending" so a bounded client retry re-runs the
 *     whole apply — an invitation is never consumed by an unverified write.
 *  2. SELF-HEALING IDEMPOTENCY: if a scope for the caller's email was already
 *     marked "applied" but the caller's User record STILL carries none of the
 *     assignments (a lost write after consumption was marked), the same stored
 *     values are re-applied. Only a fully unscoped caller can hit this path,
 *     so an administrator's later legitimate rescope is never overwritten.
 *  3. BOUNDED RETRY SUPPORT: every failure returns a stable `reason` the
 *     client uses to distinguish transient failures (retry) from permanent
 *     ones (no invitation queued, invalid invitation — never retry).
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

    // Only a fully unscoped, unroleed account (a fresh signup awaiting its
    // invitation scope) may consume a scope. Already-onboarded callers — and
    // any caller an administrator has since rescoped — return immediately, so
    // repeated requests can never overwrite a legitimate later assignment.
    const callerUnscoped = !caller.reseller_id && !caller.customer_id &&
      !caller.admin_level && !caller.role_type;
    if (!callerUnscoped) {
      return Response.json({ applied: false, reason: 'already_scoped' });
    }

    // ── Locate the intended scope for this exact email. ──
    // Pending scopes win; an "applied" scope whose assignments never actually
    // landed on the caller's record is re-applied (self-healing idempotency).
    let scope: any = null;
    let scopeState: 'pending' | 'applied_unverified' = 'pending';
    const pendingRows = await base44.asServiceRole.entities.PendingTenantScope.filter({
      email, status: 'pending',
    });
    if (pendingRows && pendingRows.length > 0) {
      scope = pendingRows[0];
    } else {
      const appliedRows = await base44.asServiceRole.entities.PendingTenantScope.filter({
        email, status: 'applied',
      }).catch(() => []);
      const candidates = appliedRows || [];
      let candidate = candidates.find(
        (s: any) => !s.applied_user_id || s.applied_user_id === caller.id
      );
      if (!candidate && candidates.length > 0) {
        // The scope was consumed by an EARLIER account with this same invited
        // email that no longer exists (e.g. its User record was removed during
        // test cleanup). The invitation was genuinely queued by an admin for
        // this exact email, so a fresh signup with that email may re-apply it.
        const stale = candidates[0];
        if (stale.applied_user_id) {
          const prior = await base44.asServiceRole.entities.User.get(stale.applied_user_id).catch(() => null);
          if (!prior) candidate = stale;
        }
      }
      if (candidate) {
        scope = candidate;
        scopeState = 'applied_unverified';
      }
    }
    if (!scope) {
      // ADMIN-SIDE DIAGNOSTIC: an authenticated caller with NO scope, NO role
      // and no pending invitation scope is exactly the "Account Setup
      // Incomplete" state. Proven vectors: direct sign-up on the auth page,
      // or the invitee signing up with a MISTYPED/alternate address (the
      // invitation email itself can never be mistyped — the admin queued a
      // scope for exactly the address they typed).
      // NEAR-MATCH HINT: a pending invitation for a near-identical address is
      // recorded in the audit entry (administrator repair detail) and flagged
      // to the caller GENERICALLY (boolean only — the other address is never
      // disclosed to the blocked caller).
      let similarInvitation = false;
      let similarEmail: string | null = null;
      try {
        const allPending = await base44.asServiceRole.entities.PendingTenantScope
          .filter({ status: 'pending' }).catch(() => []);
        const match = (allPending || []).find((s: any) => emailsNearMatch(email, s.email));
        if (match) { similarInvitation = true; similarEmail = normaliseEmail(match.email); }
      } catch (_) { /* diagnostics must never break the response */ }
      try {
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          event_type: 'tenant_user.scope_failed',
          user_id: caller.id,
          user_name: caller.display_name || caller.full_name || caller.email,
          entity_name: 'User',
          entity_id: caller.id,
          action: 'apply_pending_tenant_scope',
          notes: `Login blocked: no pending tenant scope exists for ${email}.` +
            (similarEmail
              ? ` A pending invitation EXISTS for the near-identical address ${similarEmail} — this account was almost certainly created with a mistyped/alternate address. Repair: invite THIS exact email (re-scopes the existing account), or ask the invitee to accept the original invitation link.`
              : ' Invite the user (or resend their invitation) so a scope is queued for this exact email address.'),
        });
      } catch (_) { /* diagnostics must never break the response */ }
      return Response.json({ applied: false, reason: 'no_pending_scope', similar_invitation_exists: similarInvitation });
    }

    // DEFENSE-IN-DEPTH: a guard scope without a site assignment cannot
    // produce a valid scoped account — it is NEVER applied (fail closed, the
    // user stays unscoped with no app access). inviteTenantUser blocks this
    // at the source; this guard catches legacy/malformed scopes.
    if (scope.role_type === 'guard' && !scope.site_id) {
      try {
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          event_type: 'tenant_user.scope_failed',
          user_id: caller.id, user_name: caller.display_name || caller.full_name || caller.email,
          entity_name: 'PendingTenantScope', entity_id: scope.id,
          action: 'apply_pending_tenant_scope',
          notes: `Login blocked: guard scope for ${email} has no site assignment. Re-issue the invitation with a site.`,
        });
      } catch (_) { /* diagnostics must never break the response */ }
      return Response.json({ applied: false, reason: 'guard_site_missing' });
    }

    const updates: any = {};
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
      return Response.json({ applied: false, reason: 'empty_scope' });
    }

    // Reseller-only membership RLS: add the authenticated caller's own user
    // id to the intended Reseller's `members` array BEFORE scoping the user,
    // so a membership failure fails closed (user stays unscoped → no app
    // access). The reseller is resolved server-side from the pending scope;
    // the client cannot supply an arbitrary target. Idempotent + deduped.
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

    // ── VERIFY-BEFORE-CONSUME ──
    // Read the user back and confirm the assignments actually persisted.
    // Only a VERIFIED write may consume the invitation: if verification fails
    // the scope stays pending/re-appliable and the client's bounded retry
    // re-runs the whole apply (idempotent — same values re-written).
    let verified = false;
    try {
      const fresh: any = await base44.asServiceRole.entities.User.get(caller.id);
      verified = !!fresh &&
        (!updates.role_type || fresh.role_type === updates.role_type) &&
        (!updates.admin_level || fresh.admin_level === updates.admin_level) &&
        (!updates.reseller_id || fresh.reseller_id === updates.reseller_id) &&
        (!updates.customer_id || fresh.customer_id === updates.customer_id) &&
        (!updates.site_id || fresh.site_id === updates.site_id);
    } catch (_) { /* verification read failure = unverified */ }
    if (!verified) {
      try {
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          event_type: 'tenant_user.scope_failed',
          user_id: caller.id, user_name: caller.display_name || caller.full_name || caller.email,
          entity_name: 'PendingTenantScope', entity_id: scope.id,
          action: 'apply_pending_tenant_scope',
          notes: `Scope write for ${email} could not be verified after persisting — invitation NOT consumed; a retry will re-apply it.`,
        });
      } catch (_) {}
      return Response.json({ applied: false, reason: 'verify_failed', recoverable: true });
    }

    // The assignments are persisted and verified — NOW consume the scope.
    await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, {
      status: 'applied',
      applied_user_id: caller.id,
      applied_at: new Date().toISOString(),
    });

    try {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'tenant_user.scope_applied',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        customer_id: scope.customer_id || undefined,
        reseller_id: scope.reseller_id || undefined,
        entity_name: 'User',
        entity_id: caller.id,
        action: 'apply_pending_tenant_scope',
        new_values: JSON.stringify(updates),
        notes: `Applied queued tenant scope to ${email} (${scope.role_type})${scopeState === 'applied_unverified' ? ' — re-applied after unverified earlier application' : ''}`,
      });
    } catch (_) { /* best-effort audit */ }

    return Response.json({ applied: true, role_type: scope.role_type, reseller_id: scope.reseller_id });
  } catch (error) {
    console.log('[applyMyPendingScope] fatal', String(error?.message || error));
    return Response.json({ applied: false, reason: 'error', error: String(error?.message || error) });
  }
}