import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, ShieldCheck } from "lucide-react";

/**
 * Transitional screen shown during first-login onboarding for an invited
 * tenant admin whose PendingTenantScope was just applied.
 *
 * Why: the session token was issued at signup BEFORE the tenant scope existed.
 * RLS resolves reseller_id/customer_id from the token, so without a fresh token
 * the portal would render "Reseller not found". We clear the stale token and
 * send the user to re-authenticate; on the next login the token carries the
 * applied scope and the portal resolves correctly. The pending scope is
 * already consumed, so the next login proceeds straight to the portal.
 */
export default function ReauthOnboarding() {
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try { await base44.auth.logout(); } catch (_) {}
      try { base44.auth.redirectToLogin(window.location.origin + "/"); } catch (_) {}
    }, 1500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="text-center max-w-sm w-full">
        <div className="w-16 h-16 bg-sky-500/15 border border-sky-500/30 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <ShieldCheck className="w-8 h-8 text-sky-400" />
        </div>
        <h1 className="text-xl font-bold text-white mb-2">Completing your account setup</h1>
        <p className="text-slate-400 text-sm mb-6 leading-relaxed">
          Applying your tenant access and refreshing your secure session…
        </p>
        <Loader2 className="w-7 h-7 text-sky-500 animate-spin mx-auto" />
      </div>
    </div>
  );
}