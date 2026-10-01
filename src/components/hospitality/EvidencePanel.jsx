import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Image, Loader2, Lock, ShieldAlert } from "lucide-react";

// Signed (5-minute) evidence links minted server-side only for
// ownership-verified files; identity/firearm evidence is role-restricted.
export default function EvidencePanel({ visitId, count }) {
  const [state, setState] = useState({ loading: false, items: null, error: null });
  if (!count) return <p className="text-slate-500 text-xs">No evidence photos captured.</p>;

  const load = async () => {
    setState({ loading: true, items: null, error: null });
    try {
      const res = await base44.functions.invoke("finalizeAccessEntry", { action: "hospitality_evidence", access_data: { hospitality_visit_id: visitId } });
      setState({ loading: false, items: res.data.items || [], error: null });
    } catch (e) {
      setState({ loading: false, items: null, error: e?.response?.data?.error || "Evidence could not be loaded." });
    }
  };

  if (!state.items) {
    return (
      <div className="space-y-1">
        <Button onClick={load} disabled={state.loading} variant="outline" className="h-10 border-slate-600 text-slate-200 active:scale-95 transition-transform">
          {state.loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Image className="w-4 h-4 mr-2" />} View {count} evidence photo(s)
        </Button>
        {state.error && <p className="text-rose-400 text-xs">{state.error}</p>}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {state.items.map((it, i) => (
        <div key={i} className="rounded-lg border border-slate-700 bg-slate-950 p-1.5">
          {it.url ? (
            <a href={it.url} target="_blank" rel="noreferrer"><img src={it.url} alt={it.label} className="w-full h-24 object-cover rounded" /></a>
          ) : (
            <div className="h-24 flex flex-col items-center justify-center gap-1 text-slate-500 text-[11px] text-center px-1">
              {it.restricted ? <Lock className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4 text-amber-400" />}
              {it.restricted ? "Restricted to senior roles" : "Unverified file — not shown"}
            </div>
          )}
          <p className="text-slate-400 text-[11px] mt-1 truncate">{it.label}</p>
        </div>
      ))}
    </div>
  );
}