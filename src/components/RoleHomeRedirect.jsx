import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { useModuleEntitlements } from "@/hooks/useModuleEntitlements";
import { resolveAuthorisedHome } from "@/lib/resolveAuthorisedHome";
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
 */
export default function RoleHomeRedirect() {
  const { user, isLoadingAuth } = useAuth();
  const { data: entitlements = [], isLoading } = useModuleEntitlements(user?.id, user?.customer_id);

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

  const homePath = resolveAuthorisedHome(user, entitlements);
  if (!homePath) return <SetupRequired />;
  return <Navigate to={homePath} replace />;
}