import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useBranding } from "@/hooks/useBranding";
import { resolveBrand } from "@/lib/branding";
import { vl360Invoke, vl360Key, getVl360Customer, setVl360Customer, clearVl360Cache } from "@/lib/vl360Api";

/**
 * useVL360 — the VoiceLink 360 session context for one screen: the caller's
 * server-resolved profile/role, authorised sites, active duty session and
 * management flags (all enforced server-side by the vl360Access gateway —
 * never from browser-supplied ids).
 *
 * ADMIN CUSTOMER SELECTION: platform/reseller administrators without their
 * own customer scope operate the module FOR a customer they select; the
 * selected id is attached to every invoke and re-validated server-side.
 * selectCustomer/clearCustomer clear the whole ["vl360"] query cache first so
 * no data from a previous customer can be served under the new one.
 */
export function useVL360() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: branding } = useBranding(user?.customer_id, user?.reseller_id);
  const brand = resolveBrand(branding);
  // Re-render tick: changing the stored selection must switch the query key so
  // React Query refetches under the new customer instead of serving the old.
  const [selectionTick, setSelectionTick] = useState(0);

  const q = useQuery({
    queryKey: vl360Key(["bootstrap", user?.id, selectionTick]),
    queryFn: async () => {
      const payload = { action: "bootstrap" };
      const selected = getVl360Customer();
      if (selected) payload.customer_id = selected;
      const d = await vl360Invoke(payload);
      if (d?.error) {
        const err = new Error(d.error);
        err.code = d.code || null;
        err.status = null;
        throw err;
      }
      return d;
    },
    enabled: !!user,
    retry: 1,
    staleTime: 30 * 1000,
  });

  const selectCustomer = (customerId) => {
    setVl360Customer(customerId);
    clearVl360Cache(queryClient);
    setSelectionTick((t) => t + 1);
  };
  const clearCustomer = () => selectCustomer(null);

  const refresh = () => q.refetch();
  return { user, brand, ...q, refresh, selectCustomer, clearCustomer };
}

export function useInvalidateVL360() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["vl360"] });
  };
}