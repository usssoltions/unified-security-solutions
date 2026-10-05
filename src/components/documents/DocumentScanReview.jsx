/**
 * USS Guard — Document Scan Review (Phase 3)
 *
 * Generic review panel for any resolved document profile. Displays the
 * mapped entity fields, photo (when present), all parsed fields, QR
 * classification, and a collapsible diagnostics area.
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, RefreshCw, X, ChevronDown, ChevronUp, User, FileWarning, IdCard, QrCode, Loader2 } from "lucide-react";

const HIDDEN_KEYS = new Set(["_raw"]);
// SADL image fields rendered as the photo (handled separately) — never as text.
const HIDDEN_PARSED_KEYS = ["imagerawbase64", "image width", "image height"];

// TRUNCATED-DECODE DETECTION: a partial PDF417 decode (typical when the camera
// is too far, the lens slow, or the barcode not flat) yields mid-string
// fragments such as "…OF…" or "…5097…" in place of complete values. The
// display layer never clips these — they ARE the decoded data — so they must
// be flagged at review time and never treated as complete details.
const FRAGMENT_RE = /(\.{3,}|\u2026)/;
const CRITICAL_FIELDS = {
  drivers_licence: ["surname", "driver_licence_number"],
  sa_id: ["surname", "visitor_id_number"],
  passport: ["surname", "visitor_id_number"],
  vehicle_disc: ["registration_number"],
};
function fieldLabel(k) { return String(k).replace(/_/g, " "); }
export function assessScanCompleteness(result, mappedFields, profile) {
  const issues = [];
  if (!result?.parsed || result?.malformedJSON) {
    issues.push("The barcode was decoded but structured parsing was not available");
  }
  const crit = CRITICAL_FIELDS[profile?.id];
  if (crit) {
    for (const f of crit) {
      const v = String(mappedFields?.[f] ?? "").trim();
      if (!v) issues.push(`Missing value: ${fieldLabel(f)}`);
      else if (FRAGMENT_RE.test(v)) issues.push(`Fragmented (truncated) value: ${fieldLabel(f)}`);
    }
  }
  return issues;
}

export default function DocumentScanReview({
  result, photoUrl, mappedFields, profile, qrInfo,
  onAccept, onScanAgain, onCancel,
}) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  // IDEMPOTENT ACCEPT (first-tap fix): the caller's onAccept does async work
  // (visitor resolve/create + visit count) before the workflow advances, so
  // the very first tap must instantly show "Continuing…" and lock the panel —
  // otherwise the button looks dead and a guard taps 2–3 times, each tap
  // re-entering the handler concurrently. One tap → exactly one dispatch.
  const [accepting, setAccepting] = useState(false);
  const handleAcceptClick = () => {
    if (accepting) return;
    setAccepting(true);
    onAccept?.();
  };

  const fields = result?.formattedJSON?.Fields || result?.formattedJSON || [];
  const allParsedEntries = Array.isArray(fields)
    ? fields.map((f, i) => [f?.Field ?? `Field ${i}`, f?.Value])
    : Object.entries(result?.formattedJSON || {});
  // Hide the raw Base64 photo + dimension fields — the photo is rendered above.
  const fieldEntries = allParsedEntries.filter(([k]) =>
    k && !HIDDEN_PARSED_KEYS.includes(String(k).toLowerCase())
  );

  const isParsed = !!result?.parsed;
  const hasPhoto = !!photoUrl;

  // Mapped fields excluding internal/hidden + empty values
  const mappedEntries = Object.entries(mappedFields || {})
    .filter(([k, v]) => !HIDDEN_KEYS.has(k) && v != null && v !== "");

  const isQR = profile?.id === "qr";
  const primaryName = mappedFields?.visitor_name || mappedFields?.registration_number || "";
  const completenessIssues = assessScanCompleteness(result, mappedFields, profile);
  const incomplete = completenessIssues.length > 0;

  return (
    <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-md flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 shrink-0">
        <h2 className="text-white font-semibold text-sm">{profile?.label || "Scan Result"}</h2>
        <button onClick={onCancel} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 text-xs font-medium border border-sky-500/30">
            {result?.barcodeType}
          </span>
          <span className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
            isParsed ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border-amber-500/30"
          }`}>{isParsed ? "Parsed" : "Raw"}</span>
          {result?.malformedJSON && (
            <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-300 text-xs font-medium border border-rose-500/30">Malformed JSON</span>
          )}
        </div>

        {/* QR classification */}
        {isQR && qrInfo && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
            <QrCode className="w-6 h-6 text-purple-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-purple-300 text-xs font-semibold uppercase tracking-wide">QR · {qrInfo.qrType}</p>
              <p className="text-white text-sm break-all font-mono">{String(qrInfo.payload ?? "")}</p>
              <p className="text-slate-400 text-xs mt-0.5">Caller: {qrInfo.caller || "—"}</p>
            </div>
          </div>
        )}

        {/* INCOMPLETE-SCAN FLAG — a fragmented/missing decode is never shown as
            complete details. Rescan is the primary action; accepting continues
            with the fragments so the operator can correct the values by hand. */}
        {incomplete && (
          <div className="rounded-xl border-2 border-rose-500/60 bg-rose-500/10 p-3 space-y-1">
            <p className="text-rose-300 text-sm font-bold uppercase tracking-wide flex items-center gap-2">
              <FileWarning className="w-4 h-4 shrink-0" /> Incomplete scan — not full document data
            </p>
            <p className="text-rose-200/90 text-xs">{completenessIssues.join(" · ")}</p>
            <p className="text-slate-300 text-xs">
              Scan Again and hold the barcode steady, close to the camera, well lit and flat
              — or Accept and correct the details manually.
            </p>
          </div>
        )}

        {/* Mapped summary */}
        {(primaryName || hasPhoto) && !isQR && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-sky-500/10 border border-sky-500/30">
            {hasPhoto ? (
              <img src={photoUrl} alt="Document" className="w-16 h-20 object-cover rounded-lg border border-slate-600 shrink-0" style={{ imageRendering: "pixelated" }} />
            ) : (
              <div className="w-16 h-20 rounded-lg bg-slate-800 border border-slate-600 flex items-center justify-center shrink-0">
                <IdCard className="w-7 h-7 text-slate-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sky-300 text-xs font-semibold uppercase tracking-wide mb-1">{profile?.label}</p>
              {primaryName && <p className="text-white text-base font-semibold break-words">{primaryName}</p>}
              {mappedFields?.visitor_id_number && <p className="text-slate-300 text-sm font-mono break-all">{mappedFields.visitor_id_number}</p>}
            </div>
          </div>
        )}

        {/* All mapped fields */}
        {mappedEntries.length > 0 && (
          <div>
            <h3 className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">Mapped Fields ({mappedEntries.length})</h3>
            <div className="space-y-1.5">
              {mappedEntries.map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800">
                  <span className="text-slate-400 text-xs shrink-0">{String(k).replace(/_/g, " ")}</span>
                  <span className="text-white text-sm text-right break-all">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* All parsed fields (verbatim) */}
        <div>
          <h3 className="text-slate-300 text-xs font-semibold uppercase tracking-wide mb-2">
            Parsed Fields {isParsed ? `(${fieldEntries.length})` : "— not parsed"}
          </h3>
          {isParsed && fieldEntries.length > 0 ? (
            <div className="space-y-1.5">
              {fieldEntries.map(([name, value], i) => {
                const v = String(value ?? "");
                const frag = FRAGMENT_RE.test(v);
                return (
                  <div key={i} className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/70 border border-slate-800">
                    <span className="text-slate-400 text-xs shrink-0">{String(name)}</span>
                    <span className={`text-sm text-right break-all ${frag ? "text-rose-300" : "text-white"}`}>{v}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-300 text-sm p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <FileWarning className="w-4 h-4" /> Barcode decoded but structured parsing unavailable.
            </div>
          )}
        </div>

        {/* Diagnostics */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <button onClick={() => setShowDiagnostics((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-slate-300 text-xs font-medium">
            <span>Technical diagnostics (field names only)</span>
            {showDiagnostics ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showDiagnostics && (
            <div className="px-3 pb-3 space-y-2 text-xs">
              <div><span className="text-slate-500">Profile:</span> <span className="text-slate-200">{profile?.id}</span></div>
              <div><span className="text-slate-500">formattedJSON present:</span> <span className="text-slate-200">{result?.formattedJSON ? "yes" : "no"}</span></div>
              <div><span className="text-slate-500">Photograph present:</span> <span className="text-slate-200">{hasPhoto ? "yes" : "no"}</span></div>
              <div><span className="text-slate-500">Result keys:</span> <span className="text-slate-200">{(result?.rawResultKeys || []).join(", ") || "none"}</span></div>
              {result?.formattedJSON && (
                <div><span className="text-slate-500">formattedJSON keys:</span> <span className="text-slate-200">{Object.keys(result.formattedJSON).join(", ")}</span></div>
              )}
              <div><span className="text-slate-500">Scan timestamp:</span> <span className="text-slate-200">{result?.timestamp}</span></div>
              {/* PREVIEW ENVIRONMENT: the camera track's actually-delivered
                  resolution etc. — shown on-device only inside builder Preview. */}
              {result?._envPreview ? (
                <div>
                  <span className="text-slate-500">Preview environment:</span>
                  <p className="text-slate-200 text-[11px] break-all font-mono mt-0.5">
                    camera {result._envPreview.video?.width || "?"}x{result._envPreview.video?.height || "?"}
                    {result._envPreview.video?.frameRate ? ` @ ${Math.round(result._envPreview.video.frameRate)}fps` : ""}
                    {" · viewport "}{result._envPreview.viewport?.w}x{result._envPreview.viewport?.h}
                    {" · screen "}{result._envPreview.screen?.w}x{result._envPreview.screen?.h}
                    {" @ "}{result._envPreview.dpr}x
                  </p>
                </div>
              ) : null}
              {/* RAW DECODE (diagnostics only): lets a phone-vs-tablet comparison
                  of the underlying decoded payload be made on-device. */}
              {result?.textualData ? (
                <div>
                  <span className="text-slate-500">Raw decoded payload ({result.textualData.length} chars):</span>
                  <p className="text-slate-200 text-[11px] break-all font-mono mt-0.5">{result.textualData}</p>
                </div>
              ) : <div><span className="text-slate-500">Raw decoded payload:</span> <span className="text-slate-200">none</span></div>}
              {result?.formattedText ? (
                <div>
                  <span className="text-slate-500">Formatted text:</span>
                  <p className="text-slate-200 text-[11px] break-all font-mono mt-0.5">{result.formattedText}</p>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-700/50 p-3 grid grid-cols-3 gap-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        <Button variant="outline" onClick={onCancel} disabled={accepting} className="border-slate-600 text-slate-300">
          <X className="w-4 h-4 mr-1.5" /> Cancel
        </Button>
        <Button variant="outline" onClick={onScanAgain} disabled={accepting} className="border-slate-600 text-sky-300">
          <RefreshCw className="w-4 h-4 mr-1.5" /> Scan Again
        </Button>
        <Button onClick={handleAcceptClick} disabled={accepting} variant={incomplete ? "outline" : "default"}
          className={incomplete ? "border-amber-500/50 text-amber-300" : "bg-emerald-500 hover:bg-emerald-600 text-white"}>
          {accepting ? (
            <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Continuing…</>
          ) : incomplete ? (
            <><CheckCircle2 className="w-4 h-4 mr-1.5" /> Accept & Correct</>
          ) : (
            <><CheckCircle2 className="w-4 h-4 mr-1.5" /> Accept</>
          )}
        </Button>
      </div>
    </div>
  );
}