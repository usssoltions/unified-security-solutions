import React from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { useModuleEntitlements } from "@/hooks/useModuleEntitlements";
import { resolveAuthorisedHome } from "@/lib/resolveAuthorisedHome";
import { ROLE_PAGES } from "@/lib/permissions";
import { isPageModuleEnabled } from "@/lib/moduleMapping";
import { createPageUrl } from "@/utils";
import SetupRequired from "@/components/SetupRequired";
import { Loader2 } from "lucide-react";

/**
 * Redirects the authenticated user to their role-appropriate home page.
 * Used as the root "/" route element so every role lands on the correct
 * dashboard after login.
 *
 * Uses the deterministic authorised-home resolver: if the user's role home
 * requires an unlicensed commercial module, they are sent to the first page
 * they ARE authorised for instead. If nothing is accessible, the SetupRequired
 * controlled page is rendered (never a blank body, never a self-redirect loop).
 *
 * GUARD DEFAULT LANDING MODULE (customer-configurable): when the customer's
 * record sets guard_default_landing (e.g. REDOPS → "access_control"), a guard
 * of that customer lands DIRECTLY on that module after login / app reopen /
 * session restore — no intermediate guard dashboard tap. The override is
 * strictly fail-closed: it applies only when the guard's role is permitted to
 * open the page AND the customer's module entitlements enable it; otherwise the
 * existing authorised-home behaviour is kept unchanged. Customers without the
 * setting retain their current landing screen.
 */
const GUARD_LANDING_KEYS = {
  access_control: "AccessControl",
  accesscontrol: "AccessControl",
};

export default function RoleHomeRedirect() {
  const { user, isLoadingAuth } = useAuth();
  const { data: entitlements = [], isLoading } = useModuleEntitlements(user?.id, user?.customer_id);

  // Landing config is resolved SERVER-SIDE by getGuardLandingConfig (same
  // cached key, 10 min, shared with the Layout shell). A direct client read of
  // the Customer record silently failed on real guard devices: the read is
  // RLS-gated on {{user.data.customer_id}}, which guard session tokens do not
  // carry — so the query returned nothing and guards landed on the generic
  // Guard UI. The gateway derives the caller's scope server-side instead.
  const { data: landing, isLoading: landingLoading } = useQuery({
    queryKey: ["guard_landing", user?.customer_id],
    queryFn: async () => {
      const res = await base44.functions.invoke("getGuardLandingConfig", {});
      return res?.data || res;
    },
    enabled: !!user && user.role_type === "guard" && !!user.customer_id,
    staleTime: 10 * 60 * 1000,
    retry: 2,
  });

  if (isLoadingAuth || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  // Guards: never resolve the home while the landing config is still loading —
  // an unresolved config must NOT silently fall through to the generic guard
  // home (My Shift). Wait, then apply the fail-closed override below.
  if (user.role_type === "guard" && user.customer_id && landingLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  let homePath = resolveAuthorisedHome(user, entitlements);
  const requested = GUARD_LANDING_KEYS[String(landing?.guard_default_landing || "").toLowerCase().replace(/[\s-]+/g, "_")];
  if (
    requested &&
    ROLE_PAGES[user.role_type]?.has(requested) &&
    isPageModuleEnabled(entitlements, requested, false)
  ) {
    homePath = createPageUrl(requested);
  }

  if (!homePath) return <SetupRequired />;
  return <Navigate to={homePath} replace />;
}