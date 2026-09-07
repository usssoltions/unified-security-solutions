/**
 * scheduledTaskAccess — the sole tenant-access gateway for Scheduled Tasks
 * (OperationalTask records used as SCHEDULED operational tasks — a DISTINCT
 * workflow from guard shift scheduling). Mirrors the proven attendanceAccess
 * pattern: the caller's tenant is resolved SERVER-SIDE from their User
 * record, module licensing (OPERATIONS / COMPLETE_SECURITY) is enforced, and
 * every action fails closed for unauthorized roles. The entity's RLS
 * restricts direct client access to platform admins only — Customer A can
 * never reach Customer B's tasks.
 *
 * Actions:
 *   list     — tenant tasks (guards: only tasks assigned to them) + active
 *              sites + assignable users for the form dropdowns. Also runs the
 *              overdue sweep and the idempotent recurring-occurrence top-up.
 *   create   — full validation (site/assignee belong to the tenant, recurrence
 *              rules) + bounded occurrence generation (dedup by recurrence_key).
 *   update   — edit task fields (tenant edit roles / platform admin only).
 *   start    — mark in_progress (assignee or edit roles).
 *   complete — completed + completion timestamp/notes (assignee or edit roles).
 *   cancel   — cancelled + cascades future occurrences of a recurring series.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

const EDIT_ROLES = ['customer_admin', 'admin', 'dispatcher'];
const ASSIGNABLE_ROLES = ['guard', 'admin', 'dispatcher', 'customer_admin'];
const OPEN_STATUSES = ['new', 'acknowledged', 'in_progress', 'awaiting'];
const RECURRENCE_TYPES = ['daily', 'weekly', 'weekdays', 'monthly', 'custom'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isPlatformAdmin(u) {
  return !!u && (u.role_type === 'platform_admin' || u.admin_level === 'platform');
}
function isResellerAdmin(u) {
  return !!u && !isPlatformAdmin(u) && (u.role_type === 'reseller_admin' || u.admin_level === 'reseller');
}

/* ── Date helpers — YYYY-MM-DD strings are timezone-neutral ─────────────── */
function ymdToDate(s) {
  const p = s.split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}
function addDaysYmd(s, n) {
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

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({})) || {};
    const action = String(body.action || 'list');
    const svc = base44.asServiceRole;

    const platformAdmin = isPlatformAdmin(caller);
    const resellerAdmin = isResellerAdmin(caller);
    const roleType = caller.role_type;
    const customerId = platformAdmin ? (body.customer_id || null) : (caller.customer_id || null);
    const canEdit = platformAdmin || (EDIT_ROLES.indexOf(roleType) !== -1 && !!customerId);
    const isGuard = !platformAdmin && !resellerAdmin && roleType === 'guard';
    const callerName = caller.display_name || caller.full_name || caller.email;

    if (!platformAdmin && !resellerAdmin && !customerId) {
      return Response.json({ error: 'Your account is not assigned to a customer', code: 'no_scope' }, { status: 403 });
    }
    if (resellerAdmin && !caller.reseller_id) {
      return Response.json({ error: 'Your account is not assigned to a reseller', code: 'no_scope' }, { status: 403 });
    }
    if (!platformAdmin && !resellerAdmin && !canEdit && !isGuard) {
      return Response.json({ error: 'Your role cannot access scheduled tasks', code: 'forbidden_role' }, { status: 403 });
    }

    /* Module gate — Scheduled Tasks belongs to OPERATIONS (or the
       COMPLETE_SECURITY suite). Fail closed for tenant users. */
    if (!platformAdmin && !resellerAdmin && customerId) {
      const ents = await svc.entities.ModuleEntitlement.filter({ customer_id: customerId }).catch(() => []);
      const licensed = (ents || []).some((e) =>
        e.enabled && (!e.status || e.status === 'active') &&
        (e.module_key === 'OPERATIONS' || e.module_key === 'COMPLETE_SECURITY'));
      if (!licensed) {
        return Response.json({ error: 'Scheduled Tasks requires the Operations module for your customer', code: 'module_not_enabled' }, { status: 403 });
      }
    }

    const findTask = async (id) => {
      if (!id) return null;
      const rows = await svc.entities.OperationalTask.filter({ id: String(id) }).catch(() => []);
      return (rows && rows[0]) ? rows[0] : null;
    };

    /* Scope assertion — guards only touch their own tasks; tenant roles only
       their own customer's tasks; platform admins have oversight. */
    const assertScope = (task) => {
      if (!task) return Response.json({ error: 'Task not found', code: 'not_found' }, { status: 404 });
      if (platformAdmin) return null;
      if (isGuard) {
        if (task.assigned_to !== caller.id) {
          return Response.json({ error: 'You can only access tasks assigned to you', code: 'forbidden_task' }, { status: 403 });
        }
        return null;
      }
      if (task.customer_id !== customerId) {
        return Response.json({ error: 'That task does not belong to your customer', code: 'forbidden_task' }, { status: 403 });
      }
      return null;
    };

    if (action === 'list') {
      const nowIso = new Date().toISOString();
      if (customerId) {
        // Overdue sweep: open tasks past their due date become 'overdue'.
        await svc.entities.OperationalTask.updateMany(
          { customer_id: customerId, status: { $in: OPEN_STATUSES }, due_date: { $lt: nowIso } },
          { $set: { status: 'overdue' } }
        ).catch(() => {});
        // Rolling top-up for recurring series (idempotent — dedup by recurrence_key).
        if (canEdit) {
          const parents = await svc.entities.OperationalTask.filter(
            { customer_id: customerId, recurrence_type: { $ne: 'none' } }, '-created_date', 50).catch(() => []);
          for (const parent of (parents || [])) {
            if (!parent.recurrence_key || parent.status === 'cancelled') continue;
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
      } else if (resellerAdmin) {
        tasks = await svc.entities.OperationalTask.filter({ reseller_id: caller.reseller_id }, '-created_date', 200).catch(() => []);
      } else if (customerId) {
        tasks = await svc.entities.OperationalTask.filter({ customer_id: customerId }, '-created_date', 200).catch(() => []);
      } else {
        tasks = await svc.entities.OperationalTask.list('-created_date', 200).catch(() => []);
      }
      let sites = [];
      let users = [];
      if (customerId) {
        sites = await svc.entities.Site.filter({ customer_id: customerId, status: 'active' }, 'name', 100).catch(() => []);
        const allUsers = await svc.entities.User.filter({ customer_id: customerId }, 'full_name', 200).catch(() => []);
        users = (allUsers || [])
          .filter((u) => ASSIGNABLE_ROLES.indexOf(u.role_type) !== -1)
          .map((u) => ({ id: u.id, name: u.display_name || u.full_name || u.email, role_type: u.role_type }));
      }
      return Response.json({ tasks: tasks || [], sites: sites || [], users, can_manage: canEdit });
    }

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
      const siteRows = await svc.entities.Site.filter({ id: String(body.site_id || '') }).catch(() => []);
      const site = (siteRows && siteRows[0]) ? siteRows[0] : null;
      if (!site || site.customer_id !== customerId) {
        return Response.json({ error: 'The selected site does not belong to your customer' }, { status: 400 });
      }
      if (site.status && site.status !== 'active') {
        return Response.json({ error: 'The selected site is not active' }, { status: 400 });
      }
      const userRows = await svc.entities.User.filter({ id: String(body.assigned_to || '') }).catch(() => []);
      const assignee = (userRows && userRows[0]) ? userRows[0] : null;
      if (!assignee || assignee.customer_id !== customerId) {
        return Response.json({ error: 'The selected user does not belong to your customer' }, { status: 400 });
      }
      if (ASSIGNABLE_ROLES.indexOf(assignee.role_type) === -1) {
        return Response.json({ error: 'That user role cannot be assigned tasks' }, { status: 400 });
      }
      const custRows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
      const customer = (custRows && custRows[0]) ? custRows[0] : null;
      const resellerId = (customer && customer.reseller_id) || caller.reseller_id || null;
      const recurrence_weekdays = Array.isArray(body.recurrence_weekdays)
        ? body.recurrence_weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : [];
      const parent = {
        customer_id: customerId,
        reseller_id: resellerId,
        site_id: site.id,
        site_name: site.name || null,
        title,
        description: body.description || null,
        task_type: body.task_type || 'other',
        priority: PRIORITIES.indexOf(body.priority) !== -1 ? body.priority : 'medium',
        assigned_to: assignee.id,
        assigned_to_name: assignee.display_name || assignee.full_name || assignee.email,
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
      if (body.site_id !== undefined && body.site_id !== task.site_id) {
        const siteRows = await svc.entities.Site.filter({ id: String(body.site_id || '') }).catch(() => []);
        const site = (siteRows && siteRows[0]) ? siteRows[0] : null;
        if (!site || site.customer_id !== task.customer_id) {
          return Response.json({ error: 'The selected site does not belong to your customer' }, { status: 400 });
        }
        changes.site_id = site.id;
        changes.site_name = site.name || null;
      }
      if (body.assigned_to !== undefined && body.assigned_to !== task.assigned_to) {
        const userRows = await svc.entities.User.filter({ id: String(body.assigned_to || '') }).catch(() => []);
        const assignee = (userRows && userRows[0]) ? userRows[0] : null;
        if (!assignee || assignee.customer_id !== task.customer_id) {
          return Response.json({ error: 'The selected user does not belong to your customer' }, { status: 400 });
        }
        if (ASSIGNABLE_ROLES.indexOf(assignee.role_type) === -1) {
          return Response.json({ error: 'That user role cannot be assigned tasks' }, { status: 400 });
        }
        changes.assigned_to = assignee.id;
        changes.assigned_to_name = assignee.display_name || assignee.full_name || assignee.email;
      }
      if (body.scheduled_date !== undefined || body.scheduled_time !== undefined) {
        const sd = body.scheduled_date !== undefined ? String(body.scheduled_date) : task.scheduled_date;
        const st = body.scheduled_time !== undefined ? String(body.scheduled_time) : task.scheduled_time;
        if (!DATE_RE.test(sd) || !TIME_RE.test(st)) {
          return Response.json({ error: 'A valid scheduled date and time are required' }, { status: 400 });
        }
        changes.scheduled_date = sd;
        changes.scheduled_time = st;
        changes.scheduled_at = sd + 'T' + st + ':00+02:00';
      }
      if (body.due_date !== undefined) changes.due_date = body.due_date || null;
      if (!Object.keys(changes).length) return Response.json({ success: true, task: task, unchanged: true });
      const updated = await svc.entities.OperationalTask.update(task.id, changes);
      return Response.json({ success: true, task: updated });
    }

    if (action === 'start') {
      const task = await findTask(body.id);
      const scopeErr = assertScope(task);
      if (scopeErr) return scopeErr;
      if (task.status === 'completed' || task.status === 'cancelled') {
        return Response.json({ error: 'Only open tasks can be started' }, { status: 400 });
      }
      if (task.status === 'in_progress') return Response.json({ success: true, task: task, unchanged: true });
      const updated = await svc.entities.OperationalTask.update(task.id, { status: 'in_progress' });
      return Response.json({ success: true, task: updated });
    }

    if (action === 'complete') {
      const task = await findTask(body.id);
      const scopeErr = assertScope(task);
      if (scopeErr) return scopeErr;
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
      return Response.json({ success: true, task: updated });
    }

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
      // Cancelling a recurring parent also cancels its remaining open occurrences,
      // so cancelled work never lingers as active tasks.
      if (task.recurrence_type && task.recurrence_type !== 'none') {
        await svc.entities.OperationalTask.updateMany(
          { customer_id: task.customer_id, parent_task_id: task.id, status: { $in: OPEN_STATUSES.concat(['overdue']) } },
          { $set: { status: 'cancelled' } }
        ).catch(() => {});
      }
      return Response.json({ success: true, task: updated });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}