/**
 * Deterministic authorised-home resolver.
 *
 * Solves the blank-dashboard loop: when a user's role home requires a commercial
 * module the tenant is not licensed for, ProtectedPage must NOT redirect back
 * to the same page. This resolver finds the FIRST page the user is actually
 * authorised to access — role home first, then role fallback pages, then any
 * role-allowed page. If nothing is accessible, returns null (caller renders the
 * SetupRequired controlled page instead of a blank body).
 *
 * Rules:
 *   - Platform Admins always reach their role home.
 *   - Every other user: role home must pass the module-entitlement check.
 *   - CORE pages (not in PAGE_MODULE_MAP) are always accessible per role.
 *   - Profile is the universal safe fallback for authenticated users.
 */
import { createPageUrl } from "@/utils";
import { ROLE_HOME, ROLE_PAGES } from "@/lib/permissions";
import { isPageModuleEnabled } from "@/lib/moduleMapping";
import { isPlatformAdminUser } from "@/lib/platformAdmin";

// Ordered safe fallbacks per role — CORE/utility pages that never require a
// commercial module. Profile is always last because every role can reach it.
const ROLE_FALLBACK_PAGES = {
  guard: ["GuardShift", "AccessControl", "Profile"],
  dispatcher: ["Profile"],
  // Legacy tenant "admin" (Customer Admin operations): when the role home
  // (ControlRoom, OPERATIONS) is unlicensed, the licensed standalone Task
  // Scheduling module is the legitimate commercial landing before Profile.
  admin: ["ScheduledTasks", "Profile"],
  resident: ["ResidentDashboard", "Profile"],
  estate_manager: ["Profile"],
  vendor: ["VendorPortal", "Profile"],
  client: ["ClientDashboard", "Profile"],
  // Attendance-first: an attendance-only Customer Administrator lands on the
  // Attendance Register dashboard (their role home, ClientDashboard, requires
  // the REPORTING_CORE module, which attendance-only customers lack).
  customer_admin: ["AttendanceDashboard", "ClientDashboard", "Profile"],
  platform_admin: ["TenantSetup", "ControlRoom", "Profile"],
  reseller_admin: ["ResellerPortal", "Profile"],
  practice_admin: ["MedicalDashboard", "Profile"],
  therapist: ["MedicalDashboard", "Profile"],
  reception: ["MedicalDashboard", "Profile"],
  employer_user: ["EmployerPortal", "Profile"],
  attendance_staff: ["AttendanceDashboard", "Profile"],
  control_room_operator: ["ScheduledTasks", "Profile"],
};

function isPageAccessible(user, pageKey, entitlements, platformAdmin) {
  const allowed = ROLE_PAGES[user.role_type];
  if (!allowed || !allowed.has(pageKey)) return false;
  // Module gate handles CORE pages, PLATFORM_ADMIN_ONLY pages and the
  // single-key-or-array PAGE_MODULE_MAP values uniformly.
  return platformAdmin || isPageModuleEnabled(entitlements, pageKey, false);
}

export function resolveAuthorisedHome(user, entitlements = []) {
  if (!user) return null;
  const platformAdmin = isPlatformAdminUser(user);
  const roleHome = ROLE_HOME[user.role_type];

  // Platform admin: role home always accessible
  if (platformAdmin && roleHome) return createPageUrl(roleHome);

  const check = (pageKey) => isPageAccessible(user, pageKey, entitlements, platformAdmin);

  // TASK-ONLY GUARD LANDING — role does not equal commercial entitlement.
  // A guard whose customer licenses TASK_SCHEDULING but NO security operations
  // module must NOT land on My Shift: GuardShift is a CORE page, so the module
  // check alone would never stop it. Their operational home is My Tasks.
  if (user.role_type === "guard") {
    const entActive = (e) => e.enabled && (!e.status || e.status === "active");
    const hasTasks = entitlements.some((e) => e.module_key === "TASK_SCHEDULING" && entActive(e));
    const hasSecurity = entitlements.some(
      (e) => ["OPERATIONS", "COMPLETE_SECURITY"].indexOf(e.module_key) !== -1 && entActive(e)
    );
    if (hasTasks && !hasSecurity && ROLE_PAGES.guard && ROLE_PAGES.guard.has("ScheduledTasks")) {
      return createPageUrl("ScheduledTasks");
    }
    // ACCESS-ONLY GUARD LANDING — a guard whose customer licenses ONLY the
    // ACCESS module (no OPERATIONS / COMPLETE_SECURITY suite, no Task
    // Scheduling) lands directly on the existing Access Control page: the
    // page is role-permitted and module-entitled, and it has no shift or
    // clock-in requirement. Strictly fail-closed.
    const hasAccess = entitlements.some((e) => e.module_key === "ACCESS" && entActive(e));
    if (hasAccess && !hasSecurity && ROLE_PAGES.guard && ROLE_PAGES.guard.has("AccessControl")) {
      return createPageUrl("AccessControl");
    }
  }

  // 1. Role home
  if (roleHome && check(roleHome)) return createPageUrl(roleHome);

  // 2. Ordered role fallbacks
  const fallbacks = ROLE_FALLBACK_PAGES[user.role_type] || [];
  for (const pageKey of fallbacks) {
    if (check(pageKey)) return createPageUrl(pageKey);
  }

  // 3. Any role-allowed page
  const allowed = ROLE_PAGES[user.role_type];
  if (allowed) {
    for (const pageKey of allowed) {
      if (check(pageKey)) return createPageUrl(pageKey);
    }
  }

  // 4. Profile is the universal last resort for authenticated users
  if (allowed && allowed.has("Profile")) return createPageUrl("Profile");

  return null;
}

/**
 * Returns true when a user has NO accessible commercial/dashboard page and must
 * see the SetupRequired controlled page. Use this to decide whether to render
 * SetupRequired instead of redirecting into a loop.
 */
export function needsSetupRequired(user, entitlements = []) {
  if (!user) return false;
  if (isPlatformAdminUser(user)) return false;
  return resolveAuthorisedHome(user, entitlements) === null;
}