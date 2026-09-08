/**
 * scheduledTaskAccess — the sole tenant-access gateway for the CONTROL ROOM
 * TASK SCHEDULING module (OperationalTask + TaskBatch + ControlRoom). A
 * DISTINCT workflow from guard shift scheduling (Shift records — untouched).
 *
 * WORKFLOW implemented:
 *   Management/Supervisor → TaskBatch → CONTROL ROOM queue → Control Room
 *   Operator assigns → Guard/User → start → guard sign-off (awaiting
 *   verification) → Operator verification sign-off (completed) → immediate
 *   supervisor notification → deadline Task Completion Report (2h reminders
 *   in between, driven by the scheduled sweep).
 *
 * MODULAR INDEPENDENCE: gated by TASK_SCHEDULING (or OPERATIONS /
 * COMPLETE_SECURITY for existing security customers). Notifications are the
 * module's own (shared taskNotifications.ts — Core email + Bot API Telegram);
 * the separate Notification Engine module is never required.
 *
 * SECURITY: mirrors the hardened gateway architecture — the caller's tenant
 * is resolved SERVER-SIDE from their User record; customer_id/reseller_id/
 * control_room_id/site_id/assignee ids submitted by the browser are NEVER
 * trusted as authority (validated against the resolved tenant on every
 * operation). Cross-tenant ids fail closed with 403/400.
 *
 * Actions (v2):
 *   list                — scoped tasks + control rooms + batches + sites +
 *                         assignable users (guards: own tasks; operators:
 *                         their authorised control rooms' queues).
 *   controlRoomSave     — create/update a tenant Control Room (admins).
 *   controlRoomDelete   — delete an unused Control Room (admins).
 *   createBatch         — task list/batch allocated to a Control Room, with
 *                         embedded task items; recurring series generate
 *                         bounded, deduplicated occurrence batches.
 *   cancelBatch         — cancel a batch (occurrence or whole series).
 *   assign / reassign   — operator (or supervisor) allocates a queued task
 *                         to an eligible same-customer user.
 *   start               — assignee starts the task.
 *   submitCompletion    — SIGN-OFF 1 (guard/user: notes, evidence, signature)
 *                         → status 'awaiting_verification' (NOT completed).
 *   verify              — SIGN-OFF 2 (operator: verification notes + separate
 *                         signature) → 'completed' + immediate notification.
 *                         The guard sign-off actor can never verify.
 *   reject              — operator rejects → 'reopened' (mandatory reason),
 *                         reminder cycle continues.
 *   captureReason       — non-completion reason for an outstanding/overdue task.
 *   update / cancel     — legacy task editing (control-room tasks route
 *                         through the dual sign-off lifecycle).
 *   complete            — LEGACY direct-complete; rejected for control-room
 *                         tasks (dual sign-off is mandatory).
 *   sweep               — scheduled automation: occurrence top-up, 2-hour
 *                         reminders, deadline overdue marking + Task
 *                         Completion Report. Idempotent; early-exits when
 *                         nothing is due. Callable unauthenticated (the
 *                         scheduled workflow has no user session) — it only
 *                         ever returns counts, never tenant data.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { secrets } from 'base44:runtime';
import {
  sastTodayYmd, sastInstantYmd, logTaskAudit, logTaskScopeAudit,
  resolveTaskRecipients, notifyTaskRecipients,
} from '../../shared/taskNotifications.ts';
import { completionNotification, reminderNotification, deadlineReport } from '../../shared/taskReportContent.ts';

const EDIT_ROLES = ['customer_admin', 'admin', 'dispatcher'];
const OPERATOR_ROLE = 'control_room_operator';
const ASSIGNABLE_ROLES = ['guard', 'admin', 'dispatcher', 'customer_admin'];
const OPERATOR_ELIGIBLE_ROLES = [OPERATOR_ROLE, 'dispatcher', 'admin', 'customer_admin'];
const SUPERVISOR_ROLES = ['dispatcher', 'admin', 'customer_admin'];
const MODULE_KEYS = ['TASK_SCHEDULING', 'OPERATIONS', 'COMPLETE_SECURITY'];
const LEGACY_OPEN_STATUSES = ['new', 'acknowledged', 'in_progress', 'awaiting'];
const OPEN_STATUSES = LEGACY_OPEN_STATUSES.concat(['queue', 'assigned', 'awaiting_verification', 'reopened']);
const ALL_OPEN_STATUSES = OPEN_STATUSES.concat(['overdue']);
const RECURRENCE_TYPES = ['daily', 'weekly', 'weekdays', 'monthly', 'custom'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TASK_MODULE_KEYS = ['TASK_SCHEDULING', 'OPERATIONS', 'COMPLETE_SECURITY'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;
const REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;
const SWEEP_CATCHUP_DAYS = 7;

function isPlatformAdmin(u) {
  // Mirrors the proven gateways (siteAccess / attendanceAccess / getTenantUsers):
  // the built-in role 'admin' is the USS Platform Admin alongside explicit
  // platform_admin role_type / admin_level. Without it, platform oversight (and
  // the app owner's own access) failed closed with no_scope.
  return !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
}
function isResellerAdmin(u) {
  return !!u && !isPlatformAdmin(u) && (u.role_type === 'reseller_admin' || u.admin_level === 'reseller');
}
function userName(u) {
  return (u && (u.display_name || u.full_name || u.email)) || '—';
}

/* ── Date helpers — YYYY-MM-DD strings are timezone-neutral ─────────────── */
function ymdToDate(s) {
  const p = s.split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
function addDaysYmd(s, n) {
  const d = ymdToDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetweenYmd(a, b) {
  return Math.round((ymdToDate(b) - ymdToDate(a)) / 86400000);
}
function todayYmd() {
  return new Date(Date.now() + SAST_OFFSET_MS).toISOString().slice(0, 10);
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
function occurrenceDates(startYmd, rec, endYmd, max) {
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
function buildOccurrence(parent, seriesId, ymd) {
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

/* ── Batch occurrence builders (content builders live in shared/taskReportContent.ts) ─── */

function buildTasksForOccurrence(batchRec, ymd, createdBy) {
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
    assigned_by_name: userName(createdBy),
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

function buildOccurrenceBatch(series, ymd, seriesId) {
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

/* ── Main handler ───────────────────────────────────────────────────────── */

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({})) || {};
    const action = String(body.action || 'list');

    let caller = null;
    try { caller = await base44.auth.me(); } catch (_) {}

    /* The scheduled sweep has no user session — allow ONLY the sweep action
       unauthenticated (it returns counts only, never tenant data). */
    if (!caller && action !== 'sweep') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const svc = base44.asServiceRole;

    /* ──────────────────────────────────────────────────────────────────────
       SWEEP — scheduled automation (no caller required)
       ────────────────────────────────────────────────────────────────────── */
    if (action === 'sweep') {
      const today = sastTodayYmd();
      const cutoff = addDaysYmd(today, -SWEEP_CATCHUP_DAYS);
      const results = { occurrences_generated: 0, reminders_sent: 0, reports_generated: 0, tasks_marked_overdue: 0 };

      // 1. Early-exit check FIRST: any recent unreported occurrence batches?
      //    (Series parents are excluded — occurrences drive the workflow.)
      const recentBatches = await svc.entities.TaskBatch.filter(
        { is_series: false, status: 'active' }, '-scheduled_date', 100).catch(() => []);
      const dueBatches = (recentBatches || []).filter((b) =>
        b.scheduled_date && b.scheduled_date <= today && b.scheduled_date >= cutoff);

      // 2. Top-up recurring series (bounded, dedup by recurrence_key).
      const seriesRows = await svc.entities.TaskBatch.filter(
        { is_series: true, status: 'active' }, '-created_date', 50).catch(() => []);
      for (const series of (seriesRows || [])) {
        const rec = { type: series.recurrence_type, weekdays: series.recurrence_weekdays || [], interval: series.recurrence_interval_days || 1 };
        if (rec.type === 'none') continue;
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
          const tasks = buildTasksForOccurrence(series, d, { id: series.id, display_name: series.created_by_name || 'System' });
          if (tasks.length) await svc.entities.OperationalTask.bulkCreate(tasks);
          results.occurrences_generated++;
        }
      }

      if (!dueBatches.length) return Response.json({ success: true, ...results, active_batches: 0 });

      const custRowsCache = {};
      const getCustomerName = async (customerId) => {
        if (!custRowsCache[customerId]) {
          const rows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
          custRowsCache[customerId] = (rows && rows[0] && rows[0].name) || 'Customer';
        }
        return custRowsCache[customerId];
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
        const outstanding = allTasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');

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

          const customerName = await getCustomerName(batch.customer_id);
          const content = reminderNotification(batch, outstanding, customerName);
          const sent = await notifyTaskRecipients(svc, secrets, recipients, content);
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
          // ── Deadline reached: overdue marking + Task Completion Report ──
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
          const customerName = await getCustomerName(batch.customer_id);
          const report = deadlineReport(batch, freshTasks || allTasks, customerName);
          const recipients = await resolveTaskRecipients(svc, batch.customer_id,
            [batch.primary_supervisor_id].concat(batch.additional_notification_user_ids || []));
          const sent = await notifyTaskRecipients(svc, secrets, recipients, report);
          await svc.entities.TaskBatch.update(batch.id, {
            status: 'reported', report_generated_at: new Date().toISOString(),
            report_delivery: 'email:' + sent.email + ' telegram:' + sent.telegram + ' to ' + recipients.length + ' recipient(s)',
          }).catch(() => {});
          await logTaskAudit(svc, { event_type: 'task.report_delivered', actor: null, batch,
            notes: 'Report generated at deadline — email:' + sent.email + ' telegram:' + sent.telegram });
          results.reports_generated++;
        }
      }
      return Response.json({ success: true, ...results, active_batches: dueBatches.length });
    }

    /* ──────────────────────────────────────────────────────────────────────
       AUTHENTICATED ACTIONS
       ────────────────────────────────────────────────────────────────────── */
    const platformAdmin = isPlatformAdmin(caller);
    const resellerAdmin = isResellerAdmin(caller);
    const roleType = caller.role_type;
    const customerId = platformAdmin ? (body.customer_id || null) : (caller.customer_id || null);
    const callerName = userName(caller);
    const isOperator = !platformAdmin && !resellerAdmin && roleType === OPERATOR_ROLE;
    const isGuard = !platformAdmin && !resellerAdmin && !isOperator && roleType === 'guard';
    const canEdit = platformAdmin || (EDIT_ROLES.indexOf(roleType) !== -1 && !!customerId);

    if (!platformAdmin && !resellerAdmin && !customerId) {
      return Response.json({ error: 'Your account is not assigned to a customer', code: 'no_scope' }, { status: 403 });
    }
    if (resellerAdmin && !caller.reseller_id) {
      return Response.json({ error: 'Your account is not assigned to a reseller', code: 'no_scope' }, { status: 403 });
    }
    if (!canEdit && !isOperator && !isGuard) {
      return Response.json({ error: 'Your role cannot access task scheduling', code: 'forbidden_role' }, { status: 403 });
    }

    /* Module gate — Task Scheduling is a STANDALONE module; OPERATIONS /
       COMPLETE_SECURITY customers keep access for continuity. Fail closed. */
    if (!platformAdmin && !resellerAdmin && customerId) {
      const ents = await svc.entities.ModuleEntitlement.filter({ customer_id: customerId }).catch(() => []);
      const licensed = (ents || []).some((e) =>
        e.enabled && (!e.status || e.status === 'active') && TASK_MODULE_KEYS.indexOf(e.module_key) !== -1);
      if (!licensed) {
        return Response.json({ error: 'Task Scheduling requires the Task Scheduling module for your customer', code: 'module_not_enabled' }, { status: 403 });
      }
    }

    /* Control rooms the caller may work (operators: only those they are
       authorised for; admins/platform: all tenant rooms). */
    const loadControlRooms = async () => {
      if (platformAdmin) return await svc.entities.ControlRoom.filter({}, 'name', 200).catch(() => []);
      if (resellerAdmin) return await svc.entities.ControlRoom.filter({ reseller_id: caller.reseller_id }, 'name', 200).catch(() => []);
      return await svc.entities.ControlRoom.filter({ customer_id: customerId }, 'name', 200).catch(() => []);
    };
    const operatorRoomIds = (await loadControlRooms() || [])
      .filter((r) => isOperator ? ((r.operator_user_ids || []).indexOf(caller.id) !== -1) : true)
      .map((r) => r.id);

    const findTask = async (id) => {
      if (!id) return null;
      const rows = await svc.entities.OperationalTask.filter({ id: String(id) }).catch(() => []);
      return (rows && rows[0]) ? rows[0] : null;
    };
    const findBatch = async (id) => {
      if (!id) return null;
      const rows = await svc.entities.TaskBatch.filter({ id: String(id) }).catch(() => []);
      return (rows && rows[0]) ? rows[0] : null;
    };

    /* Scope assertion. Guards: own tasks only. Operators: tasks in their
       authorised control rooms. Tenant roles: their customer only. */
    const assertScope = (task) => {
      if (!task) return Response.json({ error: 'Task not found', code: 'not_found' }, { status: 404 });
      if (platformAdmin) return null;
      if (isGuard) {
        if (task.assigned_to !== caller.id) {
          return Response.json({ error: 'You can only access tasks assigned to you', code: 'forbidden_task' }, { status: 403 });
        }
        return null;
      }
      if (isOperator) {
        if (!task.control_room_id || operatorRoomIds.indexOf(task.control_room_id) === -1) {
          return Response.json({ error: 'That task is not in a control room you are authorised for', code: 'forbidden_task' }, { status: 403 });
        }
        return null;
      }
      if (resellerAdmin) {
        if (task.reseller_id !== caller.reseller_id) {
          return Response.json({ error: 'That task does not belong to your reseller', code: 'forbidden_task' }, { status: 403 });
        }
        return null;
      }
      if (task.customer_id !== customerId) {
        return Response.json({ error: 'That task does not belong to your customer', code: 'forbidden_task' }, { status: 403 });
      }
      return null;
    };
    const assertOperatorOrEdit = (task) => {
      if (platformAdmin || canEdit) return null;
      if (isOperator) return assertScope(task);
      return Response.json({ error: 'Only a Control Room Operator or supervisor can perform this action', code: 'forbidden_action' }, { status: 403 });
    };

    /* ── list ─────────────────────────────────────────────────────────────── */
    if (action === 'list') {
      const nowIso = new Date().toISOString();
      if (customerId) {
        await svc.entities.OperationalTask.updateMany(
          { customer_id: customerId, status: { $in: LEGACY_OPEN_STATUSES }, due_date: { $lt: nowIso } },
          { $set: { status: 'overdue' } }
        ).catch(() => {});
        if (canEdit) {
          const parents = await svc.entities.OperationalTask.filter(
            { customer_id: customerId, recurrence_type: { $ne: 'none' } }, '-created_date', 50).catch(() => []);
          for (const parent of (parents || [])) {
            if (!parent.recurrence_key || parent.status === 'cancelled' || parent.task_batch_id) continue;
            const seriesId = parent.recurrence_key.slice(0, parent.recurrence_key.lastIndexOf(':'));
            const rec = { type: parent.recurrence_type, weekdays: parent.recurrence_weekdays || [], interval: parent.recurrence_interval_days || 1 };
            const endYmd = (parent.recurrence_end_date && DATE_RE.test(parent.recurrence_end_date))
              ? parent.recurrence_end_date : addDaysYmd(todayYmd(), 30);
            const dates = occurrenceDates(parent.scheduled_date, rec, endYmd, 62);
            if (!dates.length) continue;
            const keys = dates.map((d) => seriesId + ':' + d);
            const existing = await svc.entities.OperationalTask.filter({ recurrence_key: { $in: keys } }).catch(() => []);
            const have = new Set((existing || []).map((t) => t.recurrence_key));
            const missing = dates.filter((d) => !have.has(seriesId + ':' + d));
            if (missing.length) {
              await svc.entities.OperationalTask.bulkCreate(missing.map((d) => buildOccurrence(parent, seriesId, d)));
            }
          }
        }
      }
      let tasks = [];
      if (isGuard) {
        tasks = await svc.entities.OperationalTask.filter({ assigned_to: caller.id }, '-scheduled_date', 200).catch(() => []);
      } else if (isOperator) {
        tasks = operatorRoomIds.length
          ? await svc.entities.OperationalTask.filter({ control_room_id: { $in: operatorRoomIds } }, '-scheduled_date', 300).catch(() => [])
          : [];
      } else if (resellerAdmin) {
        tasks = await svc.entities.OperationalTask.filter({ reseller_id: caller.reseller_id }, '-created_date', 200).catch(() => []);
      } else if (customerId) {
        tasks = await svc.entities.OperationalTask.filter({ customer_id: customerId }, '-scheduled_date', 300).catch(() => []);
      } else {
        tasks = await svc.entities.OperationalTask.list('-created_date', 200).catch(() => []);
      }
      let sites = [];
      let staff = [];
      let batches = [];
      if (customerId) {
        sites = await svc.entities.Site.filter({ customer_id: customerId, status: 'active' }, 'name', 100).catch(() => []);
        const allUsers = await svc.entities.User.filter({ customer_id: customerId }, 'full_name', 200).catch(() => []);
        staff = (allUsers || []).map((u) => ({
          id: u.id, name: u.display_name || u.full_name || u.email, role_type: u.role_type,
        }));
        batches = await svc.entities.TaskBatch.filter({ customer_id: customerId }, '-scheduled_date', 100).catch(() => []);
      } else if (platformAdmin) {
        batches = await svc.entities.TaskBatch.list('-scheduled_date', 100).catch(() => []);
      }
      const users = staff.filter((u) => ASSIGNABLE_ROLES.indexOf(u.role_type) !== -1);
      return Response.json({
        tasks: tasks || [],
        sites: sites || [],
        users,
        staff,
        batches: batches || [],
        control_rooms: (await loadControlRooms()) || [],
        operator_room_ids: operatorRoomIds,
        can_manage: canEdit,
        is_operator: isOperator,
        is_guard: isGuard,
        customer_id: customerId,
      });
    }

    /* ── Control Room CRUD ───────────────────────────────────────────────── */
    if (action === 'controlRoomSave') {
      if (!canEdit) return Response.json({ error: 'Your role cannot manage control rooms', code: 'forbidden_action' }, { status: 403 });
      if (!customerId) return Response.json({ error: 'A customer must be selected', code: 'no_customer' }, { status: 400 });
      const name = String(body.name || '').trim();
      if (!name) return Response.json({ error: 'A control room name is required' }, { status: 400 });
      const resellerRows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
      const resellerId = (resellerRows && resellerRows[0] && resellerRows[0].reseller_id) || null;
      const collectUsers = async (ids, allowedRoles, label) => {
        const clean = [...new Set((ids || []).map(String).filter(Boolean))];
        const rows = clean.length ? await svc.entities.User.filter({ id: { $in: clean } }).catch(() => []) : [];
        const byId = new Map((rows || []).map((u) => [u.id, u]));
        for (const id of clean) {
          const u = byId.get(id);
          if (!u || (u.customer_id !== customerId && !isPlatformAdmin(u))) {
            return { err: Response.json({ error: 'A selected ' + label + ' does not belong to your customer', code: 'forbidden_user' }, { status: 400 }) };
          }
          if (allowedRoles.indexOf(u.role_type) === -1) {
            return { err: Response.json({ error: 'A selected ' + label + ' has a role that cannot hold this responsibility', code: 'forbidden_user' }, { status: 400 }) };
          }
        }
        return { ids: clean };
      };
      const ops = await collectUsers(body.operator_user_ids, OPERATOR_ELIGIBLE_ROLES, 'operator');
      if (ops.err) return ops.err;
      const sups = await collectUsers(body.supervisor_user_ids, SUPERVISOR_ROLES, 'supervisor');
      if (sups.err) return sups.err;
      const siteIds = [...new Set((body.linked_site_ids || []).map(String).filter(Boolean))];
      if (siteIds.length) {
        const siteRows = await svc.entities.Site.filter({ id: { $in: siteIds } }).catch(() => []);
        for (const s of (siteRows || [])) {
          if (s.customer_id !== customerId) {
            return Response.json({ error: 'A selected service-area site does not belong to your customer', code: 'forbidden_site' }, { status: 400 });
          }
        }
      }
      const fields = {
        customer_id: customerId, reseller_id: resellerId, name,
        physical_address: String(body.physical_address || '').trim() || null,
        status: body.status === 'inactive' ? 'inactive' : 'active',
        linked_site_ids: siteIds,
        operator_user_ids: ops.ids, supervisor_user_ids: sups.ids,
        notes: body.notes || null, created_by_name: callerName,
      };
      if (body.id) {
        const rows = await svc.entities.ControlRoom.filter({ id: String(body.id) }).catch(() => []);
        const existing = (rows && rows[0]) || null;
        if (!existing) return Response.json({ error: 'Control room not found' }, { status: 404 });
        if (!platformAdmin && existing.customer_id !== customerId) {
          return Response.json({ error: 'That control room does not belong to your customer', code: 'forbidden_room' }, { status: 403 });
        }
        const updated = await svc.entities.ControlRoom.update(existing.id, fields);
        await logTaskScopeAudit(svc, { event_type: 'task.control_room_updated', actor: caller,
          customerId, resellerId, controlId: existing.id, notes: name });
        return Response.json({ success: true, control_room: updated });
      }
      const created = await svc.entities.ControlRoom.create(fields);
      await logTaskScopeAudit(svc, { event_type: 'task.control_room_created', actor: caller,
        customerId, resellerId, controlId: created.id, notes: name });
      return Response.json({ success: true, control_room: created });
    }

    if (action === 'controlRoomDelete') {
      if (!canEdit) return Response.json({ error: 'Your role cannot manage control rooms', code: 'forbidden_action' }, { status: 403 });
      const rows = await svc.entities.ControlRoom.filter({ id: String(body.id || '') }).catch(() => []);
      const room = (rows && rows[0]) || null;
      if (!room) return Response.json({ error: 'Control room not found' }, { status: 404 });
      if (!platformAdmin && room.customer_id !== customerId) {
        return Response.json({ error: 'That control room does not belong to your customer', code: 'forbidden_room' }, { status: 403 });
      }
      const active = await svc.entities.OperationalTask.filter(
        { control_room_id: room.id, status: { $in: ALL_OPEN_STATUSES } }).catch(() => []);
      if ((active || []).length) {
        return Response.json({ error: 'This control room still has open tasks — deactivate it instead of deleting', code: 'room_in_use' }, { status: 400 });
      }
      await svc.entities.ControlRoom.delete(room.id);
      await logTaskScopeAudit(svc, { event_type: 'task.control_room_deleted', actor: caller,
        customerId: room.customer_id, resellerId: room.reseller_id, controlId: room.id, notes: room.name });
      return Response.json({ success: true });
    }

    /* ── Task Batch creation ──────────────────────────────────────────────── */
    if (action === 'createBatch') {
      if (!canEdit) return Response.json({ error: 'Your role cannot create task lists', code: 'forbidden_action' }, { status: 403 });
      if (!customerId) return Response.json({ error: 'A customer must be selected', code: 'no_customer' }, { status: 400 });
      const title = String(body.title || '').trim();
      if (!title) return Response.json({ error: 'A task list title is required' }, { status: 400 });
      const scheduled_date = String(body.scheduled_date || '');
      if (!DATE_RE.test(scheduled_date)) return Response.json({ error: 'A scheduled date is required (YYYY-MM-DD)' }, { status: 400 });
      const active_start_time = String(body.active_start_time || '');
      const deadline_time = String(body.deadline_time || '');
      if (!TIME_RE.test(active_start_time) || !TIME_RE.test(deadline_time)) {
        return Response.json({ error: 'A valid active window start and deadline (HH:MM) are required' }, { status: 400 });
      }
      if (deadline_time <= active_start_time) {
        return Response.json({ error: 'The deadline must be after the window start' }, { status: 400 });
      }
      const crRows = await svc.entities.ControlRoom.filter({ id: String(body.control_room_id || '') }).catch(() => []);
      const room = (crRows && crRows[0]) || null;
      if (!room || room.customer_id !== customerId) {
        return Response.json({ error: 'The selected control room does not belong to your customer', code: 'forbidden_room' }, { status: 400 });
      }
      if (room.status && room.status !== 'active') {
        return Response.json({ error: 'The selected control room is not active' }, { status: 400 });
      }
      // Primary Supervisor — required; same-customer user (platform admin allowed for oversight).
      const supRows = await svc.entities.User.filter({ id: String(body.primary_supervisor_id || '') }).catch(() => []);
      const supervisor = (supRows && supRows[0]) || null;
      if (!supervisor || (supervisor.customer_id !== customerId && !isPlatformAdmin(supervisor))) {
        return Response.json({ error: 'A supervisor belonging to your customer must be selected' }, { status: 400 });
      }
      // Additional recipients — same customer only (foreign ids rejected).
      const addIds = [...new Set((body.additional_notification_user_ids || []).map(String).filter(Boolean))];
      if (addIds.length) {
        const addRows = await svc.entities.User.filter({ id: { $in: addIds } }).catch(() => []);
        const byId = new Map((addRows || []).map((u) => [u.id, u]));
        for (const id of addIds) {
          const u = byId.get(id);
          if (!u || u.customer_id !== customerId) {
            return Response.json({ error: 'An additional notification recipient does not belong to your customer', code: 'forbidden_user' }, { status: 400 });
          }
        }
      }
      const addNames = addIds.length
        ? (await svc.entities.User.filter({ id: { $in: addIds } }).catch(() => [])).map((u) => userName(u))
        : [];
      // Task definitions — at least one; sites optional (Site is shared platform infrastructure).
      const defs = Array.isArray(body.task_definitions) ? body.task_definitions : [];
      const cleanDefs = [];
      for (const d of defs) {
        const t = String((d && d.title) || '').trim();
        if (!t) return Response.json({ error: 'Every task in the list needs a title' }, { status: 400 });
        let siteId = null;
        let siteName = null;
        if (d.site_id) {
          const rows = await svc.entities.Site.filter({ id: String(d.site_id) }).catch(() => []);
          const site = (rows && rows[0]) || null;
          if (!site || site.customer_id !== customerId) {
            return Response.json({ error: 'A task site does not belong to your customer', code: 'forbidden_site' }, { status: 400 });
          }
          siteId = site.id;
          siteName = site.name || null;
        }
        cleanDefs.push({
          title: t,
          description: (d.description || '').trim() || null,
          task_type: d.task_type || 'other',
          priority: PRIORITIES.indexOf(d.priority) !== -1 ? d.priority : 'medium',
          site_id: siteId, site_name: siteName,
          scheduled_time: TIME_RE.test(String(d.scheduled_time || '')) ? d.scheduled_time : null,
          due_time: TIME_RE.test(String(d.due_time || '')) ? d.due_time : null,
          completion_notes_required: !!d.completion_notes_required,
          evidence_required: !!d.evidence_required,
        });
      }
      if (!cleanDefs.length) return Response.json({ error: 'Add at least one task to the list' }, { status: 400 });

      const custRows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
      const resellerId = (custRows && custRows[0] && custRows[0].reseller_id) || caller.reseller_id || null;
      const recurrence_type = RECURRENCE_TYPES.indexOf(body.recurrence_type) !== -1 ? body.recurrence_type : 'none';
      const recurrence_end_date = (recurrence_type !== 'none' && DATE_RE.test(String(body.recurrence_end_date || ''))) ? body.recurrence_end_date : null;
      if (recurrence_end_date && recurrence_end_date < scheduled_date) {
        return Response.json({ error: 'The recurrence end date must be on or after the scheduled date' }, { status: 400 });
      }
      const common = {
        customer_id: customerId, reseller_id: resellerId,
        control_room_id: room.id, control_room_name: room.name,
        title, description: String(body.description || '').trim() || null,
        active_start_time, deadline_time,
        primary_supervisor_id: supervisor.id, primary_supervisor_name: userName(supervisor),
        additional_notification_user_ids: addIds, additional_notification_names: addNames,
        recurrence_type,
        recurrence_weekdays: Array.isArray(body.recurrence_weekdays) ? body.recurrence_weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [],
        recurrence_interval_days: Math.max(1, Number(body.recurrence_interval_days) || 1),
        recurrence_end_date,
        created_by_name: callerName,
      };

      if (recurrence_type === 'none') {
        const batchRec = await svc.entities.TaskBatch.create({
          ...common, scheduled_date, is_series: false, parent_batch_id: null,
          task_definitions: [], recurrence_key: null, status: 'active',
        });
        const tasks = buildTasksForOccurrence(
          { ...common, id: batchRec.id, deadline_time, task_definitions: cleanDefs }, scheduled_date, caller);
        await svc.entities.OperationalTask.bulkCreate(tasks);
        await logTaskAudit(svc, { event_type: 'task.batch_created', actor: caller, batch: batchRec,
          notes: title + ' → ' + room.name + ' (' + tasks.length + ' task(s), ' + active_start_time + '–' + deadline_time + ')' });
        return Response.json({ success: true, batch: batchRec, tasks_created: tasks.length });
      }

      const seriesId = 'series-' + crypto.randomUUID();
      const series = await svc.entities.TaskBatch.create({
        ...common, scheduled_date, is_series: true, parent_batch_id: null,
        task_definitions: cleanDefs,
        recurrence_key: seriesId + ':' + scheduled_date, status: 'active',
      });
      const endYmd = recurrence_end_date || addDaysYmd(scheduled_date, 30);
      const dates = occurrenceDates(scheduled_date,
        { type: recurrence_type, weekdays: common.recurrence_weekdays, interval: common.recurrence_interval_days }, endYmd, 62);
      let occurrences = 0;
      if (dates.length) {
        const occs = dates.map((d) => buildOccurrenceBatch(series, d, seriesId));
        const createdOccs = await svc.entities.TaskBatch.bulkCreate(occs);
        const allTasks = [];
        createdOccs.forEach((occ, i) => {
          buildTasksForOccurrence({ ...common, id: occ.id, deadline_time, task_definitions: cleanDefs }, dates[i], caller)
            .forEach((t) => allTasks.push(t));
        });
        if (allTasks.length) await svc.entities.OperationalTask.bulkCreate(allTasks);
        occurrences = createdOccs.length;
      }
      // The FIRST run's tasks are also needed when the series starts today.
      // NOTE: is_series:false — the series definition record itself carries the
      // same recurrence_key (seriesId:start_date), so without this filter the
      // dedup check matched the series record and today's occurrence was
      // never generated (live regression, Dogs and All acceptance 2026-09-08).
      const firstKey = seriesId + ':' + scheduled_date;
      const existingFirst = await svc.entities.TaskBatch.filter(
        { recurrence_key: firstKey, is_series: false }).catch(() => []);
      if (!(existingFirst || []).length) {
        const occ = await svc.entities.TaskBatch.create(buildOccurrenceBatch(series, scheduled_date, seriesId));
        await svc.entities.OperationalTask.bulkCreate(
          buildTasksForOccurrence({ ...common, id: occ.id, deadline_time, task_definitions: cleanDefs }, scheduled_date, caller));
        occurrences++;
      }
      await logTaskAudit(svc, { event_type: 'task.batch_created', actor: caller, batch: series,
        notes: title + ' (recurring ' + recurrence_type + ') → ' + room.name + ' — ' + occurrences + ' occurrence(s) generated' });
      return Response.json({ success: true, batch: series, occurrences_generated: occurrences });
    }

    /* ── Batch cancel ─────────────────────────────────────────────────────── */
    if (action === 'cancelBatch') {
      if (!canEdit) return Response.json({ error: 'Your role cannot cancel task lists', code: 'forbidden_action' }, { status: 403 });
      const batch = await findBatch(body.id);
      if (!batch) return Response.json({ error: 'Task list not found' }, { status: 404 });
      if (!platformAdmin && batch.customer_id !== customerId) {
        return Response.json({ error: 'That task list does not belong to your customer', code: 'forbidden_batch' }, { status: 403 });
      }
      const cancelTasksOf = async (batchId) => {
        await svc.entities.OperationalTask.updateMany(
          { task_batch_id: batchId, status: { $in: ALL_OPEN_STATUSES } },
          { $set: { status: 'cancelled' } }).catch(() => {});
      };
      if (batch.is_series) {
        await svc.entities.TaskBatch.updateMany(
          { parent_batch_id: batch.id, status: 'active' },
          { $set: { status: 'cancelled' } }).catch(() => {});
        const future = await svc.entities.TaskBatch.filter({ parent_batch_id: batch.id, status: 'cancelled' }).catch(() => []);
        for (const occ of (future || [])) await cancelTasksOf(occ.id);
        await cancelTasksOf(batch.id);
      } else {
        await cancelTasksOf(batch.id);
      }
      await svc.entities.TaskBatch.update(batch.id, { status: 'cancelled' });
      await logTaskAudit(svc, { event_type: 'task.batch_cancelled', actor: caller, batch,
        notes: batch.title + (batch.is_series ? ' (series + future occurrences)' : '') });
      return Response.json({ success: true });
    }

    /* ── Task assign / reassign (Control Room Operator or supervisor) ──────── */
    if (action === 'assign' || action === 'reassign') {
      const task = await findTask(body.id);
      const gate = assertOperatorOrEdit(task);
      if (gate) return gate;
      if (task.status === 'completed' || task.status === 'cancelled') {
        return Response.json({ error: 'A finished task cannot be assigned' }, { status: 400 });
      }
      const userRows = await svc.entities.User.filter({ id: String(body.assigned_to || '') }).catch(() => []);
      const assignee = (userRows && userRows[0]) || null;
      if (!assignee) return Response.json({ error: 'Select a user to assign the task to' }, { status: 400 });
      if (assignee.customer_id !== task.customer_id) {
        return Response.json({ error: 'The selected user does not belong to your customer', code: 'forbidden_user' }, { status: 400 });
      }
      if (ASSIGNABLE_ROLES.indexOf(assignee.role_type) === -1) {
        return Response.json({ error: 'That user role cannot be assigned tasks' }, { status: 400 });
      }
      const from = task.status;
      const changes = {
        assigned_to: assignee.id,
        assigned_to_name: userName(assignee),
        assigned_at: new Date().toISOString(),
        status: task.status === 'queue' || task.status === 'reopened' ? 'assigned' : task.status,
      };
      if (isOperator) {
        changes.assigned_by_operator_id = caller.id;
        changes.assigned_by_operator_name = callerName;
      }
      const updated = await svc.entities.OperationalTask.update(task.id, changes);
      await logTaskAudit(svc, { event_type: action === 'reassign' ? 'task.reassigned' : 'task.assigned',
        actor: caller, task, from_status: from, to_status: changes.status,
        notes: '→ ' + userName(assignee) + (isOperator ? ' (by operator ' + callerName + ')' : '') });
      return Response.json({ success: true, task: updated });
    }

    /* ── Start ────────────────────────────────────────────────────────────── */
    if (action === 'start') {
      const task = await findTask(body.id);
      const gate = assertOperatorOrEdit(task);
      if (gate) return gate;
      if (!canEdit && !isOperator && task.assigned_to !== caller.id) {
        return Response.json({ error: 'Only the assigned user can start this task', code: 'forbidden_task' }, { status: 403 });
      }
      if (task.status === 'completed' || task.status === 'cancelled') {
        return Response.json({ error: 'Only open tasks can be started' }, { status: 400 });
      }
      if (task.status === 'in_progress') return Response.json({ success: true, task, unchanged: true });
      const updated = await svc.entities.OperationalTask.update(task.id, { status: 'in_progress' });
      await logTaskAudit(svc, { event_type: 'task.started', actor: caller, task,
        from_status: task.status, to_status: 'in_progress' });
      return Response.json({ success: true, task: updated });
    }

    /* ── SIGN-OFF 1 — Guard/User completion (NOT completed) ──────────────── */
    if (action === 'submitCompletion') {
      const task = await findTask(body.id);
      const gate = assertOperatorOrEdit(task);
      if (gate) return gate;
      if (!canEdit && !isOperator && task.assigned_to !== caller.id) {
        return Response.json({ error: 'Only the assigned user can sign off this task', code: 'forbidden_task' }, { status: 403 });
      }
      if (task.status === 'cancelled') return Response.json({ error: 'A cancelled task cannot be completed' }, { status: 400 });
      if (task.status === 'completed') return Response.json({ success: true, task, unchanged: true });
      const notes = String(body.completion_notes || '').trim();
      if (task.completion_notes_required && !notes) {
        return Response.json({ error: 'Completion notes are required for this task' }, { status: 400 });
      }
      const evidence = String(body.evidence_url || '').trim() || null;
      if (task.evidence_required && !evidence && !task.completion_evidence_url) {
        return Response.json({ error: 'Evidence is required for this task' }, { status: 400 });
      }
      const signature = String(body.signature || '').trim();
      if (!signature || !signature.startsWith('data:image')) {
        return Response.json({ error: 'A digital signature is required to sign off this task' }, { status: 400 });
      }
      const updated = await svc.entities.OperationalTask.update(task.id, {
        status: 'awaiting_verification',
        completed_at: new Date().toISOString(),
        completed_by: caller.id,
        completed_by_name: callerName,
        completion_notes: notes || task.completion_notes || null,
        completion_evidence_url: evidence || task.completion_evidence_url || null,
        completion_signature: signature,
      });
      await logTaskAudit(svc, { event_type: 'task.guard_signoff', actor: caller, task,
        from_status: task.status, to_status: 'awaiting_verification',
        notes: 'Sign-off 1 by ' + callerName + (notes ? ' — ' + notes.slice(0, 200) : '') });
      return Response.json({ success: true, task: updated });
    }

    /* ── SIGN-OFF 2 — Control Room Operator verification → COMPLETED ────── */
    if (action === 'verify') {
      const task = await findTask(body.id);
      const gate = assertOperatorOrEdit(task);
      if (gate) return gate;
      if (task.status !== 'awaiting_verification') {
        return Response.json({ error: 'Only a task awaiting verification can be verified' }, { status: 400 });
      }
      if (!task.completed_by) {
        return Response.json({ error: 'The assigned user must sign off before verification' }, { status: 400 });
      }
      if (task.completed_by === caller.id) {
        return Response.json({ error: 'The two sign-offs must be performed by different people — the user who signed off the completion cannot verify it', code: 'dual_signoff' }, { status: 403 });
      }
      const signature = String(body.signature || '').trim();
      if (!signature || !signature.startsWith('data:image')) {
        return Response.json({ error: 'A digital signature is required to verify this task' }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      const updated = await svc.entities.OperationalTask.update(task.id, {
        status: 'completed',
        verified: true,
        verified_by: caller.id,
        verified_by_name: callerName,
        verified_at: nowIso,
        verification_notes: String(body.verification_notes || '').trim() || null,
        verification_signature: signature,
        final_completed_at: nowIso,
      });
      await logTaskAudit(svc, { event_type: 'task.control_room_signoff', actor: caller, task,
        from_status: 'awaiting_verification', to_status: 'completed',
        notes: 'Sign-off 2 by ' + callerName + ' — task fully completed' });

      // Immediate completion notification (module-owned channels; supervisor + configured recipients).
      try {
        const batch = await findBatch(task.task_batch_id);
        const custRows = await svc.entities.Customer.filter({ id: task.customer_id }).catch(() => []);
        const customerName = (custRows && custRows[0] && custRows[0].name) || 'Customer';
        const recipientIds = [batch && batch.primary_supervisor_id]
          .concat((task.additional_notification_user_ids && task.additional_notification_user_ids.length
            ? task.additional_notification_user_ids
            : (batch && batch.additional_notification_user_ids) || []));
        const recipients = await resolveTaskRecipients(svc, task.customer_id, recipientIds);
        if (recipients.length) {
          const content = completionNotification(updated, batch || {}, customerName);
          const sent = await notifyTaskRecipients(svc, secrets, recipients, content);
          await logTaskAudit(svc, { event_type: 'task.completion_notified', actor: caller, task,
            notes: 'Supervisor notified — email:' + sent.email + ' telegram:' + sent.telegram });
        }
      } catch (e) {
        console.error('completion notification failed:', e?.message || e);
      }
      return Response.json({ success: true, task: updated });
    }

    /* ── Reject / Reopen (operator, mandatory reason) ────────────────────── */
    if (action === 'reject') {
      const task = await findTask(body.id);
      const gate = assertOperatorOrEdit(task);
      if (gate) return gate;
      if (task.status !== 'awaiting_verification') {
        return Response.json({ error: 'Only a task awaiting verification can be rejected' }, { status: 400 });
      }
      const reason = String(body.reason || '').trim();
      if (!reason) return Response.json({ error: 'A rejection reason is required' }, { status: 400 });
      const updated = await svc.entities.OperationalTask.update(task.id, {
        status: 'reopened',
        reopen_reason: reason,
        reopened_by: caller.id,
        reopened_by_name: callerName,
        reopened_at: new Date().toISOString(),
        // Guard sign-off data is preserved (audit history intact); the task
        // returns to the assigned user for rework.
      });
      await logTaskAudit(svc, { event_type: 'task.rejected_reopened', actor: caller, task,
        from_status: 'awaiting_verification', to_status: 'reopened', notes: 'Rejected by ' + callerName + ' — ' + reason });
      return Response.json({ success: true, task: updated });
    }

    /* ── Non-completion reason capture ───────────────────────────────────── */
    if (action === 'captureReason') {
      const task = await findTask(body.id);
      const gate = assertOperatorOrEdit(task);
      if (gate) return gate;
      if (task.status === 'completed' || task.status === 'cancelled') {
        return Response.json({ error: 'A finished task needs no non-completion reason' }, { status: 400 });
      }
      const reason = String(body.reason || '').trim();
      if (!reason) return Response.json({ error: 'A reason is required' }, { status: 400 });
      const updated = await svc.entities.OperationalTask.update(task.id, {
        non_completion_reason: reason,
        reason_captured_by: caller.id,
        reason_captured_by_name: callerName,
        reason_captured_at: new Date().toISOString(),
      });
      await logTaskAudit(svc, { event_type: 'task.reason_captured', actor: caller, task,
        notes: 'Non-completion reason by ' + callerName + ' — ' + reason.slice(0, 200) });
      return Response.json({ success: true, task: updated });
    }

    /* ── Legacy task update ───────────────────────────────────────────────── */
    if (action === 'update') {
      if (!canEdit) return Response.json({ error: 'Your role cannot edit tasks', code: 'forbidden_action' }, { status: 403 });
      const task = await findTask(body.id);
      const scopeErr = assertScope(task);
      if (scopeErr) return scopeErr;
      const changes = {};
      if (body.title !== undefined) {
        const t = String(body.title).trim();
        if (!t) return Response.json({ error: 'A task title is required' }, { status: 400 });
        changes.title = t;
      }
      if (body.description !== undefined) changes.description = body.description || null;
      if (body.notes !== undefined) changes.notes = body.notes || null;
      if (body.task_type !== undefined) changes.task_type = body.task_type || 'other';
      if (body.priority !== undefined && PRIORITIES.indexOf(body.priority) !== -1) changes.priority = body.priority;
      if (body.completion_notes_required !== undefined) changes.completion_notes_required = !!body.completion_notes_required;
      if (body.evidence_required !== undefined) changes.evidence_required = !!body.evidence_required;
      if (body.site_id !== undefined && body.site_id !== task.site_id) {
        if (body.site_id) {
          const siteRows = await svc.entities.Site.filter({ id: String(body.site_id) }).catch(() => []);
          const site = (siteRows && siteRows[0]) ? siteRows[0] : null;
          if (!site || site.customer_id !== task.customer_id) {
            return Response.json({ error: 'The selected site does not belong to your customer' }, { status: 400 });
          }
          changes.site_id = site.id;
          changes.site_name = site.name || null;
        } else {
          changes.site_id = null;
          changes.site_name = null;
        }
      }
      if (body.scheduled_date !== undefined || body.scheduled_time !== undefined) {
        const sd = body.scheduled_date !== undefined ? String(body.scheduled_date) : task.scheduled_date;
        const st = body.scheduled_time !== undefined ? String(body.scheduled_time) : task.scheduled_time;
        if (!DATE_RE.test(sd)) {
          return Response.json({ error: 'A valid scheduled date is required' }, { status: 400 });
        }
        changes.scheduled_date = sd;
        changes.scheduled_time = TIME_RE.test(st) ? st : null;
        changes.scheduled_at = TIME_RE.test(st) ? sd + 'T' + st + ':00+02:00' : null;
      }
      if (body.due_date !== undefined) changes.due_date = body.due_date || null;
      if (!Object.keys(changes).length) return Response.json({ success: true, task: task, unchanged: true });
      const updated = await svc.entities.OperationalTask.update(task.id, changes);
      await logTaskAudit(svc, { event_type: 'task.updated', actor: caller, task,
        notes: 'Fields: ' + Object.keys(changes).join(', ') });
      return Response.json({ success: true, task: updated });
    }

    /* ── Legacy direct-complete — blocked for control-room tasks ──────────── */
    if (action === 'complete') {
      const task = await findTask(body.id);
      const scopeErr = assertScope(task);
      if (scopeErr) return scopeErr;
      if (task.control_room_id) {
        return Response.json({ error: 'This task follows the dual sign-off workflow: the assigned user signs off, then the Control Room Operator verifies. Use submit completion.' , code: 'dual_signoff_required' }, { status: 400 });
      }
      if (task.status === 'cancelled') {
        return Response.json({ error: 'A cancelled task cannot be completed' }, { status: 400 });
      }
      if (task.status === 'completed') return Response.json({ success: true, task: task, unchanged: true });
      const notes = String(body.completion_notes || '').trim();
      if (task.completion_notes_required && !notes) {
        return Response.json({ error: 'Completion notes are required for this task' }, { status: 400 });
      }
      const updated = await svc.entities.OperationalTask.update(task.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: caller.id,
        completed_by_name: callerName,
        completion_notes: notes || task.completion_notes || null,
      });
      await logTaskAudit(svc, { event_type: 'task.completed_legacy', actor: caller, task,
        from_status: task.status, to_status: 'completed' });
      return Response.json({ success: true, task: updated });
    }

    /* ── Cancel task ──────────────────────────────────────────────────────── */
    if (action === 'cancel') {
      if (!canEdit) return Response.json({ error: 'Your role cannot cancel tasks', code: 'forbidden_action' }, { status: 403 });
      const task = await findTask(body.id);
      const scopeErr = assertScope(task);
      if (scopeErr) return scopeErr;
      if (task.status === 'completed') {
        return Response.json({ error: 'A completed task cannot be cancelled' }, { status: 400 });
      }
      if (task.status === 'cancelled') return Response.json({ success: true, task: task, unchanged: true });
      const updated = await svc.entities.OperationalTask.update(task.id, { status: 'cancelled' });
      await logTaskAudit(svc, { event_type: 'task.cancelled', actor: caller, task,
        from_status: task.status, to_status: 'cancelled' });
      if (task.recurrence_type && task.recurrence_type !== 'none') {
        await svc.entities.OperationalTask.updateMany(
          { customer_id: task.customer_id, parent_task_id: task.id, status: { $in: ALL_OPEN_STATUSES } },
          { $set: { status: 'cancelled' } }).catch(() => {});
      }
      return Response.json({ success: true, task: updated });
    }

    /* ── Legacy direct create (single task, no control room) ──────────────── */
    if (action === 'create') {
      if (!canEdit) return Response.json({ error: 'Your role cannot create tasks', code: 'forbidden_action' }, { status: 403 });
      if (!customerId) return Response.json({ error: 'A customer must be selected', code: 'no_customer' }, { status: 400 });
      const title = String(body.title || '').trim();
      if (!title) return Response.json({ error: 'A task title is required' }, { status: 400 });
      const scheduled_date = String(body.scheduled_date || '');
      const scheduled_time = String(body.scheduled_time || '');
      if (!DATE_RE.test(scheduled_date)) return Response.json({ error: 'A scheduled date is required (YYYY-MM-DD)' }, { status: 400 });
      if (!TIME_RE.test(scheduled_time)) return Response.json({ error: 'A scheduled time is required (HH:MM)' }, { status: 400 });
      const recurrence_type = RECURRENCE_TYPES.indexOf(body.recurrence_type) !== -1 ? body.recurrence_type : 'none';
      const recurrence_end_date = (recurrence_type !== 'none' && DATE_RE.test(String(body.recurrence_end_date || ''))) ? body.recurrence_end_date : null;
      if (recurrence_end_date && recurrence_end_date < scheduled_date) {
        return Response.json({ error: 'The recurrence end date must be on or after the scheduled date' }, { status: 400 });
      }
      let site = null;
      if (body.site_id) {
        const siteRows = await svc.entities.Site.filter({ id: String(body.site_id || '') }).catch(() => []);
        site = (siteRows && siteRows[0]) ? siteRows[0] : null;
        if (!site || site.customer_id !== customerId) {
          return Response.json({ error: 'The selected site does not belong to your customer' }, { status: 400 });
        }
        if (site.status && site.status !== 'active') {
          return Response.json({ error: 'The selected site is not active' }, { status: 400 });
        }
      }
      let assignee = null;
      if (body.assigned_to) {
        const userRows = await svc.entities.User.filter({ id: String(body.assigned_to || '') }).catch(() => []);
        assignee = (userRows && userRows[0]) ? userRows[0] : null;
        if (!assignee || assignee.customer_id !== customerId) {
          return Response.json({ error: 'The selected user does not belong to your customer' }, { status: 400 });
        }
        if (ASSIGNABLE_ROLES.indexOf(assignee.role_type) === -1) {
          return Response.json({ error: 'That user role cannot be assigned tasks' }, { status: 400 });
        }
      }
      const custRows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
      const customer = (custRows && custRows[0]) ? custRows[0] : null;
      const resellerId = (customer && customer.reseller_id) || caller.reseller_id || null;
      const recurrence_weekdays = Array.isArray(body.recurrence_weekdays)
        ? body.recurrence_weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
      const parent = {
        customer_id: customerId,
        reseller_id: resellerId,
        site_id: site ? site.id : null,
        site_name: site ? (site.name || null) : null,
        title,
        description: body.description || null,
        task_type: body.task_type || 'other',
        priority: PRIORITIES.indexOf(body.priority) !== -1 ? body.priority : 'medium',
        assigned_to: assignee ? assignee.id : null,
        assigned_to_name: assignee ? userName(assignee) : null,
        assigned_by: caller.id,
        assigned_by_name: callerName,
        scheduled_date,
        scheduled_time,
        scheduled_at: scheduled_date + 'T' + scheduled_time + ':00+02:00',
        due_date: (typeof body.due_date === 'string' && body.due_date) ? body.due_date : null,
        status: 'new',
        recurrence_type,
        recurrence_weekdays,
        recurrence_interval_days: Math.max(1, Number(body.recurrence_interval_days) || 1),
        recurrence_end_date,
        recurrence_key: recurrence_type !== 'none' ? 'series-' + crypto.randomUUID() + ':' + scheduled_date : null,
        parent_task_id: null,
        notes: body.notes || null,
        completion_notes_required: !!body.completion_notes_required,
      };
      const created = await svc.entities.OperationalTask.create(parent);
      await logTaskAudit(svc, { event_type: 'task.created', actor: caller, task: created,
        notes: title + (assignee ? ' → ' + userName(assignee) : ' (unassigned)') });
      let occurrences = 0;
      if (recurrence_type !== 'none' && created && created.id) {
        const seriesId = parent.recurrence_key.slice(0, parent.recurrence_key.lastIndexOf(':'));
        const endYmd = recurrence_end_date || addDaysYmd(scheduled_date, 30);
        const dates = occurrenceDates(scheduled_date,
          { type: recurrence_type, weekdays: recurrence_weekdays, interval: parent.recurrence_interval_days }, endYmd, 62);
        if (dates.length) {
          const withId = Object.assign({}, parent, { id: created.id });
          await svc.entities.OperationalTask.bulkCreate(dates.map((d) => buildOccurrence(withId, seriesId, d)));
          occurrences = dates.length;
        }
      }
      return Response.json({ success: true, task: created, occurrences_generated: occurrences });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}