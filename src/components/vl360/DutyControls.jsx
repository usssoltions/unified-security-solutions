import React, { useState } from "react";
import { Loader2, Play, RefreshCw, MapPin, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * DutyControls — VoiceLink-specific duty session controls (Go On Duty /
 * Change Site / Go Off Duty). Server-side, duplicate-active-session-safe,
 * authorised sites only. NOT an attendance/payroll/patrol record.
 */
export default function DutyControls({ ctx }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const duty = ctx.data?.duty || null;
  const sites = ctx.data?.sites || [];

  const run = async (fn, key) => {
    setBusy(key); setError(null);
    try {
      await fn();
      await ctx.refresh();
    } catch (e) {
      setError(e?.message || "Action failed. Please try again.");
    } finally { setBusy(null); }
  };

  const onDuty = async (siteId) => run(async () => {
    const d = await vl360Invoke({ action: "duty_on", site_id: siteId || undefined });
    if (d?.error) throw new Error(d.error);
  }, "on");

  const offDuty = () => run(async () => {
    await vl360Invoke({ action: "duty_off" });
  }, "off");

  const changeSite = async (siteId) => run(async () => {
    const d = await vl360Invoke({ action: "duty_change_site", site_id: siteId });
    if (d?.error) throw new Error(d.error);
  }, "change");

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${duty ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
          <p className="text-sm font-semibold text-white">
            {duty ? `On Duty · ${duty.site_name || "No site"}` : "Off Duty"}
          </p>
        </div>
        {duty?.started_at && (
          <p className="text-xs text-slate-500">Since {new Date(duty.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
        )}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="grid grid-cols-1 gap-2">
        {!duty ? (
          <>
            {sites.length > 1 ? (
              <select
                value="" onChange={(e) => e.target.value && onDuty(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-white text-sm rounded-lg px-3 py-2.5"
              >
                <option value="">Go On Duty — choose site…</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : (
              <Button onClick={() => onDuty(sites[0]?.id)} disabled={!!busy}
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold active:scale-95">
                {busy === "on" ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Play className="w-5 h-5 mr-2" />}
                Go On Duty
              </Button>
            )}
            {sites.length === 0 && (
              <p className="text-xs text-slate-500">No authorised sites yet — ask your administrator to assign you under Personnel Setup.</p>
            )}
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {sites.length > 1 && (
              <select
                value={duty.site_id || ""} onChange={(e) => e.target.value && changeSite(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-white text-sm rounded-lg px-2 py-2.5"
              >
                <option value={duty.site_id || ""}>{duty.site_name || "Change Site…"}</option>
                {sites.filter((s) => s.id !== duty.site_id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <Button onClick={offDuty} disabled={!!busy} variant="outline"
              className="h-11 border-rose-500/30 text-rose-400 hover:bg-rose-500/10 active:scale-95 font-semibold">
              {busy === "off" ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Square className="w-5 h-5 mr-2" />}
              Go Off Duty
            </Button>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-600">VoiceLink duty session — not an attendance or payroll record.</p>
    </div>
  );
}