import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogOut, Clock, MapPin, X } from "lucide-react";

/**
 * Confirms a manual exit for a visitor currently INSIDE the estate, opened by
 * tapping an "inside" row in the Live Access Log (Phase B). The caller passes
 * the active AccessLog record; confirming fires onConfirm(record).
 */
export default function ExitConfirmModal({ target, busy, onConfirm, onClose }) {
  if (!target) return null;
  const entryAt = target.entry_time || target.timestamp;
  const mins = Math.max(0, Math.round((Date.now() - new Date(entryAt).getTime()) / 60000));

  return (
    <div className="fixed inset-0 bg-slate-900/90 z-[100] flex items-center justify-center p-4">
      <Card className="max-w-md w-full bg-slate-800 border-amber-500/40 shadow-2xl">
        <CardHeader className="flex flex-row items-center justify-between border-b border-slate-700">
          <CardTitle className="text-white text-lg flex items-center gap-2">
            <LogOut className="w-5 h-5 text-amber-400" /> Confirm Exit
          </CardTitle>
          <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-slate-300">
            <X className="w-4 h-4" />
          </button>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center gap-3">
            {target.photo_url
              ? <img src={target.photo_url} alt="" className="w-14 h-14 rounded-full object-cover shrink-0" />
              : <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center text-slate-300 font-bold text-lg shrink-0">{(target.person_name || "?")[0]?.toUpperCase()}</div>}
            <div className="min-w-0">
              <p className="text-white font-semibold truncate">{target.person_name || "Unknown"}</p>
              {target.vehicle_registration && <p className="text-slate-400 text-xs">Vehicle: {target.vehicle_registration}</p>}
              {target.destination && <p className="text-slate-400 text-xs">Destination: {target.destination}</p>}
            </div>
          </div>
          <div className="rounded-xl bg-slate-900/70 border border-slate-700 p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-slate-300"><Clock className="w-4 h-4 text-amber-400" /> Entered: {new Date(entryAt).toLocaleString()}</div>
            <div className="flex items-center gap-2 text-slate-300"><MapPin className="w-4 h-4 text-sky-400" /> Gate: {target.gate_name || "—"}</div>
            <p className="text-emerald-400 font-semibold">On site: {mins} min</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="flex-1 bg-slate-700 border-slate-600 text-slate-200">Cancel</Button>
            <Button onClick={onConfirm} disabled={busy} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white">
              <LogOut className="w-4 h-4 mr-2" /> Exit Now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}