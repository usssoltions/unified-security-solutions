/**
 * Server-side module→role registry — the single source of truth for which
 * role_types may be assigned to users of a customer, based on the commercial
 * modules that customer has enabled (ModuleEntitlement).
 *
 * MIRRORED in src/lib/roleCatalog.js for the frontend (invite/edit role
 * pickers). The two files MUST be kept in sync: add a module here and its
 * permitted roles are enforced server-side (inviteTenantUser) and offered in
 * the UI simultaneously.
 *
 * Rules:
 *  - "customer_admin" is ALWAYS allowed: it represents administrative access
 *    to the customer's enabled modules.
 *  - A module's operational roles are only assignable while that module is
 *    enabled + active for the customer (fail closed: no entitlement record =
 *    role not assignable).
 *  - "platform_admin" / "reseller_admin" are NEVER module roles:
 *    platform_admin is not assignable through this path at all;
 *    reseller_admin is platform-admin-only and validated separately.
 */
export const MODULE_ROLE_ACCESS: Record<string, string[]> = {
  COMPLETE_SECURITY: ["admin", "dispatcher", "guard"],
  OPERATIONS: ["admin", "dispatcher", "guard"],
  PATROL: ["dispatcher", "guard"],
  ACCESS: ["estate_manager", "guard", "reception"],
  ESTATE: ["estate_manager", "resident", "vendor"],
  OCCUPATIONAL_THERAPY: ["practice_admin", "therapist", "reception"],
  ATTENDANCE_REGISTER: ["attendance_staff"],
  // Support modules with no user roles of their own:
  CALLING: [],
  REPORTING_CORE: [],
  NOTIFICATION_CORE: [],
  MESSAGING: [],
  BARKODER_CORE: [],
};

export const ALWAYS_ALLOWED_ROLES: string[] = ["customer_admin"];
export const PLATFORM_PROTECTED_ROLES: string[] = ["platform_admin"];

/**
 * The full set of role_types that may be assigned to a user of a customer
 * whose enabled module keys are `enabledModuleKeys`. Always includes
 * customer_admin. Duplicates removed.
 */
export function getAllowedRolesForModules(enabledModuleKeys: string[] = []): Set<string> {
  const allowed = new Set<string>(ALWAYS_ALLOWED_ROLES);
  for (const key of enabledModuleKeys || []) {
    for (const role of MODULE_ROLE_ACCESS[key] || []) {
      allowed.add(role);
    }
  }
  return allowed;
}