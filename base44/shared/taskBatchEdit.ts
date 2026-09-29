/**
 * Task Scheduling — task-list (batch) EDITING (shared module, called ONLY by
 * the scheduledTaskAccess gateway).
 *
 * COMPLETE PRE-EXECUTION EDITING: authorised admins/supervisors may edit the
 * task-list structure BEFORE execution has started — title, description,
 * scheduled date (once-off lists), active window, recurrence (series) and the
 * embedded task items (series). Supervisor and additional-notification
 * recipients remain editable at any time (delivery configuration, never
 * history).
 *
 * EXECUTION-STARTED LOCK: once any task in the list has started, collected
 * evidence, received a sign-off, completed, or the deadline reason gate is
 * active, structural edits are REJECTED server-side — the historical meaning
 * of the executed task is never rewritten. Completed occurrences of a series
 * are never retroactively changed; pending occurrences inherit the edited
 * fields and their not-yet-started tasks are updated.
 *
 * SECURITY: tenant scope is resolved by the gateway (customerId from the
 * authenticated caller); supervisor/recipients are validated same-customer,
 * ACTIVE and role-entitled; every edit is audited.
 */

import { DATE_RE, PRIORITIES } from './taskSweep.ts';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECURRENCE_TYPES = ['daily', 'weekly', 'weekdays', 'monthly', 'custom'];
const SUPERVISOR_ROLES = ['dispatcher', 'admin', 'customer_admin'];
const USER_BLOCK_STATUSES = ['suspended', 'inactive', 'disabled', 'deleted', 'archived'];
const UNSTARTED_TASK_STATUSES = ['queue', 'new', 'assigned', 'acknowledged', 'awaiting'];

function userName(u) {
  return (u && (u.display_name || u.full_name || u.email)) || '—';
}
function userStatusBlocked(u) {
  return !!u && !!u.status && USER_BLOCK_STATUSES.indexOf(String(u.status).toLowerCase()) !== -1;
}
function isPlatformAdminUser(u) {
  return !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
}

export async function handleUpdateBatch(svc, ctx) {
  const { caller, platformAdmin, customerId, canEdit, body, findBatch, logTaskAudit } = ctx;
  if (!canEdit) return Response.json({ error: 'Your role cannot edit task lists', code: 'forbidden_action' }, { status: 403 });
  const batch = await findBatch(body.id);
  if (!batch) return Response.json({ error: 'Task list not found' }, { status: 404 });
  if (!platformAdmin && batch.customer_id !== customerId) {
    return Response.json({ error: 'That task list does not belong to your customer', code: 'forbidden_batch' }, { status: 403 });
  }
  if (batch.status === 'cancelled' || batch.status === 'reported') {
    return Response.json({ error: 'A finished or cancelled task list cannot be edited' }, { status: 400 });
  }

  // EXECUTION-STARTED DETECTION (authoritative): any task in the list that
  // started, collected evidence, carries a signature or a sign-off/completed
  // state — or a batch already inside the deadline reason gate — locks the
  // structure.
  const batchTasks = await svc.entities.OperationalTask.filter({ task_batch_id: batch.id }).catch(() => []);
  const executionStarted = batch.status === 'reason_pending' || (batchTasks || []).some((t) =>
    !t.archived && (t.completed_at || t.completion_signature || t.completion_evidence_url ||
      ['in_progress', 'awaiting_verification', 'reopened', 'overdue', 'completed'].indexOf(t.status) !== -1));

  const changes = {};
  const structural = [];

  if (body.title !== undefined) {
    const t = String(body.title || '').trim();
    if (!t) return Response.json({ error: 'A task list title is required' }, { status: 400 });
    changes.title = t; structural.push('title');
  }
  if (body.description !== undefined) {
    changes.description = String(body.description || '').trim() || null; structural.push('description');
  }
  if (body.scheduled_date !== undefined) {
    if (batch.is_series) {
      return Response.json({ error: 'A recurring series start date cannot be changed — cancel the series and create a new one with the new date', code: 'series_date_locked' }, { status: 400 });
    }
    if (!DATE_RE.test(String(body.scheduled_date || ''))) {
      return Response.json({ error: 'A valid scheduled date is required (YYYY-MM-DD)' }, { status: 400 });
    }
    changes.scheduled_date = String(body.scheduled_date); structural.push('scheduled_date');
  }
  if (body.active_start_time !== undefined || body.deadline_time !== undefined) {
    const st = body.active_start_time !== undefined ? String(body.active_start_time) : batch.active_start_time;
    const dl = body.deadline_time !== undefined ? String(body.deadline_time) : batch.deadline_time;
    if (!TIME_RE.test(st) || !TIME_RE.test(dl)) {
      return Response.json({ error: 'A valid active window start and deadline (HH:MM) are required' }, { status: 400 });
    }
    if (dl <= st) {
      return Response.json({ error: 'The deadline must be after the window start' }, { status: 400 });
    }
    changes.active_start_time = st; changes.deadline_time = dl;
    structural.push('active window');
  }
  if (body.recurrence_type !== undefined || body.recurrence_end_date !== undefined ||
      body.recurrence_weekdays !== undefined || body.recurrence_interval_days !== undefined) {
    if (!batch.is_series) {
      return Response.json({ error: 'Recurrence can only be changed on a recurring task list (series) — create a new recurring list instead', code: 'recurrence_locked' }, { status: 400 });
    }
    if (body.recurrence_type !== undefined) {
      const rt = RECURRENCE_TYPES.indexOf(body.recurrence_type) !== -1 ? body.recurrence_type : null;
      if (!rt || rt === 'none') {
        return Response.json({ error: 'A recurring series must keep a recurrence type — set an end date to stop future occurrences', code: 'recurrence_locked' }, { status: 400 });
      }
      changes.recurrence_type = rt;
    }
    if (body.recurrence_weekdays !== undefined) {
      changes.recurrence_weekdays = Array.isArray(body.recurrence_weekdays)
        ? body.recurrence_weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
    }
    if (body.recurrence_interval_days !== undefined) {
      changes.recurrence_interval_days = Math.max(1, Number(body.recurrence_interval_days) || 1);
    }
    if (body.recurrence_end_date !== undefined) {
      changes.recurrence_end_date = DATE_RE.test(String(body.recurrence_end_date || '')) ? body.recurrence_end_date : null;
    }
    structural.push('recurrence');
  }
  if (body.task_definitions !== undefined) {
    if (!Array.isArray(body.task_definitions) || !body.task_definitions.length) {
      return Response.json({ error: 'At least one task item is required' }, { status: 400 });
    }
    const cleanDefs = [];
    for (const d of body.task_definitions) {
      const t = String((d && d.title) || '').trim();
      if (!t) return Response.json({ error: 'Every task in the list needs a title' }, { status: 400 });
      let siteId = null;
      let siteName = null;
      if (d.site_id) {
        const siteRows = await svc.entities.Site.filter({ id: String(d.site_id) }).catch(() => []);
        const site = (siteRows && siteRows[0]) || null;
        if (!site || site.customer_id !== batch.customer_id) {
          return Response.json({ error: 'A task site does not belong to your customer', code: 'forbidden_site' }, { status: 400 });
        }
        siteId = site.id; siteName = site.name || null;
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
    changes.task_definitions = cleanDefs; structural.push('task items');
  }

  if (executionStarted && structural.length) {
    return Response.json({
      error: 'Execution has started on this task list — its structure (title, schedule, window, recurrence, task items) is locked to protect the audit history. Only the supervisor and notification recipients can still be changed.',
      code: 'execution_started_locked',
    }, { status: 400 });
  }

  // Primary supervisor — same customer, ACTIVE, authorised supervisory role.
  if (body.primary_supervisor_id !== undefined) {
    const supRows = await svc.entities.User.filter({ id: String(body.primary_supervisor_id || '') }).catch(() => []);
    const supervisor = (supRows && supRows[0]) || null;
    if (!supervisor || (supervisor.customer_id !== customerId && !isPlatformAdminUser(supervisor))) {
      return Response.json({ error: 'A supervisor belonging to your customer must be selected' }, { status: 400 });
    }
    if (SUPERVISOR_ROLES.indexOf(supervisor.role_type) === -1) {
      return Response.json({ error: 'The primary supervisor must hold an authorised supervisory role', code: 'forbidden_user' }, { status: 400 });
    }
    if (userStatusBlocked(supervisor)) {
      return Response.json({ error: 'The selected supervisor is not active', code: 'forbidden_user' }, { status: 400 });
    }
    changes.primary_supervisor_id = supervisor.id;
    changes.primary_supervisor_name = userName(supervisor);
  }
  // Additional recipients — same customer, ACTIVE only.
  if (body.additional_notification_user_ids !== undefined) {
    const addIds = [...new Set((body.additional_notification_user_ids || []).map(String).filter(Boolean))];
    if (addIds.length) {
      const addRows = await svc.entities.User.filter({ id: { $in: addIds } }).catch(() => []);
      const byId = new Map((addRows || []).map((u) => [u.id, u]));
      for (const id of addIds) {
        const u = byId.get(id);
        if (!u || u.customer_id !== customerId) {
          return Response.json({ error: 'An additional notification recipient does not belong to your customer', code: 'forbidden_user' }, { status: 400 });
        }
        if (userStatusBlocked(u)) {
          return Response.json({ error: 'An additional notification recipient is not active', code: 'forbidden_user' }, { status: 400 });
        }
      }
    }
    changes.additional_notification_user_ids = addIds;
    changes.additional_notification_names = addIds.length
      ? (await svc.entities.User.filter({ id: { $in: addIds } }).catch(() => [])).map((u) => userName(u))
      : [];
  }

  if (!Object.keys(changes).length) return Response.json({ success: true, batch, unchanged: true });
  const updated = await svc.entities.TaskBatch.update(batch.id, changes);

  if (batch.is_series) {
    // Deliverable fields (supervisor / recipients) propagate to ALL pending
    // occurrences — they are delivery configuration, not history.
    const deliverable = {};
    for (const k of ['primary_supervisor_id', 'primary_supervisor_name', 'additional_notification_user_ids', 'additional_notification_names']) {
      if (changes[k] !== undefined) deliverable[k] = changes[k];
    }
    if (Object.keys(deliverable).length) {
      await svc.entities.TaskBatch.updateMany(
        { parent_batch_id: batch.id, status: { $in: ['active', 'reason_pending'] } },
        { $set: deliverable }).catch(() => {});
    }
    // Structural fields propagate ONLY to occurrences whose execution has NOT
    // started — already-started/completed occurrences are never rewritten.
    const struct = {};
    for (const k of ['title', 'description', 'active_start_time', 'deadline_time', 'task_definitions']) {
      if (changes[k] !== undefined) struct[k] = changes[k];
    }
    if (Object.keys(struct).length) {
      const pending = await svc.entities.TaskBatch.filter(
        { parent_batch_id: batch.id, status: { $in: ['active', 'reason_pending'] } }, '-scheduled_date', 100).catch(() => []);
      for (const occ of (pending || [])) {
        const occTasks = await svc.entities.OperationalTask.filter({ task_batch_id: occ.id }).catch(() => []);
        const occStarted = (occTasks || []).some((t) => !t.archived && (t.completed_at || t.completion_signature ||
          ['in_progress', 'awaiting_verification', 'reopened', 'overdue', 'completed'].indexOf(t.status) !== -1));
        if (occStarted) continue;
        await svc.entities.TaskBatch.update(occ.id, struct).catch(() => {});
        const taskUpd = {};
        if (changes.title !== undefined) taskUpd.title = changes.title;
        if (changes.description !== undefined) taskUpd.description = changes.description;
        if (Object.keys(taskUpd).length) {
          const unstarted = (occTasks || []).filter((t) => !t.archived && !t.completed_at &&
            UNSTARTED_TASK_STATUSES.indexOf(t.status) !== -1);
          for (const t of unstarted) {
            await svc.entities.OperationalTask.update(t.id, taskUpd).catch(() => {});
          }
        }
      }
    }
  }

  const auditParts = Object.keys(changes).map((k) => {
    const before = batch[k];
    if (['title', 'scheduled_date', 'active_start_time', 'deadline_time', 'recurrence_type', 'recurrence_end_date'].indexOf(k) !== -1 && before !== undefined && before !== null) {
      return k + ': ' + before + ' -> ' + changes[k];
    }
    return k;
  });
  await logTaskAudit(svc, { event_type: 'task.batch_updated', actor: caller, batch,
    notes: 'Fields: ' + auditParts.join(', ') + (structural.length ? ' (pre-execution edit — execution had not started)' : '') });
  return Response.json({ success: true, batch: updated });
}