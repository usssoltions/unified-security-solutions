/**
 * Identification Document photo capture component.
 * Supports front + optional back capture with preview and retake.
 * Uses uploadOptimizedImage for compression.
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, CheckCircle2, RotateCcw, Loader2 } from "lucide-react";
import { uploadOptimizedImage } from "@/lib/imageOptimize";

export default function IdDocCapture({ idType = "sa_id", onComplete, onSkip }) {
  const [frontUrl, setFrontUrl] = useState(null);
  const [backUrl, setBackUrl] = useState(null);
  const [uploading, setUploading] = useState(null); // "front" | "back" | null
  const [error, setError] = useState(null);

  const needsBack = idType !== "passport";
  const frontLabel = idType === "passport" ? "Passport Information / Photo Page" : "Front";
  const backLabel = "Back";

  const capture = async (side, file) => {
    if (!file) return;
    setUploading(side);
    setError(null);
    try {
      // ID docs: 1400px max dim, 0.82 quality — readable but compressed
      const url = await uploadOptimizedImage(file, { maxDim: 1400, quality: 0.82 });
      if (!url) throw new Error("Upload failed");
      if (side === "front") setFrontUrl(url);
      else setBackUrl(url);
    } catch (e) {
      setError(`Failed to upload ${side} image. Please try again.`);
    } finally {
      setUploading(null);
    }
  };

  const canProceed = frontUrl && (needsBack ? backUrl : true);

  const CaptureSlot = ({ side, label, url }) => (
    <div className="space-y-2">
      <p className="text-slate-300 text-sm font-medium">{label}</p>
      {url ? (
        <div className="relative rounded-xl overflow-hidden border border-emerald-500/40">
          <img src={url} alt={label} className="w-full h-40 object-cover" />
          <div className="absolute top-2 right-2 flex gap-2">
            <label htmlFor={`id-cap-${side}`} className="cursor-pointer">
              <div className="bg-slate-900/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 active:scale-95 transition">
                <RotateCcw className="w-3.5 h-3.5" /> Retake
              </div>
              <input id={`id-cap-${side}`} type="file" accept="image/*" capture="environment"
                className="hidden" onChange={(e) => capture(side, e.target.files?.[0])} />
            </label>
          </div>
          <div className="absolute bottom-2 left-2 bg-emerald-600/90 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Captured
          </div>
        </div>
      ) : (
        <label htmlFor={`id-cap-${side}`} className="cursor-pointer block">
          <div className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center hover:border-sky-500 transition active:scale-[0.98]">
            {uploading === side ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
                <p className="text-slate-400 text-sm">Uploading…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Camera className="w-8 h-8 text-slate-400" />
                <p className="text-white text-sm font-medium">Capture {label}</p>
                <p className="text-slate-500 text-xs">Tap to open camera</p>
              </div>
            )}
          </div>
          <input id={`id-cap-${side}`} type="file" accept="image/*" capture="environment"
            className="hidden" onChange={(e) => capture(side, e.target.files?.[0])} />
        </label>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">
        Please take a clear photo of the <strong className="text-white">physical identification document</strong> presented.
      </p>
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-rose-400 text-sm">{error}</div>
      )}
      <CaptureSlot side="front" label={frontLabel} url={frontUrl} />
      {needsBack && <CaptureSlot side="back" label={backLabel} url={backUrl} />}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onSkip} className="flex-1 border-slate-600 text-slate-300 h-12">
          Skip for now
        </Button>
        <Button onClick={() => onComplete({ frontUrl, backUrl })} disabled={!canProceed}
          className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-12">
          <CheckCircle2 className="w-4 h-4 mr-2" /> Use Photos
        </Button>
      </div>
    </div>
  );
}