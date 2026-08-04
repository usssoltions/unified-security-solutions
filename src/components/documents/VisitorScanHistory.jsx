/**
 * USS Guard — Visitor Scan History (Phase 3)
 *
 * Shows the DocumentScan audit/history records linked to a single visitor.
 * Displays original JSON, driver photo, scan date and scanner version.
 */
import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { History, X, ChevronDown, ChevronUp } from "lucide-react";

export default function VisitorScanHistory({ visitor }) {
  const [open, setOpen] = useState(false);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !visitor?.id) return;
    let cancelled = false;
    setLoading(true);
    base44.entities.DocumentScan.filter({ related_id: visitor.id, related_entity: "Visitor" })
      .then((rows) => { if (!cancelled) setScans(rows || []); })
      .catch(() => { if (!cancelled) setScans([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, visitor?.id]);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-sky-300 hover:text-sky-200"
      >
        <History className="w-3.5 h-3.5" />
        Scan history {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {loading && <p className="text-slate-500 text-xs">Loading…</p>}
          {!loading && scans.length === 0 && <p className="text-slate-500 text-xs">No scan history.</p>}
          {scans.map((s) => (
            <div key={s.id} className="rounded-lg bg-slate-900/70 border border-slate-800 p-3 space-y-2">
              <div className="flex items-center gap-2">
                {s.photo_url && (
                  <img src={s.photo_url} alt="scan" className="w-8 h-10 object-cover rounded border border-slate-600" style={{ imageRendering: "pixelated" }} />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold capitalize">{s.document_type?.replace("_", " ")}</p>
                  <p className="text-slate-400 text-xs">{s.time ? new Date(s.time).toLocaleString() : ""}</p>
                  <p className="text-slate-500 text-xs">Scanner: {s.sdk_version || "—"} · {s.barcode_type || "—"}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${s.success ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                  {s.success ? "ok" : "fail"}
                </span>
              </div>
              {s.raw_json && (
                <details className="text-xs">
                  <summary className="text-slate-400 cursor-pointer">Original JSON</summary>
                  <pre className="mt-1 max-h-40 overflow-auto bg-slate-950 text-slate-300 p-2 rounded whitespace-pre-wrap break-all">{s.raw_json}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}