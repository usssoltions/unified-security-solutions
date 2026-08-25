/**
 * Reseller module registry — the single source of truth for the commercial
 * modules USS can licence to a reseller.
 *
 * Add a new module here (key + label + description) and it becomes available
 * to grant on every reseller's "Licences & Modules" tab. ResellerEntitlement
 * stores module_key as a free string (no enum), so NO schema migration is
 * required to support future modules — only an addition to this list.
 *
 * Keep keys stable; they are persisted on ResellerEntitlement + ModuleEntitlement
 * records and referenced by PAGE_MODULE_MAP (src/lib/moduleMapping.js).
 */
export const RESELLER_MODULES = [
  { key: "COMPLETE_SECURITY",      label: "Complete Security Suite", description: "Full security operations bundle (incidents, panic, scheduling, patrols)." },
  { key: "OPERATIONS",             label: "Operations",              description: "Control room, incidents, maintenance, panic, scheduling, sites." },
  { key: "PATROL",                 label: "Patrol",                  description: "Patrol dashboard, analytics, checklists, route guidance." },
  { key: "ACCESS",                 label: "Access Control",         description: "Visitor access, QR scanning, access history, blacklist." },
  { key: "CALLING",                label: "Calling",                 description: "Contacts, call history, call recordings." },
  { key: "ESTATE",                 label: "Estate Management",     description: "Residents, venues, vendors, levy, properties, voting." },
  { key: "OCCUPATIONAL_THERAPY",   label: "Occupational Therapy",   description: "Medical practice: patients, appointments, sessions, reports." },
  { key: "REPORTING_CORE",         label: "Reporting & Analytics",  description: "Reports, analytics, data hub, payroll, AI reports." },
  { key: "NOTIFICATION_CORE",      label: "Notification Engine",     description: "Multi-channel notifications (email, push, Telegram, in-app)." },
  { key: "MESSAGING",              label: "Messaging",              description: "In-app chat and messaging." },
  { key: "BARKODER_CORE",          label: "SecureScan Engine",       description: "Barcode/QR document scanning core." },
];

/** Map module_key -> {label, description} for quick lookup. */
export const RESELLER_MODULE_MAP = Object.fromEntries(
  RESELLER_MODULES.map((m) => [m.key, m])
);

/** Labels for a list of module keys. */
export function moduleLabels(keys = []) {
  return (keys || []).map((k) => RESELLER_MODULE_MAP[k]?.label || k);
}