import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { canAccessPage, roleHomePath } from "@/lib/permissions";

/**
 * Route-level guard for a single page. Enforces the role→page allowlist so a
 * guard cannot open an administrator page by typing the URL, using the Back
 * button, or reloading a stale cached route. Mirrors the menu gating in
 * Layout.jsx but enforced here at the route (Phase 12 requirement).
 *
 * Usage: <ProtectedPage pageKey="ControlRoom"><ControlRoom/></ProtectedPage>
 */
export default function ProtectedPage({ pageKey, children }) {
  const { user } = useAuth();
  // AuthenticatedApp only renders Routes when a user exists, so a missing user
  // here means we're mid-transition — render nothing rather than redirect.
  if (!user) return null;
  if (!canAccessPage(user, pageKey)) {
    return <Navigate to={roleHomePath(user)} replace />;
  }
  return children;
}