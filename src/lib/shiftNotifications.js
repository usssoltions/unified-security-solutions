/**
 * SHIFT LIFECYCLE NOTIFICATIONS — thin client for the server-side
 * sendShiftNotification function (the existing shared notification system).
 *
 * The frontend passes only shift FACTS (ids, times, names). The backend
 * resolves the guard's contact details from their authoritative User record
 * and validates tenant scope before delivering branded email + in-app
 * record + native push. The frontend never constructs recipients or contact
 * details, and notification failures never break the scheduling action.
 *
 * Deterministic event keys ('shift_<type>:<shiftId>:<startTime>') make
 * unchanged saves unable to spam the guard even if a call-site retries.
 */
import { base44 } from "@/api/base44Client";

async function invokeShiftNotification(notificationType, shift) {
  if (!shift || !shift.guard_id) return;
  try {
    await base44.functions.invoke("sendShiftNotification", {
      notificationType,
      shiftId: shift.id,
      guardId: shift.guard_id,
      guardName: shift.guard_name || null,
      siteName: shift.site_name || null,
      startTime: shift.start_time || null,
      endTime: shift.end_time || null,
    });
  } catch (_) { /* notification failure never breaks the scheduling action */ }
}

const sameInstant = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return (isNaN(ta) && isNaN(tb)) || ta === tb;
};

/**
 * True only when a scheduling-meaningful field actually changed (guard,
 * site, start or end time). Call-sites use this so saving an UNCHANGED
 * shift notifies nobody on any channel.
 */
export function meaningfulShiftChange(prev, next) {
  if (!prev || !next) return true;
  return prev.guard_id !== next.guard_id ||
    prev.site_id !== next.site_id ||
    !sameInstant(prev.start_time, next.start_time) ||
    !sameInstant(prev.end_time, next.end_time);
}

/** NEW SHIFT ASSIGNED — notify the assigned guard (server-side channels). */
export async function notifyShiftCreated(shift) {
  return invokeShiftNotification("assigned", shift);
}

/**
 * SHIFT CHANGED — notify the affected guard. A guard change notifies the
 * NEW guard as a new assignment; other meaningful changes notify as an
 * update. Unchanged saves notify nobody.
 */
export async function notifyShiftUpdated(prevShift, nextShift) {
  if (!nextShift || !nextShift.guard_id) return;
  if (!meaningfulShiftChange(prevShift, nextShift)) return;
  const guardChanged = prevShift && prevShift.guard_id && prevShift.guard_id !== nextShift.guard_id;
  return invokeShiftNotification(guardChanged ? "assigned" : "updated", nextShift);
}

/** SHIFT CANCELLED — notify the affected guard (server-side channels). */
export async function notifyShiftCancelled(shift) {
  return invokeShiftNotification("cancelled", shift);
}