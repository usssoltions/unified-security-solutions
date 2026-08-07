/**
 * USS Guard — DocumentScanner (Phase 3)
 *
 * The universal document scanner for the whole platform. One component,
 * one service, one SDK instance. Auto-detects the document type from the
 * decoded barcode — the user never chooses.
 *
 * Usage:
 *   <DocumentScanner
 *     caller="resident_visitors"
 *     documentType="auto"            // optional; defaults to auto-detect
 *     onClose={...}
 *     onAccept={({ result, photoUrl, mappedFields, profile, resolvedProfileId, parserUsed, qrInfo, sdkVersion }) => {...}}
 *   />
 *
 * To restrict to a specific profile, pass documentType (e.g. "asset_barcode").
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Zap, RefreshCw, AlertCircle, Loader2, ScanLine } from "lucide-react";
import * as scanner from "@/lib/documentScannerService";
import DocumentScanReview from "@/components/documents/DocumentScanReview";

function playBeep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    osc.onended = () => ctx.close();
  } catch (_) { /* audio not available */ }
}

const ERROR_MESSAGES = {
  license_missing: { title: "Licence not configured", body: "Ask an administrator to set VITE_BARKODER_LICENSE_KEY before using the scanner." },
  license_error: { title: "Licence error", body: "The barKoder licence is invalid, expired, or not authorised for this domain." },
  insecure_context: { title: "Secure context required", body: "Camera access and WASM streaming require HTTPS." },
  wasm_error: { title: "Scanner engine error", body: "Failed to load the barKoder WebAssembly engine. Check your connection and try again." },
  init_error: { title: "Initialization failed", body: "The scanner could not initialize. Try again." },
  camera_denied: { title: "Camera permission denied", body: "Allow camera access in your browser settings to scan barcodes." },
  no_camera: { title: "No camera found", body: "No camera device was detected on this device." },
  camera_in_use: { title: "Camera in use", body: "The camera is already in use by another application. Close it and retry." },
  camera_unavailable: { title: "Camera unavailable", body: "This environment blocked camera access. The scanner can't run inside the builder preview — open the published app on a device over HTTPS." },
  camera_timeout: { title: "Camera not responding", body: "The camera didn't start in time. Grant camera permission, make sure no other app is using it, then retry." },
  not_detected: { title: "No barcode detected", body: "No barcode was detected before the scan timed out. Try again with better lighting and framing." },
  profile_not_active: { title: "Document type not enabled", body: "This document type is configured but not yet enabled." }
};

// The barKoder SDK reads `document.getElementById('barkoder-container')` ONCE
// at module-load time (static class field) and caches that element forever.
// If React re-creates the div on every open, the SDK keeps pointing at the old,
// detached element and the camera feed never starts. So we keep ONE persistent
// container element and re-attach it into the current viewport on each open —
// before the SDK is (re)initialized.
let _scannerContainer = null;
function ensureScannerContainer(wrapper) {
  if (!wrapper) return null;
  if (!_scannerContainer) {
    _scannerContainer = document.createElement("div");
    _scannerContainer.id = "barkoder-container";
  }
  Object.assign(_scannerContainer.style, {
    position: "absolute", inset: "0", width: "100%", height: "100%",
    minWidth: "280px", minHeight: "280px", background: "#000",
  });
  if (_scannerContainer.parentNode !== wrapper) wrapper.appendChild(_scannerContainer);
  return _scannerContainer;
}

export default function DocumentScanner({
  documentType = "auto",
  caller = null,
  onClose,
  onAccept,
}) {
  const profile = scanner.getProfile(documentType);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [flashOn, setFlashOn] = useState(false);
  const [result, setResult] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const [mappedFields, setMappedFields] = useState(null);
  const [resolved, setResolved] = useState(null); // { profileId, profile, parserUsed, qrInfo }
  const processingRef = useRef(false);
  const viewportRef = useRef(null);

  const reportError = useCallback((err) => { setError(err); setStatus("error"); }, []);

  useEffect(() => {
    let cancelled = false;
    let aborted = false;
    let watchdog = null;
    const start = async () => {
      if (typeof window !== "undefined" && !window.isSecureContext) return reportError({ type: "insecure_context" });
      // The builder preview runs in an iframe without camera permission — bail early
      // with a clear message instead of hanging forever on getUserMedia.
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function")
        return reportError({ type: "camera_unavailable" });
      // Attach the persistent #barkoder-container BEFORE the SDK loads/initializes,
      // so its cached container reference always points at a live, in-DOM element.
      ensureScannerContainer(viewportRef.current);
      // If init + camera start doesn't progress within 12s (e.g. a blocked/hung
      // getUserMedia in the preview iframe), surface a clear error + Retry.
      watchdog = setTimeout(() => { if (!cancelled) { aborted = true; console.warn("[barKoder] watchdog: camera start timed out"); reportError({ type: "camera_timeout" }); } }, 12000);
      try {
        await scanner.initializeBarkoder();
        console.log("[barKoder] DocumentScanner initialized");
        if (cancelled) return;
        const { supported } = await scanner.configureForProfile(documentType);
        if (cancelled) return;
        if (!supported) return reportError({ type: "profile_not_active" });

        try {
          const cams = await scanner.getCameras();
          if (cancelled || aborted) return;
          setCameras(cams);
          const primary = scanner.pickPrimaryRearCamera(cams);
          if (primary) {
            const id = primary.id || primary.deviceId;
            await scanner.setCameraId(id);
            setSelectedCamera(id);
            try { localStorage.setItem("barkoder_camera_id", String(id)); } catch (_) {}
            console.log("[barKoder] auto-selected camera", primary.label || id);
          }
        } catch (e) {
          const msg = String(e?.name || e?.message || e).toLowerCase();
          if (msg.includes("notallowed") || msg.includes("denied")) return reportError({ type: "camera_denied" });
          if (msg.includes("notfound") || msg.includes("devices")) return reportError({ type: "no_camera" });
        }
        if (cancelled || aborted) return;
        beginScanning();
      } catch (e) { if (!cancelled) reportError(e); }
      finally { if (watchdog) clearTimeout(watchdog); }
    };
    start();
    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
      scanner.stopScanner();
      scanner.resetInstance();
      if (_scannerContainer && _scannerContainer.parentNode) _scannerContainer.parentNode.removeChild(_scannerContainer);
      console.log("[barKoder] DocumentScanner unmount (instance reset for next open)");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType]);

  const beginScanning = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setResult(null);
    setPhotoUrl(null);
    setMappedFields(null);
    setResolved(null);
    processingRef.current = false;
    try {
      await scanner.configureForProfile(documentType);
      scanner.startScanner((raw) => {
        console.log("[barKoder] RAW DECODE RESULT (unmodified):", raw);
        console.log("[barKoder] result keys:", raw ? Object.keys(raw) : [],
          "| formattedJSON?", !!(raw?.formattedJSON || (raw?.results?.[0]?.formattedJSON)),
          "| textualData len:", (raw?.textualData || raw?.results?.[0]?.textualData || "").length);
        if (processingRef.current) return;
        if (!raw || raw.error) return;
        if (raw.resultsCount === 0) return;
        if (!raw.textualData && !(raw.results && raw.results.length)) return;
        processingRef.current = true;
        scanner.stopScanner();
        handleResult(raw);
      });
      setStatus("scanning");
      console.log("[barKoder] camera_started", { profile: documentType, caller });
      scanner.logDebug("camera_started", { profile: documentType, caller });
    } catch (e) { reportError(e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentType, caller]);

  const handleResult = useCallback(async (raw) => {
    const { parsed, profileId, profile: resolvedProfile, mappedFields: mapped, parserUsed, qrInfo } =
      scanner.resolveDocument(raw, caller, documentType);
    console.log("[barKoder] barcode_detected", { type: parsed.barcodeType, resolved: profileId, parsed: !!parsed.formattedJSON });
    scanner.logDebug("barcode_detected", { type: parsed.barcodeType, resolved: profileId });

    let photo = null;
    if (resolvedProfile.supportsPhoto && parsed.formattedJSON) {
      // Barkoder.getSADLImage needs the formatted JSON string (reads Fields[15..17]),
      // NOT the raw PDF417 textualData.
      photo = await scanner.getSadlPhoto(parsed.formattedJSONRaw);
    }
    console.log("[barKoder] photo_present", { yes: !!photo, source: parsed.formattedJSONSource });
    scanner.logDebug("photo_present", { yes: !!photo });

    setResult(parsed);
    setPhotoUrl(photo);
    setMappedFields(mapped);
    setResolved({ profileId, profile: resolvedProfile, parserUsed, qrInfo });
    setStatus("result");
    playBeep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caller]);

  const handleClose = useCallback(() => { scanner.stopScanner(); onClose?.(); }, [onClose]);
  const handleScanAgain = useCallback(() => { beginScanning(); }, [beginScanning]);
  const handleAccept = useCallback(() => {
    scanner.stopScanner();
    onAccept?.({
      result, photoUrl, mappedFields,
      profile: resolved?.profile,
      resolvedProfileId: resolved?.profileId,
      parserUsed: resolved?.parserUsed,
      qrInfo: resolved?.qrInfo,
      sdkVersion: scanner.SDK_VERSION,
    });
  }, [onAccept, result, photoUrl, mappedFields, resolved]);

  const handleCameraChange = useCallback(async (id) => {
    setSelectedCamera(id);
    try {
      await scanner.setCameraId(id);
      if (status === "scanning") scanner.stopScanner();
      beginScanning();
    } catch (_) {}
  }, [status, beginScanning]);

  const handleFlashToggle = useCallback(() => { scanner.toggleFlash(); setFlashOn((v) => !v); }, []);

  const errMsg = error ? (ERROR_MESSAGES[error.type] || ERROR_MESSAGES.init_error) : null;
  const backCameras = cameras.filter((c) => /back|rear|environment/i.test(c.label || c.facingMode || ""));
  const showCameraPicker = backCameras.length > 1;
  const headerLabel = documentType === "auto" ? "Scan Document" : profile.label;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <h2 className="text-white font-semibold text-sm">{headerLabel}</h2>
        <button onClick={handleClose} className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 active:bg-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="relative flex-1 mx-3 rounded-2xl overflow-hidden bg-black border border-slate-700/50 min-h-[280px]">
        <div ref={viewportRef} className="absolute inset-0" style={{ width: "100%", height: "100%", minWidth: 280, minHeight: 280, background: "#000" }} />

        {status === "scanning" && (
          <div className="absolute inset-0 pointer-events-none flex flex-col">
            <div className="flex-1 flex items-center justify-center">
              <div className="w-[80%] max-w-sm aspect-[3/2] border-2 border-sky-400/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] relative">
                <ScanLine className="absolute top-1/2 left-0 right-0 mx-auto w-full h-8 text-sky-400/60 animate-pulse" />
              </div>
            </div>
            <p className="text-center text-slate-200 text-xs px-6 pb-6">{profile.instruction}</p>
          </div>
        )}

        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
            <p className="text-slate-300 text-sm">Starting camera…</p>
          </div>
        )}

        {status === "error" && errMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 bg-slate-950/95">
            <AlertCircle className="w-12 h-12 text-rose-400" />
            <div className="text-center">
              <h3 className="text-white font-semibold text-base mb-1">{errMsg.title}</h3>
              <p className="text-slate-400 text-sm">{errMsg.body}</p>
              {error?.message && (
                <p className="text-slate-500 text-[11px] mt-2 break-words font-mono">{error.message}</p>
              )}
            </div>
            <Button onClick={beginScanning} className="bg-sky-500 hover:bg-sky-600">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        )}

        {status === "result" && result && (
          <DocumentScanReview
            result={result}
            photoUrl={photoUrl}
            mappedFields={mappedFields}
            profile={resolved?.profile}
            qrInfo={resolved?.qrInfo}
            onAccept={handleAccept}
            onScanAgain={handleScanAgain}
            onCancel={handleClose}
          />
        )}
      </div>

      {status !== "result" && (
        <div className="shrink-0 p-3 flex items-center gap-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          {showCameraPicker && (
            <select value={selectedCamera || ""} onChange={(e) => handleCameraChange(e.target.value)}
              className="flex-1 bg-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2.5 border border-slate-700">
              {cameras.map((c) => (
                <option key={c.id || c.deviceId} value={c.id || c.deviceId}>{c.label || "Camera"}</option>
              ))}
            </select>
          )}
          <button onClick={handleFlashToggle}
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${flashOn ? "bg-amber-500 text-white" : "bg-slate-800 text-slate-300"}`}
            aria-label="Toggle torch">
            <Zap className="w-5 h-5" />
          </button>
          <Button onClick={handleClose} variant="outline" className="border-slate-600 text-slate-300">
            <X className="w-4 h-4 mr-1.5" /> Cancel
          </Button>
        </div>
      )}
    </div>
  );
}