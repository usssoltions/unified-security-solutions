import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { canAccessPage } from "@/lib/permissions";
import { useModuleEntitlements, isModuleEnabled } from "@/hooks/useModuleEntitlements";
import { PAGE_MODULE_MAP } from "@/lib/moduleMapping";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { resolveAuthorisedHome, needsSetupRequired } from "@/lib/resolveAuthorisedHome";
import SetupRequired from "@/components/SetupRequired";

/**
 * Route-level guard for a single page. Enforces TWO layers:
 *   1. Role → page allowlist (canAccessPage) — a guard cannot open an admin page
 *   2. Module entitlement check — a customer admin cannot access modules their
 *      tenant is not licensed for (e.g., a medical-only practice cannot see
 *      Patrol, Access, Estate, Operations).
 *
 * PLATFORM ADMIN is determined ONLY by the explicit capability
 * (role_type === "platform_admin" OR admin_level === "platform") — never by a
 * missing tenant assignment. Legacy unmigrated admins are not platform admins.
 *
 * LOOP PREVENTION: when a module is not licensed, we redirect to the
 * deterministic authorised home (resolveAuthorisedHome) instead of the static
 * role home. If the authorised home IS the current page (i.e. even the role
 * home is unlicensed), or there is no accessible page at all, we render the
 * SetupRequired controlled page — NEVER a blank body and NEVER a self-redirect.
 */
export default function ProtectedPage({ pageKey, children }) {
  const { user } = useAuth();
  const { data: entitlements = [], isLoading } = useModuleEntitlements(user?.id, user?.customer_id);

  if (!user) return null;

  // Wait for entitlements to load before gating (prevents a flash redirect to
  // a home that may itself be unlicensed). For users without a customer_id
  // (platform admins or unmigrated legacy), the query is disabled and returns
  // [] immediately, so no extra wait.
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-6 h-6 border-2 border-slate-600 border-t-sky-500 rounded-full animate-spin" />
      </div>
    );
  }

  const platformAdmin = isPlatformAdminUser(user);

  // If the user has no accessible page at all, show SetupRequired immediately.
  if (needsSetupRequired(user, entitlements)) {
    return <SetupRequired />;
  }

  // Layer 1: role → page allowlist
  if (!canAccessPage(user, pageKey)) {
    return <Navigate to={resolveAuthorisedHome(user, entitlements)} replace />;
  }

  // Layer 2: module entitlement check (platform admins bypass)
  const moduleKey = PAGE_MODULE_MAP[pageKey];
  if (moduleKey && !platformAdmin && !isModuleEnabled(entitlements, moduleKey, false)) {
    const home = resolveAuthorisedHome(user, entitlements);
    // If the authorised home is the current page we'd loop — show SetupRequired
    // instead. This is the fix for the blank-dashboard self-redirect loop.
    if (!home || home === window.location.pathname) {
      return <SetupRequired />;
    }
    return <Navigate to={home} replace />;
  }

  return children;
}