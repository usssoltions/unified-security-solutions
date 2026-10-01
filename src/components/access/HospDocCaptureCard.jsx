import React, { useState } from "react";
import { ScanLine, CheckCircle2, RefreshCw, Hash, Camera } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import HospitalityPhotoCapture from "./HospitalityPhotoCapture";

/**
 * One GRID GATE document-capture card ("Scan Vehicle Disk" / "Licence Disk").
 * Two routes per the workflow: a live scan (barKoder profile) or, when the
 * barcode cannot be scanned, an ownership-verified photo + typed identifier.
 * The server re-validates whichever route is submitted.
 */
export default function HospDocCaptureCard({
  label, subtitle, capture, error, onScanRequest, onCapture, siteId, submitToken, disabled,
}) {
  const [manual, setManual] = useState(false);
  const [typed, setTyped] = useState("");
  const [photo, setPhoto] = useState([]);

  const saveManual = () => {
    if (photo.length && typed.trim().length >= 4) {
      onCapture({ method: "manual_photo", identifier: typed.trim(), payload: null, photoUri: photo[0], fields: {} });
      setManual(false); setTyped(""); setPhoto([]);
    }
  };

  if (capture) {
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <p className="text-emerald-300 text-xs font-semibold uppercase tracking-wide truncate">{label}</p>
          </div>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${capture.method === "scanned" ? "bg-emerald-500/20 text-emerald-300" : "bg-sky-500/20 text-sky-300"}`}>
            {capture.method === "scanned" ? "Scanned" : "Photo + manual"}
          </span>
        </div>
        <p className="text-white font-bold text-base break-all">{capture.identifier}</p>
        {capture.method === "manual_photo" && capture.photoUri && (
          <img src={capture.photoUri} alt={label} className="h-24 w-24 object-cover rounded-lg border border-slate-700" />
        )}
        {Object.entries(capture.fields || {}).filter(([, v]) => v).map(([k, v]) => (
          <p key={k} className="text-slate-400 text-xs break-all">
            {k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}: <span className="text-slate-300">{v}</span>
          </p>
        ))}
        <button type="button" disabled={disabled} onClick={() => onCapture(null)}
          className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 active:scale-95 transition-transform">
          <RefreshCw className="w-3 h-3" /> Capture again
        </button>
      </div>
    );
  }

  if (manual) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-slate-300 text-sm font-semibold">{label} — photo + manual</p>
          <button type="button" disabled={disabled} onClick={() => setManual(false)}
            className="text-xs text-slate-400 hover:text-slate-200">Try scanning instead</button>
        </div>
        <HospitalityPhotoCapture siteId={siteId} submitToken={submitToken} label={`Photo of the ${label.toLowerCase()}`} photos={photo} onChange={setPhoto} />
        <div className="flex gap-2 items-end">
          <div className="flex-1 space-y-1.5">
            <p className="text-slate-300 text-xs font-medium">Type the number exactly as shown on the document</p>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={disabled}
              placeholder={subtitle} className="bg-slate-900 border-slate-700 text-white h-11" />
          </div>
          <Button type="button" onClick={saveManual} disabled={disabled || !photo.length || typed.trim().length < 4}
            className="h-11 px-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold active:scale-95 transition-transform">
            <Hash className="w-4 h-4 mr-1" /> Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-white text-sm font-semibold leading-tight">{label}</p>
          <p className="text-slate-500 text-xs truncate">{subtitle}</p>
        </div>
        <ScanLine className="w-5 h-5 text-sky-400 shrink-0" />
      </div>
      {error && <p className="text-amber-300 text-xs">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={disabled} onClick={() => onScanRequest("scan")}
          className="flex-1 h-11 bg-sky-600 hover:bg-sky-700 text-white font-semibold active:scale-95 transition-transform">
          <ScanLine className="w-4 h-4 mr-2" /> Scan
        </Button>
        <Button type="button" disabled={disabled} onClick={() => setManual(true)} variant="outline"
          className="flex-1 h-11 border-slate-600 text-slate-300 active:scale-95 transition-transform">
          <Camera className="w-4 h-4 mr-2" /> Photo + manual
        </Button>
      </div>
    </div>
  );
}