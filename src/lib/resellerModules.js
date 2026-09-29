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
  { key: "TASK_SCHEDULING",        label: "Task Scheduling",          description: "Standalone commercial task management: task lists, scheduling, assignment and reassignment, priorities and deadlines, recurring tasks, evidence, dual sign-offs, rejection/reopen and late-reason workflows, archive/restore, task reminders, overdue alerts and task-specific completion/deadline reports — with its OWN notifications (in-app, native push, email, Telegram) built in. Requires no other module." },
  { key: "PATROL",                 label: "Patrol",                  description: "Patrol dashboard, analytics, checklists, route guidance." },
  { key: "ACCESS",                 label: "Access Control",         description: "Visitor access, QR scanning, access history, blacklist." },
  { key: "CALLING",                label: "Calling",                 description: "Contacts, call history, call recordings." },
  { key: "ESTATE",                 label: "Estate Management",     description: "Residents, venues, vendors, properties, voting." },
  { key: "OCCUPATIONAL_THERAPY",   label: "Occupational Therapy",   description: "Medical practice: patients, appointments, sessions, reports." },
  { key: "REPORTING_CORE",         label: "Reporting & Analytics",  description: "Platform-wide reports, analytics, data hub, payroll and AI reports (normal task completion/deadline reporting is included in Task Scheduling itself)." },
  { key: "NOTIFICATION_CORE",      label: "Notification Engine",     description: "Advanced cross-module notification routing, preferences and escalation management. Not required for Task Scheduling — task notifications are built into Task Scheduling." },
  { key: "MESSAGING",              label: "Messaging",              description: "In-app chat and messaging." },
  { key: "BARKODER_CORE",          label: "SecureScan Engine",       description: "Barcode/QR document scanning core." },
  { key: "ATTENDANCE_REGISTER",    label: "Attendance Register",     description: "Digital attendance register: worker/patient check-in via SecureScan, e-signatures, official PDF register and Excel export." },
];

/** Map module_key -> {label, description} for quick lookup. */
export const RESELLER_MODULE_MAP = Object.fromEntries(
  RESELLER_MODULES.map((m) => [m.key, m])
);

/** Labels for a list of module keys. */
export function moduleLabels(keys = []) {
  return (keys || []).map((k) => RESELLER_MODULE_MAP[k]?.label || k);
}

/* ── Central friendly-name resolver ─────────────────────────────────────
 * The SINGLE source of truth for displaying a module on ANY customer-facing
 * or administrator-facing surface. Internal entitlement keys (COMPLETE_SECURITY,
 * BARKODER_CORE, REPORTING_CORE, NOTIFICATION_CORE, ...) are for logic and
 * database use only and must NEVER be rendered raw. Use these helpers
 * everywhere a module key is displayed.
 */
export function getModuleDisplayName(key) {
  return (key && RESELLER_MODULE_MAP[key]?.label) || key || "";
}

export function getModuleDescription(key) {
  return (key && RESELLER_MODULE_MAP[key]?.description) || "";
}