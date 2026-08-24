import React, { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { roleHomePath } from "@/lib/permissions";
import { createPageUrl } from "@/utils";
import { Loader2 } from "lucide-react";

/**
 * Redirects the authenticated user to their role-appropriate home page.
 * Used as the root "/" route element so every role lands on the correct
 * dashboard after login instead of a hardcoded GuardShift.
 */
export default function RoleHomeRedirect() {
  const { user, isLoadingAuth } = useAuth();
  const navigate = useNavigate();

  if (isLoadingAuth || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
      </div>
    );
  }

  const homePath = roleHomePath(user);
  return <Navigate to={homePath} replace />;
}