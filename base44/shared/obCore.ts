/**
 * Task & OB Scheduling — Digital Occurrence Book (OB) CORE (shared module).
 *
 * Everything OB-specific lives HERE so the proven ordinary-task pipeline
 * (taskSweep.ts / taskLifecycle.ts / scheduledTaskAccess) is untouched:
 *   - SAST slot computation (interval anchored to the WINDOW START, never to
 *     the previous completion; specified times; overnight + 24-hour windows;
 *     active days; inclusive/exclusive window end)
 *   - bounded, idempotent occurrence generation (occurrence_key dedupe —
 *     scheduler retries, overlapping runs and schedule edits can never
 *     duplicate checks)
 *   - safe server-side OB reference numbers (cryptographic randomness with a
 *     uniqueness retry loop — NEVER count-based)
 *   - the OB SWEEP: due notification (once), overdue reminder after the
 *     configured grace (once), supervisor escalation after the configured
 *     additional delay (once, email + Telegram + push) — all flagged on the
 *     occurrence with claim-before-send CAS stamps so overlapping sweeps,
 *     retries and catch-up runs can never flood, and completion/cancellation
 *     stops everything.
 *
 * Reuses the Task module's OWN notification infrastructure
 * (taskNotifications.ts — Core email + Bot API Telegram + native push) and
 * its tenant-safe recipient resolution and branding resolver. No dependency
 * on any other module entitlement.
 */
import {
  sastTodayYmd, resolveTaskRecipients, notifyTaskRecipientsOnce,
  resolveTaskBrandContext, logTaskAudit,
} from './taskNotifications.ts';
import { sendNativePushToUsers } from './nativePush.ts';

const SAST_MS = 2 * 60 * 60 * 1000;
const MAX_SLOTS_PER_SCHEDULE = 300;
export const OB_OUTCOMES = ['all_in_order', 'issue_noted', 'action_taken', 'other'];
export const OB_CATEGORIES = ['Security', 'Fire', 'Access', 'Patrol', 'Maintenance observation', 'Health & safety', 'Other'];

/* ── Small date/time helpers (SAST, UTC+2, no DST) ─────────────────────── */

function ymdToDate(s) {
  const p = String(s).split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}
export function addDaysYmd(s, n) {
  const d = ymdToDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function weekdayOf(s) {
  return ymdToDate(s).getUTCDay(); // 0=Sunday … 6=Saturday
}
export function hhmmToMinutes(s) {
  const p = String(s || '').split(':');
  const h = Math.min(23, Math.max(0, Number(p[0]) || 0));
  const m = Math.min(59, Math.max(0, Number(p[1]) || 0));
  return h * 60 + m;
}
export function minutesToHHMM(total) {
  const m = ((total % 1440) + 1440) % 1440;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
/** UTC instant for a SAST wall-clock date + minutes-since-midnight. */
function sastInstantMinutes(dateYmd, minutes) {
  const hhmm = minutesToHHMM(minutes);
  return Date.parse(dateYmd + 'T' + hhmm + ':00+02:00');
}

/** Operating-window span in minutes (0 diff = 24-hour operation). */
export function windowSpanMinutes(sch) {
  const ws = hhmmToMinutes(sch.window_start);
  const we = hhmmToMinutes(sch.window_end);
  let span = we - ws;
  if (span < 0) span += 1440;
  if (span === 0) span = 1440;
  return span;
}

/* ── Slot computation ─────────────────────────────────────────────────────
   Returns the check slots for ONE schedule over [fromYmd, fromYmd+daysAhead],
   each anchored to the schedule's window start. For an overnight window the
   slots past midnight belong to the STARTING operating date (label '(+1d)'),
   so period-based reports always bucket by the operating date. */
export function computeSlots(sch, fromYmd, daysAhead) {
  const out = [];
  if (!sch || !sch.id) return out;
  const ws = hhmmToMinutes(sch.window_start);
  const span = windowSpanMinutes(sch);
  const inclusive = sch.window_end_inclusive !== false;
  const lastRel = inclusive ? span : span - 1;
  const step = sch.cadence === 'times'
    ? null
    : Math.max(1, Math.min(1440, Number(sch.every_n_minutes) || 60));
  const times = (sch.specified_times || [])
    .map(hhmmToMinutes)
    .map((t) => (t - ws + 1440) % 1440) // minutes after window start
    .filter((rel) => rel <= lastRel)
    .sort((a, b) => a - b);
  const days = (sch.active_days || []).map(Number);
  const limitYmd = addDaysYmd(fromYmd, Math.max(0, Number(daysAhead) || 0));
  for (let d = fromYmd; d <= limitYmd; d = addDaysYmd(d, 1)) {
    if (sch.start_date && d < sch.start_date) continue;
    if (sch.end_date && d > sch.end_date) break;
    if (days.length && days.indexOf(weekdayOf(d)) === -1) continue;
    let slots = [];
    if (sch.cadence === 'times') slots = times.slice();
    else for (let t = 0; t <= lastRel; t += step) { slots.push(t); if (slots.length > MAX_SLOTS_PER_SCHEDULE) break; }
    for (const rel of slots) {
      const total = ws + rel; // minutes since midnight of the operating day (may exceed 1440 → next calendar day)
      const dayOff = Math.floor(total / 1440);
      out.push({
        operating_date: d,
        slot_label: minutesToHHMM(total) + (dayOff ? ' (+1d)' : ''),
        due_at: new Date(sastInstantMinutes(addDaysYmd(d, dayOff), total)).toISOString(),
        key: sch.id + ':' + d + ':' + String(total).padStart(4, '0'),
      });
      if (out.length > MAX_SLOTS_PER_SCHEDULE * 3) return out;
    }
  }
  return out;
}

/* ── Safe OB reference (cryptographic randomness, uniqueness-retried) ──── */

function randToken(n) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return s;
}
export async function generateObReference(svc) {
  const ymd = new Date(Date.now() + SAST_MS).toISOString().slice(0, 10).replace(/-/g, '');
  for (let i = 0; i < 6; i++) {
    const ref = 'OB-' + ymd + '-' + randToken(6);
    const ex = await svc.entities.OBOccurrence.filter({ ob_reference: ref }, '-created_date', 1).catch(() => []);
    if (!ex || !ex.length) return ref;
  }
  throw new Error('Could not generate a unique OB reference');
}

/* ── Occurrence generation + dedupe ────────────────────────────────────── */

async function keysExist(svc, keys) {
  const have = new Set();
  for (let i = 0; i < keys.length; i += 80) {
    const chunk = keys.slice(i, i + 80);
    const rows = await svc.entities.OBOccurrence.filter({ occurrence_key: { $in: chunk } }).catch(() => []);
    for (const r of rows || []) have.add(r.occurrence_key);
  }
  return have;
}

/** Idempotent generation: creates every missing scheduled check for the next
 * `daysAhead` days. Never duplicates (occurrence_key pre-check + post-dedupe). */
export async function ensureOccurrences(svc, sch, fromYmd, daysAhead) {
  if (!sch || sch.status !== 'active' || sch.cadence !== 'interval' && sch.cadence !== 'times') return { created: 0 };
  const slots = computeSlots(sch, fromYmd, daysAhead);
  if (!slots.length) return { created: 0 };
  const keys = slots.map((s) => s.key);
  const have = await keysExist(svc, keys);
  const missing = slots.filter((s) => !have.has(s.key));
  if (!missing.length) return { created: 0 };
  const records = [];
  for (const s of missing) {
    const ref = await generateObReference(svc);
    records.push({
      customer_id: sch.customer_id,
      reseller_id: sch.reseller_id || null,
      ob_reference: ref,
      schedule_id: sch.id,
      occurrence_key: s.key,
      source: 'scheduled',
      scope: sch.scope || 'overall',
      control_room_id: sch.control_room_id,
      control_room_name: sch.control_room_name || null,
      site_id: sch.scope === 'site' ? (sch.site_id || null) : null,
      site_name: sch.scope === 'site' ? (sch.site_name || null) : null,
      title: sch.title,
      category: sch.category || null,
      instructions: sch.instructions || null,
      operating_date: s.operating_date,
      slot_label: s.slot_label,
      due_at: s.due_at,
      evidence_required: sch.evidence_required === true,
      status: 'pending',
      is_test: sch.is_test === true,
    });
  }
  await svc.entities.OBOccurrence.bulkCreate(records).catch(async () => {
    for (const r of records) await svc.entities.OBOccurrence.create(r).catch(() => {});
  });
  // Post-dedupe (overlapping runs may race the pre-check): keep the OLDEST
  // pending record per key, delete extras.
  await dedupePending(svc, sch.id);
  return { created: records.length };
}

/** Remove duplicate PENDING occurrences that share an occurrence_key
 * (concurrent-generation race guard). Completed/cancelled records are never
 * touched — history is always preserved. */
export async function dedupePending(svc, scheduleId) {
  if (!scheduleId) return 0;
  const rows = await svc.entities.OBOccurrence.filter({ schedule_id: scheduleId, status: 'pending' }, 'created_date', 500).catch(() => []);
  const byKey = {};
  for (const r of rows || []) {
    if (!r.occurrence_key) continue;
    (byKey[r.occurrence_key] = byKey[r.occurrence_key] || []).push(r);
  }
  let removed = 0;
  for (const key of Object.keys(byKey)) {
    const dupes = byKey[key];
    if (dupes.length < 2) continue;
    const keep = dupes[0]; // sorted by created_date asc
    for (const extra of dupes.slice(1)) {
      await svc.entities.OBOccurrence.delete(extra.id).catch(() => {});
      removed++;
    }
  }
  return removed;
}

/** Cancel every outstanding (pending) check of a schedule — used on pause /
 * cancel / customer OB-disabled so nothing lingers unnotified. History
 * (completed/cancelled) is never touched. */
export async function cancelPendingForSchedule(svc, scheduleId, reason) {
  if (!scheduleId) return 0;
  const nowIso = new Date().toISOString();
  const cas = await svc.entities.OBOccurrence.updateMany(
    { schedule_id: scheduleId, status: 'pending' },
    { $set: { status: 'cancelled', cancelled_at: nowIso, cancelled_by_id: 'system', cancelled_by_name: 'Task & OB Scheduling Automation', cancel_reason: reason || 'Schedule stopped' } }
  ).catch(() => null);
  return (cas && cas.updated) || 0;
}

/* ── Recipients (tenant-safe, reuses the Task module resolution) ───────── */

async function obAlertRecipients(svc, occ, sch) {
  const room = sch
    ? sch
    : null;
  let ids = [];
  if (sch && sch.assigned_operator_id) ids.push(sch.assigned_operator_id);
  if (occ && occ.control_room_id) {
    const rooms = await svc.entities.ControlRoom.filter({ id: occ.control_room_id }).catch(() => []);
    for (const r of rooms || []) ids = ids.concat((r.operator_user_ids || []).map(String));
  }
  ids = [...new Set(ids.filter(Boolean))];
  const recips = await resolveTaskRecipients(svc, occ.customer_id, ids);
  return recips.filter((r) => r.status !== 'suspended' && r.status !== 'inactive');
}

async function escalationRecipients(svc, sch, occ) {
  const base = await obAlertRecipients(svc, occ, sch);
  const ids = new Set(base.map((r) => r.id));
  // Escalation widens to the customer's administrators + dispatchers only.
  const staff = await svc.entities.User.filter({ customer_id: occ.customer_id }, 'full_name', 200).catch(() => []);
  for (const u of staff || []) {
    if (['customer_admin', 'dispatcher', 'admin'].indexOf(u.role_type) !== -1 && u.status !== 'suspended' && u.status !== 'inactive') ids.add(u.id);
  }
  return resolveTaskRecipients(svc, occ.customer_id, [...ids]);
}

/* ── Notification content + dispatch ───────────────────────────────────── */

function obLine(occ) {
  return occ.title + ' · ' + (occ.scope === 'site' ? ('Site: ' + (occ.site_name || '—')) : 'Overall') +
    ' · ' + (occ.control_room_name || '') + ' · due ' + (occ.slot_label || '') + ' (' + (occ.operating_date || '') + ')';
}

async function inAppNotify(svc, occ, recipients, { title, message, priority }) {
  for (const r of recipients) {
    await svc.entities.Notification.create({
      customer_id: occ.customer_id, reseller_id: occ.reseller_id || null,
      recipient_id: r.id, recipient_name: r.name,
      type: 'status_change', priority: priority || 'high',
      title, message,
      related_entity: 'OBOccurrence', related_id: occ.id,
      action_url: '/ScheduledTasks', sent_via: ['in_app'],
    }).catch(() => {});
  }
}

async function sendObAlert(svc, occ, sch, kind) {
  const brandCtx = await resolveTaskBrandContext(svc, occ.customer_id).catch(() => null);
  const recipients = await obAlertRecipients(svc, occ, sch);
  if (!recipients.length) return;
  const titles = {
    due: 'OB CHECK DUE — ' + occ.title,
    overdue: 'OB CHECK OVERDUE — ' + occ.title,
  };
  const messages = {
    due: obLine(occ) + ' — the check is now due. Open your Task Queue.',
    overdue: obLine(occ) + ' — outstanding beyond the grace period. Record it or escalate.',
  };
  await inAppNotify(svc, occ, recipients, { title: titles[kind], message: messages[kind], priority: 'high' });
  await sendNativePushToUsers(svc, recipients.map((r) => r.id), {
    title: titles[kind], body: messages[kind],
    priority: 'high', action_label: 'Open', action_url: '/ScheduledTasks',
    event_key: 'ob_' + kind + ':' + occ.id,
    customer_id: occ.customer_id, reseller_id: occ.reseller_id || null,
    brand: brandCtx && brandCtx.brand ? brandCtx.brand : null,
  }).catch(() => null);
}

function escalationEmailHtml(occ, brand, brandName) {
  const c = (brand && brand.primary) || '#0ea5e9';
  return '<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">' +
    '<div style="background:' + c + ';color:#fff;padding:16px 20px;border-radius:8px 8px 0 0"><h2 style="margin:0;font-size:18px">' + (brandName || 'Task & OB Scheduling') + ' — OB ESCALATION</h2></div>' +
    '<div style="border:1px solid #e2e8f0;border-top:0;padding:20px;color:#0f172a">' +
    '<p style="margin:0 0 12px"><strong>' + occ.title + '</strong> (' + (occ.ob_reference || '') + ')</p>' +
    '<p style="margin:0 0 6px">Scope: ' + (occ.scope === 'site' ? 'Site — ' + (occ.site_name || '—') : 'Overall control room') + '</p>' +
    '<p style="margin:0 0 6px">Control room: ' + (occ.control_room_name || '—') + '</p>' +
    '<p style="margin:0 0 6px">Due: ' + (occ.slot_label || '') + ' on ' + (occ.operating_date || '') + ' (SAST)</p>' +
    '<p style="margin:0 0 6px">Overdue beyond the configured grace and escalation delay — still not recorded.</p>' +
    '<p style="margin:16px 0 0;font-size:12px;color:#64748b">Automated escalation by ' + (brandName || 'Task & OB Scheduling') + '. Opening or acknowledging this alert is not completion — the check must be recorded in the Occurrence Book.</p>' +
    '</div></div>';
}

async function sendEscalation(svc, secrets, occ, sch) {
  const brandCtx = await resolveTaskBrandContext(svc, occ.customer_id).catch(() => null);
  const recipients = await escalationRecipients(svc, sch, occ);
  if (!recipients.length) return;
  const line = obLine(occ);
  await inAppNotify(svc, occ, recipients, { title: 'OB ESCALATION — ' + occ.title, message: line + ' — still outstanding; escalated to supervisors.', priority: 'high' });
  await notifyTaskRecipientsOnce(svc, secrets, recipients, {
    subject: '[OB ESCALATION] ' + occ.title + ' — ' + (occ.operating_date || ''),
    emailBody: line + ' — outstanding beyond the grace period and escalation delay. Opening this alert is not completion; the check must be recorded in the Occurrence Book.',
    emailHtml: escalationEmailHtml(occ, brandCtx && brandCtx.brand, brandCtx && brandCtx.brandName),
    telegramText: '🚨 OB ESCALATION — ' + line + ' — still not recorded.',
    from_name: (brandCtx && brandCtx.brandName) || 'Task & OB Scheduling',
    eventKey: 'ob_escalation:' + occ.id,
    actionUrl: '/ScheduledTasks',
    pushTitle: 'OB ESCALATION — ' + occ.title,
    pushBody: line + ' — still not recorded.',
    priority: 'critical',
    customerId: occ.customer_id, resellerId: occ.reseller_id || null,
  });
}

/* ── THE OB SWEEP ──────────────────────────────────────────────────────── */

export async function runObSweep(svc, secrets) {
  const results = { generated: 0, due_notified: 0, overdue_notified: 0, escalations: 0, cancelled: 0, deduped: 0 };
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const schedules = await svc.entities.OBSchedule.filter({ status: 'active' }, '-created_date', 200).catch(() => []);
  if (!schedules || !schedules.length) return results;
  const custCache = {};
  const obOn = async (cid) => {
    if (!cid) return false;
    if (custCache[cid] === undefined) {
      const c = await svc.entities.Customer.filter({ id: cid }).catch(() => []);
      custCache[cid] = !!(c && c[0] && c[0].digital_ob_enabled === true);
    }
    return custCache[cid];
  };
  const scheduleById = {};
  for (const sch of schedules) {
    scheduleById[sch.id] = sch;
    if (!(await obOn(sch.customer_id))) {
      results.cancelled += await cancelPendingForSchedule(svc, sch.id, 'Digital OB disabled for this customer');
      continue;
    }
    const g = await ensureOccurrences(svc, sch, sastTodayYmd(), 2);
    results.generated += g.created;
  }
  const pending = await svc.entities.OBOccurrence.filter({ status: 'pending' }, 'due_at', 300).catch(() => []);
  for (const occ of pending || []) {
    if (!occ.due_at) continue;
    const due = Date.parse(occ.due_at);
    if (isNaN(due) || due > now) continue;
    const sch = occ.schedule_id ? scheduleById[occ.schedule_id] : null;
    if (occ.source === 'scheduled' && (!sch || sch.status !== 'active' || !(await obOn(occ.customer_id)))) {
      const cas = await svc.entities.OBOccurrence.updateMany(
        { id: occ.id, status: 'pending' },
        { $set: { status: 'cancelled', cancelled_at: nowIso, cancelled_by_id: 'system', cancelled_by_name: 'Task & OB Scheduling Automation', cancel_reason: 'Schedule no longer active' } }
      ).catch(() => null);
      if (cas && cas.updated) results.cancelled++;
      continue;
    }
    // DUE — one notification, claim-before-send (a concurrent sweep that lost
    // the claim updates zero rows and sends nothing).
    if (!occ.due_notified_at) {
      const claim = await svc.entities.OBOccurrence.updateMany(
        { id: occ.id, status: 'pending', due_notified_at: null },
        { $set: { due_notified_at: nowIso } }).catch(() => null);
      if (claim && claim.updated) {
        await sendObAlert(svc, occ, sch, 'due').catch(() => {});
        results.due_notified++;
      }
    }
    const graceMs = (((sch && Number(sch.overdue_grace_minutes)) || 15)) * 60000;
    if (!occ.overdue_notified_at && now >= due + graceMs) {
      const claim = await svc.entities.OBOccurrence.updateMany(
        { id: occ.id, status: 'pending', overdue_notified_at: null },
        { $set: { overdue_notified_at: nowIso, overdue_at: nowIso } }).catch(() => null);
      if (claim && claim.updated) {
        await sendObAlert(svc, occ, sch, 'overdue').catch(() => {});
        results.overdue_notified++;
      }
    }
    const escMs = (((sch && Number(sch.escalation_delay_minutes)) || 30)) * 60000;
    if (occ.overdue_notified_at && !occ.escalation_notified_at && now >= due + graceMs + escMs) {
      const claim = await svc.entities.OBOccurrence.updateMany(
        { id: occ.id, status: 'pending', escalation_notified_at: null },
        { $set: { escalation_notified_at: nowIso } }).catch(() => null);
      if (claim && claim.updated) {
        await sendEscalation(svc, secrets, occ, sch).catch(() => {});
        results.escalations++;
      }
    }
  }
  return results;
}

/** Audit helper (module-scoped PlatformAuditLog record). */
export async function logObAudit(svc, { event_type, actor, occ, schedule, notes, action }) {
  try {
    await svc.entities.PlatformAuditLog.create({
      event_type,
      user_id: (actor && actor.id) || 'system',
      user_name: (actor && (actor.display_name || actor.full_name || actor.email)) || 'Task & OB Scheduling Automation',
      customer_id: (occ && occ.customer_id) || (schedule && schedule.customer_id) || null,
      reseller_id: (occ && occ.reseller_id) || (schedule && schedule.reseller_id) || null,
      module_key: 'TASK_SCHEDULING',
      entity_name: occ ? 'OBOccurrence' : 'OBSchedule',
      entity_id: (occ && occ.id) || (schedule && schedule.id) || null,
      action: action || '',
      notes: notes || null,
    });
  } catch (e) {
    console.error('ob audit failed:', e?.message || e);
  }
}