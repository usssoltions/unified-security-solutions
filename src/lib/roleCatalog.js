/**
 * Module-aware role catalog.
 *
 * The platform serves multiple industry verticals (Security, Estate, Medical,
 * Attendance), each with its own role set. `getRolesForTenant(customerType)`
 * serves the legacy User Management screens; the NEW module-scoped registry
 * below (`MODULE_ROLE_ACCESS` / `getInviteRolesForCustomer`) is the canonical
 * source for user INVITATION / assignment flows: the role options shown to an
 * admin depend on the modules ENABLED for the selected customer, not on a
 * hard-coded list.
 *
 * MODULE_ROLE_ACCESS is MIRRORED server-side in base44/shared/tenantRoles.ts,
 * which inviteTenantUser enforces authoritatively (fail closed). The two files
 * MUST be kept in sync.
 */

export const SECURITY_ROLES = [
  { value: "admin", label: "Admin", color: "purple" },
  { value: "dispatcher", label: "Dispatcher / Supervisor", color: "sky" },
  { value: "guard", label: "Security Guard", color: "emerald" },
  { value: "client", label: "Client", color: "amber" },
  { value: "estate_manager", label: "Estate Manager", color: "teal" },
  { value: "resident", label: "Resident", color: "indigo" },
  { value: "vendor", label: "Vendor", color: "orange" },
];

export const MEDICAL_ROLES = [
  { value: "practice_admin", label: "Practice Administrator", color: "purple" },
  { value: "therapist", label: "Therapist", color: "emerald" },
  { value: "reception", label: "Reception", color: "sky" },
  { value: "employer_user", label: "Employer Portal User", color: "amber" },
];

export const ROLE_DESCRIPTIONS = {
  admin: { label: "Admin", text: "Full system access", color: "purple" },
  dispatcher: { label: "Dispatcher/Supervisor", text: "Control room, shifts, operations", color: "purple" },
  guard: { label: "Security Guard", text: "Field operations, clock in/out, incidents", color: "emerald" },
  client: { label: "Client", text: "View reports and incidents for their sites", color: "amber" },
  estate_manager: { label: "Estate Manager", text: "Manage residents, venues, vendors, levies", color: "teal" },
  resident: { label: "Resident", text: "Visitors, bookings, orders, payments", color: "indigo" },
  vendor: { label: "Vendor", text: "Manage menu items and orders", color: "orange" },
  practice_admin: { label: "Practice Administrator", text: "Manage practice: patients, appointments, staff", color: "purple" },
  therapist: { label: "Therapist", text: "Run clinical sessions and generate reports", color: "emerald" },
  reception: { label: "Reception", text: "Check-in patients, book appointments", color: "sky" },
  employer_user: { label: "Employer Portal User", text: "Refer employees and view authorised reports", color: "amber" },
  attendance_staff: { label: "Attendance Staff", text: "Register worker/patient attendance: scanning, signatures, records", color: "sky" },
  customer_admin: { label: "Customer Administrator", text: "Administrative access to the customer's enabled modules", color: "purple" },
};

export const ATTENDANCE_ROLES = [
  { value: "attendance_staff", label: "Attendance Staff", color: "sky" },
  { value: "admin", label: "Admin", color: "purple" },
];

/* ── Module → role registry (invite/assign flows) ────────────────────────
 * Mirrors base44/shared/tenantRoles.ts. Keys are the commercial module keys
 * (see src/lib/resellerModules.js). Order of MODULE_ROLE_ORDER controls the
 * display order of roles in pickers.
 */
export const MODULE_ROLE_ACCESS = {
  COMPLETE_SECURITY: ["admin", "dispatcher", "guard"],
  OPERATIONS: ["admin", "dispatcher", "guard"],
  PATROL: ["dispatcher", "guard"],
  ACCESS: ["estate_manager", "guard", "reception"],
  ESTATE: ["estate_manager", "resident", "vendor"],
  OCCUPATIONAL_THERAPY: ["practice_admin", "therapist", "reception"],
  ATTENDANCE_REGISTER: ["attendance_staff"],
  CALLING: [],
  REPORTING_CORE: [],
  NOTIFICATION_CORE: [],
  MESSAGING: [],
  BARKODER_CORE: [],
};

export const MODULE_ROLE_ORDER = [
  "COMPLETE_SECURITY", "OPERATIONS", "PATROL", "ACCESS", "ESTATE",
  "OCCUPATIONAL_THERAPY", "ATTENDANCE_REGISTER",
];

export const INVITE_ROLE_LABELS = {
  reseller_admin: "Reseller Administrator",
  customer_admin: "Customer Administrator",
  admin: "Customer Admin (operations)",
  dispatcher: "Dispatcher / Supervisor",
  guard: "Security Guard",
  estate_manager: "Estate Manager",
  resident: "Resident",
  vendor: "Vendor",
  practice_admin: "Practice Administrator",
  therapist: "Therapist",
  reception: "Reception",
  attendance_staff: "Attendance Staff",
};

/**
 * Role options for inviting a user to a customer, derived from the modules
 * ENABLED for that customer. Union across enabled modules, deduplicated,
 * ordered. "customer_admin" is always present (administrative access to the
 * customer's enabled modules). "platform_admin" is never included.
 * "reseller_admin" only when allowResellerAdmin (platform-admin context).
 */
export function getInviteRolesForCustomer(enabledModuleKeys = [], { allowResellerAdmin = false } = {}) {
  const seen = new Set();
  const roles = [];
  const push = (value) => {
    if (!value || value === "platform_admin" || seen.has(value)) return;
    seen.add(value);
    roles.push({ value, label: INVITE_ROLE_LABELS[value] || value });
  };
  if (allowResellerAdmin) push("reseller_admin");
  push("customer_admin");
  for (const key of MODULE_ROLE_ORDER) {
    if (!(enabledModuleKeys || []).includes(key)) continue;
    for (const r of MODULE_ROLE_ACCESS[key] || []) push(r);
  }
  return roles;
}

/** True when the customer's only enabled operational module is the
 *  Attendance Register (SecureScan / BARKODER_CORE is supporting
 *  infrastructure that introduces NO user roles). */
export function isAttendanceOnlyCustomer(enabledModuleKeys = []) {
  const operational = MODULE_ROLE_ORDER.filter((k) => (enabledModuleKeys || []).includes(k));
  return operational.length > 0 && operational.every((k) => k === "ATTENDANCE_REGISTER");
}

/**
 * Role options for the tenant User Management screens (role filters,
 * counters, Add User / Edit User role dropdowns). Derived from the
 * customer's ENABLED MODULE ENTITLEMENTS — never from a generic
 * customer_type. An Attendance Register / SecureScan-only customer offers
 * exactly Customer Administrator and Attendance Staff — never medical,
 * security, estate or platform roles. Other module mixes keep the legacy
 * vertical role set.
 */
export function getTenantUserManagementRoles(enabledModuleKeys = [], customerType) {
  if (isAttendanceOnlyCustomer(enabledModuleKeys)) {
    return [
      { value: "customer_admin", label: "Customer Administrator", color: "purple" },
      { value: "attendance_staff", label: "Attendance Staff", color: "sky" },
    ];
  }
  return [
    { value: "customer_admin", label: "Customer Administrator", color: "purple" },
    ...getRolesForTenant(customerType, enabledModuleKeys),
  ];
}

/**
 * Legacy accessor for tenant-scoped User Management screens (existing users).
 * Kept for backwards compatibility.
 */
export function getRolesForTenant(customerType, enabledModuleKeys = []) {
  let roles;
  if (customerType === "medical") roles = MEDICAL_ROLES;
  else if (customerType === "attendance") roles = ATTENDANCE_ROLES;
  else roles = SECURITY_ROLES;
  if (enabledModuleKeys.includes("ATTENDANCE_REGISTER") && !roles.some((r) => r.value === "attendance_staff")) {
    roles = [...roles, { value: "attendance_staff", label: "Attendance Staff", color: "sky" }];
  }
  return roles;
}

export function isMedicalRoleSet(roles) {
  return roles === MEDICAL_ROLES;
}

/* ── Customer-facing role display + module-aware descriptions ──────────
 * MIRRORED server-side in base44/shared/tenantRoles.ts (role registry) and
 * base44/shared/tenantBranding.ts (branded emails). Customer-facing wording
 * is derived from the customer's ENABLED modules — never generic security
 * terminology where module context is available.
 */
export const MODULE_LABELS = {
  ATTENDANCE_REGISTER: "Attendance Register",
  OCCUPATIONAL_THERAPY: "Occupational Therapy",
  ESTATE: "Estate Management",
  ACCESS: "Access Control",
  PATROL: "Patrol",
  OPERATIONS: "Operations",
  COMPLETE_SECURITY: "Security Operations",
};

export const MODULE_DESCRIPTIONS = {
  ATTENDANCE_REGISTER: "Manage attendance records, workers/patients, reports and authorised scanning functions.",
  OCCUPATIONAL_THERAPY: "Manage patients, appointments, clinical sessions and reports.",
  ESTATE: "Manage residents, venues, vendors and estate services.",
  ACCESS: "Manage visitor access, QR scanning and access history.",
  PATROL: "Manage patrols, checklists and route monitoring.",
  OPERATIONS: "Manage control room operations, incidents, shifts and sites.",
  COMPLETE_SECURITY: "Manage security operations, incidents, patrols and shifts.",
};

const OPERATIONAL_MODULE_ORDER = [
  "ATTENDANCE_REGISTER", "OCCUPATIONAL_THERAPY", "ESTATE",
  "ACCESS", "PATROL", "OPERATIONS", "COMPLETE_SECURITY",
];

/** Friendly display name for a role — never expose raw role keys. */
export function getRoleDisplay(roleValue) {
  return INVITE_ROLE_LABELS[roleValue] || (roleValue || "").replace(/_/g, " ");
}

/** Module-aware role description shown in invitation/onboarding UI. */
export function getRoleDescription(roleValue, enabledModuleKeys = []) {
  if (roleValue === "reseller_admin") {
    return "Administer the reseller organisation, its customers, licences and users.";
  }
  const descs = OPERATIONAL_MODULE_ORDER
    .filter((k) => (enabledModuleKeys || []).includes(k))
    .map((k) => MODULE_DESCRIPTIONS[k])
    .filter(Boolean);
  if (!descs.length) {
    return "Administrative access to the modules enabled for your organisation.";
  }
  if (roleValue === "customer_admin") return descs.join(" ");
  return descs[0];
}