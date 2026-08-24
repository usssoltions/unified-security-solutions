import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Fetches active module entitlements for a customer/tenant.
 * Used to gate navigation items and backend access by licensed modules.
 */
export function useModuleEntitlements(userId, customerId) {
  return useQuery({
    queryKey: ["moduleEntitlements", customerId],
    queryFn: async () => {
      if (!customerId) return [];
      try {
        const entitlements = await base44.entities.ModuleEntitlement.filter({
          customer_id: customerId,
          enabled: true,
        });
        return entitlements || [];
      } catch (e) {
        console.error("Failed to load module entitlements:", e);
        return [];
      }
    },
    enabled: !!customerId,
    staleTime: 60000,
  });
}

/**
 * Checks if a specific module is enabled for the user.
 *
 * PRODUCTION POLICY — FAIL CLOSED:
 *   - Platform Admins always have access to every module.
 *   - PLATFORM_ADMIN_ONLY modules are NEVER available to non-platform users.
 *   - For every other user: no explicit entitlement = no module access.
 *
 * This prevents unrelated commercial modules from leaking to users whose
 * tenant has not been set up or licensed.
 */
export function isModuleEnabled(entitlements, moduleKey, isPlatformAdmin = false) {
  if (isPlatformAdmin) return true;
  if (moduleKey === "PLATFORM_ADMIN_ONLY") return false;
  // Fail closed: no entitlements loaded/configured = no commercial module access
  if (!entitlements || entitlements.length === 0) return false;
  return entitlements.some(
    (e) => e.module_key === moduleKey && e.enabled && (!e.status || e.status === "active")
  );
}