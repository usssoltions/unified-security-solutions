/**
 * DocCropAdjust — manual document-crop corner editor for the Attendance
 * Register ID-photo capture. Shown when automatic edge detection is
 * uncertain (or when the operator taps "Adjust"): drag each corner circle
 * onto the document's corners, then Apply Crop. The parent performs the
 * perspective warp and shows the final preview before upload.
 */
import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Crop, Loader2 } from "lucide-react";

const DEFAULT_CORNERS = [[0.03, 0.05], [0.97, 0.05], [0.97, 0.95], [0.03, 0.95]];

export default function DocCropAdjust({ file, note, busy = false, onApply, onCancel }) {
  const [url, setUrl] = useState(null);
  const [corners, setCorners] = useState(DEFAULT_CORNERS);
  const imgRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Corner dragging via pointer events on window (works with touch + mouse)
  useEffect(() => {
    const posFromEvent = (e) => {
      const r = imgRef.current?.getBoundingClientRect();
      if (!r || !r.width || !r.height) return null;
      return [
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      ];
    };
    const move = (e) => {
      if (dragRef.current == null) return;
      e.preventDefault();
      const p = posFromEvent(e);
      if (!p) return;
      setCorners((cs) => cs.map((c, i) => (i === dragRef.current ? p : c)));
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const pointsAttr = corners.map((c) => `${(c[0] * 100).toFixed(2)},${(c[1] * 100).toFixed(2)}`).join(" ");

  return (
    <div className="space-y-3">
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2">
        <Crop className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
        <p className="text-amber-300 text-xs leading-relaxed">{note}</p>
      </div>

      {url && (
        <div className="bg-black rounded-xl overflow-hidden border border-[var(--border-default)] flex justify-center">
          <div className="relative inline-block">
            <img
              ref={imgRef}
              src={url}
              alt="Document crop adjustment"
              draggable={false}
              className="block max-h-[46vh] max-w-full w-auto h-auto select-none"
              style={{ touchAction: "none" }}
            />
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              <polygon
                points={pointsAttr}
                fill="rgba(14,165,233,0.15)"
                stroke="#0ea5e9"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            {corners.map((c, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Adjust corner ${i + 1}`}
                onPointerDown={(e) => { e.preventDefault(); dragRef.current = i; }}
                className="absolute w-9 h-9 rounded-full bg-sky-500/85 border-2 border-white shadow-lg flex items-center justify-center"
                style={{
                  left: `${c[0] * 100}%`,
                  top: `${c[1] * 100}%`,
                  transform: "translate(-50%, -50%)",
                  touchAction: "none",
                }}
              >
                <span className="w-2 h-2 bg-white rounded-full" />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}
          className="flex-1 border-[var(--border-default)] text-slate-200 h-12">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Cancel"}
        </Button>
        <Button variant="outline" onClick={() => setCorners(DEFAULT_CORNERS)} disabled={busy}
          className="border-[var(--border-default)] text-slate-200 h-12 px-3">
          Reset
        </Button>
        <Button onClick={() => onApply(corners)} disabled={busy} variant="brand" className="flex-1 h-12">
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Crop className="w-4 h-4 mr-2" />}
          Apply Crop
        </Button>
      </div>
    </div>
  );
}