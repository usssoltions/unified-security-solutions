import React from "react";
import { Loader2, ShieldX, RefreshCw, LogIn, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";
import BrandHeader from "@/components/branding/BrandHeader";
import VL360CustomerSelect from "./VL360CustomerSelect";
import { isPlatformAdminUser, isResellerAdminUser } from "@/lib/platformAdmin";
import { getVl360Customer } from "@/lib/vl360Api";

/**
 * VL360Shell — shared loading / selection / access / error framing for every
 * VoiceLink 360 screen. States are DISTINGUISHED, never all shown as
 * "check your connection":
 *   • no_tenant_scope + platform/reseller admin → customer selection gate
 *   • no_tenant_scope (everyone else)           → no organisation linked
 *   • entitlement_required                      → module not licensed
 *   • profile_disabled                          → access removed
 *   • 403 (other)                               → access denied
 *   • 401 / auth_required                       → session expired (Sign In)
 *   • 5xx or no HTTP response                   → genuine connection failure
 */
export default function VL360Shell({ ctx, title, subtitle, children }) {
  if (ctx.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin mx-auto" />
          <p className="text-slate-400 text-sm">Loading VoiceLink 360…</p>
        </div>
      </div>
    );
  }

  // Normalise the failure: a thrown structured error (HTTP failure) or a
  // 200-with-error body from the gateway.
  const err = ctx.error
    || (ctx.data?.error
      ? Object.assign(new Error(ctx.data.error), { code: ctx.data.code || null, status: null })
      : null);
  const code = err?.code || null;
  const status = err?.status || null;
  const msg = err?.message || "";

  if (err) {
    const isAdminActor = isPlatformAdminUser(ctx.user) || isResellerAdminUser(ctx.user);

    // Customer selection gate — a normal, authorised state for platform and
    // reseller administrators operating on a customer, NOT an error.
    if (code === "no_tenant_scope" && isAdminActor) {
      return (
        <div className="min-h-screen bg-slate-950">
          <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
            <BrandHeader title={title} subtitle={subtitle} />
            <VL360CustomerSelect ctx={ctx} />
          </div>
        </div>
      );
    }

    const state = {
      no_tenant_scope: {
        tone: "amber", title: "VoiceLink 360 not available",
        text: "No organisation is linked to your account. Ask your administrator to link your account to a customer.",
      },
      entitlement_required: {
        tone: "amber", title: "VoiceLink 360 not enabled",
        text: msg || "VoiceLink 360 is not licensed for your organisation yet. Please contact your administrator.",
      },
      profile_disabled: {
        tone: "amber", title: "Access removed",
        text: "Your VoiceLink 360 access has been removed. Please contact your administrator.",
      },
      session_expired: {
        tone: "rose", title: "Session expired",
        text: "Your session has expired. Please sign in again.",
        signIn: true,
      },
    }[code === "auth_required" || status === 401 ? "session_expired" : code]
      || (status && status >= 500 ? {
        tone: "rose", title: "Connection problem",
        text: "Could not reach VoiceLink 360. Check your connection and try again.",
      } : null)
      || (status && status >= 400 && status < 500 && code !== "network_error" ? {
        tone: "amber", title: "Access denied",
        text: msg || "You are not authorised to use VoiceLink 360.",
      } : null)
      || (code === "network_error" ? {
        tone: "rose", title: "Connection problem",
        text: "Could not reach VoiceLink 360. Check your connection and try again.",
      } : null)
      || {
        tone: "rose", title: "Something went wrong",
        text: msg || "Could not load VoiceLink 360. Please try again.",
      };

    const isAmber = state.tone === "amber";
    return (
      <div className="min-h-screen bg-slate-950 p-4 flex items-center justify-center">
        <div className="max-w-sm text-center space-y-4">
          <ShieldX className={`w-12 h-12 mx-auto ${isAmber ? "text-amber-400" : "text-rose-400"}`} />
          <h1 className="text-lg font-bold text-white">{state.title}</h1>
          <p className="text-slate-400 text-sm">{state.text}</p>
          {state.signIn ? (
            <Button onClick={() => base44.auth.redirectToLogin()} className="bg-sky-500 hover:bg-sky-600">
              <LogIn className="w-4 h-4 mr-2" /> Sign In
            </Button>
          ) : (
            <Button variant="outline" onClick={() => ctx.refetch?.()} className="border-slate-600 text-slate-200">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          )}
          {/* Administrators operating a selected customer can always switch
              back to the selection — the previous customer's cache is cleared. */}
          {isAdminActor && getVl360Customer() && (
            <Button variant="outline" onClick={() => ctx.clearCustomer?.()} className="border-slate-600 text-slate-200 w-full">
              <Building2 className="w-4 h-4 mr-2" /> Switch organisation
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="p-4 md:p-6 max-w-xl mx-auto space-y-4">
        <BrandHeader title={title} subtitle={subtitle} />
        {children}
      </div>
    </div>
  );
}