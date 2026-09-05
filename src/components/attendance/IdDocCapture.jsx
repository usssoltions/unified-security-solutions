/**
 * Identification Document photo capture — guided camera + TRUE crop.
 *
 * The image SAVED against the Worker/Patient record is the tightly cropped,
 * high-resolution document photo (captured through DocumentCamera, cropped from
 * the original camera frame BEFORE upload). The full camera frame is never
 * stored — the cropped image is the authoritative document master, used by the
 * profile thumbnails and the Worker/Patient ID PDF.
 *
 * Front and back are captured and saved as separate masters (never merged).
 * Barkoder/SecureScan scanning is a separate subsystem and is NOT touched.
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, CheckCircle2, RotateCcw, Loader2 } from "lucide-react";
import DocumentCamera from "./DocumentCamera";
import { uploadDocumentPhoto } from "@/lib/documentPhoto";

export default function IdDocCapture({ idType = "sa_id", onComplete, onSkip }) {
  const [frontUrl, setFrontUrl] = useState(null);
  const [backUrl, setBackUrl] = useState(null);
  const [uploading, setUploading] = useState(null); // "front" | "back" | null
  const [error, setError] = useState(null);
  const [cameraSide, setCameraSide] = useState(null); // "front" | "back" | null

  const needsBack = idType !== "passport";
  const frontLabel = idType === "passport" ? "Passport Information / Photo Page" : "Front";
  const backLabel = "Back";

  // The camera component returns the CROPPED high-quality file; upload it
  // directly (single encode, no recompression) as the document master.
  const handleUse = async (file) => {
    const side = cameraSide;
    setCameraSide(null);
    setUploading(side);
    setError(null);
    try {
      const url = await uploadDocumentPhoto(file);
      if (!url) throw new Error("Upload failed");
      if (side === "front") setFrontUrl(url);
      else setBackUrl(url);
    } catch (e) {
      setError(`Failed to upload the ${side} image. Please try again.`);
    } finally {
      setUploading(null);
    }
  };

  const canProceed = frontUrl && (needsBack ? backUrl : true);

  if (cameraSide) {
    const label = cameraSide === "front" ? frontLabel : backLabel;
    return (
      <DocumentCamera
        title={`Capture ${label}`}
        idType={idType}
        onUse={handleUse}
        onCancel={() => setCameraSide(null)}
      />
    );
  }

  const CaptureSlot = ({ side, label, url }) => (
    <div className="space-y-2">
      <p className="text-slate-300 text-sm font-medium">{label}</p>
      {url ? (
        <div className="relative rounded-xl overflow-hidden border border-emerald-500/40">
          {/* Stored CROPPED master — aspect preserved, never stretched */}
          <img src={url} alt={label} className="w-full h-40 object-contain bg-[var(--surface-base)]" />
          <div className="absolute top-2 right-2">
            <Button size="sm" variant="outline" onClick={() => setCameraSide(side)}
              className="bg-slate-900/80 backdrop-blur-sm border-slate-600 text-white h-9">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Retake
            </Button>
          </div>
          <div className="absolute bottom-2 left-2 bg-emerald-600/90 text-white text-xs px-2 py-0.5 rounded flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Captured
          </div>
        </div>
      ) : (
        <Button onClick={() => setCameraSide(side)} variant="brand" className="w-full h-12">
          {uploading === side
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading…</>
            : <><Camera className="w-4 h-4 mr-2" /> Capture {label}</>}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">
        Please take a clear photo of the <strong className="text-white">physical identification document</strong> presented.
        Position the document inside the guide — the saved photo will contain the document only.
      </p>
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-rose-400 text-sm">{error}</div>
      )}
      <CaptureSlot side="front" label={frontLabel} url={frontUrl} />
      {needsBack && <CaptureSlot side="back" label={backLabel} url={backUrl} />}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onSkip} className="flex-1 border-[var(--border-default)] text-slate-200 h-12">
          Skip for now
        </Button>
        <Button onClick={() => onComplete({ frontUrl, backUrl })} disabled={!canProceed}
          variant="brand" className="flex-1 h-12">
          <CheckCircle2 className="w-4 h-4 mr-2" /> Use Photos
        </Button>
      </div>
    </div>
  );
}