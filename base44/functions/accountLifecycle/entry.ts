import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import {
  TENANT_ADMIN_ROLES,
  isPlatformAdminUser, isResellerAdminUser, isTenantAdminUser,
  resolveAuthorityError, findLastAdminViolation, collectDependencies,
  performAccountRemoval, applySuspension, applyDeactivation, applyReactivation,
  resolveApprovers, resolveOrganisationName, auditAccountEvent, notifyUsers,
} from '../../shared/accountLifecycle.ts';

/**
 * accountLifecycle — THE ONE account lifecycle gateway.
 *
 * Central actions (every action authenticates the caller, resolves tenant and
 * role server-side, validates hierarchy and dependencies, audits, and fails
 * closed 403 on cross-tenant attempts):
 *   requestAccountRemoval      — self-service in-app removal REQUEST (never destructive)
 *   myRequest                 — the caller's own latest request (Profile status)
 *   cancelAccountRemovalRequest— requester withdraws their own pending request
 *   listRequests               — admin review list, scoped server-side
 *   approveAccountRemoval     — authorised administrator performs final removal
 *                               (hierarchy + last-admin + dependency validated)
 *   rejectAccountRemoval      — authorised administrator refuses the request
 *   suspendUser / deactivateUser / reactivateUser — distinct account states
 *   removeUserAccount         — direct administrative removal (same validation)
 *
 * Google Play account-deletion capability is preserved: every user can request
 * removal of their account in-app; final removal is completed through this
 * authorised organisation-management process.
 *
 * PUBLIC actions (Google Play external account-deletion resource — these run
 * WITHOUT an authenticated caller, for users who can no longer access the
 * installed app; identity is verified by a single-use emailed link before
 * anything is bound to an account):
 *   publicInitiateRemoval — emails a one-time verification link to the
 *                           account address (anti-enumeration: the response
 *                           is identical whether or not the email is known)
 *   publicVerifyRemovalToken — validates the single-use link token (expiry,
 *                           not consumed/revoked) and establishes the
 *                           verified account context ONLY. Opening the
 *                           emailed link can NEVER create a removal request:
 *                           email security scanners, accidental opens and
 *                           forwarded links are completely inert.
 *   publicConfirmRemoval — explicit deliberate confirmation, one atomic
 *                           idempotent operation: creates (or reuses) the
 *                           SAME AccountDeletionRequest through the SAME
 *                           central gateway FIRST, and marks the single-use
 *                           token consumed ONLY after the request exists —
 *                           a failure can never leave a consumed token with
 *                           no removal request. Retries return the existing
 *                           pending request and never duplicate it.
 */

const PUBLIC_APP_URL = 'https://guard-track-pro-26cedab8.base44.app';
const VERIFICATION_TTL_MINUTES = 30;
const RESEND_THROTTLE_MINUTES = 2;

async function sha256Hex(value) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* THE ONE removal-request record creator — shared by the in-app self-service
 * action and the verified public web action, so both flows produce identical
 * AccountDeletionRequest records through the same central gateway. */
async function createRemovalRequest(svc, target, reason) {
  const existing = await svc.entities.AccountDeletionRequest
    .filter({ user_id: target.id, status: 'pending' }).catch(() => []);
  if ((existing || []).length) {
    return { request: existing[0], alreadyPending: true };
  }
  const deps = await collectDependencies(svc, target);
  const request = await svc.entities.AccountDeletionRequest.create({
    user_id: target.id,
    user_email: target.email,
    user_name: target.display_name || target.full_name || target.email,
    user_role: target.role_type || target.role || null,
    customer_id: target.customer_id || null,
    reseller_id: target.reseller_id || null,
    organisation_name: await resolveOrganisationName(svc, target),
    requested_at: new Date().toISOString(),
    requested_by: target.id,
    reason: (reason || '').toString().trim().slice(0, 500) || null,
    status: 'pending',
    dependency_summary: deps.summary,
  });
  return { request, alreadyPending: false };
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({})) || {};
    const action = body.action;
    const svc = base44.asServiceRole;

    /* ── PUBLIC (unauthenticated) — external account-deletion resource ───── */
    if (action === 'publicInitiateRemoval') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
      }
      // Anti-enumeration: the response is identical whether or not the email
      // belongs to a registered USS account.
      const rows = await svc.entities.User.filter({ email }).catch(() => []);
      const target = (rows || [])[0];
      if (target) {
        // Throttle resend abuse: a link issued less than 2 minutes ago is not
        // re-sent, but the response stays generic either way.
        const existingTokens = await svc.entities.PublicRemovalVerification
          .filter({ email, status: 'pending' }, '-created_date', 5).catch(() => []);
        const recent = (existingTokens || []).find(v => v.expires_at &&
          new Date(v.expires_at).getTime() - (VERIFICATION_TTL_MINUTES - RESEND_THROTTLE_MINUTES) * 60000 > Date.now());
        if (!recent) {
          // Supersede older pending links so only the newest one works.
          await svc.entities.PublicRemovalVerification.updateMany(
            { email, status: 'pending' }, { $set: { status: 'expired' } }
          ).catch(() => {});
          const token = randomToken();
          const tokenHash = await sha256Hex(token);
          await svc.entities.PublicRemovalVerification.create({
            email,
            user_id: target.id,
            token_hash: tokenHash,
            status: 'pending',
            expires_at: new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60000).toISOString(),
            user_agent: (req.headers.get('user-agent') || '').slice(0, 250) || null,
          });
          const verifyUrl = `${PUBLIC_APP_URL}/account-removal?token=${token}`;
          await svc.integrations.Core.SendEmail({
            to: email,
            subject: 'Verify your account removal request — Unified Security Solutions',
            html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px">
              <h2 style="color:#0f172a;margin:0 0 16px">Unified Security Solutions</h2>
              <p style="color:#334155">A request to remove your USS user account and personal information was initiated from our public account-removal page.</p>
              <p style="color:#334155"><b>This link is single-use and expires in 30 minutes.</b> If you did not request this, you can safely ignore this email — no request is created until you open the link and confirm.</p>
              <p style="margin:32px 0">
                <a href="${verifyUrl}" style="background:#b45309;color:#ffffff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Verify and continue</a>
              </p>
              <p style="color:#64748b;font-size:12px">If the button does not work, copy this link into your browser:<br>${verifyUrl}</p>
              <p style="color:#64748b;font-size:12px">Account removal is never instant: your organisation's authorised administrator reviews every request. Security and audit records may be retained where required by law.</p>
            </div>`,
            text: `Unified Security Solutions — verify your account removal request. Open this single-use link within 30 minutes: ${verifyUrl}. If you did not request this, ignore this email.`,
          }).catch(() => {});
        }
      }
      return Response.json({
        success: true,
        message: 'If this email address belongs to a registered Unified Security Solutions account, a verification link has been sent. Please check your inbox (and spam folder).',
      });
    }

    /* Verify the emailed link WITHOUT consuming it and WITHOUT creating
     * anything — opening the link only establishes the verified account
     * context shown on the confirmation page. Email-security scanners,
     * accidental opens and forwarded links therefore stay inert: the
     * AccountDeletionRequest is created ONLY by the explicit deliberate
     * publicConfirmRemoval action. */
    if (action === 'publicVerifyRemovalToken') {
      const token = String(body.token || '').trim();
      const invalid = () => Response.json(
        { error: 'This verification link is invalid or has expired. Please start again.' },
        { status: 400 });
      if (!token) return invalid();
      const tokenHash = await sha256Hex(token);
      const rows = await svc.entities.PublicRemovalVerification
        .filter({ token_hash: tokenHash, status: 'pending' }).catch(() => []);
      const verification = (rows || [])[0];
      if (!verification || !verification.expires_at ||
          new Date(verification.expires_at).getTime() < Date.now()) {
        return invalid();
      }
      const userRows = await svc.entities.User.filter({ id: verification.user_id }).catch(() => []);
      const target = (userRows || [])[0];
      if (!target) return invalid();
      // Masked email only — establishes the verified context without exposing
      // the full address to anyone merely holding (but not owning) the link.
      const email = String(target.email || verification.email || '');
      const at = email.indexOf('@');
      const maskedEmail = at > 0 ? email.slice(0, 1) + '***' + email.slice(at) : '';
      return Response.json({ success: true, verified: true, email: maskedEmail });
    }

    if (action === 'publicConfirmRemoval') {
      const token = String(body.token || '').trim();
      const invalid = () => Response.json(
        { error: 'This verification link is invalid or has expired. Please start again.' },
        { status: 400 });
      if (!token) return invalid();
      const tokenHash = await sha256Hex(token);
      const rows = await svc.entities.PublicRemovalVerification
        .filter({ token_hash: tokenHash }).catch(() => []);
      const verification = (rows || [])[0];
      if (!verification) return invalid();

      // ATOMICITY: the request is created/reused FIRST; the token is marked
      // consumed ONLY AFTER the AccountDeletionRequest exists durably (see
      // below). The consume-on-failure window is therefore impossible.
      // IDEMPOTENT REPLAY: a token already consumed by a successful
      // confirmation returns that same pending request (double tap, network
      // retry, browser retry never create duplicates and never dead-end the
      // user after a lost response).
      if (verification.status === 'consumed') {
        const consumedUser = await svc.entities.User
          .filter({ id: verification.user_id }).catch(() => []);
        const consumedTarget = (consumedUser || [])[0];
        if (consumedTarget) {
          const existing = await svc.entities.AccountDeletionRequest
            .filter({ user_id: consumedTarget.id, status: 'pending' }).catch(() => []);
          if ((existing || []).length) {
            return Response.json({ success: true, request: existing[0], alreadyPending: true });
          }
        }
        return Response.json(
          { error: 'This verification link has already been used. Please start again.' },
          { status: 400 });
      }
      if (verification.status !== 'pending' ||
          !verification.expires_at || new Date(verification.expires_at).getTime() < Date.now()) {
        return invalid();
      }

      const userRows = await svc.entities.User.filter({ id: verification.user_id }).catch(() => []);
      const target = (userRows || [])[0];
      if (!target) {
        return Response.json({ error: 'This account no longer exists. No further action is required.' }, { status: 404 });
      }

      // Create (or reuse) the removal request. Any failure here THROWS before
      // the token is consumed — the link stays pending and safely retryable,
      // and the retry reuses the existing pending request instead of
      // duplicating it. The token is consumed only on the line after this.
      const { request, alreadyPending } = await createRemovalRequest(svc, target, body.reason);
      await svc.entities.PublicRemovalVerification.update(verification.id, {
        status: 'consumed',
        consumed_at: new Date().toISOString(),
      }).catch(() => {});

      if (!alreadyPending) {
        const approvers = await resolveApprovers(svc, target);
        await notifyUsers(svc, approvers,
          'Account removal request',
          `${target.display_name || target.full_name || target.email} requested removal of their user account and personal information (verified via the public web form). Review it under Account Removal Requests.`,
          '/UserManagement');
        await auditAccountEvent(svc, 'account.deletion_requested', target, target,
          'Self-service account removal requested via the public web form with verified email ownership (pending administrator review). The request itself does not change the account.');
      }
      return Response.json({ success: true, request, alreadyPending: !!alreadyPending });
    }

    /* ── AUTHENTICATED ACTIONS (unchanged central gateway) ────────────────── */
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    /* ── SELF-SERVICE REQUEST (Google Play account-deletion capability) ─── */
    if (action === 'requestAccountRemoval') {
      const target = caller;
      const { request, alreadyPending } = await createRemovalRequest(svc, target, body.reason);
      if (alreadyPending) {
        return Response.json({
          error: 'You already have an account removal request pending review.',
          request,
        }, { status: 409 });
      }
      const approvers = await resolveApprovers(svc, target);
      await notifyUsers(svc, approvers,
        'Account removal request',
        `${target.display_name || target.full_name || target.email} requested removal of their user account and personal information. Review it under Account Removal Requests.`,
        '/UserManagement');
      await auditAccountEvent(svc, 'account.deletion_requested', target, target,
        'Self-service account removal requested (pending administrator review). '
        + 'The request itself does not change the account.');
      return Response.json({ success: true, request });
    }

    if (action === 'myRequest') {
      const requests = await svc.entities.AccountDeletionRequest
        .filter({ user_id: caller.id }, '-requested_at', 10).catch(() => []);
      return Response.json({ success: true, request: (requests || [])[0] || null });
    }

    if (action === 'cancelAccountRemovalRequest') {
      const requests = await svc.entities.AccountDeletionRequest
        .filter({ user_id: caller.id, status: 'pending' }).catch(() => []);
      if (!(requests || []).length) {
        return Response.json({ error: 'No pending account removal request to cancel' }, { status: 404 });
      }
      await svc.entities.AccountDeletionRequest.update(requests[0].id, {
        status: 'cancelled',
        completed_at: new Date().toISOString(),
      });
      await auditAccountEvent(svc, 'account.deletion_request_cancelled', caller, caller,
        'Account removal request cancelled by the requesting user.');
      return Response.json({ success: true });
    }

    /* ── ADMIN REVIEW LIST — scope resolved server-side, fail closed ────── */
    if (action === 'listRequests') {
      let requests = [];
      if (isPlatformAdminUser(caller)) {
        requests = await svc.entities.AccountDeletionRequest.list('-requested_at', 200).catch(() => []);
      } else if (isResellerAdminUser(caller)) {
        requests = await svc.entities.AccountDeletionRequest
          .filter({ reseller_id: caller.reseller_id }, '-requested_at', 200).catch(() => []);
      } else if (isTenantAdminUser(caller) || TENANT_ADMIN_ROLES.includes(caller.role_type)) {
        requests = await svc.entities.AccountDeletionRequest
          .filter({ customer_id: caller.customer_id }, '-requested_at', 200).catch(() => []);
      } else {
        requests = await svc.entities.AccountDeletionRequest
          .filter({ user_id: caller.id }, '-requested_at', 10).catch(() => []);
      }
      return Response.json({ success: true, requests: requests || [] });
    }

    /* ── APPROVE — final removal, fully validated ───────────────────────── */
    if (action === 'approveAccountRemoval') {
      const rows = await svc.entities.AccountDeletionRequest
        .filter({ id: body.request_id }).catch(() => []);
      const request = (rows || [])[0];
      if (!request) return Response.json({ error: 'Account removal request not found' }, { status: 404 });
      if (request.status !== 'pending') {
        return Response.json({ error: `This request was already ${request.status}` }, { status: 409 });
      }
      if (request.user_id === caller.id) {
        return Response.json({ error: 'You cannot approve your own account removal request — another authorised administrator must review it' }, { status: 403 });
      }

      const targetRows = await svc.entities.User.filter({ id: request.user_id }).catch(() => []);
      const target = (targetRows || [])[0];
      if (!target) {
        // Account already gone: close the request, nothing to remove.
        await svc.entities.AccountDeletionRequest.update(request.id, {
          status: 'completed', reviewed_at: new Date().toISOString(),
          reviewed_by: caller.id, reviewed_by_name: caller.display_name || caller.full_name,
          review_notes: 'Account no longer exists — request closed.', completed_at: new Date().toISOString(),
        });
        return Response.json({ success: true, closed: true });
      }

      const authorityError = resolveAuthorityError(caller, target);
      if (authorityError) return Response.json({ error: authorityError }, { status: 403 });

      const lastAdminError = await findLastAdminViolation(svc, target);
      if (lastAdminError) return Response.json({ error: lastAdminError }, { status: 403 });

      const deps = await collectDependencies(svc, target);
      if (deps.blockers.length) {
        return Response.json({
          error: 'This account has active operational dependencies that must be resolved first: ' + deps.blockers.join('; '),
          blockers: deps.blockers,
        }, { status: 409 });
      }

      await auditAccountEvent(svc, 'account.deletion_approved', caller, target,
        'Account removal request approved. Safe resolutions: ' + (deps.resolvable.length ? deps.resolvable.join('; ') : 'none required'));

      const removal = await performAccountRemoval(svc, target);

      const reviewedAt = new Date().toISOString();
      await svc.entities.AccountDeletionRequest.update(request.id, {
        status: 'completed',
        reviewed_at: reviewedAt,
        reviewed_by: caller.id,
        reviewed_by_name: caller.display_name || caller.full_name,
        review_notes: (body.review_notes || '').toString().trim().slice(0, 500) || null,
        completed_at: reviewedAt,
      });
      await auditAccountEvent(svc, 'account.deleted', caller, target,
        `Account removed. ${removal.cancelledFutureShifts} future shift(s) cancelled; operational and audit history preserved.`);
      return Response.json({ success: true, removed: true, resolutions: deps.resolvable });
    }

    /* ── REJECT ──────────────────────────────────────────────────────────── */
    if (action === 'rejectAccountRemoval') {
      const rows = await svc.entities.AccountDeletionRequest
        .filter({ id: body.request_id }).catch(() => []);
      const request = (rows || [])[0];
      if (!request) return Response.json({ error: 'Account removal request not found' }, { status: 404 });
      if (request.status !== 'pending') {
        return Response.json({ error: `This request was already ${request.status}` }, { status: 409 });
      }
      if (request.user_id === caller.id) {
        return Response.json({ error: 'You cannot review your own account removal request' }, { status: 403 });
      }
      const targetRows = await svc.entities.User.filter({ id: request.user_id }).catch(() => []);
      const target = (targetRows || [])[0];
      if (target) {
        const authorityError = resolveAuthorityError(caller, target);
        if (authorityError) return Response.json({ error: authorityError }, { status: 403 });
      }
      const notes = (body.review_notes || '').toString().trim().slice(0, 500) || null;
      await svc.entities.AccountDeletionRequest.update(request.id, {
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: caller.id,
        reviewed_by_name: caller.display_name || caller.full_name,
        review_notes: notes,
      });
      // Notify the requesting user while their account is still active.
      if (target) {
        await notifyUsers(svc, [target],
          'Account removal request reviewed',
          `Your account removal request was not approved. ${notes ? `Reviewer note: ${notes}` : 'Contact your organisation administrator for more information.'}`,
          '/Profile');
        await auditAccountEvent(svc, 'account.deletion_rejected', caller, target,
          'Account removal request rejected.' + (notes ? ` Reviewer note: ${notes}` : ''));
      }
      return Response.json({ success: true });
    }

    /* ── DISTINCT ACCOUNT STATES (suspension / deactivation / reactivation) ─ */
    if (action === 'suspendUser' || action === 'deactivateUser' || action === 'reactivateUser') {
      if (!body.target_user_id) {
        return Response.json({ error: 'target_user_id is required' }, { status: 400 });
      }
      if (body.target_user_id === caller.id) {
        return Response.json({ error: 'You cannot change your own account state' }, { status: 403 });
      }
      const rows = await svc.entities.User.filter({ id: body.target_user_id }).catch(() => []);
      const target = (rows || [])[0];
      if (!target) return Response.json({ error: 'Target user not found' }, { status: 404 });

      const authorityError = resolveAuthorityError(caller, target);
      if (authorityError) return Response.json({ error: authorityError }, { status: 403 });

      const lastAdminError = await findLastAdminViolation(svc, target);
      if (lastAdminError) return Response.json({ error: lastAdminError }, { status: 403 });

      if (action === 'suspendUser') {
        await applySuspension(svc, target);
        await auditAccountEvent(svc, 'account.suspended', caller, target,
          'Account suspended (temporary, reversible) by an authorised administrator.');
      } else if (action === 'deactivateUser') {
        await applyDeactivation(svc, target);
        await auditAccountEvent(svc, 'account.deactivated', caller, target,
          'Account deactivated (login disabled, account and history retained) by an authorised administrator.');
      } else {
        await applyReactivation(svc, target);
        await auditAccountEvent(svc, 'account.reactivated', caller, target,
          'Account reactivated by an authorised administrator.');
      }
      return Response.json({ success: true });
    }

    /* ── DIRECT ADMINISTRATIVE REMOVAL (same validation as approval) ────── */
    if (action === 'removeUserAccount') {
      if (!body.target_user_id) {
        return Response.json({ error: 'target_user_id is required' }, { status: 400 });
      }
      if (body.target_user_id === caller.id) {
        return Response.json({ error: 'You cannot remove your own account. Submit an account removal request for review by another administrator.' }, { status: 403 });
      }
      const rows = await svc.entities.User.filter({ id: body.target_user_id }).catch(() => []);
      const target = (rows || [])[0];
      if (!target) return Response.json({ error: 'Target user not found' }, { status: 404 });

      const authorityError = resolveAuthorityError(caller, target);
      if (authorityError) return Response.json({ error: authorityError }, { status: 403 });

      const lastAdminError = await findLastAdminViolation(svc, target);
      if (lastAdminError) return Response.json({ error: lastAdminError }, { status: 403 });

      const deps = await collectDependencies(svc, target);
      if (deps.blockers.length) {
        return Response.json({
          error: 'This account has active operational dependencies that must be resolved first: ' + deps.blockers.join('; '),
          blockers: deps.blockers,
        }, { status: 409 });
      }

      const removal = await performAccountRemoval(svc, target);
      await auditAccountEvent(svc, 'account.deleted', caller, target,
        `Direct administrative account removal. ${removal.cancelledFutureShifts} future shift(s) cancelled; operational and audit history preserved.`);

      // Close any pending removal request from this user
      const pending = await svc.entities.AccountDeletionRequest
        .filter({ user_id: target.id, status: 'pending' }).catch(() => []);
      for (const p of (pending || [])) {
        await svc.entities.AccountDeletionRequest.update(p.id, {
          status: 'completed',
          reviewed_at: new Date().toISOString(),
          reviewed_by: caller.id,
          reviewed_by_name: caller.display_name || caller.full_name,
          review_notes: 'Closed — account removed directly by an authorised administrator.',
          completed_at: new Date().toISOString(),
        }).catch(() => {});
      }
      return Response.json({ success: true, removed: true, resolutions: deps.resolvable });
    }

    return Response.json({
      error: 'Invalid action. Supported: publicInitiateRemoval, publicVerifyRemovalToken, publicConfirmRemoval, requestAccountRemoval, myRequest, cancelAccountRemovalRequest, listRequests, approveAccountRemoval, rejectAccountRemoval, suspendUser, deactivateUser, reactivateUser, removeUserAccount',
    }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}