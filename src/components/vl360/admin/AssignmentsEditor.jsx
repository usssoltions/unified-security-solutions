import React, { useState, useEffect } from "react";
import { Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * AssignmentsEditor — set a person's site assignments of one kind
 * ('personnel' or 'controller') against the customer's active sites.
 * Multi-site assignment supported; server re-validates every site.
 */
export default function AssignmentsEditor({ targetUser, kind, sites, current = [], onSaved }) {
  const [selected, setSelected] = useState(new Set(current.map((a) => a.site_id)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSelected(new Set((current || []).map((a) => a.site_id)));
    setDone(false);
  }, [targetUser?.user_id, kind, JSON.stringify(current)]);

  const toggle = (id) => {
    setDone(false);
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const d = await vl360Invoke({ action: "save_assignments", target_user_id: targetUser.user_id, kind, site_ids: [...selected] });
      if (d?.error) throw new Error(d.error);
      setDone(true);
      onSaved?.();
    } catch (e) {
      setError(e?.message || "Could not save assignments.");
    } finally { setBusy(false); }
  };

  if (!sites || !sites.length) return <p className="text-xs text-slate-500">No active sites yet — create sites first.</p>;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sites.map((s) => {
          const active = selected.has(s.id);
          return (
            <button key={s.id} onClick={() => toggle(s.id)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left active:scale-[0.98] transition-transform ${active ? "bg-sky-500/15 border-sky-500/50 text-sky-200" : "bg-slate-950 border-slate-700 text-slate-300"}`}>
              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${active ? "bg-sky-500 border-sky-500" : "border-slate-600"}`}>
                {active && <Check className="w-3 h-3 text-slate-950" />}
              </span>
              <span className="truncate">{s.name}</span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <Button size="sm" onClick={save} disabled={busy} className="bg-sky-500 hover:bg-sky-600 text-slate-950 font-semibold active:scale-95">
        {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
        {done ? "Saved" : `Save ${kind === "controller" ? "Controller" : "Personnel"} Assignments`}
      </Button>
    </div>
  );
}