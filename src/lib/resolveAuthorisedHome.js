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
import { PAGE_MODULE_MAP } from "@/lib/moduleMapping";
import { isModuleEnabled } from "@/hooks/useModuleEntitlements";
import { isPlatformAdminUser } from "@/lib/platformAdmin";

// Ordered safe fallbacks per role — CORE/utility pages that never require a
// commercial module. Profile is always last because every role can reach it.
const ROLE_FALLBACK_PAGES = {
  guard: ["GuardShift", "Profile"],
  dispatcher: ["Profile"],
  admin: ["Profile"],
  resident: ["ResidentDashboard", "Profile"],
  estate_manager: ["Profile"],
  vendor: ["VendorPortal", "Profile"],
  client: ["ClientDashboard", "Profile"],
  customer_admin: ["ClientDashboard", "Profile"],
  platform_admin: ["TenantSetup", "ControlRoom", "Profile"],
  reseller_admin: ["ResellerPortal", "Profile"],
  practice_admin: ["MedicalDashboard", "Profile"],
  therapist: ["MedicalDashboard", "Profile"],
  reception: ["MedicalDashboard", "Profile"],
  employer_user: ["EmployerPortal", "Profile"],
};

function isPageAccessible(user, pageKey, entitlements, platformAdmin) {
  const allowed = ROLE_PAGES[user.role_type];
  if (!allowed || !allowed.has(pageKey)) return false;
  const moduleKey = PAGE_MODULE_MAP[pageKey];
  // PLATFORM_ADMIN_ONLY pages are only for platform admins
  if (moduleKey === "PLATFORM_ADMIN_ONLY") return platformAdmin;
  // CORE pages (no module) are always accessible per role
  if (!moduleKey) return true;
  // Commercial module pages require an entitlement (or platform admin)
  return platformAdmin || isModuleEnabled(entitlements, moduleKey, false);
}

export function resolveAuthorisedHome(user, entitlements = []) {
  if (!user) return null;
  const platformAdmin = isPlatformAdminUser(user);
  const roleHome = ROLE_HOME[user.role_type];

  // Platform admin: role home always accessible
  if (platformAdmin && roleHome) return createPageUrl(roleHome);

  const check = (pageKey) => isPageAccessible(user, pageKey, entitlements, platformAdmin);

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