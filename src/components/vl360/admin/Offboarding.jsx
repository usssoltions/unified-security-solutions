import React, { useState } from "react";
import { Loader2, UserMinus, CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * Access & Offboarding — disable/restore a person's VoiceLink access
 * (removing USS access immediately stops authorised retrieval of VoiceLink
 * destinations through USS) plus the external offboarding checklist, which
 * must be completed and confirmed SEPARATELY in Telegram and by the SIP
 * provider — USS never reports external access as revoked.
 */
const CHECKLIST = [
  "Remove the person from each Telegram group (in Telegram).",
  "Rotate/regenerate private group invite links they held (in Telegram).",
  "Disable or reassign their SIP account / Wave Lite registration with your SIP provider.",
  "Confirm each step — then mark their USS access removed below.",
];

export default function Offboarding({ data, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [checked, setChecked] = useState(new Set());

  const setEnabled = async (u, enabled) => {
    setBusy(u.user_id); setError(null);
    try {
      const d = await vl360Invoke({ action: "save_profile", target_user_id: u.user_id, enabled });
      if (d?.error) throw new Error(d.error);
      onChanged?.();
    } catch (e) { setError(e?.message || "Could not update."); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
        <p className="text-sm font-semibold text-white">External offboarding checklist</p>
        {CHECKLIST.map((c, i) => (
          <button key={i} onClick={() => setChecked((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}
            className="flex items-start gap-2 text-left w-full">
            {checked.has(i) ? <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> : <Square className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />}
            <span className={`text-xs ${checked.has(i) ? "text-slate-500 line-through" : "text-slate-300"}`}>{c}</span>
          </button>
        ))}
        <p className="text-[11px] text-amber-300/80">Do not report external access as revoked until every step is confirmed.</p>
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="space-y-2">
        {(data?.users || []).map((u) => {
          const enabled = u.vl_profile ? u.vl_profile.enabled !== false : false;
          return (
            <div key={u.user_id} className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-800 rounded-xl p-3.5">
              <div className="min-w-0">
                <p className="text-white text-sm font-semibold truncate">{u.name}</p>
                <p className="text-xs text-slate-400">
                  {u.vl_profile ? `${u.vl_profile.vl_role_label} · ` : ""}{enabled ? "VoiceLink access active" : "VoiceLink access removed"}
                </p>
              </div>
              {u.vl_profile && (
                <Button size="sm" variant="outline" disabled={busy === u.user_id}
                  onClick={() => setEnabled(u, !enabled)}
                  className={`shrink-0 ${enabled ? "border-rose-500/30 text-rose-400" : "border-emerald-500/40 text-emerald-400"}`}>
                  {busy === u.user_id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserMinus className="w-4 h-4 mr-1" />}
                  {enabled ? "Remove VL Access" : "Restore VL Access"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-500">
        Removing USS access prevents further authorised retrieval of VoiceLink destinations through USS. Telegram group membership and telephone access require the separate steps above.
      </p>
    </div>
  );
}