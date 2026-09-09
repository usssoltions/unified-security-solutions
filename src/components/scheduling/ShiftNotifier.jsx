/**
 * ShiftNotifier
 * Called after a shift is created/updated.
 * Opens the WhatsApp prompt for the guard's phone and routes the multi-channel
 * notification (branded email + in-app record + native push) through the
 * SERVER-SIDE sendShiftNotification function — the frontend never constructs
 * recipients or contact details. Falls back gracefully if any step fails.
 */
import { base44 } from "@/api/base44Client";
import { guardShiftAssignedMessage, buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * Notify a guard about their new/updated shift.
 * @param {object} shift - created shift record
 * @param {object} guard - guard User record (must have .phone or .whatsapp)
 * @param {"assigned"|"updated"} type
 */
export async function notifyGuardShift(shift, guard, type = "assigned") {
  if (!guard) return;

  // full_name is the platform-managed, read-only field (often just the email
  // local-part, e.g. "sales"). display_name is the editable, human name set in
  // User Management — prefer it everywhere a person's name is shown.
  const guardName = guard.display_name || guard.full_name || "Guard";

  const msg = guardShiftAssignedMessage({
    guardName,
    siteName: shift.site_name,
    startTime: shift.start_time,
    endTime: shift.end_time,
    notes: shift.notes,
  });

  // 1. Open WhatsApp for guard (requires dispatcher to tap)
  const guardPhone = guard.whatsapp || guard.phone || guard.phone_number;
  if (guardPhone) {
    const link = buildWhatsAppLink(guardPhone, msg);
    if (link) {
      // Store link in session storage so ShiftForm can open it
      const pending = JSON.parse(sessionStorage.getItem("pending_guard_wa") || "[]");
      pending.push({ name: guardName, number: guardPhone, link, shiftId: shift.id });
      sessionStorage.setItem("pending_guard_wa", JSON.stringify(pending));
    }
  }

  // 2. SERVER-SIDE multi-channel notification — branded email + in-app record
  //    + NATIVE PUSH. The backend (sendShiftNotification) resolves the guard's
  //    contact details from their authoritative User record and validates
  //    tenant scope. Deterministic event keys mean an unchanged shift can
  //    never re-notify the guard.
  try {
    await base44.functions.invoke("sendShiftNotification", {
      notificationType: type,
      shiftId: shift.id,
      guardId: guard.id,
      guardName: shift.guard_name || guardName,
      siteName: shift.site_name || null,
      startTime: shift.start_time || null,
      endTime: shift.end_time || null,
    });
  } catch (_) { /* notification failure never breaks the scheduling action */ }
}