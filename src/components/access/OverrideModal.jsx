import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ShieldCheck, X, Loader2 } from "lucide-react";

export default function OverrideModal({ target, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!reason.trim()) { setError("A reason is required to override a blacklist block."); return; }
    setBusy(true);
    setError("");
    try {
      const res = await base44.functions.invoke("authorizeBlacklistOverride", {
        accessLogId: target.id,
        reason: reason.trim(),
      });
      if (res?.data?.error) throw new Error(res.data.error);
      onDone();
    } catch (e) {
      setError(e?.message || "Override failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-rose-500/40 bg-slate-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-rose-500/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h3 className="text-white font-bold">Supervisor Override</h3>
              <p className="text-slate-400 text-xs">Authorize entry despite blacklist</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 space-y-1">
          <p className="text-white text-sm font-medium">{target.person_name || "Unknown"}</p>
          <p className="text-rose-300 text-xs font-medium">{target.flag_reason || "Blacklisted"}</p>
          <p className="text-slate-500 text-xs font-mono">
            {target.sa_id_number || target.driver_licence_number || target.vehicle_registration || ""}
          </p>
        </div>

        <div>
          <label className="text-slate-400 text-xs mb-1.5 block font-medium">Reason for override *</label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Resident confirmed appointment; false-positive match…"
            className="bg-slate-800 border-slate-700 text-white min-h-[90px]"
            disabled={busy}
          />
        </div>

        {error && <p className="text-rose-400 text-sm">{error}</p>}

        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="flex-1 border-slate-600 text-slate-300">
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy} className="flex-1 bg-rose-500 hover:bg-rose-600">
            {busy ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Authorizing…</>
            ) : (
              <><ShieldCheck className="w-4 h-4 mr-1" /> Authorize</>
            )}
          </Button>
        </div>

        <p className="text-slate-500 text-[11px] text-center">
          Your supervisor session is verified server-side. This action is permanently audited.
        </p>
      </div>
    </div>
  );
}