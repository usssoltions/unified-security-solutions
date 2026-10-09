import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { vl360Invoke } from "@/lib/vl360Api";

/**
 * PhonePermissions — per-user External Telephone Calling permission
 * (Internal Communication Only ⇄ External Calling Enabled). Enforced by the
 * gateway server-side as well. USS permissions do not prevent direct use of
 * the external app — the SIP provider enforces actual outbound restrictions.
 */
export default function PhonePermissions({ data, onChanged }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const toggle = async (u) => {
    setBusy(u.user_id); setError(null);
    try {
      const next = !(u.vl_profile?.external_calling_enabled);
      const d = await vl360Invoke({ action: "save_profile", target_user_id: u.user_id, external_calling_enabled: next });
      if (d?.error) throw new Error(d.error);
      onChanged?.();
    } catch (e) { setError(e?.message || "Could not update."); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {(data?.users || []).map((u) => (
        <div key={u.user_id} className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold truncate">{u.name}</p>
            <p className="text-xs text-slate-400">
              {u.vl_profile?.external_calling_enabled ? (
                <span className="text-sky-300">External Calling Enabled</span>
              ) : (
                <span>Internal Communication Only</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {busy === u.user_id && <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />}
            <Switch checked={!!u.vl_profile?.external_calling_enabled} onCheckedChange={() => toggle(u)} />
          </div>
        </div>
      ))}
      {(data?.users || []).length === 0 && <p className="text-slate-500 text-sm text-center py-4">No users yet.</p>}
      <p className="text-[11px] text-slate-500">
        SIP credentials and registration stay inside Wave Lite. Actual outbound restrictions are enforced by the SIP provider — this permission governs USS features only.
      </p>
    </div>
  );
}