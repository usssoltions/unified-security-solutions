import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useBranding } from "@/hooks/useBranding";
import { resolveBrand } from "@/lib/branding";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * useVL360 — the VoiceLink 360 session context for one screen: the caller's
 * server-resolved profile/role, authorised sites, active duty session and
 * management flags (all enforced server-side by the vl360Access gateway —
 * never from browser-supplied ids).
 */
export function useVL360() {
  const { user } = useAuth();
  const { data: branding } = useBranding(user?.customer_id, user?.reseller_id);
  const brand = resolveBrand(branding);
  const q = useQuery({
    queryKey: ["vl360_bootstrap", user?.id],
    queryFn: async () => {
      const d = await vl360Invoke({ action: "bootstrap" });
      return d;
    },
    enabled: !!user,
    retry: 1,
    staleTime: 30 * 1000,
  });
  const refresh = () => q.refetch();
  return { user, brand, ...q, refresh };
}

export function useInvalidateVL360() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["vl360_bootstrap"] });
    queryClient.invalidateQueries({ queryKey: ["vl360_personnel"] });
  };
}