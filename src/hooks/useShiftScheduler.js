import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Customer-level Shift Scheduler mode (server-resolved).
 *
 * Shares the getGuardLandingConfig query cache (same key, 10-min staleness)
 * so guard shells and admin navigation read ONE cached server resolution.
 * getGuardLandingConfig returns shift_scheduler_enabled resolved SERVER-SIDE
 * from the caller's Customer record — the session token never has to carry
 * custom user fields, so guards and tenant admins both get the truth.
 *
 * DEFAULT ON: an unresolved/failed read keeps the scheduled flow (existing
 * customers without a saved setting are Scheduler ON) — the flag can only
 * turn navigation OFF when the server explicitly resolved `false`.
 */
export function useShiftScheduler(user) {
  const { data } = useQuery({
    queryKey: ["guard_landing", user?.customer_id],
    queryFn: async () => {
      const res = await base44.functions.invoke("getGuardLandingConfig", {});
      return res?.data || res;
    },
    enabled: !!user && !!user.customer_id,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });
  return data?.shift_scheduler_enabled !== false;
}