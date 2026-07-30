/**
 * barKoder Phase 1 — Scanner Component
 *
 * A reusable, mobile-friendly full-screen scanner modal.
 *
 * Enabled decoders: PDF417 (SA driver's licence) + QR Code only.
 * Single-result mode: stops after the first valid result, prevents duplicate
 * callbacks, and gives audible + visual confirmation.
 *
 * The rear-facing camera is preferred. Camera access is requested only after
 * the user opens the scanner. On close, the SDK stops and releases the camera.
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X, Zap, RefreshCw, AlertCircle, Camera, Loader2, ScanLine } from "lucide-react";
import * as barkoder from "@/lib/barkoderService";
import BarkoderReviewPanel from "@/components/barkoder/BarkoderReviewPanel";

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
  license_missing: { title: "Licence not configured", body: "Ask an administrator to set VITE_BARKODER_LICENSE_KEY before using the barKoder scanner." },
  license_error: { title: "Licence error", body: "The barKoder licence is invalid, expired, or not authorised for this domain." },
  insecure_context: { title: "Secure context required", body: "Camera access and WASM streaming require HTTPS. Open the app over a secure connection." },
  wasm_error: { title: "Scanner engine error", body: "Failed to load the barKoder WebAssembly engine. Check your connection and try again." },
  init_error: { title: "Initialization failed", body: "The barKoder scanner could not initialize. Try again." },
  camera_denied: { title: "Camera permission denied", body: "Allow camera access in your browser settings to scan barcodes." },
  no_camera: { title: "No camera found", body: "No camera device was detected on this device." },
  camera_in_use: { title: "Camera in use", body: "The camera is already in use by another application. Close it and retry." },
  not_detected: { title: "No barcode detected", body: "No barcode was detected before the scan timed out. Try again with better lighting and framing." }
};

export default function BarkoderScanner({ onClose, onAccept }) {
  const [status, setStatus] = useState("loading"); // loading | scanning | result | error
  const [error, setError] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [flashOn, setFlashOn] = useState(false);
  const [result, setResult] = useState(null);
  const [photoUrl, setPhotoUrl] = useState(null);
  const processingRef = useRef(false);

  const reportError = useCallback((err) => {
    setError(err);
    setStatus("error");
  }, []);

  // Initialize + start scanning on mount
  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (!barkoder.isLicenseConfigured()) {
        return reportError({ type: "license_missing" });
      }
      if (typeof window !== "undefined" && !window.isSecureContext) {
        return reportError({ type: "insecure_context" });
      }
      try {
        await barkoder.initializeBarkoder();
        if (cancelled) return;

        // Enumerate cameras (may trigger the permission prompt)
        try {
          const cams = await barkoder.getCameras();
          if (cancelled) return;
          setCameras(cams);
          const rear = cams.find(c => /back|rear|environment/i.test(c.label || c.facingMode || ""));
          if (rear) {
            const id = rear.id || rear.deviceId;
            await barkoder.setCameraId(id);
            setSelectedCamera(id);
          }
        } catch (e) {
          const msg = String(e?.name || e?.message || e).toLowerCase();
          if (msg.includes("notallowed") || msg.includes("denied")) return reportError({ type: "camera_denied" });
          if (msg.includes("notfound") || msg.includes("devices")) return reportError({ type: "no_camera" });
        }

        beginScanning();
      } catch (e) {
        if (!cancelled) reportError(e);
      }
    };

    start();
    return () => {
      cancelled = true;
      barkoder.stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginScanning = useCallback(async () => {
    setStatus("loading");
    setError(null);
    setResult(null);
    setPhotoUrl(null);
    processingRef.current = false;
    try {
      await barkoder.initializeBarkoder();
      barkoder.startScanner((raw) => {
        // Ignore repeated results while processing / error frames / empty frames
        if (processingRef.current) return;
        if (!raw) return;
        if (raw.error) return;
        if (raw.resultsCount === 0) return;
        if (!raw.textualData && !(raw.results && raw.results.length)) return;

        processingRef.current = true;
        barkoder.stopScanner();
        handleResult(raw);
      });
      setStatus("scanning");
      barkoder.logDebug("camera_started");
    } catch (e) {
      reportError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResult = useCallback(async (raw) => {
    const parsed = barkoder.parseResult(raw);
    barkoder.logDebug("barcode_detected", { type: parsed.barcodeType });
    barkoder.logDebug("formatted_json_present", { yes: !!parsed.formattedJSON });

    let photo = null;
    if (parsed.formattedJSON) {
      photo = await barkoder.getSadlPhoto(parsed.textualData);
    }
    barkoder.logDebug("sadl_photo_present", { yes: !!photo });

    setResult(parsed);
    setPhotoUrl(photo);
    setStatus("result");
    playBeep();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = useCallback(() => {
    barkoder.stopScanner();
    onClose?.();
  }, [onClose]);

  const handleScanAgain = useCallback(() => {
    beginScanning();
  }, [beginScanning]);

  const handleAccept = useCallback(() => {
    barkoder.stopScanner();
    onAccept?.({ result, photoUrl });
  }, [onAccept, result, photoUrl]);

  const handleCameraChange = useCallback(async (id) => {
    setSelectedCamera(id);
    try {
      await barkoder.setCameraId(id);
      if (status === "scanning") barkoder.stopScanner();
      beginScanning();
    } catch (_) {}
  }, [status, beginScanning]);

  const handleFlashToggle = useCallback(() => {
    barkoder.toggleFlash();
    setFlashOn(v => !v);
  }, []);

  const errMsg = error ? (ERROR_MESSAGES[error.type] || ERROR_MESSAGES.init_error) : null;

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <h2 className="text-white font-semibold text-sm">barKoder Scanner</h2>
        <button onClick={handleClose} className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-slate-300 active:bg-slate-700">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scanner viewport — explicit size required by the SDK */}
      <div className="relative flex-1 mx-3 rounded-2xl overflow-hidden bg-black border border-slate-700/50 min-h-[280px]">
        {/* The SDK attaches its camera preview to this element */}
        <div
          id="barkoder-container"
          className="absolute inset-0"
          style={{ width: "100%", height: "100%", minWidth: 280, minHeight: 280, background: "#000" }}
        />

        {/* Overlay frame + instruction */}
        {status === "scanning" && (
          <div className="absolute inset-0 pointer-events-none flex flex-col">
            <div className="flex-1 flex items-center justify-center">
              <div className="w-[80%] max-w-sm aspect-[3/2] border-2 border-sky-400/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] relative">
                <ScanLine className="absolute top-1/2 left-0 right-0 mx-auto w-full h-8 text-sky-400/60 animate-pulse" />
              </div>
            </div>
            <p className="text-center text-slate-200 text-xs px-6 pb-6">
              Align the barcode on the back of the driver's licence inside the frame
            </p>
          </div>
        )}

        {/* Loading overlay */}
        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
            <p className="text-slate-300 text-sm">Starting camera…</p>
          </div>
        )}

        {/* Error overlay */}
        {status === "error" && errMsg && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 bg-slate-950/95">
            <AlertCircle className="w-12 h-12 text-rose-400" />
            <div className="text-center">
              <h3 className="text-white font-semibold text-base mb-1">{errMsg.title}</h3>
              <p className="text-slate-400 text-sm">{errMsg.body}</p>
            </div>
            <Button onClick={beginScanning} className="bg-sky-500 hover:bg-sky-600">
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </div>
        )}

        {/* Result review panel */}
        {status === "result" && result && (
          <BarkoderReviewPanel
            result={result}
            photoUrl={photoUrl}
            onAccept={handleAccept}
            onScanAgain={handleScanAgain}
            onCancel={handleClose}
          />
        )}
      </div>

      {/* Controls */}
      {status !== "result" && (
        <div className="shrink-0 p-3 flex items-center gap-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
          {cameras.length > 1 && (
            <select
              value={selectedCamera || ""}
              onChange={e => handleCameraChange(e.target.value)}
              className="flex-1 bg-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2.5 border border-slate-700"
            >
              {cameras.map(c => (
                <option key={c.id || c.deviceId} value={c.id || c.deviceId}>
                  {c.label || "Camera"}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleFlashToggle}
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${flashOn ? "bg-amber-500 text-white" : "bg-slate-800 text-slate-300"}`}
            aria-label="Toggle torch"
          >
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