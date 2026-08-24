import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Fetches white-label branding for the user's tenant.
 * Priority: customer-specific > reseller-level > null (use defaults).
 */
export function useBranding(customerId, resellerId) {
  return useQuery({
    queryKey: ["branding", customerId, resellerId],
    queryFn: async () => {
      try {
        const all = await base44.entities.Branding.list();
        if (!all || all.length === 0) return null;

        // Customer-specific branding takes priority
        if (customerId) {
          const customerSpecific = all.find((b) => b.customer_id === customerId);
          if (customerSpecific) return customerSpecific;
        }

        // Fall back to reseller-level branding
        if (resellerId) {
          const resellerLevel = all.find(
            (b) => b.reseller_id === resellerId && !b.customer_id
          );
          if (resellerLevel) return resellerLevel;
        }

        return null;
      } catch (e) {
        console.error("Failed to load branding:", e);
        return null;
      }
    },
    enabled: !!customerId || !!resellerId,
    staleTime: 120000,
  });
}