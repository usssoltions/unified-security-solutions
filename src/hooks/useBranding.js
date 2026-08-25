import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Fetches white-label branding for the authenticated user's tenant.
 *
 * Resolution is performed server-side by the `getWhiteLabelBranding`
 * backend function, which derives the caller's reseller from their own
 * reseller_id (reseller users) or their customer's reseller_id (customer
 * users) and returns only public branding fields. A client cannot supply an
 * arbitrary reseller_id to read another reseller's branding.
 *
 * Returns null for platform admins (no tenant) → the app uses USS defaults.
 * Priority: reseller-level branding, inherited by all customers of that
 * reseller. Customer-specific branding is a future layer (not created here).
 */
export function useBranding(customerId, resellerId) {
  return useQuery({
    queryKey: ["branding", customerId, resellerId],
    queryFn: async () => {
      try {
        const res = await base44.functions.invoke("getWhiteLabelBranding", {});
        return res?.data?.branding ?? res?.branding ?? null;
      } catch (e) {
        console.error("Failed to load branding:", e);
        return null;
      }
    },
    enabled: !!customerId || !!resellerId,
    staleTime: 120000,
  });
}