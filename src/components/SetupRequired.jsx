import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { createPageUrl } from "@/utils";
import { isPlatformAdminUser } from "@/lib/platformAdmin";
import { ShieldAlert, Building2, ArrowRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Controlled "ACCOUNT SETUP REQUIRED" page.
 *
 * Rendered when an authenticated user has no accessible commercial module or
 * dashboard page (legacy / unmigrated user with no tenant + no entitlements).
 * This replaces the blank-body failure mode — the user always sees a clear,
 * actionable message instead of an empty Layout shell.
 */
export default function SetupRequired() {
  const { user, logout } = useAuth();
  const platformAdmin = isPlatformAdminUser(user);

  const handleReload = () => window.location.reload();

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <ShieldAlert className="w-8 h-8 text-amber-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Account Setup Required</h1>
        <p className="text-slate-400 text-sm mb-6 leading-relaxed">
          Your account has not yet been assigned to an organisation or licensed module.
          Please contact an administrator to complete your tenant and module setup.
        </p>

        {user && (
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 mb-6 text-left">
            <p className="text-xs text-slate-500 mb-2">Signed in as</p>
            <p className="text-sm text-white font-medium">{user.email}</p>
            <p className="text-xs text-slate-400 mt-1">
              Role: <span className="text-slate-300">{user.role_type || user.role || "—"}</span>
            </p>
            <p className="text-xs text-slate-400">
              Tenant: <span className="text-slate-300">{user.customer_id ? "Assigned" : "Not assigned"}</span>
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {platformAdmin && (
            <Link to={createPageUrl("TenantSetup")}>
              <Button className="w-full bg-sky-500 hover:bg-sky-600 h-11">
                <Building2 className="w-4 h-4 mr-2" />
                Go to Tenant Setup
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          )}
          <Button onClick={handleReload} variant="outline" className="w-full border-slate-600 text-slate-300 h-11">
            <RefreshCw className="w-4 h-4 mr-2" />
            Reload after setup
          </Button>
          <Button
            onClick={() => logout()}
            variant="ghost"
            className="w-full text-slate-400 hover:text-slate-200 h-11"
          >
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}