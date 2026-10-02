import React from "react";
import { Loader2, AlertTriangle } from "lucide-react";

/**
 * LoadStatusBanner — distinguishes "still loading" and "failed to load" from a
 * genuinely empty list. Renders nothing once data has loaded successfully.
 */
export default function LoadStatusBanner({ loading, error, onRetry }) {
  if (error) {
    const msg = error?.response?.data?.error || error?.message || "Unknown error";
    return (
      <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1">Could not load data: {msg}</div>
        {onRetry && <button onClick={onRetry} className="underline shrink-0">Retry</button>}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 text-slate-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }
  return null;
}