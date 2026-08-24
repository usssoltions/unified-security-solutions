import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { canAccessPage, roleHomePath } from "@/lib/permissions";
import { useModuleEntitlements, isModuleEnabled } from "@/hooks/useModuleEntitlements";
import { PAGE_MODULE_MAP } from "@/lib/moduleMapping";

/**
 * Route-level guard for a single page. Enforces TWO layers:
 *   1. Role → page allowlist (canAccessPage) — a guard cannot open an admin page
 *   2. Module entitlement check — a customer admin cannot access modules their
 *      tenant is not licensed for (e.g., a medical-only practice cannot see
 *      Patrol, Access, Estate, Operations).
 *
 * ONLY platform admins (no customer_id, no reseller_id) bypass module
 * entitlement restrictions. Customer/reseller admins are gated.
 */
export default function ProtectedPage({ pageKey, children }) {
  const { user } = useAuth();
  const { data: entitlements = [] } = useModuleEntitlements(user?.id, user?.customer_id);

  if (!user) return null;

  // Layer 1: role → page allowlist
  if (!canAccessPage(user, pageKey)) {
    return <Navigate to={roleHomePath(user)} replace />;
  }

  // Layer 2: module entitlement check (platform admins bypass)
  const isPlatformAdmin = user?.role === "admin" && !user?.customer_id && !user?.reseller_id;
  const moduleKey = PAGE_MODULE_MAP[pageKey];
  if (moduleKey && !isPlatformAdmin && !isModuleEnabled(entitlements, moduleKey, false)) {
    return <Navigate to={roleHomePath(user)} replace />;
  }

  return children;
}