/**
 * WhatsApp deep-link utilities.
 * All notification flows should use these helpers so that
 * the admin contact list is the single source of truth.
 */

const STORAGE_KEY = "wa_admin_contacts";

/** Returns array of { name, number } objects stored in localStorage */
export function getWhatsAppContacts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

/** Persist the full contacts array */
export function saveWhatsAppContacts(contacts) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
}

/**
 * Build a single wa.me deep-link for one number + message.
 * Strips all non-digit chars and adds country code if missing (defaults to 27 = South Africa).
 */
export function buildWhatsAppLink(rawNumber, message) {
  let digits = rawNumber.replace(/\D/g, "");
  // If starts with 0, replace with 27 (SA default)
  if (digits.startsWith("0")) digits = "27" + digits.slice(1);
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * Open WhatsApp for a single number immediately.
 */
export function sendWhatsApp(rawNumber, message) {
  window.open(buildWhatsAppLink(rawNumber, message), "_blank");
}

/**
 * Returns an array of { name, number, link } for all stored contacts
 * given a composed message — ready to render as buttons.
 */
export function buildAdminLinks(message) {
  return getWhatsAppContacts().map((c) => ({
    name: c.name,
    number: c.number,
    link: buildWhatsAppLink(c.number, message),
  }));
}

// ─── Pre-built message composers ──────────────────────────────────────────────

export function panicMessage({ guardName, siteName, lat, lng, notes }) {
  const mapsLink = lat && lng ? `\n📍 https://maps.google.com/?q=${lat},${lng}` : "";
  return `🚨 *PANIC ALERT — IMMEDIATE RESPONSE REQUIRED*

Guard: ${guardName}
Site: ${siteName || "Unknown"}
Time: ${new Date().toLocaleString("en-ZA")}${mapsLink}
${notes ? `\nNotes: ${notes}` : ""}

Please respond immediately.`;
}

export function incidentMessage({ guardName, siteName, incidentType, summary, reportNumber, lat, lng }) {
  const mapsLink = lat && lng ? `\n📍 https://maps.google.com/?q=${lat},${lng}` : "";
  return `🔴 *INCIDENT REPORT — ${(incidentType || "").toUpperCase()}*

Report #: ${reportNumber}
Guard: ${guardName}
Site: ${siteName || "Unknown"}
Time: ${new Date().toLocaleString("en-ZA")}${mapsLink}

Summary: ${summary || "No summary provided."}

Please review in the SecureGuard app.`;
}

export function maintenanceMessage({ guardName, siteName, maintenanceType, details }) {
  return `🔧 *MAINTENANCE REQUEST*

Type: ${maintenanceType}
Guard: ${guardName}
Site: ${siteName || "Unknown"}
Time: ${new Date().toLocaleString("en-ZA")}

Details: ${(details || "").substring(0, 300)}

Please review in the SecureGuard app.`;
}

export function dispatchMessage({ alarmType, address, guardName, clientName, lat, lng }) {
  const mapsLink = lat && lng ? `\n📍 Navigate: https://maps.google.com/?q=${lat},${lng}` : "";
  return `🚨 *ALARM DISPATCH — ${(alarmType || "").replace(/_/g, " ").toUpperCase()}*

Responder: ${guardName}
Address: ${address}${clientName ? `\nClient: ${clientName}` : ""}
Dispatched: ${new Date().toLocaleString("en-ZA")}${mapsLink}

Please acknowledge and proceed to location immediately.`;
}

export function shiftScheduleMessage({ guardName, siteName, startTime, endTime, notes }) {
  return `📅 *SHIFT SCHEDULE*

Guard: ${guardName}
Site: ${siteName}
Date: ${new Date(startTime).toLocaleDateString("en-ZA")}
Time: ${new Date(startTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })} – ${new Date(endTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
${notes ? `Notes: ${notes}` : ""}

Please reply to confirm receipt. You can accept or request changes via the SecureGuard app.`;
}

export function shiftAckMessage({ guardName, siteName, startTime, status, notes }) {
  const emoji = status === "accepted" ? "✅" : status === "declined" ? "❌" : "🔄";
  return `${emoji} *SHIFT ${status.toUpperCase()} — ${guardName}*

Site: ${siteName}
Date: ${new Date(startTime).toLocaleDateString("en-ZA")}
Time: ${new Date(startTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" })}
Status: ${status.charAt(0).toUpperCase() + status.slice(1)}
${notes ? `Message: ${notes}` : ""}
Acknowledged: ${new Date().toLocaleString("en-ZA")}`;
}

export function startOfShiftMessage({ guardName, siteName, shiftPost }) {
  return `🛡️ *START OF SHIFT REPORT*

Guard: ${guardName}
Site: ${siteName || "Unknown"}
Post: ${shiftPost || "N/A"}
Time: ${new Date().toLocaleString("en-ZA")}

Guard has clocked in and submitted start-of-shift report. Please review in SecureGuard.`;
}

export function shiftReminderMessage({ guardName, siteName, startTime }) {
  return `⏰ *SHIFT REMINDER — 24 HOURS*

Guard: ${guardName}
Site: ${siteName}
Shift starts: ${new Date(startTime).toLocaleString("en-ZA")}

Please ensure you are ready and confirm receipt.`;
}