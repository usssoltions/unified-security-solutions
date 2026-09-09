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
  sastTodayYmd, sastInstantYmd, resolveTaskRecipients, notifyTaskRecipients,
  logTaskAudit, resolveTaskBrandContext,
} from './taskNotifications.ts';
import { reminderNotification, deadlineReport, reasonRequiredNotification } from './taskReportContent.ts';

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
    const p = current.split('-');
    const next = new Date(Date.UTC(Number(p[0]), Number(p[1]), Number(p[2]), 12));
    return next.toISOString().slice(0, 10);
  }
  return null;
}
export function occurrenceDates(startYmd, rec, endYmd, max) {
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
  const results = { occurrences_generated: 0, reminders_sent: 0, reports_generated: 0, tasks_marked_overdue: 0, reasons_required: 0 };

  // 1. Early-exit check FIRST: any recent unreported occurrence batches?
  //    (Series parents are excluded — occurrences drive the workflow.)
  const recentBatches = await svc.entities.TaskBatch.filter(
    { is_series: false, status: 'active' }, '-scheduled_date', 100).catch(() => []);
  const dueBatches = (recentBatches || []).filter((b) =>
    b.scheduled_date && b.scheduled_date <= today && b.scheduled_date >= cutoff && !b.archived);

  // 2. Top-up recurring series (bounded, dedup by recurrence_key).
  const seriesRows = await svc.entities.TaskBatch.filter(
    { is_series: true, status: 'active' }, '-created_date', 50).catch(() => []);
  for (const series of (seriesRows || [])) {
    const rec = { type: series.recurrence_type, weekdays: series.recurrence_weekdays || [], interval: series.recurrence_interval_days || 1 };
    if (rec.type === 'none' || series.archived) continue;
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
          type: 'status_change', priority: 'normal',
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
        priority: 'normal',
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