import React, { useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * SetupChecks — validates every stored VoiceLink destination (sites and
 * individuals): missing / valid / malformed. Valid destinations can be opened
 * (explicit admin tap — never automatic) and then manually confirmed.
 */
export default function SetupChecks({ onChanged }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const d = await vl360Invoke({ action: "run_setup_checks" });
      if (d?.error) throw new Error(d.error);
      setResult(d);
    } catch (e) { setError(e?.message || "Checks failed."); } finally { setBusy(false); }
  };

  const statusIcon = (s) => s === "valid"
    ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
    : s === "missing"
      ? <AlertTriangle className="w-4 h-4 text-amber-400" />
      : <XCircle className="w-4 h-4 text-rose-400" />;

  const Group = ({ title, rows, confirmAction }) => (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-white">{title}</p>
      {(rows || []).map((r) => (
        <div key={r.name} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-white text-sm font-medium truncate">{r.name}</p>
            <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${r.setup_confirmed ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-400 border border-slate-700"}`}>
              {r.setup_confirmed ? "Confirmed" : "Not confirmed"}
            </span>
          </div>
          <div className="space-y-1.5">
            {r.items.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  {statusIcon(it.status)}
                  <div className="min-w-0">
                    <p className="text-xs text-slate-300 truncate">{it.label}</p>
                    {it.link && <p className="text-[10px] text-slate-600 truncate">{it.link}</p>}
                  </div>
                </div>
                {it.status === "valid" && (
                  <button
                    onClick={() => { window.location.href = it.link; }}
                    className="text-xs text-sky-400 underline shrink-0 flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" /> Open &amp; verify
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {(rows || []).length === 0 && <p className="text-slate-500 text-xs">Nothing configured yet.</p>}
    </div>
  );

  return (
    <div className="space-y-3">
      <Button size="sm" onClick={run} disabled={busy} className="bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />} Run Setup Checks
      </Button>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {result && (
        <>
          <Group title="Site destinations" rows={result.site_checks} />
          <Group title="Individual destinations" rows={result.person_checks} />
          <p className="text-[11px] text-slate-500">
            "Open &amp; verify" opens the destination on your tap — confirm here only after checking it reaches the correct person/group.
          </p>
        </>
      )}
      {!result && <p className="text-xs text-slate-500">Run the checks to list every stored destination and its format status.</p>}
    </div>
  );
}