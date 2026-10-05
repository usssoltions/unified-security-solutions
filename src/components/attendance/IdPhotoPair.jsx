import React from "react";
import { CheckCircle2, ImageOff } from "lucide-react";

const SOURCE_LABEL = {
  captured_this_visit: "Captured during this visit",
  on_file: "Worker's photos on file",
  attached_by_edit: "Attached by administrator edit",
};

/** Front/back ID-document photos with capture status. */
export default function IdPhotoPair({ front, back, source, capturedAt, capturedBy }) {
  if (!front) {
    return (
      <div className="flex items-center gap-2 text-amber-300 text-sm bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
        <ImageOff className="w-4 h-4 shrink-0" /> No ID photos saved for this visit
      </div>
    );
  }
  const meta = [
    SOURCE_LABEL[source],
    capturedAt ? new Date(capturedAt).toLocaleString("en-ZA") : null,
    capturedBy || null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="space-y-2">
      <p className="text-emerald-300 text-sm font-medium flex items-center gap-1.5">
        <CheckCircle2 className="w-4 h-4" /> ID photos saved
      </p>
      {meta && <p className="text-slate-400 text-xs">{meta}</p>}
      <div className="grid grid-cols-2 gap-2">
        {[["Front", front], ["Back", back]].map(([label, url]) => (
          <div key={label}>
            <p className="text-slate-400 text-xs mb-1">{label}</p>
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={`ID document ${label.toLowerCase()}`}
                  className="w-full h-32 object-contain rounded-lg border border-[var(--border-default)] bg-[var(--surface-base)]" />
              </a>
            ) : (
              <div className="h-32 rounded-lg border border-dashed border-[var(--border-default)] flex items-center justify-center text-slate-500 text-xs">Not captured</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}