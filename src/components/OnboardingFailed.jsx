import React, { useState } from "react";
import { Shield, LogOut, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

/**
 * Fail-closed onboarding screen.
 *
 * Shown when a non-platform user authenticates but their tenant scope could
 * not be applied or resolved (e.g. an invitation scope was missing, already
 * consumed by another session, or the first-login apply failed transiently).
 * The user is NOT given unscoped application access, NOT fallen back to
 * platform/default-customer data, and NOT allowed to self-select a reseller.
 * Platform Admin accounts are never routed here.
 *
 * SELF-HEALING: the apply step is idempotent, so "Try Again" safely re-runs
 * the full provisioning check — a TRANSIENT first-login failure (network
 * timeout while the server-side scope apply was still completing) recovers
 * here without administrator intervention. A permanently broken invitation
 * keeps this screen, and the server logs an actionable admin-side diagnostic.
 */
export default function OnboardingFailed({ message, onRetry }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } catch (_) {}
    setRetrying(false);
  };

  const handleLogout = async () => {
    try { await base44.auth.logout(); } catch (_) {}
    window.location.assign("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="text-center max-w-md w-full">
        <div className="w-16 h-16 bg-rose-500/15 border border-rose-500/30 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <AlertCircle className="w-8 h-8 text-rose-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Account Setup Incomplete</h1>
        <p className="text-slate-400 text-sm mb-6 leading-relaxed">
          {message || "Your account setup could not be completed. Please contact your administrator."}
        </p>
        <div className="flex flex-col gap-3">
          {onRetry && (
            <Button onClick={handleRetry} disabled={retrying} className="bg-sky-500 hover:bg-sky-600 h-11 px-6">
              {retrying ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Retrying setup...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" /> Try Again
                </>
              )}
            </Button>
          )}
          <Button onClick={handleLogout} variant="outline" className="border-slate-600 text-slate-300 h-11 px-6">
            <LogOut className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
        <div className="flex items-center justify-center gap-2 mt-6 text-slate-600 text-xs">
          <Shield className="w-3 h-3" />
          <span>Unscoped access is blocked for security.</span>
        </div>
      </div>
    </div>
  );
}