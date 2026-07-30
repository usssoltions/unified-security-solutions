/**
 * barKoder Phase 1 — Result Review Panel
 *
 * Shown after a successful scan. Holds the result in component state only
 * (nothing is persisted to the database in Phase 1).
 *
 * Shows: barcode type, licence status (parsed/raw), all parsed key/value
 * fields from formattedJSON, the driver photograph when returned, a
 * collapsible technical diagnostics area (FIELD NAMES ONLY), and the
 * Accept Test Result / Scan Again / Cancel buttons.
 *
 * Privacy: the raw binary barcode data is never shown in the normal UI.
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, RefreshCw, X, ChevronDown, ChevronUp, User, FileWarning } from "lucide-react";

export default function BarkoderReviewPanel({ result, photoUrl, onAccept, onScanAgain, onCancel }) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const fields = result?.formattedJSON?.Fields || result?.formattedJSON || [];
  const fieldEntries = Array.isArray(fields)
    ? fields.map((f, i) => [f?.Field ?? `Field ${i}`, f?.Value])
    : Object.entries(result?.formattedJSON || {});

  const isParsed = !!result?.parsed;
  const hasPhoto = !!photoUrl;

  return (
    <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
        <h2 className="text-white font-semibold text-sm">Scan Result (Test)</h2>
        <button onClick={onCancel} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 text-xs font-medium border border-sky-500/30">
            {result?.barcodeType}
          </span>
          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
            isParsed
              ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
              : "bg-amber-500/15 text-amber-300 border-amber-500/30"
          }`}>
            {isParsed ? "Parsed (SADL)" : "Raw"}
          </span>
          {result?.malformedJSON && (
            <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 text-xs font-medium border border-rose-500/30">
              Malformed JSON
            </span>
          )}
        </div>

        {/* Driver photograph */}
        {hasPhoto && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-700/50">
            <img src={photoUrl} alt="Driver" className="w-20 h-[100px] object-cover rounded-lg border border-slate-600" style={{ imageRendering: "pixelated" }} />
            <div className="flex items-center gap-1.5 text-emerald-300 text-sm">
              <User className="w-4 h-4" /> Photograph extracted via official SADL helper
            </div>
          </div>
        )}

        {/* Parsed fields */}
        <div>
          <h3 className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">
            Parsed Fields {isParsed ? `(${fieldEntries.length})` : "— not parsed"}
          </h3>
          {isParsed && fieldEntries.length > 0 ? (
            <div className="space-y-1.5">
              {fieldEntries.map(([name, value], i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800">
                  <span className="text-slate-400 text-xs shrink-0">{String(name)}</span>
                  <span className="text-white text-sm text-right break-all">{String(value ?? "")}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-300 text-sm p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <FileWarning className="w-4 h-4" /> PDF417 decoded but SADL parsing unavailable or not a driver's licence.
            </div>
          )}
        </div>

        {/* Collapsible technical diagnostics — FIELD NAMES ONLY */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <button
            onClick={() => setShowDiagnostics(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-slate-300 text-xs font-medium"
          >
            <span>Technical diagnostics (field names only)</span>
            {showDiagnostics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showDiagnostics && (
            <div className="px-3 pb-3 space-y-2 text-xs">
              <div>
                <span className="text-slate-500">formattedJSON present:</span>{" "}
                <span className="text-slate-200">{result?.formattedJSON ? "yes" : "no"}</span>
              </div>
              <div>
                <span className="text-slate-500">SADL photograph present:</span>{" "}
                <span className="text-slate-200">{hasPhoto ? "yes" : "no"}</span>
              </div>
              <div>
                <span className="text-slate-500">Result top-level keys:</span>{" "}
                <span className="text-slate-200">{(result?.rawResultKeys || []).join(", ") || "none"}</span>
              </div>
              {result?.formattedJSON && (
                <div>
                  <span className="text-slate-500">formattedJSON keys:</span>{" "}
                  <span className="text-slate-200">{Object.keys(result.formattedJSON).join(", ")}</span>
                </div>
              )}
              <div>
                <span className="text-slate-500">Scan timestamp:</span>{" "}
                <span className="text-slate-200">{result?.timestamp}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="shrink-0 border-t border-slate-700/50 p-3 grid grid-cols-3 gap-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <Button variant="outline" onClick={onCancel} className="border-slate-600 text-slate-300">
          <X className="w-4 h-4 mr-1.5" /> Cancel
        </Button>
        <Button variant="outline" onClick={onScanAgain} className="border-slate-600 text-sky-300">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Scan Again
        </Button>
        <Button onClick={onAccept} className="bg-emerald-500 hover:bg-emerald-600 text-white">
          <CheckCircle2 className="w-4 h-4 mr-1.5" /> Accept
        </Button>
      </div>
    </div>
  );
}