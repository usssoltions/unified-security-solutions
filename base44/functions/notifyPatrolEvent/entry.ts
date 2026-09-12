/**
 * notifyPatrolEvent — server-side dispatcher for patrol lifecycle events the
 * guard's device cannot deliver itself (a guard's client cannot create
 * Notification records for OTHER users — RLS correctly blocks it, so the
 * monitoring-side notification must be created server-side here).
 *
 * Actions:
 *   completed → in-app completion notice to the patrol's tenant monitoring
 *               roles (email deliberately off — routine success transaction)
 *   exception → in-app + push + Telegram + email to the patrol's tenant
 *               monitoring roles (failed required check / patrol ended early)
 *
 * Recipients are resolved server-side from the patrol's OWN tenant scope
 * (customer_id) — never from caller input — so cross-tenant delivery is
 * impossible. The caller must be the patrol's assigned guard (or platform
 * oversight). Every channel is failure-isolated; deterministic event keys
 * dedupe retries.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';

const MONITORING_ROLES = ['admin', 'dispatcher', 'supervisor', 'customer_admin', 'control_room_operator'];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, patrolId, summary } = body;
    if (!action || !patrolId) {
      return Response.json({ error: 'action and patrolId are required' }, { status: 400 });
    }
    if (action !== 'completed' && action !== 'exception') {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    const patrol = await base44.asServiceRole.entities.ScheduledPatrol.get(patrolId).catch(() => null);
    if (!patrol) return Response.json({ error: 'Patrol not found' }, { status: 404 });

    // AUTHORITY — only the assigned guard (or platform oversight) may report
    // this patrol's events. Tenant scope is taken from the patrol record.
    const isPlatform = caller.role_type === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
    if (!isPlatform && patrol.guard_id && caller.id !== patrol.guard_id) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const isCompleted = action === 'completed';
    const title = isCompleted
      ? `✅ Patrol Completed — ${patrol.site_name}`
      : `⚠️ Patrol Exception — ${patrol.site_name}`;
    const message = summary ||
      `Patrol #${patrol.patrol_number} at ${patrol.site_name} by ${patrol.guard_name || 'the assigned guard'}: ${patrol.checkpoints_completed || 0}/${patrol.checkpoints_total || 0} checkpoints.`;
    const eventKey = (isCompleted ? 'patrol_completed:' : 'patrol_exception:') + patrolId;

    // TENANT-SCOPED monitoring recipients (platform oversight always
    // permitted). The reporting guard is excluded — they already know.
    const allUsers = (await base44.asServiceRole.entities.User.list().catch(() => [])) || [];
    const isPlatformUser = (u) => u.role_type === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform';
    const recipients = allUsers.filter(u =>
      MONITORING_ROLES.includes(u.role_type) &&
      u.id !== patrol.guard_id &&
      (isPlatformUser(u) || !patrol.customer_id || u.customer_id === patrol.customer_id));

    let notified = 0;
    for (const r of recipients) {
      // IN-APP — server-persisted record (feeds the Bell, survives refresh)
      await base44.asServiceRole.entities.Notification.create({
        recipient_id: r.id,
        recipient_name: r.display_name || r.full_name,
        type: 'system',
        priority: isCompleted ? 'low' : 'high',
        title, message, read: false,
        related_entity: 'ScheduledPatrol', related_id: patrolId,
        action_url: '/PatrolMonitoring',
        sent_via: ['in_app'],
        customer_id: patrol.customer_id || undefined,
        reseller_id: patrol.reseller_id || undefined,
      }).catch(() => {});
      notified++;

      if (isCompleted) continue; // routine success — in-app only

      // PUSH + TELEGRAM + EMAIL — operational exception, all channels on.
      await sendNativePush(base44.asServiceRole, {
        user_id: r.id, title, body: message, priority: 'high',
        action_label: 'Open Patrol Monitoring', action_url: '/PatrolMonitoring',
        event_key: eventKey,
        customer_id: patrol.customer_id || undefined,
        reseller_id: patrol.reseller_id || undefined,
      }).catch(() => {});
      if (r.telegram_connected && r.telegram_notifications_enabled !== false && r.telegram_chat_id) {
        await sendTaskTelegramDeduped(base44.asServiceRole, secrets, eventKey,
          r.telegram_chat_id, `${title}\n\n${message}`).catch(() => {});
      }
      if (r.email) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'USS Patrol Alerts', to: r.email, subject: title, body: message,
        }).catch(() => {});
      }
    }

    return Response.json({ success: true, action, notified });
  } catch (error) {
    console.error('notifyPatrolEvent error:', error);
    return Response.json({ error: error?.message || 'Patrol event notification failed' }, { status: 500 });
  }
}