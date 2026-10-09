import React from "react";
import { Loader2, ShieldX, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import BrandHeader from "@/components/branding/BrandHeader";

/**
 * VL360Shell — shared loading / access-denied / error framing for every
 * VoiceLink 360 screen. Uses the tenant's resolved branding; denies fail
 * closed with an honest explanation and a retry.
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
  if (ctx.isError || !ctx.data || ctx.data.error) {
    const msg = ctx.error?.message || ctx.data?.error || "";
    const denied = /not licensed|entitlement|permission|removed/i.test(msg);
    return (
      <div className="min-h-screen bg-slate-950 p-4 flex items-center justify-center">
        <div className="max-w-sm text-center space-y-4">
          <ShieldX className={`w-12 h-12 mx-auto ${denied ? "text-amber-400" : "text-rose-400"}`} />
          <h1 className="text-lg font-bold text-white">{denied ? "VoiceLink 360 not available" : "Something went wrong"}</h1>
          <p className="text-slate-400 text-sm">
            {denied
              ? (msg || "VoiceLink 360 is not licensed for your organisation, or your access has been removed. Please contact your administrator.")
              : "Could not load VoiceLink 360. Check your connection and try again."}
          </p>
          <Button variant="outline" onClick={() => ctx.refetch?.()} className="border-slate-600 text-slate-200">
            <RefreshCw className="w-4 h-4 mr-2" /> Retry
          </Button>
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