/**
 * Task Scheduling — DATA LIFECYCLE module (shared by the scheduledTaskAccess
 * gateway only).
 *
 * Production lifecycle model — ordinary data management INSIDE the app, so
 * customers never need platform support to clean up their own data:
 *   DELETE      — permanent; only records with NO operational history.
 *                 Always revalidated SERVER-SIDE (the UI never has authority)
 *                 and always tombstoned in the audit log BEFORE the delete.
 *   CANCEL      — stop operational execution; records preserved.
 *   ARCHIVE     — hide from active queues/views; full history preserved,
 *                 restorable, viewable by authorised administrators.
 *   DEACTIVATE  — disable future use of a Control Room (history preserved).
 *
 * TENANT SECURITY: every action resolves the caller's tenant server-side via
 * the gateway context (customerId resolved from the User record, never from
 * the browser payload). Foreign ids fail closed with 403. Lifecycle actions
 * are restricted to Customer Administrators (canEdit) and Platform Admins —
 * Control Room Operators and Guards NEVER receive delete/archive privileges.
 */

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000; // Africa/Johannesburg, UTC+2, no DST
const ALL_OPEN_STATUSES = ['new', 'acknowledged', 'in_progress', 'awaiting',
  'queue', 'assigned', 'awaiting_verification', 'reopened', 'overdue'];
const TASK_DELETABLE_STATUSES = ['queue', 'assigned', 'new', 'acknowledged', 'awaiting', 'cancelled'];
const ROOM_STATUSES = ['active', 'inactive', 'archived'];
const TEST_RE = /\[TEST\]/i;

function userName(u) {
  return (u && (u.display_name || u.full_name || u.email)) || '—';
}

/** A task with ANY of this is operational history — it must be archived, never deleted. */
export function taskHasOperationalHistory(t) {
  return !!(t && (t.completed_at || t.completed_by || t.verified || t.verified_by || t.final_completed_at
    || t.completion_evidence_url || t.completion_signature || t.verification_signature
    || t.non_completion_reason
    || ['in_progress', 'awaiting_verification', 'reopened', 'completed', 'overdue'].indexOf(t.status) !== -1));
}

/** SERVER-SIDE delete eligibility — the single authority; the UI only mirrors it. */
export async function taskDeletable(svc, task) {
  if (!task) return false;
  if (taskHasOperationalHistory(task)) return false;
  if (TASK_DELETABLE_STATUSES.indexOf(task.status) === -1) return false;
  if (task.task_batch_id) {
    const rows = await svc.entities.TaskBatch.filter({ id: task.task_batch_id }).catch(() => []);
    const batch = (rows && rows[0]) || null;
    // A delivered Task Completion Report references this task — never delete.
    if (batch && batch.report_generated_at) return false;
  }
  return true;
}

/**
 * Lifecycle audit entry — actor, role, customer, record type/id/name, previous
 * status, action, SAST timestamp, optional reason. For permanent deletions
 * this is written BEFORE the delete as an audit TOMBSTONE with enough
 * metadata to prove what was removed and by whom (no retained content).
 */
async function logLifecycleAudit(svc, { event_type, actor, customerId, resellerId, entityName,
  entityId, entityLabel, from_status, to_action, reason, meta }) {
  const sastStamp = new Date(Date.now() + SAST_OFFSET_MS).toISOString().replace('Z', '+02:00') + ' SAST';
  try {
    await svc.entities.PlatformAuditLog.create({
      event_type,
      user_id: (actor && actor.id) || 'system',
      user_name: userName(actor) === '—' ? 'System' : userName(actor),
      customer_id: customerId || null,
      reseller_id: resellerId || null,
      module_key: 'TASK_SCHEDULING',
      entity_name: entityName,
      entity_id: entityId || null,
      action: (from_status || '') + ' -> ' + (to_action || ''),
      old_values: JSON.stringify(Object.assign({ status: from_status || null }, meta || {})),
      new_values: JSON.stringify({ action: to_action, sast_timestamp: sastStamp, reason: reason || null }),
      notes: (entityLabel || entityName) + ' — ' + (to_action || '') + ' by '
        + ((actor && (actor.role_type || actor.role)) || 'platform')
        + (reason ? ' — reason: ' + reason : '') + ' — ' + sastStamp,
    });
  } catch (e) {
    console.error('lifecycle audit failed:', (e && e.message) || e);
  }
}

/**
 * Handles the lifecycle actions of the scheduledTaskAccess gateway.
 * Returns a Response for a handled action, or null when the action is not a
 * lifecycle action (the gateway then continues/Unknown-action).
 */
export async function handleTaskLifecycle(svc, ctx) {
  const { caller, platformAdmin, customerId, canEdit, body, findTask, findBatch, assertScope, logTaskAudit } = ctx;
  const callerName = userName(caller);
  const action = String(body.action || '');

  const forbidden = (msg) => Response.json({ error: msg, code: 'forbidden_action' }, { status: 403 });
  const batchScope = (batch) => (!platformAdmin && batch.customer_id !== customerId)
    ? Response.json({ error: 'That task list does not belong to your customer', code: 'forbidden_batch' }, { status: 403 })
    : null;
  const roomScope = (room) => (!platformAdmin && room.customer_id !== customerId)
    ? Response.json({ error: 'That control room does not belong to your customer', code: 'forbidden_room' }, { status: 403 })
    : null;

  /* ── TASK DELETE — permanent, server-revalidated, tombstoned ───────────── */
  if (action === 'deleteTask') {
    if (!canEdit) return forbidden('Your role cannot delete tasks');
    const task = await findTask(body.id);
    const scopeErr = assertScope(task);
    if (scopeErr) return scopeErr;
    if (!(await taskDeletable(svc, task))) {
      return Response.json({ error: 'This task has operational history (sign-offs, evidence, a non-completion reason or a delivered report) and cannot be permanently deleted. Archive it instead.', code: 'not_deletable' }, { status: 400 });
    }
    await logLifecycleAudit(svc, { event_type: 'task.deleted', actor: caller,
      customerId: task.customer_id, resellerId: task.reseller_id,
      entityName: 'OperationalTask', entityId: task.id, entityLabel: task.title,
      from_status: task.status, to_action: 'deleted', reason: body.reason || null,
      meta: { title: task.title, scheduled_date: task.scheduled_date,
        control_room: task.control_room_name, task_list: task.task_batch_title } });
    await svc.entities.OperationalTask.delete(task.id);
    return Response.json({ success: true, deleted: true });
  }

  /* ── TASK ARCHIVE / RESTORE — history preserved ────────────────────────── */
  if (action === 'archiveTask' || action === 'restoreTask') {
    if (!canEdit) return forbidden('Your role cannot archive or restore tasks');
    const task = await findTask(body.id);
    const scopeErr = assertScope(task);
    if (scopeErr) return scopeErr;
    const archiving = action === 'archiveTask';
    if (archiving === !!task.archived) return Response.json({ success: true, task, unchanged: true });
    const nowIso = new Date().toISOString();
    const updated = await svc.entities.OperationalTask.update(task.id, archiving
      ? { archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName }
      : { archived: false, archived_at: null, archived_by: null, archived_by_name: null });
    await logLifecycleAudit(svc, { event_type: archiving ? 'task.archived' : 'task.restored', actor: caller,
      customerId: task.customer_id, resellerId: task.reseller_id,
      entityName: 'OperationalTask', entityId: task.id, entityLabel: task.title,
      from_status: task.status, to_action: archiving ? 'archived' : 'restored', reason: body.reason || null });
    return Response.json({ success: true, task: updated });
  }

  /* ── BULK TASK ACTIONS — bulk archive / bulk cancel (no bulk delete) ───── */
  if (action === 'bulkTaskAction') {
    if (!canEdit) return forbidden('Your role cannot perform bulk task actions');
    const mode = body.mode === 'cancel' ? 'cancel' : 'archive';
    const ids = Array.isArray(body.ids) ? [...new Set((body.ids || []).map(String))] : [];
    if (!ids.length) return Response.json({ error: 'Select at least one task' }, { status: 400 });
    const rows = await svc.entities.OperationalTask.filter({ id: { $in: ids } }).catch(() => []);
    // Tenant isolation: a single out-of-scope id fails the whole request.
    for (const t of (rows || [])) {
      if (!platformAdmin && t.customer_id !== customerId) {
        return Response.json({ error: 'A selected task does not belong to your customer', code: 'forbidden_task' }, { status: 403 });
      }
    }
    const nowIso = new Date().toISOString();
    const counts = { affected: 0, skipped: 0 };
    for (const t of (rows || [])) {
      if (mode === 'archive') {
        if (t.archived) { counts.skipped++; continue; }
        await svc.entities.OperationalTask.update(t.id, {
          archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName });
        counts.affected++;
      } else {
        if (t.archived || t.status === 'completed' || t.status === 'cancelled') { counts.skipped++; continue; }
        await svc.entities.OperationalTask.update(t.id, { status: 'cancelled' });
        await logTaskAudit(svc, { event_type: 'task.cancelled', actor: caller, task: t,
          from_status: t.status, to_status: 'cancelled', notes: 'Bulk cancel by ' + callerName });
        counts.affected++;
      }
    }
    await logLifecycleAudit(svc, { event_type: mode === 'archive' ? 'task.bulk_archived' : 'task.bulk_cancelled',
      actor: caller, customerId, resellerId: caller.reseller_id || null,
      entityName: 'OperationalTask', entityLabel: counts.affected + ' task(s)', from_status: null,
      to_action: mode === 'archive' ? 'bulk archived' : 'bulk cancelled',
      meta: { requested: ids.length, affected: counts.affected, skipped: counts.skipped } });
    return Response.json({ success: true, requested: ids.length, ...counts });
  }

  /* ── BATCH / SERIES CANCEL — stop execution, preserve history ──────────── */
  if (action === 'cancelBatch') {
    if (!canEdit) return forbidden('Your role cannot cancel task lists');
    const batch = await findBatch(body.id);
    if (!batch) return Response.json({ error: 'Task list not found' }, { status: 404 });
    const scopeErr = batchScope(batch);
    if (scopeErr) return scopeErr;
    const { sastTodayYmd } = await import('./taskNotifications.ts');
    const today = sastTodayYmd();
    const cancelTasksOf = async (batchId) => {
      await svc.entities.OperationalTask.updateMany(
        { task_batch_id: batchId, status: { $in: ALL_OPEN_STATUSES } },
        { $set: { status: 'cancelled' } }).catch(() => {});
    };
    const cancelOne = async (b) => {
      if (b.status !== 'active' && b.status !== 'reason_pending') return false;
      await cancelTasksOf(b.id);
      await svc.entities.TaskBatch.update(b.id, { status: 'cancelled' });
      return true;
    };
    if (batch.is_series) {
      // SERIES CANCEL SCOPE (production requirement):
      //   A) scope 'future'   — stop future occurrences ONLY; today's run keeps
      //      operating and history is untouched.
      //   B) scope 'all'      — cancel current + future open occurrences.
      //   C) archive_history  — after cancelling, archive completed/history
      //      occurrences (never deleted) so the active view is clean.
      // The series record itself is ALWAYS cancelled — this permanently stops
      // future generation (the sweep only generates for status 'active' series)
      // and future reminders/notifications for the cancelled work.
      const scope = body.scope === 'future' ? 'future' : 'all';
      const occs = await svc.entities.TaskBatch.filter({ parent_batch_id: batch.id }).catch(() => []);
      let cancelledOccs = 0;
      for (const occ of (occs || [])) {
        if (occ.archived) continue;
        if (scope === 'future' ? occ.scheduled_date > today : true) {
          if (await cancelOne(occ)) cancelledOccs++;
        }
      }
      await svc.entities.TaskBatch.update(batch.id, { status: 'cancelled' });
      if (body.archive_history) {
        const nowIso = new Date().toISOString();
        for (const occ of (occs || [])) {
          if (occ.archived || (occ.status !== 'reported' && occ.status !== 'cancelled')) continue;
          const occTasks = await svc.entities.OperationalTask.filter({ task_batch_id: occ.id }).catch(() => []);
          const upd = (occTasks || []).filter((t) => !t.archived).map((t) => ({
            id: t.id, archived: true, archived_at: nowIso,
            archived_by: caller.id, archived_by_name: callerName,
          }));
          if (upd.length) await svc.entities.OperationalTask.bulkUpdate(upd).catch(() => {});
          await svc.entities.TaskBatch.update(occ.id, {
            archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName,
          }).catch(() => {});
        }
      }
      await logTaskAudit(svc, { event_type: 'task.batch_cancelled', actor: caller, batch,
        notes: batch.title + ' (series, ' + (scope === 'future' ? 'future occurrences only' : 'all occurrences')
          + (body.archive_history ? ' + history archived' : '') + ') — ' + cancelledOccs + ' occurrence(s) cancelled' });
      await logLifecycleAudit(svc, { event_type: 'task.batch_cancelled', actor: caller,
        customerId: batch.customer_id, resellerId: batch.reseller_id, entityName: 'TaskBatch',
        entityId: batch.id, entityLabel: batch.title, from_status: batch.status,
        to_action: 'cancelled (series, ' + scope + ')', reason: body.reason || null,
        meta: { occurrences_cancelled: cancelledOccs } });
      return Response.json({ success: true, occurrences_cancelled: cancelledOccs });
    }
    const cancelled = await cancelOne(batch);
    await logTaskAudit(svc, { event_type: 'task.batch_cancelled', actor: caller, batch,
      notes: batch.title + (cancelled ? '' : ' (already stopped)') });
    await logLifecycleAudit(svc, { event_type: 'task.batch_cancelled', actor: caller,
      customerId: batch.customer_id, resellerId: batch.reseller_id, entityName: 'TaskBatch',
      entityId: batch.id, entityLabel: batch.title, from_status: batch.status,
      to_action: 'cancelled', reason: body.reason || null });
    return Response.json({ success: true });
  }

  /* ── BATCH ARCHIVE / RESTORE (series: occurrences + tasks follow) ─────── */
  if (action === 'archiveBatch' || action === 'restoreBatch') {
    if (!canEdit) return forbidden('Your role cannot archive or restore task lists');
    const batch = await findBatch(body.id);
    if (!batch) return Response.json({ error: 'Task list not found' }, { status: 404 });
    const scopeErr = batchScope(batch);
    if (scopeErr) return scopeErr;
    const archiving = action === 'archiveBatch';
    const nowIso = new Date().toISOString();
    let members = [batch];
    if (batch.is_series) {
      members = members.concat((await svc.entities.TaskBatch.filter({ parent_batch_id: batch.id }).catch(() => [])) || []);
    }
    for (const b of members) {
      if (!!b.archived === archiving) continue;
      await svc.entities.TaskBatch.update(b.id, archiving
        ? { archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName }
        : { archived: false, archived_at: null, archived_by: null, archived_by_name: null });
      const bt = await svc.entities.OperationalTask.filter({ task_batch_id: b.id }).catch(() => []);
      const upd = (bt || []).filter((t) => !!t.archived !== archiving).map((t) => ({
        id: t.id,
        ...(archiving
          ? { archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName }
          : { archived: false, archived_at: null, archived_by: null, archived_by_name: null }),
      }));
      if (upd.length) await svc.entities.OperationalTask.bulkUpdate(upd).catch(() => {});
    }
    await logLifecycleAudit(svc, { event_type: archiving ? 'task.batch_archived' : 'task.batch_restored',
      actor: caller, customerId: batch.customer_id, resellerId: batch.reseller_id,
      entityName: 'TaskBatch', entityId: batch.id, entityLabel: batch.title,
      from_status: batch.status, to_action: archiving ? 'archived' : 'restored',
      reason: body.reason || null, meta: { members: members.length } });
    return Response.json({ success: true, members: members.length });
  }

  /* ── BATCH DELETE — only when NO operational history anywhere ──────────── */
  if (action === 'deleteBatch') {
    if (!canEdit) return forbidden('Your role cannot delete task lists');
    const batch = await findBatch(body.id);
    if (!batch) return Response.json({ error: 'Task list not found' }, { status: 404 });
    const scopeErr = batchScope(batch);
    if (scopeErr) return scopeErr;
    let members = [batch];
    if (batch.is_series) {
      members = members.concat((await svc.entities.TaskBatch.filter({ parent_batch_id: batch.id }).catch(() => [])) || []);
    }
    for (const b of members) {
      if (b.report_generated_at) {
        return Response.json({ error: 'A completion report has been delivered for this task list — archive it instead of deleting', code: 'not_deletable' }, { status: 400 });
      }
    }
    const memberIds = members.map((b) => b.id);
    const allTasks = await svc.entities.OperationalTask.filter({ task_batch_id: { $in: memberIds } }).catch(() => []);
    for (const t of (allTasks || [])) {
      if (!(await taskDeletable(svc, t))) {
        return Response.json({ error: 'This task list contains task(s) with operational history (sign-offs, evidence or reasons) — archive it instead of deleting', code: 'not_deletable' }, { status: 400 });
      }
    }
    // Audit TOMBSTONES before the destructive deletes.
    for (const t of (allTasks || [])) {
      await logLifecycleAudit(svc, { event_type: 'task.deleted', actor: caller,
        customerId: t.customer_id, resellerId: t.reseller_id, entityName: 'OperationalTask',
        entityId: t.id, entityLabel: t.title, from_status: t.status, to_action: 'deleted',
        reason: body.reason || null, meta: { title: t.title, task_list: batch.title, control_room: t.control_room_name } });
    }
    for (const b of members) {
      await logLifecycleAudit(svc, { event_type: 'task.batch_deleted', actor: caller,
        customerId: b.customer_id, resellerId: b.reseller_id, entityName: 'TaskBatch',
        entityId: b.id, entityLabel: b.title, from_status: b.status, to_action: 'deleted',
        reason: body.reason || null, meta: { title: b.title, scheduled_date: b.scheduled_date,
          control_room: b.control_room_name, series: !!b.is_series } });
    }
    if ((allTasks || []).length) {
      await svc.entities.OperationalTask.deleteMany({ task_batch_id: { $in: memberIds } }).catch(() => {});
    }
    for (const b of members) await svc.entities.TaskBatch.delete(b.id);
    return Response.json({ success: true, deleted_batches: members.length, deleted_tasks: (allTasks || []).length });
  }

  /* ── CONTROL ROOM STATUS — deactivate / reactivate / archive ───────────── */
  if (action === 'controlRoomStatus') {
    if (!canEdit) return forbidden('Your role cannot manage control rooms');
    const rows = await svc.entities.ControlRoom.filter({ id: String(body.id || '') }).catch(() => []);
    const room = (rows && rows[0]) || null;
    if (!room) return Response.json({ error: 'Control room not found' }, { status: 404 });
    const scopeErr = roomScope(room);
    if (scopeErr) return scopeErr;
    const status = ROOM_STATUSES.indexOf(body.status) !== -1 ? body.status : null;
    if (!status) return Response.json({ error: 'A valid status is required (active, inactive or archived)' }, { status: 400 });
    if (status === room.status) return Response.json({ success: true, room, unchanged: true });
    await svc.entities.ControlRoom.update(room.id, { status });
    const event = status === 'active' ? 'task.control_room_reactivated'
      : status === 'inactive' ? 'task.control_room_deactivated' : 'task.control_room_archived';
    await logLifecycleAudit(svc, { event_type: event, actor: caller, customerId: room.customer_id,
      resellerId: room.reseller_id, entityName: 'ControlRoom', entityId: room.id,
      entityLabel: room.name, from_status: room.status, to_action: status, reason: body.reason || null,
      meta: { name: room.name } });
    return Response.json({ success: true });
  }

  /* ── CONTROL ROOM DELETE — only with NO task/batch history at all ─────── */
  if (action === 'controlRoomDelete') {
    if (!canEdit) return forbidden('Your role cannot manage control rooms');
    const rows = await svc.entities.ControlRoom.filter({ id: String(body.id || '') }).catch(() => []);
    const room = (rows && rows[0]) || null;
    if (!room) return Response.json({ error: 'Control room not found' }, { status: 404 });
    const scopeErr = roomScope(room);
    if (scopeErr) return scopeErr;
    // Production lifecycle rule: a room referenced by ANY task or task list
    // (any status) is part of operational/report history — it must be
    // deactivated or archived, never destructively deleted. Historical
    // records keep their original control room name snapshots.
    const histTasks = await svc.entities.OperationalTask.filter({ control_room_id: room.id }, '-created_date', 1).catch(() => []);
    if ((histTasks || []).length) {
      return Response.json({ error: 'This control room has task or report history — deactivate or archive it instead of deleting', code: 'room_has_history' }, { status: 400 });
    }
    const histBatches = await svc.entities.TaskBatch.filter({ control_room_id: room.id }, '-created_date', 1).catch(() => []);
    if ((histBatches || []).length) {
      return Response.json({ error: 'This control room is referenced by task list history — deactivate or archive it instead of deleting', code: 'room_has_history' }, { status: 400 });
    }
    await logLifecycleAudit(svc, { event_type: 'task.control_room_deleted', actor: caller,
      customerId: room.customer_id, resellerId: room.reseller_id, entityName: 'ControlRoom',
      entityId: room.id, entityLabel: room.name, from_status: room.status, to_action: 'deleted',
      reason: body.reason || null, meta: { name: room.name } });
    await svc.entities.ControlRoom.delete(room.id);
    return Response.json({ success: true, deleted: true });
  }

  /* ── PLATFORM ADMIN — TEST DATA CLEANUP (scan / clean) ────────────────────
     NOT a general unrestricted delete tool. It identifies CLEARLY FLAGGED
     records ([TEST] batches and [TEST] standalone tasks) within ONE
     explicitly-selected customer, shows what is safe to delete versus what
     must be archived, and cleans them through the SAME lifecycle eligibility
     rules — delete only history-free records (tombstoned), archive the rest.
     Never affects another tenant: every query is customer_id-scoped. */
  if (action === 'testDataCustomers' || action === 'testDataScan' || action === 'testDataCleanup') {
    if (!platformAdmin) return forbidden('Only a Platform Administrator can use the test data cleanup tool');
    if (action === 'testDataCustomers') {
      const rows = await svc.entities.Customer.filter({}, 'name', 300).catch(() => []);
      return Response.json({ customers: (rows || []).map((c) => ({
        id: c.id, name: c.name, customer_type: c.customer_type || null, status: c.status || null,
      })) });
    }
    const custId = String(body.customer_id || '');
    if (!custId) return Response.json({ error: 'Select the customer to scan' }, { status: 400 });
    const custRows = await svc.entities.Customer.filter({ id: custId }).catch(() => []);
    const customer = (custRows && custRows[0]) || null;
    if (!customer) return Response.json({ error: 'Customer not found' }, { status: 404 });

    const batches = (await svc.entities.TaskBatch.filter({ customer_id: custId }, '-scheduled_date', 500).catch(() => [])) || [];
    const tasks = (await svc.entities.OperationalTask.filter({ customer_id: custId }, '-scheduled_date', 500).catch(() => [])) || [];
    const rooms = (await svc.entities.ControlRoom.filter({ customer_id: custId }, 'name', 200).catch(() => [])) || [];
    const tasksByBatch = {};
    for (const t of tasks) (tasksByBatch[t.task_batch_id] = tasksByBatch[t.task_batch_id] || []).push(t);
    const batchById = new Map(batches.map((b) => [b.id, b]));

    // Clearly-flagged records: [TEST] batches (series AND their occurrences —
    // occurrences inherit the series title) plus [TEST] standalone tasks.
    const flagged = [];
    const flaggedBatchIds = new Set();
    for (const b of batches) {
      if (!TEST_RE.test(b.title || '')) continue;
      flaggedBatchIds.add(b.id);
      const bt = tasksByBatch[b.id] || [];
      let deletable = !b.report_generated_at;
      for (const t of bt) { if (!(await taskDeletable(svc, t))) { deletable = false; break; } }
      flagged.push({ type: 'batch', id: b.id, title: b.title, status: b.status, archived: !!b.archived,
        is_series: !!b.is_series, scheduled_date: b.scheduled_date,
        control_room_name: b.control_room_name || null, task_count: bt.length,
        safe_to_delete: deletable && !b.is_series,
        reason: b.is_series ? 'Recurring series — its occurrences are listed individually; the series record will be archived'
          : deletable ? 'No sign-offs, evidence, reasons or delivered reports — safe to delete'
          : 'Has operational history — will be archived, not deleted' });
    }
    const tasksById = new Map(tasks.map((t) => [t.id, t]));
    for (const t of tasks) {
      if (!TEST_RE.test(t.title || '') || flaggedBatchIds.has(t.task_batch_id)) continue;
      const deletable = await taskDeletable(svc, t);
      flagged.push({ type: 'task', id: t.id, title: t.title, status: t.status, archived: !!t.archived,
        scheduled_date: t.scheduled_date, control_room_name: t.control_room_name || null, task_count: 1,
        safe_to_delete: deletable,
        reason: deletable ? 'No sign-offs, evidence, reasons or delivered reports — safe to delete'
          : 'Has operational history — will be archived, not deleted' });
    }

    if (action === 'testDataScan') {
      return Response.json({
        customer: { id: customer.id, name: customer.name },
        counts: {
          batches: batches.length, tasks: tasks.length,
          control_rooms: rooms.length,
          control_rooms_active: rooms.filter((r) => r.status === 'active').length,
          flagged: flagged.length,
          safe_to_delete: flagged.filter((f) => f.safe_to_delete).length,
          to_archive: flagged.filter((f) => !f.safe_to_delete).length,
        },
        flagged,
      });
    }

    // testDataCleanup — explicit confirmation required; same lifecycle rules.
    if (body.confirm !== true) {
      return Response.json({ error: 'Explicit confirmation is required before cleanup' }, { status: 400 });
    }
    const onlyIds = Array.isArray(body.ids) ? new Set((body.ids || []).map(String)) : null;
    const results = { deleted_batches: 0, deleted_tasks: 0, archived_batches: 0, archived_tasks: 0, skipped: 0 };
    const nowIso = new Date().toISOString();
    for (const f of flagged) {
      if (onlyIds && !onlyIds.has(f.id)) continue;
      if (f.type === 'task') {
        const t = tasksById.get(f.id);
        if (!t) { results.skipped++; continue; }
        if (f.safe_to_delete) {
          await logLifecycleAudit(svc, { event_type: 'task.deleted', actor: caller,
            customerId: t.customer_id, resellerId: t.reseller_id, entityName: 'OperationalTask',
            entityId: t.id, entityLabel: t.title, from_status: t.status, to_action: 'deleted',
            reason: 'Test data cleanup', meta: { title: t.title, control_room: t.control_room_name } });
          await svc.entities.OperationalTask.delete(t.id);
          results.deleted_tasks++;
        } else if (!t.archived) {
          await svc.entities.OperationalTask.update(t.id, {
            archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName });
          results.archived_tasks++;
        } else { results.skipped++; }
      } else {
        const b = batchById.get(f.id);
        if (!b) { results.skipped++; continue; }
        if (f.safe_to_delete) {
          const memberIds = [b.id];
          const btasks = tasksByBatch[b.id] || [];
          for (const t of btasks) {
            await logLifecycleAudit(svc, { event_type: 'task.deleted', actor: caller,
              customerId: t.customer_id, resellerId: t.reseller_id, entityName: 'OperationalTask',
              entityId: t.id, entityLabel: t.title, from_status: t.status, to_action: 'deleted',
              reason: 'Test data cleanup', meta: { title: t.title, task_list: b.title } });
          }
          if (btasks.length) {
            await svc.entities.OperationalTask.deleteMany({ task_batch_id: { $in: memberIds } }).catch(() => {});
          }
          await logLifecycleAudit(svc, { event_type: 'task.batch_deleted', actor: caller,
            customerId: b.customer_id, resellerId: b.reseller_id, entityName: 'TaskBatch',
            entityId: b.id, entityLabel: b.title, from_status: b.status, to_action: 'deleted',
            reason: 'Test data cleanup', meta: { title: b.title, scheduled_date: b.scheduled_date } });
          await svc.entities.TaskBatch.delete(b.id);
          results.deleted_batches++;
          results.deleted_tasks += btasks.length;
        } else if (!b.archived) {
          await svc.entities.TaskBatch.update(b.id, {
            archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName });
          const btasks = tasksByBatch[b.id] || [];
          const upd = btasks.filter((t) => !t.archived).map((t) => ({
            id: t.id, archived: true, archived_at: nowIso, archived_by: caller.id, archived_by_name: callerName,
          }));
          if (upd.length) await svc.entities.OperationalTask.bulkUpdate(upd).catch(() => {});
          results.archived_batches++;
          results.archived_tasks += upd.length;
        } else { results.skipped++; }
      }
    }
    await logLifecycleAudit(svc, { event_type: 'task.test_data_cleanup', actor: caller,
      customerId: customer.id, resellerId: customer.reseller_id || null, entityName: 'TaskBatch',
      entityLabel: customer.name + ' test data', from_status: null, to_action: 'cleaned',
      meta: results });
    return Response.json({ success: true, flagged: flagged.length, ...results });
  }

  return null;
}