import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';

// Phase H — shift-end notification dispatcher.
// Idempotent: only fires once per shift (guarded by shift.ended_notified).
// Triggered by the guard's device on the first end-of-shift transition, and
// safe to re-invoke (or to drive from a scheduled automation) — repeat calls
// with ended_notified already true are short-circuited.

const SUPERVISOR_ROLES = ['admin', 'dispatcher', 'supervisor', 'management'];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — shift-end notifications must come from a
    // logged-in user (guard's device or an admin/scheduled automation).
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Respect the global "Shift Reports" toggle — if disabled in System
    // Configuration, never send the shift-end notification email.
    try {
      const _settings = await base44.asServiceRole.entities.AutomationSetting.list();
      if (_settings?.[0] && _settings[0].report_shift_reports === false) {
        return Response.json({ skipped: true, reason: 'shift reports disabled' });
      }
    } catch (_) {}

    const body = await req.json().catch(() => ({}));
    const shiftId = body && body.shiftId ? String(body.shiftId) : '';
    if (!shiftId) return Response.json({ error: 'shiftId is required' }, { status: 400 });

    let shift = null;
    try { shift = await base44.asServiceRole.entities.Shift.get(shiftId); } catch (_) { shift = null; }
    if (!shift) return Response.json({ error: 'Shift not found' }, { status: 404 });

    if (shift.status !== 'active') {
      return Response.json({ skipped: true, reason: 'shift is not active' });
    }

    const endTime = shift.end_time ? new Date(shift.end_time) : null;
    if (!endTime) return Response.json({ skipped: true, reason: 'no end_time' });
    if (endTime > new Date()) {
      return Response.json({ skipped: true, reason: 'shift has not ended yet' });
    }

    // Idempotency gate — server is the single source of truth.
    if (shift.ended_notified) {
      return Response.json({ skipped: true, reason: 'already notified' });
    }

    const now = new Date().toISOString();
    await base44.asServiceRole.entities.Shift.update(shiftId, {
      ended_notified: true,
      ended_notified_at: now,
    });

    const guardName = shift.guard_name || 'Assigned guard';
    const siteName = shift.site_name || 'their site';
    const minsOver = Math.max(0, Math.round((Date.now() - endTime.getTime()) / 60000));
    const priority = minsOver > 15 ? 'high' : 'medium';

    const title = `⏰ Shift ended — ${guardName} @ ${siteName}`;
    const message = `${guardName}'s shift at ${siteName} ended at ${endTime.toLocaleString('en-ZA')} (${minsOver} min ago) and has not yet been clocked out.`;

    // TENANT-SCOPED recipients — the shift's OWN customer's operational
    // supervisors (platform oversight always permitted). No cross-tenant
    // shift-end notifications.
    const allUsers = await base44.asServiceRole.entities.User.list();
    const isPlatformUser = (u) => u.role_type === 'platform_admin' || u.admin_level === 'platform';
    const admins = (allUsers || []).filter(u =>
      SUPERVISOR_ROLES.includes(u.role_type) &&
      (isPlatformUser(u) || !shift.customer_id || u.customer_id === shift.customer_id));

    let notified = 0;
    for (const admin of admins) {
      try {
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.display_name || admin.full_name,
          type: 'shift_reminder',
          priority,
          title,
          message,
          read: false,
          related_entity: 'shift',
          related_id: shiftId,
          action_url: '/Scheduling',
          sent_via: ['in_app'],
          customer_id: shift.customer_id || undefined,
          reseller_id: shift.reseller_id || undefined,
        });
        notified++;
      } catch (_) {}
    }

    // TELEGRAM — automatic operational channel to the same scoped recipients;
    // failure-isolated from in-app/email/push; exactly-once via ended_notified
    // plus the deterministic event key.
    for (const admin of admins) {
      if (!admin.telegram_connected || admin.telegram_notifications_enabled === false || !admin.telegram_chat_id) continue;
      await sendTaskTelegramDeduped(base44.asServiceRole, secrets, 'shift_end:' + shiftId,
        admin.telegram_chat_id, `${title}\n\n${message}`)
        .catch(() => {});
    }

    try {
      const emails = admins.map(a => a.email).filter(Boolean).join(',');
      if (emails) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'SecureGuard Shifts',
          to: emails,
          subject: title,
          body: message,
        });
      }
    } catch (_) {}

    // NATIVE PUSH — shared platform service: a shift that ended without a
    // clock-out requires supervisor attention even with the app closed.
    // The ended_notified gate keeps the whole event exactly-once.
    for (const admin of admins) {
      await sendNativePush(base44.asServiceRole, {
        user_id: admin.id,
        title,
        body: message,
        priority: priority === 'high' ? 'high' : 'normal',
        action_label: 'Open Scheduling', action_url: '/Scheduling',
        event_key: 'shift_end:' + shiftId,
      }).catch(() => {});
    }

    return Response.json({ success: true, notified, ended_notified_at: now });
  } catch (error) {
    return Response.json({ error: error?.message || 'Shift-end notification failed' }, { status: 500 });
  }
}