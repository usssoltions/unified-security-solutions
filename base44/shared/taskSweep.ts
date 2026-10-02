/**
 * Task Scheduling — scheduled sweep + occurrence generation (shared module).
 *
 * Extracted from the scheduledTaskAccess gateway so the gateway stays under
 * the file-size limit. Contains: the SAST date/occurrence helpers, the series
 * occurrence batch/task builders (also used by the gateway's createBatch /
 * create / list actions) and the SWEEP itself — scheduled automation with no
 * user session: recurring-series occurrence top-up, 2-hour reminders, deadline
 * overdue marking, the deadline reason gate and the authoritative Task
 * Completion Report. Idempotent; early-exits when nothing is due; returns
 * counts only, never tenant data.
 *
 * All sweep emails (reminder, reason required, completion report) use the
 * module's ONE shared tenant-branded email template.
 */
import {
  sastTodayYmd, sastInstantYmd, resolveTaskRecipients, notifyTaskRecipients, notifyTaskRecipientsOnce,
  logTaskAudit, resolveTaskBrandContext,
} from './taskNotifications.ts';
import { hasDemoFlags } from './simulatedRecords.ts';
import { reminderNotification, deadlineReport, reasonRequiredNotification,
  verificationOverdueNotification, guardOverdueNotification, fmtSast, MY_TASKS_LINK,
  newTaskListNotification } from './taskReportContent.ts';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PRIORITIES = ['low', 'medium', 'high', 'critical'];
export const ALL_OPEN_STATUSES = ['new', 'acknowledged', 'in_progress', 'awaiting',
  'queue', 'assigned', 'awaiting_verification', 'reopened', 'overdue'];
const REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;
const SWEEP_CATCHUP_DAYS = 7;

/* ── Date helpers — YYYY-MM-DD strings are timezone-neutral ─────────────── */

function ymdToDate(s) {
  const p = s.split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
export function addDaysYmd(s, n) {
  const d = ymdToDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetweenYmd(a, b) {
  return Math.round((ymdToDate(b) - ymdToDate(a)) / 86400000);
}
function nextOccurrenceYmd(current, rec) {
  if (rec.type === 'daily') return addDaysYmd(current, 1);
  if (rec.type === 'weekly') return addDaysYmd(current, 7);
  if (rec.type === 'custom') return addDaysYmd(current, Math.max(1, Number(rec.interval) || 1));
  if (rec.type === 'weekdays') {
    const allowed = (rec.weekdays && rec.weekdays.length) ? rec.weekdays : [1, 2, 3, 4, 5];
    let d = addDaysYmd(current, 1);
    for (let i = 0; i < 7; i++) {
      if (allowed.indexOf(ymdToDate(d).getUTCDay()) !== -1) return d;
      d = addDaysYmd(d, 1);
    }
    return null;
  }
  if (rec.type === 'monthly') {
    // EXPLICIT MONTH-END SEMANTICS (JS rollover fix): a series created on the
    // 29th/30th/31st must never silently roll into the following month via
    // JavaScript date normalisation (Date.UTC(2026,1,31) → 3 March). The
    // series' ORIGINAL requested day is preserved; when the target month has
    // no such day (31 in a 30-day month, day 29/30/31 in February), the LAST
    // VALID DAY of that month is used — 31 Jan → 28/29 Feb (leap-year aware)
    // → 31 Mar. Later months that DO contain the requested day resume it.
    const p = current.split('-');
    const y = Number(p[0]);
    const m = Number(p[1]); // 1-based month of `current`
    const requestedDay = Math.min(31, Math.max(1, Number(rec.originalDay) || Number(p[2])));
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); // day 0 of the month AFTER the target = target month's length
    const day = Math.min(requestedDay, lastDay);
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return ny + '-' + String(nm).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  }
  return null;
}
export function occurrenceDates(startYmd, rec, endYmd, max) {
  // Monthly series keep their ORIGINAL requested day (set once from the
  // series start date) so a clamped short-month occurrence (e.g. 28 Feb) is
  // followed by the requested day again (31 Mar) — never a permanent drift.
  if (rec && rec.type === 'monthly' && rec.originalDay === undefined) {
    rec.originalDay = Number(String(startYmd).slice(8, 10));
  }
  const out = [];
  let cur = startYmd;
  let guard = 0;
  const cap = max || 62;
  while (out.length < cap && guard < 500) {
    guard++;
    cur = nextOccurrenceYmd(cur, rec);
    if (!cur) break;
    if (endYmd && cur > endYmd) break;
    out.push(cur);
  }
  return out;
}
/* Occurrence due = occurrence date + the parent's day delta, same wall clock. */
function occurrenceDue(parent, occurrenceYmd) {
  if (!parent.due_date || typeof parent.due_date !== 'string') return null;
  const parts = parent.due_date.split('T');
  if (parts.length < 2 || !DATE_RE.test(parts[0])) return null;
  const delta = daysBetweenYmd(parent.scheduled_date, parts[0]);
  return addDaysYmd(occurrenceYmd, delta) + 'T' + parts[1];
}
export function buildOccurrence(parent, seriesId, ymd) {
  return {
    customer_id: parent.customer_id,
    reseller_id: parent.reseller_id || null,
    site_id: parent.site_id || null,
    site_name: parent.site_name || null,
    title: parent.title,
    description: parent.description || null,
    task_type: parent.task_type || 'other',
    priority: parent.priority || 'medium',
    assigned_to: parent.assigned_to || null,
    assigned_to_name: parent.assigned_to_name || null,
    assigned_by: parent.assigned_by || null,
    assigned_by_name: parent.assigned_by_name || null,
    scheduled_date: ymd,
    scheduled_time: parent.scheduled_time || null,
    scheduled_at: parent.scheduled_time ? ymd + 'T' + parent.scheduled_time + ':00+02:00' : null,
    due_date: occurrenceDue(parent, ymd),
    status: 'new',
    recurrence_type: parent.recurrence_type,
    recurrence_weekdays: parent.recurrence_weekdays || [],
    recurrence_interval_days: parent.recurrence_interval_days || 1,
    recurrence_end_date: parent.recurrence_end_date || null,
    recurrence_key: seriesId + ':' + ymd,
    parent_task_id: parent.id,
    notes: parent.notes || null,
    completion_notes_required: !!parent.completion_notes_required,
  };
}
export function buildTasksForOccurrence(batchRec, ymd, createdBy) {
  return (batchRec.task_definitions || []).map((d) => ({
    customer_id: batchRec.customer_id,
    reseller_id: batchRec.reseller_id || null,
    control_room_id: batchRec.control_room_id,
    control_room_name: batchRec.control_room_name || null,
    task_batch_id: batchRec.id,
    task_batch_title: batchRec.title,
    title: d.title,
    description: d.description || null,
    task_type: d.task_type || 'other',
    priority: PRIORITIES.indexOf(d.priority) !== -1 ? d.priority : 'medium',
    site_id: d.site_id || null,
    site_name: d.site_name || null,
    assigned_to: null,
    assigned_to_name: null,
    assigned_by: createdBy.id,
    assigned_by_name: createdBy.name || 'System',
    scheduled_date: ymd,
    scheduled_time: d.scheduled_time || null,
    scheduled_at: d.scheduled_time ? ymd + 'T' + d.scheduled_time + ':00+02:00' : null,
    due_date: d.due_time ? ymd + 'T' + d.due_time + ':00+02:00'
      : (batchRec.deadline_time ? ymd + 'T' + batchRec.deadline_time + ':00+02:00' : null),
    status: 'queue',
    recurrence_type: 'none',
    notes: null,
    completion_notes_required: !!d.completion_notes_required,
    evidence_required: !!d.evidence_required,
  }));
}
export function buildOccurrenceBatch(series, ymd, seriesId) {
  return {
    customer_id: series.customer_id,
    reseller_id: series.reseller_id || null,
    control_room_id: series.control_room_id,
    control_room_name: series.control_room_name || null,
    title: series.title,
    description: series.description || null,
    scheduled_date: ymd,
    active_start_time: series.active_start_time,
    deadline_time: series.deadline_time,
    is_series: false,
    parent_batch_id: series.id,
    task_definitions: [],
    recurrence_type: series.recurrence_type,
    recurrence_weekdays: series.recurrence_weekdays || [],
    recurrence_interval_days: series.recurrence_interval_days || 1,
    recurrence_end_date: series.recurrence_end_date || null,
    recurrence_key: seriesId + ':' + ymd,
    primary_supervisor_id: series.primary_supervisor_id,
    primary_supervisor_name: series.primary_supervisor_name || null,
    additional_notification_user_ids: series.additional_notification_user_ids || [],
    additional_notification_names: series.additional_notification_names || [],
    status: 'active',
    created_by_name: series.created_by_name || null,
  };
}

/* ── The sweep ──────────────────────────────────────────────────────────── */

export async function runTaskSweep(svc, secrets) {
  const today = sastTodayYmd();
  const cutoff = addDaysYmd(today, -SWEEP_CATCHUP_DAYS);
  const results = { occurrences_generated: 0, occurrences_activated: 0, reminders_sent: 0, reports_generated: 0, tasks_marked_overdue: 0, reasons_required: 0, overdue_alerts_sent: 0 };

  // 1. SERIES TOP-UP FIRST (SWEEP ORDER FIX): recurring occurrences are
  //    generated/topped-up BEFORE the sweep evaluates which batches are due —
  //    a newly due recurrence is processed by THIS run, never delayed to the
  //    next 30-minute sweep merely because the due-batch query ran first.
  //    Database pre-generation is deliberately SILENT: user-facing activation
  //    notifications fire per occurrence when its window STARTS (below) — a
  //    future occurrence is never notified ~30 days in advance.
  const seriesRows = await svc.entities.TaskBatch.filter(
    { is_series: true, status: 'active' }, '-created_date', 50).catch(() => []);
  for (const series of (seriesRows || [])) {
    const rec = { type: series.recurrence_type, weekdays: series.recurrence_weekdays || [], interval: series.recurrence_interval_days || 1 };
    if (rec.type === 'none' || series.archived || hasDemoFlags(series)) continue;
    const endYmd = (series.recurrence_end_date && DATE_RE.test(series.recurrence_end_date))
      ? series.recurrence_end_date : addDaysYmd(today, 30);
    const dates = occurrenceDates(series.scheduled_date, rec, endYmd, 62);
    if (!dates.length) continue;
    const seriesId = series.recurrence_key ? series.recurrence_key.slice(0, series.recurrence_key.lastIndexOf(':')) : series.id;
    const keys = dates.map((d) => seriesId + ':' + d);
    const existing = await svc.entities.TaskBatch.filter({ recurrence_key: { $in: keys } }).catch(() => []);
    const have = new Set((existing || []).map((b) => b.recurrence_key));
    const missing = dates.filter((d) => !have.has(seriesId + ':' + d));
    for (const d of missing) {
      const occ = await svc.entities.TaskBatch.create(buildOccurrenceBatch(series, d, seriesId));
      const tasks = buildTasksForOccurrence(series, d, { id: series.id, name: series.created_by_name || 'System' });
      if (tasks.length) await svc.entities.OperationalTask.bulkCreate(tasks);
      results.occurrences_generated++;
    }
  }

  // 2. Due-batch evaluation AFTER the top-up (series parents are excluded —
  //    occurrence batches drive the workflow).
  const recentBatches = await svc.entities.TaskBatch.filter(
    { is_series: false, status: 'active' }, '-scheduled_date', 100).catch(() => []);
  const dueBatches = (recentBatches || []).filter((b) =>
    b.scheduled_date && b.scheduled_date <= today && b.scheduled_date >= cutoff && !b.archived &&
    // SIMULATED-RECORD SKIP — demo-seed batches are never swept/reminded.
    !hasDemoFlags(b));

  if (!dueBatches.length) return Response.json({ success: true, ...results, active_batches: 0 });

  // Tenant brand context (customer → reseller → platform) — cached per
  // customer so every sweep email for a tenant shares its branding.
  const brandCtxCache = {};
  const getBrandCtx = async (customerId) => {
    if (!brandCtxCache[customerId]) brandCtxCache[customerId] = await resolveTaskBrandContext(svc, customerId);
    return brandCtxCache[customerId];
  };

  for (const batch of dueBatches) {
    if (!batch.deadline_time || !batch.active_start_time) continue;
    const startMs = sastInstantYmd(batch.scheduled_date, batch.active_start_time);
    const deadlineMs = sastInstantYmd(batch.scheduled_date, batch.deadline_time);
    const now = Date.now();
    if (now < startMs) continue;

    const tasks = await svc.entities.OperationalTask.filter({ task_batch_id: batch.id }).catch(() => []);
    const allTasks = tasks || [];
    if (!allTasks.length) continue;
    const outstanding = allTasks.filter((t) => !t.archived && t.status !== 'completed' && t.status !== 'cancelled');

    // ── OCCURRENCE ACTIVATION (pre-generated recurring occurrences) ──
    // The user-facing activation notification fires exactly ONCE per
    // occurrence, the moment its active window STARTS — separated from the
    // silent database pre-generation above. Bounded to windows that started
    // within the last 12 hours so stale catch-up batches (older runs, missed
    // sweeps) are never blasted long after the fact; the existing 2-hour
    // reminder cadence continues to cover older windows. Event-key
    // idempotent — a re-run can never re-notify an activated occurrence.
    if (!batch.activation_notified_at && (now - startMs) < 12 * 60 * 60 * 1000) {
      const crRowsA = await svc.entities.ControlRoom.filter({ id: batch.control_room_id }).catch(() => []);
      const crA = (crRowsA && crRowsA[0]) || null;
      const recipientsA = await resolveTaskRecipients(svc, batch.customer_id,
        [batch.primary_supervisor_id].concat((crA && crA.operator_user_ids) || [],
          (crA && crA.supervisor_user_ids) || [], batch.additional_notification_user_ids || []));
      const activeA = recipientsA.filter((r) => r.status !== 'suspended' && r.status !== 'inactive');
      if (activeA.length) {
        const brandCtx = await getBrandCtx(batch.customer_id);
        const content = newTaskListNotification(batch, allTasks.length, brandCtx.customerName, brandCtx.brand, brandCtx.brandName);
        for (const r of activeA) {
          await svc.entities.Notification.create({
            customer_id: batch.customer_id, reseller_id: batch.reseller_id || null,
            recipient_id: r.id, recipient_name: r.name,
            type: 'status_change', priority: 'high',
            title: 'TASK LIST ACTIVE — ' + batch.title,
            message: 'Task list for ' + batch.scheduled_date + ' (' + batch.active_start_time + '–' + batch.deadline_time + ') is now active in ' + (batch.control_room_name || 'your control room') + ' — ' + allTasks.length + ' task(s).',
            related_entity: 'TaskBatch', related_id: batch.id,
            action_url: '/ScheduledTasks', sent_via: ['in_app'],
          }).catch(() => {});
        }
        await notifyTaskRecipients(svc, secrets, activeA, { ...content, from_name: brandCtx.brandName,
          eventKey: 'task_occurrence_activated:' + batch.id,
          actionUrl: '/ScheduledTasks',
          pushTitle: 'TASK LIST ACTIVE — ' + batch.title,
          pushBody: 'Task list for ' + batch.scheduled_date + ' (' + batch.active_start_time + '–' + batch.deadline_time + ') is now active — open the Task Queue.',
          priority: 'high',
          customerId: batch.customer_id, resellerId: batch.reseller_id || null });
        await logTaskAudit(svc, { event_type: 'task.occurrence_activated', actor: null, batch,
          notes: 'Occurrence activated at window start — ' + activeA.length + ' recipient(s) notified' });
        results.occurrences_activated++;
      }
      // Mark regardless once evaluated (nothing to notify, or notified) so the
      // sweep never re-evaluates the same activation forever.
      await svc.entities.TaskBatch.update(batch.id, {
        activation_notified_at: new Date().toISOString(),
      }).catch(() => {});
    }

    if (now < deadlineMs) {
      // ── Active window: 2-hour reminder cycle ──
      if (!outstanding.length) continue;
      const dueReminders = Math.floor((now - startMs) / REMINDER_INTERVAL_MS);
      if ((batch.reminder_count || 0) >= dueReminders) continue;

      const crRows = await svc.entities.ControlRoom.filter({ id: batch.control_room_id }).catch(() => []);
      const cr = (crRows && crRows[0]) || null;
      const operatorIds = (cr && cr.operator_user_ids) || [];
      const supervisorIds = (cr && cr.supervisor_user_ids) || [];
      const recipients = await resolveTaskRecipients(svc, batch.customer_id,
        [batch.primary_supervisor_id].concat(operatorIds, supervisorIds, batch.additional_notification_user_ids || []));
      if (!recipients.length) continue;

      const brandCtx = await getBrandCtx(batch.customer_id);
      // In-app bell record for every recipient — this also drives the shared
      // ForegroundAlertBanner (visual alert + chime) while the app is open.
      for (const r of recipients) {
        await svc.entities.Notification.create({
          customer_id: batch.customer_id, reseller_id: batch.reseller_id || null,
          recipient_id: r.id, recipient_name: r.name,
          type: 'status_change', priority: 'medium',
          title: 'OUTSTANDING TASKS — ' + batch.title,
          message: outstanding.length + ' task(s) still outstanding in ' + (batch.control_room_name || 'your control room') +
            ' (window ' + batch.active_start_time + '–' + batch.deadline_time + ').',
          related_entity: 'TaskBatch', related_id: batch.id,
          action_url: '/ScheduledTasks', sent_via: ['in_app'],
        }).catch(() => {});
      }
      const content = reminderNotification(batch, outstanding, brandCtx.customerName, brandCtx.brand, brandCtx.brandName);
      const sent = await notifyTaskRecipients(svc, secrets, recipients, { ...content, from_name: brandCtx.brandName,
        eventKey: 'task_reminder:' + batch.id + ':' + dueReminders,
        actionUrl: '/ScheduledTasks',
        pushTitle: 'OUTSTANDING TASKS — ' + batch.title,
        pushBody: outstanding.length + ' task(s) still outstanding in ' + (batch.control_room_name || 'your control room') +
          ' (window ' + batch.active_start_time + '–' + batch.deadline_time + ').',
        priority: 'medium',
        customerId: batch.customer_id, resellerId: batch.reseller_id || null });
      await svc.entities.TaskBatch.update(batch.id, {
        reminder_count: dueReminders, last_reminder_at: new Date().toISOString(),
      }).catch(() => {});
      await svc.entities.OperationalTask.updateMany(
        { task_batch_id: batch.id, status: { $in: ALL_OPEN_STATUSES } },
        { $set: { last_reminder_at: new Date().toISOString() } }).catch(() => {});
      await logTaskAudit(svc, { event_type: 'task.reminder_sent', actor: null, batch,
        notes: outstanding.length + ' outstanding task(s) — email:' + sent.email + ' telegram:' + sent.telegram });
      results.reminders_sent++;
    } else if (!batch.report_generated_at) {
      // ── Deadline reached: overdue marking + REASON-GATED report ──
      if (outstanding.length) {
        // ── IMMEDIATE OVERDUE ALERTS (one-shot, deadline-threshold) ──
        // TWO DISTINCT overdue states, evaluated BEFORE the status flatten:
        //   STATE A — GUARD TASK OVERDUE: deadline passed, Sign-off 1 NOT
        //             completed (the assigned task itself is overdue).
        //   STATE B — VERIFICATION OVERDUE: Sign-off 1 completed but Sign-off
        //             2 (Control Room verification) outstanding past the
        //             deadline — clearly identified as VERIFICATION OVERDUE,
        //             never reported as a plain overdue task.
        // Each alert is delivered AT MOST ONCE per task+threshold (event
        // marker via notifyTaskRecipientsOnce) — later 30-minute sweep runs
        // can never duplicate the immediate alert. The 2-hour reminder
        // cadence (active window only) and the reason gate below continue
        // unchanged; no second reminder engine exists here.
        const crRows = await svc.entities.ControlRoom.filter({ id: batch.control_room_id }).catch(() => []);
        const cr = (crRows && crRows[0]) || null;
        const operatorIds = (cr && cr.operator_user_ids) || [];
        const brandCtx = await getBrandCtx(batch.customer_id);
        const deadlineInstant = batch.scheduled_date + 'T' + (batch.deadline_time || '00:00') + ':00+02:00';
        for (const t of outstanding) {
          const verificationOverdue = !!(t.completed_at && !t.verified);
          // Stable event key per task + threshold: the Sign-off 1 timestamp
          // for State B (a rejected/reworked sign-off earns a fresh alert),
          // the deadline instant for State A.
          const eventKey = verificationOverdue
            ? 'task_verification_overdue:' + t.id + ':' + t.completed_at
            : 'task_guard_overdue:' + t.id + ':' + (t.due_date || deadlineInstant);
          const deadlineStr = fmtSast(t.due_date || deadlineInstant);
          // Recipients — resolved SERVER-SIDE, strictly this batch's tenant:
          // the room's ACTIVE operators + the primary supervisor (escalation)
          // + the batch's configured additional recipients; State A also
          // includes the assigned guard (their task is overdue). Operators of
          // OTHER rooms and OTHER customers can never resolve here.
          const recipientIds = [batch.primary_supervisor_id].concat(operatorIds,
            batch.additional_notification_user_ids || [], verificationOverdue ? [] : [t.assigned_to]);
          const recipients = await resolveTaskRecipients(svc, batch.customer_id, recipientIds);
          if (!recipients.length) continue;
          const active = recipients.filter((r) => r.status !== 'suspended' && r.status !== 'inactive');
          const content = verificationOverdue
            ? verificationOverdueNotification(t, batch, brandCtx.customerName, brandCtx.brand, brandCtx.brandName)
            : guardOverdueNotification(t, batch, brandCtx.customerName, brandCtx.brand, brandCtx.brandName);
          const alertTitle = (verificationOverdue ? 'VERIFICATION OVERDUE — ' : 'TASK OVERDUE — ') + t.title;
          const alertMsg = verificationOverdue
            ? (t.completed_by_name || 'The assigned user') + ' completed Sign-off 1, but Control Room verification has not been completed by the deadline (' + deadlineStr + ').'
            : 'Deadline ' + deadlineStr + ' passed without Sign-off 1' + (t.assigned_to_name ? ' from ' + t.assigned_to_name : '') + '.';
          // In-app bell record for every ACTIVE recipient — drives the shared
          // ForegroundAlertBanner (visual alert + chime) while the app is open.
          for (const r of active) {
            await svc.entities.Notification.create({
              customer_id: batch.customer_id, reseller_id: batch.reseller_id || null,
              recipient_id: r.id, recipient_name: r.name,
              type: 'status_change', priority: 'high',
              title: alertTitle, message: alertMsg,
              related_entity: 'OperationalTask', related_id: t.id,
              action_url: '/ScheduledTasks', sent_via: ['in_app'],
            }).catch(() => {});
          }
          // Branded email + Telegram (inline REVIEW & VERIFY TASK action on
          // State B) + native push — ONE-SHOT per task+threshold.
          const sent = await notifyTaskRecipientsOnce(svc, secrets, active, {
            ...content, from_name: brandCtx.brandName,
            eventKey, actionUrl: '/ScheduledTasks',
            telegramButton: { text: verificationOverdue ? 'REVIEW & VERIFY TASK' : 'OPEN TASK SCHEDULING', url: MY_TASKS_LINK },
            pushTitle: alertTitle,
            pushBody: alertMsg,
            priority: 'high',
            customerId: batch.customer_id, resellerId: batch.reseller_id || null });
          await logTaskAudit(svc, { event_type: verificationOverdue ? 'task.verification_overdue_alert' : 'task.guard_overdue_alert', actor: null, task: t,
            from_status: t.status, to_status: 'overdue',
            notes: alertTitle + ' (immediate overdue alert) — email:' + sent.email + ' telegram:' + sent.telegram + ' push:' + sent.push });
          results.overdue_alerts_sent++;
        }
        await svc.entities.OperationalTask.updateMany(
          { task_batch_id: batch.id, status: { $in: ALL_OPEN_STATUSES } },
          { $set: { status: 'overdue' } }).catch(() => {});
        for (const t of outstanding) {
          await logTaskAudit(svc, { event_type: 'task.overdue', actor: null, task: t,
            from_status: t.status, to_status: 'overdue', notes: 'Deadline ' + batch.deadline_time + ' reached without dual sign-off' });
        }
        results.tasks_marked_overdue += outstanding.length;
      }
      const freshTasks = await svc.entities.OperationalTask.filter({ task_batch_id: batch.id }).catch(() => []);
      const freshOutstanding = (freshTasks || []).filter((t) => !t.archived && t.status !== 'completed' && t.status !== 'cancelled');
      const needReason = freshOutstanding.filter((t) => !t.non_completion_reason);
      if (needReason.length) {
        // REASON GATE: never silently finalise the deadline report while an
        // incomplete task has no non-completion reason. Flag the batch
        // 'reason_pending' and demand reasons from the responsible
        // operator/supervisor (one exception notification per batch —
        // never re-spammed). The authoritative report finalises in the
        // captureReason action once every incomplete task has a reason.
        if (!batch.reason_required_notified_at) {
          const crRows = await svc.entities.ControlRoom.filter({ id: batch.control_room_id }).catch(() => []);
          const cr = (crRows && crRows[0]) || null;
          const recipients = await resolveTaskRecipients(svc, batch.customer_id,
            [batch.primary_supervisor_id].concat((cr && cr.operator_user_ids) || [],
              (cr && cr.supervisor_user_ids) || [], batch.additional_notification_user_ids || []));
          const brandCtx = await getBrandCtx(batch.customer_id);
          // In-app bell record for every recipient — drives the shared
          // ForegroundAlertBanner (visual alert + chime) while the app is open.
          for (const r of recipients) {
            await svc.entities.Notification.create({
              customer_id: batch.customer_id, reseller_id: batch.reseller_id || null,
              recipient_id: r.id, recipient_name: r.name,
              type: 'status_change', priority: 'high',
              title: 'TASK REASON REQUIRED — ' + batch.title,
              message: 'Deadline reached: ' + needReason.length + ' incomplete task(s) need a non-completion reason before the Task Completion Report finalises.',
              related_entity: 'TaskBatch', related_id: batch.id,
              action_url: '/ScheduledTasks', sent_via: ['in_app'],
            }).catch(() => {});
          }
          const content = reasonRequiredNotification(batch, needReason, brandCtx.customerName, brandCtx.brand, brandCtx.brandName);
          const sent = await notifyTaskRecipients(svc, secrets, recipients, { ...content, from_name: brandCtx.brandName,
            eventKey: 'task_reason_required:' + batch.id,
            actionUrl: '/ScheduledTasks',
            pushTitle: 'TASK REASON REQUIRED — ' + batch.title,
            pushBody: 'Deadline reached: ' + needReason.length + ' incomplete task(s) need a non-completion reason before the Task Completion Report finalises.',
            priority: 'high',
            customerId: batch.customer_id, resellerId: batch.reseller_id || null });
          await svc.entities.TaskBatch.update(batch.id, {
            status: 'reason_pending', reason_required_notified_at: new Date().toISOString(),
          }).catch(() => {});
          await logTaskAudit(svc, { event_type: 'task.reason_required', actor: null, batch,
            notes: 'Deadline reached — ' + needReason.length + ' incomplete task(s) need a non-completion reason before the report finalises. email:' + sent.email + ' telegram:' + sent.telegram });
          results.reasons_required++;
        }
      } else {
        // Every incomplete task already has a reason (or nothing is
        // incomplete) → finalise the authoritative Task Completion Report.
        const brandCtx = await getBrandCtx(batch.customer_id);
        const report = deadlineReport(batch, (freshTasks || []).filter((t) => !t.archived), brandCtx.customerName, brandCtx.brand, brandCtx.brandName);
        const recipients = await resolveTaskRecipients(svc, batch.customer_id,
          [batch.primary_supervisor_id].concat(batch.additional_notification_user_ids || []));
        const sent = await notifyTaskRecipients(svc, secrets, recipients, { ...report, from_name: brandCtx.brandName,
          eventKey: 'task_report:' + batch.id });
        await svc.entities.TaskBatch.update(batch.id, {
          status: 'reported', report_generated_at: new Date().toISOString(),
          report_delivery: 'email:' + sent.email + ' telegram:' + sent.telegram + ' to ' + recipients.length + ' recipient(s)',
          report_content: report.emailBody,
        }).catch(() => {});
        await logTaskAudit(svc, { event_type: 'task.report_delivered', actor: null, batch,
          notes: 'Report generated at deadline — email:' + sent.email + ' telegram:' + sent.telegram });
        results.reports_generated++;
      }
    }
  }
  return Response.json({ success: true, ...results, active_batches: dueBatches.length });
}