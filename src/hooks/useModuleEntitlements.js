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
 * Admins always have access. If no entitlements are configured, all modules
 * are enabled (backward compatibility for existing tenants).
 */
export function isModuleEnabled(entitlements, moduleKey, isAdmin = false) {
  if (isAdmin) return true;
  if (!entitlements || entitlements.length === 0) return true;
  return entitlements.some(
    (e) => e.module_key === moduleKey && e.enabled && (!e.status || e.status === "active")
  );
}