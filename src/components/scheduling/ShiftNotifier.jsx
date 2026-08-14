/**
 * ShiftNotifier
 * Called after a shift is created/updated.
 * Sends WhatsApp directly to the guard's phone + branded email + in-app notification.
 * Falls back gracefully if any step fails.
 */
import { base44 } from "@/api/base44Client";
import { guardShiftAssignedMessage, buildWhatsAppLink } from "@/lib/whatsapp";

const COMPANY_LOGO = "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png";
const BRAND_COLOR = "#C41E3A";
const BRAND_SECONDARY = "#1a1a1a";

/**
 * Notify a guard about their new/updated shift.
 * @param {object} shift - created shift record
 * @param {object} guard - guard User record (must have .phone or .whatsapp and .email)
 * @param {"assigned"|"updated"} type
 */
export async function notifyGuardShift(shift, guard, type = "assigned") {
  if (!guard) return;

  // full_name is the platform-managed, read-only field (often just the email
  // local-part, e.g. "sales"). display_name is the editable, human name set in
  // User Management — prefer it everywhere a person's name is shown.
  const guardName = guard.display_name || guard.full_name || "Guard";
  const isUpdated = type === "updated";

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

  // 2. Email guard — fully branded with a login link to sign off / acknowledge.
  if (guard.email) {
    const subject = `[SecureGuard] Shift ${isUpdated ? "Updated" : "Assigned"} — ${shift.site_name}`;
    const loginUrl = `${window.location.origin}/GuardMyShifts`;
    const emailBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:200px;height:auto;margin-bottom:20px;border-radius:10px;"/>
    <h1 style="color:white;margin:0;font-size:26px;font-weight:bold;">📅 SHIFT ${isUpdated ? "UPDATED" : "ASSIGNED"}</h1>
    <p style="color:rgba(255,255,255,0.95);margin:10px 0 0;font-size:15px;">${isUpdated ? "Your shift details have changed" : "Action Required — Please Acknowledge"}</p>
  </div>

  <div style="padding:30px;background:#f8f9fa;border-bottom:3px solid ${BRAND_COLOR};">
    <h2 style="color:#0c4a6e;margin:0 0 12px;font-size:20px;">Hello ${guardName},</h2>
    <p style="color:#64748b;margin:0 0 18px;font-size:14px;">You have been ${isUpdated ? "updated on a" : "assigned a new"} shift. Please review the details below and acknowledge your shift in the SecureGuard app.</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f1f5f9;">
        <td style="padding:12px;color:#64748b;font-weight:bold;width:30%;">Site</td>
        <td style="padding:12px;color:#0f172a;">${shift.site_name || "—"}</td>
      </tr>
      <tr>
        <td style="padding:12px;color:#64748b;font-weight:bold;">Date</td>
        <td style="padding:12px;color:#0f172a;">${new Date(shift.start_time).toLocaleDateString("en-ZA")}</td>
      </tr>
      <tr style="background:#f1f5f9;">
        <td style="padding:12px;color:#64748b;font-weight:bold;">Time</td>
        <td style="padding:12px;color:#0f172a;">${new Date(shift.start_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${new Date(shift.end_time).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}</td>
      </tr>
      ${shift.notes ? `<tr><td style="padding:12px;color:#64748b;font-weight:bold;">Notes</td><td style="padding:12px;color:#0f172a;">${shift.notes}</td></tr>` : ""}
    </table>
  </div>

  <div style="padding:30px;text-align:center;">
    <a href="${loginUrl}" style="display:inline-block;background:${BRAND_COLOR};color:white;padding:15px 40px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold;">Login to Acknowledge Shift</a>
    <p style="color:#94a3b8;margin:15px 0 0;font-size:12px;">Or copy this link: ${loginUrl}</p>
  </div>

  <div style="background:${BRAND_SECONDARY};padding:25px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:15px;opacity:0.8;"/>
    <p style="color:#94a3b8;margin:0 0 10px;font-size:13px;">Automated shift notification from Unified Security Solutions</p>
    <p style="color:${BRAND_COLOR};margin:10px 0 0;font-size:11px;font-weight:bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
  </div>
</div></body></html>`;
    await base44.integrations.Core.SendEmail({ from_name: "Unified Security Solutions — Scheduling", to: guard.email, subject, body: emailBody }).catch(() => {});
  }

  // 3. In-app notification for guard
  await base44.entities.Notification.create({
    recipient_id: guard.id,
    recipient_name: guardName,
    type: "shift_reminder",
    priority: "high",
    title: `Shift ${isUpdated ? "Updated" : "Assigned"} — ${shift.site_name}`,
    message: `You have a shift on ${new Date(shift.start_time).toLocaleDateString("en-ZA")} at ${shift.site_name}. Please review and acknowledge in the app.`,
    read: false,
    related_entity: "shift",
    related_id: shift.id,
  }).catch(() => {});
}