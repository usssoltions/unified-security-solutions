/**
 * obAccess — the sole tenant-access gateway for the DIGITAL OCCURRENCE BOOK
 * (OB) extension of the TASK & OB SCHEDULING module (OBSchedule + OBOccurrence).
 *
 * ISOLATION FROM ORDINARY TASKS: the proven ordinary-task pipeline
 * (scheduledTaskAccess, taskSweep, taskLifecycle) is NOT modified by this
 * gateway. OB checks/entries live in their own entities with their own
 * server-side authorisation — no ordinary-task sign-off side effects, no
 * shared state.
 *
 * SECURITY (mirrors scheduledTaskAccess):
 *   - the caller's tenant is resolved SERVER-SIDE from the User record;
 *   - customer/control-room/site/assignee ids from the browser are validated,
 *     never trusted (cross-tenant fails closed 403/400);
 *   - Control Room Operators are restricted to rooms listing them in
 *     operator_user_ids (least privilege, same as the task queue);
 *   - attribution-bearing actions (entry_submit, entry_amend, entry_cancel)
 *     are HARD-BLOCKED under platform-oversight impersonation — a signature/
 *     entry can only be created by the authenticated user personally;
 *   - the Digital OB customer setting is enforced SERVER-SIDE: when OFF, all
 *     OB write actions are rejected (ob_disabled) and automation never runs;
 *     platform administrators retain read oversight of historical records.
 *
 * Actions:
 *   bootstrap          — OB on/off + role flags + rooms/sites/operators +
 *                        schedules + outstanding queue (+ bounded generation).
 *   schedule_save      — create/edit an OB check schedule (admins).
 *   schedule_status    — pause / resume / cancel a schedule (admins).
 *   entry_submit       — record a scheduled OB check (atomic completion) or
 *                        capture an unscheduled OB entry.
 *   entry_cancel       — explicitly cancel an outstanding check with reason.
 *   entry_amend        — append a dated correction (original retained).
 *   entry_get          — full entry incl. amendments + signed attachment URLs.
 *   register_list      — filtered/paginated register.
 *   report             — period summary + detailed register (exports use the
 *                        same action, same permissions).
 *   sweep              — scheduled automation (no session; counts only).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import {
  sastTodayYmd, resolveTaskBrandContext, logTaskAudit,
} from '../../shared/taskNotifications.ts';
import {
  runObSweep, ensureOccurrences, generateObReference, dedupePending,
  cancelPendingForSchedule, computeSlots, OB_OUTCOMES, addDaysYmd, logObAudit,
} from '../../shared/obCore.ts';
import { customerModuleLicensed } from '../../shared/entitlementActive.ts';

const TASK_MODULE_KEYS = ['TASK_SCHEDULING', 'OPERATIONS', 'COMPLETE_SECURITY'];
const EDIT_ROLES = ['customer_admin', 'admin', 'dispatcher'];
const OPERATOR_ROLE = 'control_room_operator';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ATTRIBUTION_ACTIONS = ['entry_submit', 'entry_amend', 'entry_cancel'];

function isPlatformAdmin(u) {
  return !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
}
function isResellerAdmin(u) {
  return !!u && !isPlatformAdmin(u) && (u.role_type === 'reseller_admin' || u.admin_level === 'reseller');
}
function userName(u) {
  return (u && (u.display_name || u.full_name || u.email)) || '—';
}
function bad(message, status = 400, code) {
  return Response.json(code ? { error: message, code } : { error: message }, { status });
}

/* ── Server-side validation helpers ─────────────────────────────────────── */

async function findSite(svc, customerId, siteId) {
  if (!siteId) return null;
  const rows = await svc.entities.Site.filter({ id: String(siteId) }).catch(() => []);
  const s = (rows || [])[0] || null;
  return s && s.customer_id === customerId ? s : null;
}
async function findSchedule(svc, id) {
  if (!id) return null;
  const rows = await svc.entities.OBSchedule.filter({ id: String(id) }).catch(() => []);
  return (rows || [])[0] || null;
}
async function findOcc(svc, id) {
  if (!id) return null;
  const rows = await svc.entities.OBOccurrence.filter({ id: String(id) }).catch(() => []);
  return (rows || [])[0] || null;
}
function normalizeAttachments(input) {
  return (Array.isArray(input) ? input : [])
    .filter((a) => a && typeof a.file_uri === 'string' && a.file_uri.length < 500)
    .slice(0, 5)
    .map((a) => ({ name: String(a.name || 'evidence').slice(0, 120), file_uri: a.file_uri, uploaded_at: new Date().toISOString() }));
}

/* ── Main handler ───────────────────────────────────────────────────────── */

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({})) || {};
    const action = String(body.action || 'bootstrap');

    let caller = null;
    try { caller = await base44.auth.me(); } catch (_) {}
    if (!caller && action !== 'sweep') return bad('Unauthorized', 401);
    const svc = base44.asServiceRole;

    if (action === 'sweep') {
      return Response.json(await runObSweep(svc, secrets));
    }

    /* Platform oversight (audited) — identical to scheduledTaskAccess. */
    if (caller && isPlatformAdmin(caller) && body.as_user_id) {
      if (ATTRIBUTION_ACTIONS.indexOf(action) !== -1) {
        return bad('An OB entry can only be recorded by the authenticated user themselves. Administrative impersonation may never record, amend or cancel an OB entry.', 403, 'impersonation_forbidden');
      }
      const rows = await svc.entities.User.filter({ id: String(body.as_user_id) }).catch(() => []);
      const target = (rows || [])[0];
      if (!target) return bad('Impersonation target user not found', 400);
      caller = { ...target, role: target.role || target.role_type };
      await logObAudit(svc, { event_type: 'ob.impersonated', actor: caller, notes: 'Platform admin executing OB action as ' + userName(target) });
    }

    const platformAdmin = isPlatformAdmin(caller);
    const resellerAdmin = isResellerAdmin(caller);
    const roleType = caller.role_type;
    const customerId = platformAdmin ? (body.customer_id || null) : (caller.customer_id || null);
    const callerName = userName(caller);
    const isOperator = !platformAdmin && !resellerAdmin && roleType === OPERATOR_ROLE;
    const canEdit = platformAdmin || (EDIT_ROLES.indexOf(roleType) !== -1 && !!customerId);

    if (!platformAdmin && !resellerAdmin && !customerId) return bad('Your account is not assigned to a customer', 403, 'no_scope');
    if (!canEdit && !isOperator) return bad('Your role cannot access the Occurrence Book', 403, 'forbidden_role');

    /* Server-side gates: Task Scheduling module licence + Digital OB setting.
       Reads stay open to platform admins (history retention); every WRITE is
       rejected while OB is OFF. */
    const customerRec = customerId
      ? ((await svc.entities.Customer.filter({ id: customerId }).catch(() => []))[0] || null)
      : null;
    if (!platformAdmin && !resellerAdmin && customerId) {
      const licensed = await customerModuleLicensed(svc, customerId, TASK_MODULE_KEYS);
      if (!licensed) return bad('Task & OB Scheduling requires the Task Scheduling module for your customer', 403, 'module_not_enabled');
    }
    const obOn = !!(customerRec && customerRec.digital_ob_enabled === true);
    const WRITE_ACTIONS = ['schedule_save', 'schedule_status', 'entry_submit', 'entry_cancel', 'entry_amend'];
    if (!obOn && WRITE_ACTIONS.indexOf(action) !== -1) {
      return bad('The Digital Occurrence Book is not enabled for this customer.', 403, 'ob_disabled');
    }

    /* Rooms the caller may work: operators ONLY the rooms listing them. */
    const rooms = platformAdmin
      ? (await svc.entities.ControlRoom.filter({}, 'name', 200).catch(() => []))
      : resellerAdmin
        ? (await svc.entities.ControlRoom.filter({ reseller_id: caller.reseller_id }, 'name', 200).catch(() => []))
        : (await svc.entities.ControlRoom.filter({ customer_id: customerId }, 'name', 200).catch(() => []));
    const roomIds = (rooms || []).map((r) => r.id);
    const operatorRoomIds = (rooms || [])
      .filter((r) => (isOperator ? (r.operator_user_ids || []).indexOf(caller.id) !== -1 : true))
      .map((r) => r.id);
    const roomById = {};
    for (const r of rooms || []) roomById[r.id] = r;
    const assertRoom = (roomId) => {
      if (!roomId || roomIds.indexOf(roomId) === -1) return bad('That control room does not belong to your organisation', 403, 'forbidden_room');
      if (isOperator && operatorRoomIds.indexOf(roomId) === -1) return bad('You are not authorised for that control room', 403, 'forbidden_room');
      return null;
    };

    /* ── bootstrap ─────────────────────────────────────────────────────── */
    if (action === 'bootstrap') {
      let schedules = [];
      let queue = [];
      let sites = [];
      let operators = [];
      if (customerId && obOn) {
        sites = (await svc.entities.Site.filter({ customer_id: customerId, status: 'active' }, 'name', 200).catch(() => [])) || [];
        const allUsers = (await svc.entities.User.filter({ customer_id: customerId }, 'full_name', 200).catch(() => [])) || [];
        operators = allUsers
          .filter((u) => ['control_room_operator', 'dispatcher', 'customer_admin', 'admin'].indexOf(u.role_type) !== -1)
          .filter((u) => !(u.status === 'suspended' || u.status === 'inactive'))
          .map((u) => ({ id: u.id, name: u.display_name || u.full_name || u.email, role_type: u.role_type }));
        let all = [];
        if (resellerAdmin) all = (await svc.entities.OBSchedule.filter({ reseller_id: caller.reseller_id }, '-created_date', 100).catch(() => [])) || [];
        else all = (await svc.entities.OBSchedule.filter({ customer_id: customerId }, '-created_date', 100).catch(() => [])) || [];
        schedules = (all || []).filter((s) => (isOperator ? operatorRoomIds.indexOf(s.control_room_id) !== -1 : true));
        // Bounded, idempotent generation so the queue is never stale between sweeps.
        for (const sch of (schedules || []).filter((s) => s.status === 'active')) {
          await ensureOccurrences(svc, sch, sastTodayYmd(), 2).catch(() => {});
        }
        const queueFilter = isOperator
          ? { status: 'pending', control_room_id: { $in: operatorRoomIds.length ? operatorRoomIds : ['none'] } }
          : { status: 'pending', control_room_id: { $in: roomIds.length ? roomIds : ['none'] } };
        queue = roomIds.length
          ? ((await svc.entities.OBOccurrence.filter(queueFilter, 'due_at', 200).catch(() => [])) || [])
          : [];
        if (isOperator && schedules.some((s) => s.assigned_operator_id && operatorRoomIds.indexOf(s.control_room_id) === -1)) { /* no-op guard */ }
      }
      return Response.json({
        ob_enabled: obOn,
        can_manage: canEdit,
        is_operator: isOperator,
        operator_room_ids: operatorRoomIds,
        schedules: (schedules || []).map((s) => {
          const slots = computeSlots(s, sastTodayYmd(), 1);
          return { ...s, next_slots: slots.slice(0, 4).map((x) => ({ slot_label: x.slot_label, due_at: x.due_at })) };
        }),
        queue: (queue || []).sort((a, b) => String(a.due_at || '').localeCompare(String(b.due_at || ''))),
        rooms: (rooms || []).map((r) => ({ id: r.id, name: r.name, customer_id: r.customer_id })),
        sites: (sites || []).map((s) => ({ id: s.id, name: s.name })),
        operators,
        links: await (async () => {
          if (!customerId) return { incidents_available: false, maintenance_available: false };
          const licensed = await customerModuleLicensed(svc, customerId, ['OPERATIONS', 'COMPLETE_SECURITY']).catch(() => false);
          return { incidents_available: !!licensed, maintenance_available: !!licensed };
        })(),
      });
    }

    /* ── schedule_save (create/edit) ───────────────────────────────────── */
    if (action === 'schedule_save') {
      if (!canEdit) return bad('Only a supervisor or administrator can manage OB schedules', 403, 'forbidden_action');
      const f = body.schedule || {};
      const scope = f.scope === 'site' ? 'site' : 'overall';
      const roomId = String(f.control_room_id || '');
      const roomErr = assertRoom(roomId);
      if (roomErr) return roomErr;
      const title = String(f.title || '').trim();
      if (!title) return bad('A check title is required');
      if (title.length > 200) return bad('The check title is too long');
      const instructions = String(f.instructions || '').slice(0, 4000);
      const cadence = f.cadence === 'times' ? 'times' : 'interval';
      const windowStart = String(f.window_start || '');
      const windowEnd = String(f.window_end || '');
      if (!TIME_RE.test(windowStart) || !TIME_RE.test(windowEnd)) return bad('The operating window must be two HH:MM times');
      const span = (() => { const ws = hhmm(windowStart), we = hhmm(windowEnd); let s = we - ws; if (s < 0) s += 1440; if (s === 0) s = 1440; return s; })();
      function hhmm(s) { const p = String(s).split(':'); return Number(p[0]) * 60 + Number(p[1]); }
      const inclusive = f.window_end_inclusive !== false;
      const start = String(f.start_date || '');
      if (!DATE_RE.test(start)) return bad('A start date (YYYY-MM-DD) is required');
      const end = f.end_date && DATE_RE.test(String(f.end_date)) ? String(f.end_date) : null;
      if (end && end < start) return bad('The end date cannot be before the start date');
      const activeDays = (Array.isArray(f.active_days) ? f.active_days : []).map(Number).filter((d) => d >= 0 && d <= 6);
      let every = null;
      let times = [];
      if (cadence === 'interval') {
        every = Math.max(1, Math.min(1440, Number(f.every_n_minutes) || 0));
        if (!every) return bad('An interval of at least 1 minute is required');
        if (span > 0 && every > span && span !== 1440) return bad('The interval is longer than the operating window');
      } else {
        times = (Array.isArray(f.specified_times) ? f.specified_times : []).filter((t) => TIME_RE.test(String(t)));
        if (!times.length) return bad('At least one specified time (HH:MM) is required');
        const ws = hhmm(windowStart);
        for (const t of times) {
          const rel = (hhmm(t) - ws + 1440) % 1440;
          if (!(rel < span || (inclusive && rel === span))) {
            return bad('Specified time ' + t + ' falls outside the operating window' + (inclusive ? '' : ' (window end is excluded)'));
          }
        }
        if (times.length > 24) return bad('A schedule supports at most 24 specified times per day');
      }
      const grace = Math.max(0, Math.min(720, Number(f.overdue_grace_minutes) || 15));
      const escDelay = Math.max(0, Math.min(1440, Number(f.escalation_delay_minutes) || 30));
      let siteId = null; let siteName = null;
      if (scope === 'site') {
        const site = await findSite(svc, customerId, String(f.site_id || ''));
        if (!site) return bad('A valid site of your organisation is required for a site-scope schedule', 403, 'forbidden_site');
        siteId = site.id; siteName = site.name;
      }
      let assignedId = null; let assignedName = null;
      if (f.assigned_operator_id) {
        const uRows = await svc.entities.User.filter({ id: String(f.assigned_operator_id) }).catch(() => []);
        const u = (uRows || [])[0];
        if (!u || u.customer_id !== customerId) return bad('The assigned operator does not belong to your organisation', 403, 'forbidden_operator');
        if ((roomById[roomId].operator_user_ids || []).indexOf(u.id) === -1 && ['dispatcher', 'customer_admin', 'admin'].indexOf(u.role_type) === -1) {
          return bad('The assigned operator is not authorised for that control room', 403, 'forbidden_operator');
        }
        if (u.status === 'suspended' || u.status === 'inactive') return bad('The assigned operator account is not active');
        assignedId = u.id; assignedName = userName(u);
      }
      const nowIso = new Date().toISOString();
      const fields = {
        title, instructions, category: String(f.category || '').slice(0, 80) || null,
        scope, site_id: siteId, site_name: siteName,
        control_room_id: roomId, control_room_name: (roomById[roomId] || {}).name || null,
        assigned_operator_id: assignedId, assigned_operator_name: assignedName,
        cadence, every_n_minutes: cadence === 'interval' ? every : null,
        specified_times: cadence === 'times' ? times : [],
        active_days: activeDays, start_date: start, end_date: end,
        window_start: windowStart, window_end: windowEnd, window_end_inclusive: inclusive,
        overdue_grace_minutes: grace, escalation_delay_minutes: escDelay,
        evidence_required: f.evidence_required === true,
      };
      if (body.id) {
        const existing = await findSchedule(svc, body.id);
        if (!existing || existing.customer_id !== customerId) return bad('Schedule not found in your organisation', 404, 'not_found');
        if (existing.status === 'cancelled') return bad('A cancelled schedule cannot be edited', 400, 'cancelled_schedule');
        // Preserve history: completed/cancelled occurrences stay; only future
        // PENDING occurrences are regenerated from the new definition.
        const futureNowIso = nowIso;
        await svc.entities.OBOccurrence.deleteMany(
          { schedule_id: existing.id, status: 'pending', due_at: { $gt: futureNowIso } }).catch(() => {});
        const history = (existing.change_history || []).concat([{
          timestamp: nowIso, actor_id: caller.id, actor_name: callerName, action: 'edited', notes: 'Schedule definition updated',
        }]);
        await svc.entities.OBSchedule.update(existing.id, { ...fields, status: 'active', change_history: history });
        const updated = await findSchedule(svc, existing.id);
        const gen = await ensureOccurrences(svc, updated, sastTodayYmd(), 2);
        await logObAudit(svc, { event_type: 'ob.schedule_edited', actor: caller, schedule: updated, notes: 'Future pending checks regenerated: ' + gen.created });
        return Response.json({ success: true, schedule: updated, generated: gen.created });
      }
      const created = await svc.entities.OBSchedule.create({
        ...fields,
        customer_id: customerId, reseller_id: customerRec ? (customerRec.reseller_id || null) : null,
        status: 'active',
        change_history: [{ timestamp: nowIso, actor_id: caller.id, actor_name: callerName, action: 'created', notes: 'OB schedule created' }],
        created_by_id: caller.id, created_by_name: callerName,
      });
      const sch = (await svc.entities.OBSchedule.filter({ id: created.id || created._id }).catch(() => []))[0] || created;
      const gen = await ensureOccurrences(svc, sch, sastTodayYmd(), 2);
      await logObAudit(svc, { event_type: 'ob.schedule_created', actor: caller, schedule: sch, notes: 'Initial checks generated: ' + gen.created });
      return Response.json({ success: true, schedule: sch, generated: gen.created });
    }

    /* ── schedule_status (pause / resume / cancel) ─────────────────────── */
    if (action === 'schedule_status') {
      if (!canEdit) return bad('Only a supervisor or administrator can manage OB schedules', 403, 'forbidden_action');
      const sch = await findSchedule(svc, body.id);
      if (!sch || sch.customer_id !== customerId) return bad('Schedule not found in your organisation', 404, 'not_found');
      const wanted = String(body.status || '');
      if (['paused', 'active', 'cancelled'].indexOf(wanted) === -1) return bad('Unknown schedule status');
      if (sch.status === 'cancelled') return bad('A cancelled schedule cannot be changed', 400, 'cancelled_schedule');
      const nowIso = new Date().toISOString();
      const history = (sch.change_history || []).concat([{
        timestamp: nowIso, actor_id: caller.id, actor_name: callerName, action: wanted === 'active' ? 'resumed' : wanted,
        notes: String(body.reason || '').slice(0, 500) || null,
      }]);
      const patch = { status: wanted, change_history: history };
      if (wanted === 'paused') {
        patch.paused_at = nowIso;
        // Automation stops: outstanding checks are cancelled with a recorded
        // reason — resuming NEVER back-fills them (no flood on re-enable).
        patch.cancelled_pending = await cancelPendingForSchedule(svc, sch.id, 'Schedule paused by ' + callerName);
      } else if (wanted === 'cancelled') {
        patch.cancelled_at = nowIso;
        patch.cancelled_reason = String(body.reason || 'Cancelled by ' + callerName).slice(0, 500);
        patch.cancelled_pending = await cancelPendingForSchedule(svc, sch.id, 'Schedule cancelled');
      } else if (wanted === 'active') {
        patch.resumed_at = nowIso;
      }
      await svc.entities.OBSchedule.update(sch.id, patch);
      const updated = await findSchedule(svc, sch.id);
      if (wanted === 'active') {
        // Explicit resumption: generation restarts cleanly from NOW — the past
        // is never back-filled, so re-enabling cannot flood historical alerts.
        const gen = await ensureOccurrences(svc, updated, sastTodayYmd(), 2);
        await logObAudit(svc, { event_type: 'ob.schedule_resumed', actor: caller, schedule: updated, notes: 'Generated from resume moment: ' + gen.created });
        return Response.json({ success: true, schedule: updated, generated: gen.created });
      }
      await logObAudit(svc, { event_type: 'ob.schedule_' + (wanted === 'paused' ? 'paused' : 'cancelled'), actor: caller, schedule: updated, notes: patch.cancelled_reason || null });
      return Response.json({ success: true, schedule: updated });
    }

    /* ── entry_submit — atomic completion / unscheduled capture ────────── */
    if (action === 'entry_submit') {
      const nowIso = new Date().toISOString();
      const outcome = String(body.outcome || '');
      if (OB_OUTCOMES.indexOf(outcome) === -1) return bad('An outcome must be explicitly selected (including "All in order")');
      const notes = String(body.notes || '').slice(0, 4000);
      const attachments = normalizeAttachments(body.attachments);
      const title = String(body.title || '').trim().slice(0, 200);
      const category = String(body.category || '').slice(0, 80) || null;

      let occ = null;
      let sch = null;
      if (body.occurrence_id) {
        occ = await findOcc(svc, body.occurrence_id);
        if (!occ || occ.customer_id !== customerId) return bad('OB check not found in your organisation', 404, 'not_found');
        const roomErr = assertRoom(occ.control_room_id);
        if (roomErr) return roomErr;
        if (occ.status === 'completed') return Response.json({ success: true, already_recorded: true, entry: occ });
        if (occ.status === 'cancelled') return bad('That check was cancelled and cannot be recorded', 400, 'check_cancelled');
        if (occ.source === 'scheduled') {
          sch = occ.schedule_id ? await findSchedule(svc, occ.schedule_id) : null;
          if (sch && sch.assigned_operator_id && sch.assigned_operator_id !== caller.id && !canEdit) {
            return bad('That check is assigned to another operator', 403, 'forbidden_check');
          }
          if (sch && sch.evidence_required && !attachments.length) {
            return bad('Supporting evidence is required for this check', 400, 'evidence_required');
          }
        }
        if (occ.evidence_required && !attachments.length) {
          return bad('Supporting evidence is required for this check', 400, 'evidence_required');
        }
      } else {
        // UNSCHEDULED entry
        if (!title) return bad('A title is required for an unscheduled OB entry');
        const scope = body.scope === 'site' ? 'site' : 'overall';
        const roomId = String(body.control_room_id || '');
        const roomErr = assertRoom(roomId);
        if (roomErr) return roomErr;
        let siteId = null; let siteName = null;
        if (scope === 'site') {
          const site = await findSite(svc, customerId, String(body.site_id || ''));
          if (!site) return bad('A valid site of your organisation is required', 403, 'forbidden_site');
          siteId = site.id; siteName = site.name;
        }
        const ref = await generateObReference(svc);
        const created = await svc.entities.OBOccurrence.create({
          customer_id: customerId, reseller_id: customerRec ? (customerRec.reseller_id || null) : null,
          ob_reference: ref, schedule_id: null, occurrence_key: null,
          source: 'unscheduled', scope,
          control_room_id: roomId, control_room_name: (roomById[roomId] || {}).name || null,
          site_id: siteId, site_name: siteName,
          title, category, instructions: null,
          outcome, notes, attachments,
          operating_date: sastTodayYmd(), slot_label: null, due_at: nowIso,
          evidence_required: false,
          status: 'completed', submitted_at: nowIso,
          operator_id: caller.id, operator_name: callerName,
          original_entry: { title, category, outcome, notes },
        });
        const entry = (await svc.entities.OBOccurrence.filter({ id: created.id || created._id }).catch(() => []))[0] || created;
        await logObAudit(svc, { event_type: 'ob.entry_created', actor: caller, occ: entry, notes: 'Unscheduled OB entry ' + ref });
        return Response.json({ success: true, entry });
      }

      // SCHEDULED completion — ONE atomic conditional write completes the
      // check AND records the entry together. A second controller / double
      // tap / retry matches zero rows and receives the already-recorded entry.
      const incidentId = body.incident_id ? String(body.incident_id) : null;
      const maintenanceId = body.maintenance_id ? String(body.maintenance_id) : null;
      let incidentRef = null; let maintenanceRef = null;
      if (incidentId) {
        const rows = await svc.entities.Incident.filter({ id: incidentId }).catch(() => []);
        const inc = (rows || [])[0];
        if (!inc || inc.customer_id !== customerId) return bad('That incident does not belong to your organisation', 403, 'forbidden_link');
        incidentRef = (inc.incident_number ? inc.incident_number + ' — ' : '') + (inc.title || '');
      }
      if (maintenanceId) {
        const rows = await svc.entities.MaintenanceRequest.filter({ id: maintenanceId }).catch(() => []);
        const m = (rows || [])[0];
        if (!m || m.customer_id !== customerId) return bad('That maintenance request does not belong to your organisation', 403, 'forbidden_link');
        maintenanceRef = (m.request_number ? m.request_number + ' — ' : '') + (m.title || '');
      }
      const entryFields = {
        outcome, notes, attachments,
        category: category || occ.category || null,
        incident_id: incidentId, incident_reference: incidentRef,
        maintenance_id: maintenanceId, maintenance_reference: maintenanceRef,
        status: 'completed', submitted_at: nowIso,
        operator_id: caller.id, operator_name: callerName,
        original_entry: { title: occ.title, category: occ.category || null, outcome, notes },
      };
      const cas = await svc.entities.OBOccurrence.updateMany(
        { id: occ.id, status: 'pending' },
        { $set: entryFields }).catch(() => null);
      if (!cas || !cas.updated) {
        const reread = await findOcc(svc, occ.id);
        if (reread && reread.status === 'completed') return Response.json({ success: true, already_recorded: true, entry: reread });
        return bad('That check is no longer outstanding', 409, 'conflict');
      }
      const entry = await findOcc(svc, occ.id);
      await logObAudit(svc, { event_type: 'ob.entry_recorded', actor: caller, occ: entry, notes: 'Check recorded (' + outcome + ')' + (occ.due_at && nowIso > occ.due_at ? ' — LATE (original due time retained)' : '') });
      return Response.json({ success: true, entry });
    }

    /* ── entry_cancel — explicit cancellation with recorded reason ─────── */
    if (action === 'entry_cancel') {
      if (!canEdit) return bad('Only a supervisor or administrator can cancel an outstanding OB check', 403, 'forbidden_action');
      const occ = await findOcc(svc, body.id);
      if (!occ || occ.customer_id !== customerId) return bad('OB check not found in your organisation', 404, 'not_found');
      if (occ.status !== 'pending') return bad('Only an outstanding check can be cancelled', 400, 'not_outstanding');
      const reason = String(body.reason || '').trim();
      if (!reason) return bad('A recorded reason is required to cancel an outstanding check');
      const nowIso = new Date().toISOString();
      const cas = await svc.entities.OBOccurrence.updateMany(
        { id: occ.id, status: 'pending' },
        { $set: { status: 'cancelled', cancelled_at: nowIso, cancelled_by_id: caller.id, cancelled_by_name: callerName, cancel_reason: reason.slice(0, 500) } }).catch(() => null);
      if (!cas || !cas.updated) return bad('That check is no longer outstanding', 409, 'conflict');
      const entry = await findOcc(svc, occ.id);
      await logObAudit(svc, { event_type: 'ob.check_cancelled', actor: caller, occ: entry, notes: reason });
      return Response.json({ success: true, entry });
    }

    /* ── entry_amend — dated correction, original retained ─────────────── */
    if (action === 'entry_amend') {
      const occ = await findOcc(svc, body.id);
      if (!occ || occ.customer_id !== customerId) return bad('OB entry not found in your organisation', 404, 'not_found');
      if (isOperator && operatorRoomIds.indexOf(occ.control_room_id) === -1) return bad('You are not authorised for that control room', 403, 'forbidden_entry');
      if (occ.status !== 'completed') return bad('Only recorded entries can be amended', 400, 'not_completed');
      const reason = String(body.reason || '').trim();
      if (!reason) return bad('A reason is required for every correction');
      const corr = body.corrections || {};
      const patch = {};
      if (corr.title !== undefined) { const t = String(corr.title || '').trim().slice(0, 200); if (t) patch.title = t; }
      if (corr.category !== undefined) patch.category = String(corr.category || '').slice(0, 80) || null;
      if (corr.outcome !== undefined) {
        if (OB_OUTCOMES.indexOf(String(corr.outcome)) === -1) return bad('Invalid corrected outcome');
        patch.outcome = corr.outcome;
      }
      if (corr.notes !== undefined) patch.notes = String(corr.notes || '').slice(0, 4000);
      if (!Object.keys(patch).length) return bad('Nothing to correct');
      const nowIso = new Date().toISOString();
      const amendments = (occ.amendments || []).concat([{
        timestamp: nowIso, author_id: caller.id, author_name: callerName,
        reason: reason.slice(0, 500), corrected: patch,
      }]);
      await svc.entities.OBOccurrence.update(occ.id, { ...patch, amendments });
      const entry = await findOcc(svc, occ.id);
      await logObAudit(svc, { event_type: 'ob.entry_amended', actor: caller, occ: entry, notes: reason });
      return Response.json({ success: true, entry });
    }

    /* ── entry_get — detail + signed attachment access (same permission) ─ */
    if (action === 'entry_get') {
      const occ = await findOcc(svc, body.id);
      if (!occ) return bad('OB entry not found', 404, 'not_found');
      if (!platformAdmin && !resellerAdmin) {
        if (occ.customer_id !== customerId) return bad('That entry does not belong to your organisation', 403, 'forbidden_entry');
        if (isOperator && operatorRoomIds.indexOf(occ.control_room_id) === -1) return bad('You are not authorised for that control room', 403, 'forbidden_entry');
      } else if (resellerAdmin && occ.reseller_id !== caller.reseller_id) {
        return bad('That entry does not belong to your reseller', 403, 'forbidden_entry');
      }
      const atts = [];
      for (const a of occ.attachments || []) {
        try {
          const signed = await base44.integrations.Core.CreateFileSignedUrl({ file_uri: a.file_uri, expires_in: 600 });
          atts.push({ ...a, signed_url: signed.signed_url || null });
        } catch (_) { atts.push({ ...a, signed_url: null }); }
      }
      return Response.json({ entry: { ...occ, attachments: atts } });
    }

    /* ── register_list — filtered, bounded, paginated ──────────────────── */
    if (action === 'register_list') {
      if (!customerId) return bad('customer scope required');
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const page = Math.max(0, Number(body.page) || 0);
      const q = { customer_id: customerId };
      if (resellerAdmin) { delete q.customer_id; q.reseller_id = caller.reseller_id; }
      const f = body.filters || {};
      if (f.scope === 'overall' || f.scope === 'site') q.scope = f.scope;
      if (f.control_room_id && roomIds.indexOf(f.control_room_id) !== -1) q.control_room_id = f.control_room_id;
      if (f.site_id) q.site_id = String(f.site_id);
      if (f.operator_id) q.operator_id = String(f.operator_id);
      if (f.status === 'completed' || f.status === 'cancelled') q.status = f.status; else q.status = 'completed';
      if (isOperator && operatorRoomIds.length) q.control_room_id = { $in: operatorRoomIds };
      // Date window on the SERVER (historical due/submission timestamps).
      let fromIso = null; let toIso = null;
      if (f.date_from && DATE_RE.test(f.date_from)) fromIso = new Date(Date.parse(f.date_from + 'T00:00:00+02:00')).toISOString();
      if (f.date_to && DATE_RE.test(f.date_to)) toIso = new Date(Date.parse(f.date_to + 'T23:59:59+02:00')).toISOString();
      if (fromIso || toIso) {
        q.submitted_at = {};
        if (fromIso) q.submitted_at.$gte = fromIso;
        if (toIso) q.submitted_at.$lte = toIso;
      }
      const rows = (await svc.entities.OBOccurrence.filter(q, '-submitted_at', 1000).catch(() => [])) || [];
      let list = rows;
      const term = String(f.q || '').trim().toLowerCase();
      if (term) {
        list = list.filter((e) => [e.ob_reference, e.title, e.notes, e.operator_name, e.category, e.site_name, e.control_room_name]
          .some((v) => v && String(v).toLowerCase().indexOf(term) !== -1));
      }
      if (f.category) list = list.filter((e) => (e.category || '') === f.category);
      const total = list.length;
      const pageRows = list.slice(page * limit, page * limit + limit);
      return Response.json({ entries: pageRows, total, page, limit, has_more: (page + 1) * limit < total });
    }

    /* ── report — period summary + detailed register (exports included) ── */
    if (action === 'report') {
      if (!customerId) return bad('customer scope required');
      const period = String(body.period || 'today');
      const today = sastTodayYmd();
      const dayOff = (ymd, n) => {
        const p = ymd.split('-');
        const d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
      };
      let from = today; let to = today;
      if (period === 'yesterday') { from = dayOff(today, -1); to = from; }
      else if (period === 'week') { from = dayOff(today, -6); to = today; }
      else if (period === 'month') { from = today.slice(0, 8) + '01'; to = today; }
      else if (period === 'custom') {
        if (DATE_RE.test(String(body.date_from))) from = String(body.date_from);
        if (DATE_RE.test(String(body.date_to))) to = String(body.date_to);
      }
      const fromIso = new Date(Date.parse(from + 'T00:00:00+02:00')).toISOString();
      const toIso = new Date(Date.parse(to + 'T23:59:59+02:00')).toISOString();
      const f = body.filters || {};
      const q = { customer_id: customerId };
      if (resellerAdmin) { delete q.customer_id; q.reseller_id = caller.reseller_id; }
      if (f.control_room_id && roomIds.indexOf(f.control_room_id) !== -1) q.control_room_id = f.control_room_id;
      if (isOperator && operatorRoomIds.length) q.control_room_id = { $in: operatorRoomIds };
      if (f.scope === 'overall' || f.scope === 'site') q.scope = f.scope;
      const rows = (await svc.entities.OBOccurrence.filter(q, '-created_date', 2000).catch(() => [])) || [];
      const now = new Date();
      const summary = {
        period_from: from, period_to: to,
        scheduled_due: 0, completed_on_time: 0, completed_late: 0,
        outstanding_within_grace: 0, overdue_outstanding: 0, cancelled_checks: 0,
        unscheduled_entries: 0, unscheduled_all_in_order: 0, unscheduled_other: 0,
      };
      const entries = [];
      const missed = [];
      for (const o of rows || []) {
        const inScheduledPeriod = o.source === 'scheduled' && o.due_at && o.due_at >= fromIso && o.due_at <= toIso;
        const submittedInPeriod = o.submitted_at && o.submitted_at >= fromIso && o.submitted_at <= toIso;
        const siteFilterOk = !f.site_id || o.site_id === String(f.site_id);
        if (o.source === 'scheduled' && inScheduledPeriod) {
          summary.scheduled_due++;
          const graceMs = 0; // overdue classification stored server-side via overdue_at
          if (o.status === 'completed' && submittedInPeriod !== false) {
            const late = o.submitted_at && o.due_at && o.submitted_at > o.due_at;
            if (late) summary.completed_late++; else summary.completed_on_time++;
            if (siteFilterOk) entries.push(o);
          } else if (o.status === 'completed') {
            // completed outside the period window (edge) — still counted as due
            const late = o.submitted_at && o.due_at && o.submitted_at > o.due_at;
            if (late) summary.completed_late++; else summary.completed_on_time++;
          } else if (o.status === 'cancelled') {
            summary.cancelled_checks++;
            if (siteFilterOk) missed.push(o);
          } else {
            // outstanding
            if (o.overdue_at || now >= Date.parse(o.due_at) + (((graceMs) || 15 * 60000))) { summary.overdue_outstanding++; } else { summary.outstanding_within_grace++; }
            if (siteFilterOk) missed.push(o);
          }
        } else if (o.source === 'unscheduled' && submittedInPeriod) {
          summary.unscheduled_entries++;
          if (o.outcome === 'all_in_order') summary.unscheduled_all_in_order++; else summary.unscheduled_other++;
          if (siteFilterOk) entries.push(o);
        }
      }
      entries.sort((a, b) => String(b.submitted_at || b.due_at || '').localeCompare(String(a.submitted_at || a.due_at || '')));
      missed.sort((a, b) => String(a.due_at || '').localeCompare(String(b.due_at || '')));
      const brandCtx = await resolveTaskBrandContext(svc, customerId).catch(() => null);
      return Response.json({
        summary, entries, missed, period, date_from: from, date_to: to,
        customer_name: brandCtx ? brandCtx.customerName : null,
      });
    }

    return bad('Unknown action', 400, 'unknown_action');
  } catch (e) {
    console.error('obAccess failed:', e?.message || e);
    return Response.json({ error: e?.message || 'Unexpected error' }, { status: 500 });
  }
}