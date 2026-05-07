/**
 * WhatsApp deep-link utilities — single source of truth.
 *
 * Contacts are stored in the WhatsAppContact entity (DB) for cross-device access.
 * localStorage is kept as a fallback cache.
 */

import { base44 } from "@/api/base44Client";

const STORAGE_KEY = "wa_admin_contacts";
const APP_URL = window.location.origin;

// ─── Contact management ────────────────────────────────────────────────────────

/** Returns cached contacts from localStorage */
export function getWhatsAppContacts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Load contacts from DB and cache locally */
export async function loadWhatsAppContacts() {
  try {
    const records = await base44.entities.WhatsAppContact.filter({ active: true });
    const contacts = records.map(r => ({ name: r.name, number: r.number, id: r.id }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    return contacts;
  } catch {
    return getWhatsAppContacts();
  }
}

/** Persist the full contacts array (legacy localStorage) */
export function saveWhatsAppContacts(contacts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

// ─── Link builders ─────────────────────────────────────────────────────────────

/**
 * Normalise a phone number to international digits only.
 * Defaults to South Africa (+27) for numbers starting with 0.
 */
export function normaliseNumber(rawNumber) {
  if (!rawNumber) return null;
  let digits = String(rawNumber).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "27" + digits.slice(1);
  return digits;
}

/** Build a single wa.me deep-link */
export function buildWhatsAppLink(rawNumber, message) {
  const digits = normaliseNumber(rawNumber);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Open WhatsApp for a single number immediately */
export function sendWhatsApp(rawNumber, message) {
  const link = buildWhatsAppLink(rawNumber, message);
  if (link) window.open(link, "_blank");
}

/**
 * Returns an array of { name, number, link } for all stored admin contacts.
 */
export function buildAdminLinks(message) {
  return getWhatsAppContacts()
    .filter(c => c.number)
    .map(c => ({
      name: c.name,
      number: c.number,
      link: buildWhatsAppLink(c.number, message),
    }));
}

/**
 * Build a deep-link that opens the app at a specific path.
 * Used in guard-facing messages so tapping opens the app.
 */
export function appDeepLink(path) {
  return `${APP_URL}/${path}`;
}

// ─── Admin notification helpers ────────────────────────────────────────────────

/**
 * Send in-app email to all admin users.
 * Falls back silently if email fails.
 */
export async function emailAdmins({ subject, body }) {
  try {
    const allUsers = await base44.entities.User.list();
    const admins = allUsers.filter(u =>
      ["admin", "dispatcher", "supervisor", "management"].includes(u.role_type) && u.email
    );
    for (const admin of admins) {
      await base44.integrations.Core.SendEmail({ to: admin.email, subject, body }).catch(() => {});
    }
  } catch (_) {}
}

/**
 * Create in-app notifications for all admins.
 */
export async function notifyAdmins({ type, title, message, relatedEntity, relatedId }) {
  try {
    const allUsers = await base44.entities.User.list();
    const admins = allUsers.filter(u =>
      ["admin", "dispatcher", "supervisor", "management"].includes(u.role_type)
    );
    for (const admin of admins) {
      await base44.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: type || "system",
        priority: "high",
        title,
        message,
        read: false,
        related_entity: relatedEntity || null,
        related_id: relatedId || null,
      }).catch(() => {});
    }
  } catch (_) {}
}

// ─── Pre-built message composers ──────────────────────────────────────────────

export function panicMessage({ guardName, siteName, lat, lng, notes }) {
  const mapsLink = lat && lng ? `\n📍 Navigate: https://maps.google.com/?q=${lat},${lng}` : "";
  return `🚨 *PANIC ALERT — IMMEDIATE RESPONSE REQUIRED*

Guard: ${guardName}
Site: ${siteName || "Unknown"}
Time: ${new Date().toLocaleString("en-ZA")}${mapsLink}
${notes ? `\nNotes: ${notes}` : ""}

⚡ Open SecureGuard App: ${appDeepLink("ControlRoom")}

Please respond IMMEDIATELY.`;
}

export function incidentMessage({ guardName, siteName, incidentType, summary, reportNumber, lat, lng }) {
  const mapsLink = lat && lng ? `\n📍 Location: https://maps.google.com/?q=${lat},${lng}` : "";
  return `🔴 *INCIDENT REPORT — ${(incidentType || "").toUpperCase()}*

Report #: ${reportNumber}
Guard: ${guardName}
Site: ${siteName || "Unknown"}
Time: ${new Date().toLocaleString("en-ZA")}${mapsLink}

Summary: ${(summary || "No summary provided.").substring(0, 300)}

📱 Review in app: ${appDeepLink("AdminIncidents")}`;
}

export function maintenanceMessage({ guardName, siteName, maintenanceType, details }) {
  return `🔧 *MAINTENANCE REQUEST*

Type: ${maintenanceType}
Guard: ${guardName}
Site: ${siteName || "Unknown"}
Time: ${new Date().toLocaleString("en-ZA")}

Details: ${(details || "").substring(0, 250)}

📱 Review in app: ${appDeepLink("AdminMaintenance")}`;
}

export function dispatchMessage({ alarmType, address, guardName, clientName, lat, lng }) {
  const mapsLink = lat && lng ? `\n📍 Navigate: https://maps.google.com/?q=${lat},${lng}` : "";
  return `🚨 *ALARM DISPATCH — ${(alarmType || "").replace(/_/g, " ").toUpperCase()}*

Responder: ${guardName}
Address: ${address}${clientName ? `\nClient: ${clientName}` : ""}
Dispatched: ${new Date().toLocaleString("en-ZA")}${mapsLink}

⚡ Open app to acknowledge & get directions: ${appDeepLink("GuardShift")}

Please acknowledge and proceed to location IMMEDIATELY.`;
}

/** Sent to the GUARD when a shift is assigned */
export function guardShiftAssignedMessage({ guardName, siteName, startTime, endTime, notes }) {
  return `📅 *SHIFT ASSIGNED — ${guardName}*

Site: ${siteName}
Date: ${new Date(startTime).toLocaleDateString("en-ZA")}
Time: ${new Date(startTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${new Date(endTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
${notes ? `Notes: ${notes}` : ""}

✅ *Please review, sign & confirm your shift in the SecureGuard app:*
${appDeepLink("GuardShift")}

Tap the "Respond" button next to your upcoming shift to Accept, Decline, or request a Revision.`;
}

/** Sent to admins when a new shift is created (schedule overview) */
export function shiftScheduleMessage({ guardName, siteName, startTime, endTime, notes }) {
  return `📅 *SHIFT SCHEDULED*

Guard: ${guardName}
Site: ${siteName}
Date: ${new Date(startTime).toLocaleDateString("en-ZA")}
Time: ${new Date(startTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${new Date(endTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
${notes ? `Notes: ${notes}` : ""}

Guard will receive a WhatsApp to confirm. View schedule: ${appDeepLink("Scheduling")}`;
}

/** Sent to guard 24h before shift */
export function shiftReminderMessage({ guardName, siteName, startTime }) {
  return `⏰ *SHIFT REMINDER — 24 HOURS*

Guard: ${guardName}
Site: ${siteName}
Shift starts: ${new Date(startTime).toLocaleString("en-ZA")}

Make sure you are rested, in uniform, and ready on time.

📱 View your shift details: ${appDeepLink("GuardShift")}`;
}

/** Sent to admins when guard acknowledges a shift */
export function shiftAckMessage({ guardName, siteName, startTime, status, notes }) {
  const emoji = status === "accepted" ? "✅" : status === "declined" ? "❌" : "🔄";
  const statusLabel = status === "revision_requested" ? "Revision Requested" : status.charAt(0).toUpperCase() + status.slice(1);
  return `${emoji} *SHIFT ${statusLabel.toUpperCase()} — ${guardName}*

Site: ${siteName}
Date: ${new Date(startTime).toLocaleDateString("en-ZA")}
Time: ${new Date(startTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
Status: ${statusLabel}
${notes ? `Message: ${notes}` : ""}
Acknowledged: ${new Date().toLocaleString("en-ZA")}

📱 View scheduling: ${appDeepLink("Scheduling")}`;
}

/** Sent to admins on start-of-shift report */
export function startOfShiftMessage({ guardName, siteName, shiftPost }) {
  return `🛡️ *START OF SHIFT REPORT*

Guard: ${guardName}
Site: ${siteName || "Unknown"}
Post: ${shiftPost || "N/A"}
Time: ${new Date().toLocaleString("en-ZA")}

Guard has clocked in and submitted start-of-shift report.

📱 Review in app: ${appDeepLink("ControlRoom")}`;
}

/** Sent directly to guard when an alarm response is assigned */
export function guardAlarmDispatchMessage({ alarmType, address, clientName, lat, lng }) {
  const mapsLink = lat && lng ? `\n📍 Navigate to scene: https://maps.google.com/?q=${lat},${lng}` : "";
  return `🚨 *ALARM RESPONSE ASSIGNED TO YOU*

Type: ${(alarmType || "").replace(/_/g, " ").toUpperCase()}
Address: ${address}${clientName ? `\nClient: ${clientName}` : ""}
Dispatched: ${new Date().toLocaleString("en-ZA")}${mapsLink}

⚡ Open app, acknowledge & follow map:
${appDeepLink("GuardShift")}

Respond IMMEDIATELY.`;
}

/** Sent to guard when an incident is assigned to them */
export function guardIncidentAssignedMessage({ guardName, incidentTitle, siteName, priority }) {
  return `🔴 *INCIDENT ASSIGNED — ${(priority || "").toUpperCase()} PRIORITY*

Guard: ${guardName}
Incident: ${incidentTitle}
Site: ${siteName}
Time: ${new Date().toLocaleString("en-ZA")}

📱 Open app to view details & respond:
${appDeepLink("GuardShift")}`;
}

/** Alert for real-time system alert (missed check-in, geofence, etc.) */
export function systemAlertMessage({ alertType, guardName, siteName, details }) {
  return `⚠️ *SYSTEM ALERT — ${(alertType || "").replace(/_/g, " ").toUpperCase()}*

Guard: ${guardName || "Unknown"}
Site: ${siteName || "Unknown"}
Time: ${new Date().toLocaleString("en-ZA")}
${details ? `\nDetails: ${details}` : ""}

📱 Review in app: ${appDeepLink("ControlRoom")}`;
}