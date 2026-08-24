/**
 * Explicit Platform Admin authority — the ONLY safe way to decide whether a
 * user is a Platform Admin (sees every tenant, bypasses module entitlements).
 *
 * PRODUCTION RULE — never infer Platform Admin from a missing tenant
 * assignment. A historical Base44 `role === "admin"` user who has not yet
 * received a customer_id/reseller_id is NOT automatically a Platform Admin.
 *
 * Canonical authority is determined by EITHER:
 *   1. An explicit `role_type === "platform_admin"` on the user, OR
 *   2. An explicit `admin_level === "platform"` on the user.
 *
 * `admin_level` is the dedicated immutable capability field on the User entity
 * ("platform" | "reseller" | "customer" | null) and is the strongest signal.
 *
 * Base44's built-in `role === "admin"` may still be required for platform
 * mechanics, but it does NOT grant application-wide Platform Admin authority.
 */
export function isPlatformAdminUser(user) {
  if (!user) return false;
  if (user.role_type === "platform_admin") return true;
  if (user.admin_level === "platform") return true;
  return false;
}

/**
 * Reseller admin scope — sees their own reseller's customers only.
 */
export function isResellerAdminUser(user) {
  if (!user) return false;
  if (user.role_type === "reseller_admin") return true;
  if (user.admin_level === "reseller") return true;
  return false;
}

/**
 * Customer admin scope — sees their own tenant only.
 */
export function isCustomerAdminUser(user) {
  if (!user) return false;
  if (user.admin_level === "customer") return true;
  const customerAdminRoles = ["estate_manager", "practice_admin"];
  return customerAdminRoles.includes(user.role_type);
}