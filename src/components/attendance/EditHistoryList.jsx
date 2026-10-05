import React from "react";
import { History } from "lucide-react";

const label = (k) => k.replace("_snapshot", "").replace(/_/g, " ");
const short = (v) => {
  if (v === null || v === undefined || v === "") return "—";
  const s = String(v);
  return /^https?:\/\//.test(s) ? "photo" : s;
};

const PROFILE_TEXT = {
  updated_linked: "Worker profile updated with these details",
  corrected_linked: "Worker profile corrected with these details",
  updated_matching: "Matching worker profile (same ID number) updated",
  created: "New worker profile created for this ID number",
};

/** Read-only, append-only edit log for an attendance record. */
export default function EditHistoryList({ history }) {
  if (!history?.length) return null;
  return (
    <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] p-4 space-y-3">
      <p className="text-white text-sm font-semibold flex items-center gap-2"><History className="w-4 h-4" /> Edit history</p>
      {[...history].reverse().map((h, i) => (
        <div key={i} className="text-xs border-l-2 border-[var(--border-default)] pl-3 space-y-1">
          <p className="text-slate-300">{new Date(h.timestamp).toLocaleString("en-ZA")} · {h.editor_name}</p>
          <p className="text-slate-400">Reason: {h.reason}</p>
          {Object.entries(h.changes || {}).map(([k, c]) => (
            <p key={k} className="text-slate-400 break-words"><span className="text-slate-300 capitalize">{label(k)}</span>: {short(c.from)} → {short(c.to)}</p>
          ))}
          {h.applied_to_worker && <p className="text-emerald-400">Photos also saved on the worker profile</p>}
          {PROFILE_TEXT[h.worker_profile_action] && <p className="text-emerald-400">{PROFILE_TEXT[h.worker_profile_action]}</p>}
        </div>
      ))}
    </div>
  );
}