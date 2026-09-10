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
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({})) || {};
    const action = body.action;
    const svc = base44.asServiceRole;

    /* ── SELF-SERVICE REQUEST (Google Play account-deletion capability) ─── */
    if (action === 'requestAccountRemoval') {
      const target = caller;
      const existing = await svc.entities.AccountDeletionRequest
        .filter({ user_id: target.id, status: 'pending' }).catch(() => []);
      if ((existing || []).length) {
        return Response.json({
          error: 'You already have an account removal request pending review.',
          request: existing[0],
        }, { status: 409 });
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
        reason: (body.reason || '').toString().trim().slice(0, 500) || null,
        status: 'pending',
        dependency_summary: deps.summary,
      });
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
      error: 'Invalid action. Supported: requestAccountRemoval, myRequest, cancelAccountRemovalRequest, listRequests, approveAccountRemoval, rejectAccountRemoval, suspendUser, deactivateUser, reactivateUser, removeUserAccount',
    }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}