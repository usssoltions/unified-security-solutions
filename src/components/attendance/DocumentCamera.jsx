/**
 * DocumentCamera — guided live capture for physical ID document photos.
 *
 * • Rear (environment) camera by default; continuous autofocus where
 *   supported; tap-to-focus; short focus-settle before capture is enabled.
 * • A document alignment guide (ID-1 landscape card / portrait page) overlays
 *   the preview with the instruction to fill the guide with the document.
 * • On capture the image is TRULY cropped from the ORIGINAL camera-resolution
 *   frame to the guide area before anything is saved — the full camera frame
 *   (table/bed/hands/background) is never stored or uploaded.
 * • Shows the CROPPED preview with Use Photo / Retake.
 * • Gallery fallback (same guided crop) if the camera is unavailable.
 *
 * Physical document PHOTO subsystem only — Barkoder/SecureScan is untouched.
 */
import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Camera, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Image as ImageIcon,
} from "lucide-react";
import { guideForIdType, visibleSourceRect, cropToGuide, captureWarnings } from "@/lib/documentPhoto";

export default function DocumentCamera({ title, idType = "sa_id", onUse, onCancel }) {
  const [phase, setPhase] = useState("starting"); // starting | live | still | preview | denied
  const [errorMsg, setErrorMsg] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [focusSettling, setFocusSettling] = useState(true);
  const [guideStyle, setGuideStyle] = useState({});
  const [stillUrl, setStillUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [retakeSource, setRetakeSource] = useState("camera");

  const videoRef = useRef(null);
  const stillImgRef = useRef(null);
  const containerRef = useRef(null);
  const guideRef = useRef(null);
  const streamRef = useRef(null);
  const objectUrlRef = useRef(null);

  const guide = guideForIdType(idType);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  // Start the rear camera with the highest practical resolution
  const startCamera = async () => {
    setPhase("starting");
    setErrorMsg(null);
    setWarnings([]);
    setFocusSettling(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1440 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      // Continuous autofocus where supported (harmless if unsupported)
      const track = stream.getVideoTracks()[0];
      if (track) {
        try { await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (_) {}
      }
      setRetakeSource("camera");
      setPhase("live");
      // Short focus-settle period — capture is disabled while the camera focuses
      setTimeout(() => setFocusSettling(false), 900);
    } catch (e) {
      setPhase("denied");
      setErrorMsg(
        e?.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser/app settings, or choose an existing photo below."
          : "The camera is unavailable on this device. You can retry, or choose an existing photo below."
      );
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      stopStream();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guide geometry — scales with the viewport, always preserving the
  // physical document aspect ratio.
  useEffect(() => {
    if (phase !== "live" && phase !== "still") return;
    const c = containerRef.current;
    if (!c) return;
    const measure = () => {
      const cw = c.clientWidth, ch = c.clientHeight;
      let gw, gh;
      if (guide.orientation === "landscape") {
        gw = cw * 0.86;
        gh = gw / guide.aspect;
        if (gh > ch * 0.58) { gh = ch * 0.58; gw = gh * guide.aspect; }
      } else {
        gh = ch * 0.62;
        gw = gh / guide.aspect;
        if (gw > cw * 0.86) { gw = cw * 0.86; gh = gw / guide.aspect; }
      }
      setGuideStyle({
        left: Math.round((cw - gw) / 2),
        top: Math.round((ch - gh) / 2),
        width: Math.round(gw),
        height: Math.round(gh),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [phase, guide]);

  // Tap-to-focus (where the device/browser permits it)
  const tapToFocus = async (e) => {
    if (phase !== "live" || !streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    const video = videoRef.current;
    if (!track || !video) return;
    const r = video.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setFocusSettling(true);
    try { await track.applyConstraints({ advanced: [{ focusMode: "single-shot", pointsOfInterest: [x, y] }] }); } catch (_) {}
    setTimeout(() => setFocusSettling(false), 700);
  };

  const setPreviewFromCrop = (crop) => {
    if (!crop) {
      setErrorMsg("Capture failed — please retake.");
      setPhase("denied");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(crop.file);
    setPreviewUrl(objectUrlRef.current);
    setPreviewFile(crop.file);
    setWarnings(captureWarnings(crop));
    stopStream();
    setPhase("preview");
  };

  // Capture from the LIVE video frame (object-fit: cover mapping)
  const grabFrame = async () => {
    const video = videoRef.current, container = containerRef.current, guideEl = guideRef.current;
    if (!video || !container || !guideEl || !video.videoWidth) return;
    const rect = visibleSourceRect({
      mediaW: video.videoWidth, mediaH: video.videoHeight,
      cw: container.clientWidth, ch: container.clientHeight,
      fit: "cover", guideEl, container,
    });
    setPreviewFromCrop(await cropToGuide(video, rect));
  };

  // Crop the chosen gallery photo (object-fit: contain mapping) — still from
  // the ORIGINAL file resolution, never a thumbnail.
  const grabStill = async () => {
    const img = stillImgRef.current, container = containerRef.current, guideEl = guideRef.current;
    if (!img || !container || !guideEl || !img.naturalWidth) return;
    const rect = visibleSourceRect({
      mediaW: img.naturalWidth, mediaH: img.naturalHeight,
      cw: container.clientWidth, ch: container.clientHeight,
      fit: "contain", guideEl, container,
    });
    setPreviewFromCrop(await cropToGuide(img, rect));
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(f);
    setStillUrl(objectUrlRef.current);
    setRetakeSource("still");
    setPhase("still");
  };

  const handleRetake = () => {
    setPreviewUrl(null);
    setPreviewFile(null);
    setWarnings([]);
    if (retakeSource === "still" && stillUrl) {
      setPhase("still");
    } else {
      startCamera();
    }
  };

  const textTop = guideStyle.top != null ? Math.max(6, guideStyle.top - 24) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-white text-sm font-semibold">{title}</p>
        <Button variant="ghost" onClick={onCancel} className="text-slate-400 h-9">Cancel</Button>
      </div>

      {(phase === "starting" || phase === "live" || phase === "still") && (
        <div
          ref={containerRef}
          onClick={phase === "live" ? tapToFocus : undefined}
          className="relative w-full h-[56vh] max-h-[520px] bg-black rounded-xl overflow-hidden"
        >
          {phase === "live" ? (
            <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
          ) : phase === "still" ? (
            <img ref={stillImgRef} src={stillUrl} alt="Document" className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
              <p className="text-slate-400 text-sm">Starting camera…</p>
            </div>
          )}

          {/* Document alignment guide — darkened surround + frame */}
          {guideStyle.width != null && (
            <>
              <div
                ref={guideRef}
                className="absolute rounded-lg pointer-events-none"
                style={{
                  left: guideStyle.left, top: guideStyle.top,
                  width: guideStyle.width, height: guideStyle.height,
                  boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.55)",
                  border: "2px solid rgba(255, 255, 255, 0.85)",
                }}
              >
                <span className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-[var(--brand-accent)] rounded-tl-md" />
                <span className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-[var(--brand-accent)] rounded-tr-md" />
                <span className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-[var(--brand-accent)] rounded-bl-md" />
                <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-[var(--brand-accent)] rounded-br-md" />
              </div>
              <p
                className="absolute left-2 right-2 text-center text-white/90 text-xs font-medium"
                style={{ top: textTop }}
              >
                Position the document inside the frame and move closer until it fills the guide.
              </p>
            </>
          )}

          {phase === "live" && focusSettling && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-slate-900/80 text-slate-200 text-xs px-3 py-1 rounded-full flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Focusing…
            </div>
          )}
        </div>
      )}

      {phase === "denied" && (
        <div className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2 text-amber-300 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {errorMsg}
          </div>
          <Button onClick={startCamera} variant="brand" className="w-full h-12">
            <Camera className="w-4 h-4 mr-2" /> Retry Camera
          </Button>
          <label htmlFor="doc-cam-gallery" className="cursor-pointer block">
            <span className="flex items-center justify-center gap-2 h-12 w-full rounded-md border border-[var(--border-default)] text-slate-200 active:scale-95 transition">
              <ImageIcon className="w-4 h-4" /> Choose from Gallery
            </span>
            <input id="doc-cam-gallery" type="file" accept="image/*" className="hidden" onChange={pickFile} />
          </label>
        </div>
      )}

      {phase === "live" && (
        <Button onClick={grabFrame} disabled={focusSettling} variant="brand" className="w-full h-12">
          {focusSettling
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Focusing…</>
            : <><Camera className="w-4 h-4 mr-2" /> Capture Photo</>}
        </Button>
      )}

      {phase === "still" && (
        <Button onClick={grabStill} variant="brand" className="w-full h-12">
          <CheckCircle2 className="w-4 h-4 mr-2" /> Use Photo
        </Button>
      )}

      {phase === "preview" && (
        <>
          <div className="bg-black rounded-xl overflow-hidden border border-[var(--border-default)]">
            <img src={previewUrl} alt="Cropped document" className="w-full max-h-[48vh] object-contain" />
          </div>
          {warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1">
              {warnings.map((w) => (
                <p key={w} className="text-amber-300 text-xs flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleRetake} className="flex-1 border-[var(--border-default)] text-slate-200 h-12">
              <RefreshCw className="w-4 h-4 mr-1.5" /> Retake
            </Button>
            <Button onClick={() => onUse(previewFile)} variant="brand" className="flex-1 h-12">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Use Photo
            </Button>
          </div>
        </>
      )}
    </div>
  );
}