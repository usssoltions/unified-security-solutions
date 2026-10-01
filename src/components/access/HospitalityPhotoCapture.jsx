import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { optimizeImageFile } from "@/lib/imageOptimize";

/**
 * GRID GATE Hospitality evidence photo capture.
 * PRIVATE storage (UploadPrivateFile) — evidence uris are stored on the
 * HospitalityVisit record and only ever viewed through signed access, never
 * a public URL. Optimised before upload (1000px / JPEG 0.7) like every other
 * camera capture in the app.
 */
export default function HospitalityPhotoCapture({ label, photos = [], onChange, multiple = false }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState(null);
  const inputId = `hosp_photo_${label.replace(/\s+/g, "_").toLowerCase()}`;

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setErr(null);
    try {
      const uploaded = [];
      for (const file of files) {
        const optimized = await optimizeImageFile(file, { maxDim: 1000, quality: 0.7 });
        const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file: optimized });
        uploaded.push(file_uri);
      }
      onChange(multiple ? [...photos, ...uploaded] : uploaded.slice(0, 1));
    } catch (e2) {
      setErr("Upload failed — please try again.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeAt = (i) => onChange(photos.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block">
        <div className="border-2 border-dashed border-slate-600 rounded-xl p-3 flex items-center gap-3 cursor-pointer hover:border-sky-500 active:scale-[0.99] transition-all">
          {uploading ? (
            <Loader2 className="w-5 h-5 text-sky-400 animate-spin shrink-0" />
          ) : (
            <Camera className="w-5 h-5 text-slate-400 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-slate-200 text-sm font-medium truncate">{uploading ? "Uploading…" : label}</p>
            <p className="text-slate-500 text-xs">{multiple ? "Tap to add photo(s)" : "Tap to take photo"}</p>
          </div>
        </div>
      </label>
      <input type="file" accept="image/*" capture="environment" multiple={multiple} onChange={handleFiles} className="hidden" id={inputId} />
      {err && <p className="text-rose-400 text-xs">{err}</p>}
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((uri, i) => (
            <div key={i} className="relative">
              <img src={uri} alt={`${label} ${i + 1}`} className="w-16 h-16 rounded-lg object-cover border border-slate-600" />
              <button
                onClick={() => removeAt(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-rose-600 rounded-full flex items-center justify-center text-white"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}