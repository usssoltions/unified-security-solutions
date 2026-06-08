/**
 * ShiftNotifier
 * Called after a shift is created/updated.
 * Sends WhatsApp directly to the guard's phone + email + in-app notification.
 * Falls back gracefully if any step fails.
 */
import { base44 } from "@/api/base44Client";
import { guardShiftAssignedMessage, buildWhatsAppLink, notifyAdmins } from "@/lib/whatsapp";

/**
 * Notify a guard about their new/updated shift.
 * @param {object} shift - created shift record
 * @param {object} guard - guard User record (must have .phone or .whatsapp and .email)
 * @param {"assigned"|"updated"} type
 */
export async function notifyGuardShift(shift, guard, type = "assigned") {
  if (!guard) return;

  const msg = guardShiftAssignedMessage({
    guardName: guard.full_name,
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
      pending.push({ name: guard.full_name, number: guardPhone, link, shiftId: shift.id });
      sessionStorage.setItem("pending_guard_wa", JSON.stringify(pending));
    }
  }

  // 2. Email guard
  if (guard.email) {
    const subject = `[SecureGuard] Shift ${type === "updated" ? "Updated" : "Assigned"} — ${shift.site_name}`;
    const body = `Dear ${guard.full_name},\n\nYou have been ${type === "updated" ? "updated on a" : "assigned a new"} shift:\n\nSite: ${shift.site_name}\nDate: ${new Date(shift.start_time).toLocaleDateString("en-ZA")}\nTime: ${new Date(shift.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${new Date(shift.end_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}\n${shift.notes ? `Notes: ${shift.notes}` : ""}\n\nPlease log in to the SecureGuard app to review and acknowledge your shift.\n\nThank you.`;
    await base44.integrations.Core.SendEmail({ to: guard.email, subject, body }).catch(() => {});
  }

  // 3. In-app notification for guard
  await base44.entities.Notification.create({
    recipient_id: guard.id,
    recipient_name: guard.full_name,
    type: "shift_reminder",
    priority: "high",
    title: `Shift ${type === "updated" ? "Updated" : "Assigned"} — ${shift.site_name}`,
    message: `You have a shift on ${new Date(shift.start_time).toLocaleDateString("en-ZA")} at ${shift.site_name}. Please review and acknowledge in the app.`,
    read: false,
    related_entity: "shift",
    related_id: shift.id,
  }).catch(() => {});
}