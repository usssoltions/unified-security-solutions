import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, Camera, ChevronLeft } from "lucide-react";
import IdDocCapture from "./IdDocCapture";

/**
 * Wizard step 3 — ID-document photos for THIS attendance. Always shown.
 * Worker with photos on file → explicit choice: use them, or capture new.
 * onDone({ mode: 'existing'|'captured'|'none', frontUrl, backUrl, frontView, backView, updateWorker })
 */
export default function IdPhotoStep({ existingWorker, idType, onDone, onBack }) {
  const onFile = existingWorker && existingWorker.id_front_url ? existingWorker : null;
  const [capturing, setCapturing] = useState(!onFile);
  const [updateWorker, setUpdateWorker] = useState(true);

  const capture = (
    <IdDocCapture
      idType={idType}
      onComplete={(p) => onDone({ mode: "captured", ...p, updateWorker: onFile ? updateWorker : true })}
      onSkip={onFile ? () => setCapturing(false) : () => onDone({ mode: "none" })}
      skipLabel={onFile ? "Back to photos on file" : "Continue without ID photos"}
    />
  );

  return (
    <div className="space-y-4">
      <h2 className="text-white text-xl font-bold">Identification Document</h2>
      {existingWorker && !onFile && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-amber-300 text-sm">
          No ID photos on file for this worker — please capture them now.
        </div>
      )}
      {onFile && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 space-y-2">
          <p className="text-emerald-300 text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> ID photos on file for this worker
          </p>
          {onFile.id_captured_at && (
            <p className="text-slate-400 text-xs">
              Captured {new Date(onFile.id_captured_at).toLocaleString("en-ZA")}{onFile.id_captured_by_name ? ` by ${onFile.id_captured_by_name}` : ""}
            </p>
          )}
          <div className="flex gap-2">
            {[onFile.id_front_view_url, onFile.id_back_url ? onFile.id_back_view_url : null].filter(Boolean).map((u, i) => (
              <img key={i} src={u} alt={i ? "ID Back" : "ID Front"} className="h-24 rounded-lg object-contain border border-[var(--border-default)] bg-[var(--surface-base)]" />
            ))}
          </div>
          {!capturing && (
            <div className="flex flex-col gap-2 pt-1">
              <Button variant="brand" onClick={() => onDone({ mode: "existing" })} className="h-12">
                <CheckCircle2 className="w-4 h-4 mr-2" /> Use existing photos for this attendance
              </Button>
              <Button variant="outline" onClick={() => setCapturing(true)} className="h-12 border-[var(--border-default)] text-slate-200">
                <Camera className="w-4 h-4 mr-2" /> Capture or replace photos for this attendance
              </Button>
            </div>
          )}
        </div>
      )}
      {capturing && onFile && (
        <label className="flex items-center gap-2 text-slate-300 text-sm">
          <Checkbox checked={updateWorker} onCheckedChange={(v) => setUpdateWorker(!!v)} />
          Also replace the photos on the worker profile
        </label>
      )}
      {capturing && capture}
      <Button variant="outline" onClick={onBack} className="w-full border-slate-600 text-slate-300 h-12">
        <ChevronLeft className="w-4 h-4 mr-1" /> Back
      </Button>
    </div>
  );
}