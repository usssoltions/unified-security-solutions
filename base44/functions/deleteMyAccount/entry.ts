import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * deleteMyAccount — Google Play-compliant SELF-SERVICE ACCOUNT DELETION.
 *
 * SECURITY CONTRACT:
 *  - SELF-DELETION ONLY: this function never accepts a target user id. The
 *    account being deleted is always the authenticated caller's own — a user
 *    can never delete another user's account. Any user_id in the payload is
 *    ignored.
 *  - DELIBERATE CONFIRMATION: the caller must send the exact confirmation
 *    phrase; the UI additionally requires a typed "DELETE" before invoking.
 *  - SERVICE ROLE is used only AFTER authenticating the caller, and only for
 *    this user's own data.
 *
 * AUDIT-TRAIL PRESERVATION (security platform requirement):
 *  Operational and security records that reference the deleted user
 *  (incidents, attendance snapshots, patrols, panic events, tasks, sign-offs,
 *  maintenance, shift history, reports, PlatformAuditLog) are NOT touched —
 *  they carry their own historical snapshots and must remain part of the
 *  customer's audit trail. Only personal account data, channel mappings and
 *  session artefacts are removed; no Customer, Site, Control Room or tenant
 *  record is deleted or cascaded.
 *
 * The final step uses the platform's native account-deletion mechanism
 * (service-role User.delete — the same operation as Dashboard → Users →
 * Remove User), which permanently removes the core account profile.
 */
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({})) || {};
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = user.id;
    if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') {
      return Response.json({
        error: 'Confirmation phrase missing — account NOT deleted. Type DELETE to confirm.',
        code: 'confirm_required',
      }, { status: 400 });
    }

    const svc = base44.asServiceRole;
    const nowIso = new Date().toISOString();

    /* 1) PERSONAL MAPPINGS & SESSION ARTEFACTS (this user only) ─────────── */

    // Telegram enrollments: revoked and cleared (empty strings — the platform
    // registers the unmapped state) so the one-to-one chat mapping dies with
    // the account and can never be claimed by another user.
    await svc.entities.TelegramEnrollment.updateMany(
      { user_id: userId, status: { $in: ['pending', 'completed'] } },
      { $set: {
        status: 'revoked',
        telegram_chat_id: '', telegram_username: '',
        telegram_first_name: '', telegram_last_name: '',
      } }
    ).catch(() => {});

    // Push device registrations: deactivated (registry keeps diagnostic
    // history by design — records are never deleted).
    await svc.entities.PushRegistration.updateMany(
      { user_id: userId, status: 'active' },
      { $set: {
        status: 'inactive', push_enabled: false,
        unregistered_at: nowIso, unregistered_reason: 'user_deleted',
      } }
    ).catch(() => {});

    // The user's own notification inbox: personal data, safe to remove.
    await svc.entities.Notification.deleteMany({ recipient_id: userId }).catch(() => {});

    // Pending invitation scopes for this email: cancelled, never applied.
    await svc.entities.PendingTenantScope.updateMany(
      { email: String(user.email || '').trim().toLowerCase(), status: 'pending' },
      { $set: { status: 'cancelled', cancelled_at: nowIso, cancelled_by: userId } }
    ).catch(() => {});

    /* 2) TENANT STRUCTURE — records preserved, only the membership
       REFERENCES to this user are pulled. Customer/Site/ControlRoom and
       every operational/audit record remain intact. ────────────────────── */

    await svc.entities.Reseller.updateMany(
      { members: userId }, { $pull: { members: userId } }).catch(() => {});
    await svc.entities.ControlRoom.updateMany(
      { operator_user_ids: userId }, { $pull: { operator_user_ids: userId } }).catch(() => {});
    await svc.entities.ControlRoom.updateMany(
      { supervisor_user_ids: userId }, { $pull: { supervisor_user_ids: userId } }).catch(() => {});

    /* 3) AUDIT — the deletion itself is a security-relevant event. ───────── */

    const auditRecord = {
      event_type: 'user.account_deleted',
      user_id: userId,
      user_name: user.display_name || user.full_name || user.email || '—',
      action: 'self_service_account_deletion',
      notes: 'Account deleted by the authenticated user (Google Play account-deletion flow). '
        + 'Personal account data, Telegram mapping and push registrations removed; operational, '
        + 'security and audit records preserved for the customer audit trail.',
    };
    if (user.customer_id) auditRecord.customer_id = user.customer_id;
    if (user.reseller_id) auditRecord.reseller_id = user.reseller_id;
    await svc.entities.PlatformAuditLog.create(auditRecord).catch(() => {});

    /* 4) THE ACCOUNT — platform-native deletion (Dashboard Users → Remove
       User equivalent). Authoritative last step: if this fails, the account
       stays intact and the client shows the failure. ─────────────────────── */

    await svc.entities.User.delete(userId);

    return Response.json({ success: true, deleted: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}