/**
 * useTenantContext
 *
 * Canonical hook for reading the current user's tenant context (reseller_id,
 * customer_id) and safely injecting it into entity payloads.
 *
 * WHY THIS EXISTS
 * ---------------
 * Multi-tenant isolation relies on every tenant-scoped entity carrying the
 * correct `reseller_id` and `customer_id` at creation time. Before this hook,
 * each page read `user.reseller_id` / `user.customer_id` manually — which led
 * to inconsistent handling of:
 *   - platform admins (no tenant — must NOT inject a tenant id)
 *   - reseller admins (reseller_id set, customer_id null)
 *   - customer users (customer_id set, reseller_id inherited)
 *   - legacy users with no tenant assigned yet
 *
 * This hook centralizes that logic so create() calls can't accidentally leak
 * across tenants or insert null/empty tenant ids that bypass RLS filters.
 *
 * USAGE
 * -----
 *   const { tenantContext, withTenant, isPlatformAdmin, hasTenant } = useTenantContext();
 *
 *   // Inject tenant ids into a create payload:
 *   await base44.entities.Incident.create(withTenant({
 *     title, category, guard_id, site_id
 *   }));
 *
 *   // Conditional logic:
 *   if (!hasTenant) { return <NoTenantAssigned />; }
 */
import { useMemo } from "react";
import { useAuth } from "@/lib/AuthContext";

/**
 * Reads tenant context off a user object.
 * Platform admin = role admin AND no reseller_id AND no customer_id.
 * Reseller admin = has reseller_id, no customer_id.
 * Customer user = has customer_id (reseller_id may or may not be set).
 *
 * @param {object|null|undefined} user
 * @returns {{ reseller_id: string|null, customer_id: string|null, isPlatformAdmin: boolean, isResellerAdmin: boolean, hasTenant: boolean }}
 */
export function getTenantContextFromUser(user) {
  const reseller_id = user?.reseller_id || null;
  const customer_id = user?.customer_id || null;
  const isPlatformAdmin =
    user?.role === "admin" && !reseller_id && !customer_id;
  const isResellerAdmin =
    !!reseller_id && !customer_id && user?.role_type !== "customer_user";
  const hasTenant = !!reseller_id || !!customer_id;
  return { reseller_id, customer_id, isPlatformAdmin, isResellerAdmin, hasTenant };
}

export function useTenantContext() {
  const { user } = useAuth();

  const context = useMemo(() => {
    const base = getTenantContextFromUser(user);

    /**
     * Merges tenant ids into a payload object.
     *
     * - Only sets reseller_id / customer_id if they are non-empty.
     * - Does NOT overwrite values the caller already set explicitly (caller
     *   may be acting on behalf of a different tenant, e.g. platform admin
     *   creating a record inside a specific customer's scope).
     * - For platform admins with no tenant, injects nothing (the record will
     *   be unscoped — only platform admins can read unscoped records).
     */
    const withTenant = (payload = {}) => {
      const merged = { ...payload };
      if (base.reseller_id && merged.reseller_id === undefined) {
        merged.reseller_id = base.reseller_id;
      }
      if (base.customer_id && merged.customer_id === undefined) {
        merged.customer_id = base.customer_id;
      }
      return merged;
    };

    return {
      ...base,
      withTenant,
    };
  }, [user]);

  return context;
}

export default useTenantContext;