/**
 * DocumentCamera — guided live capture for physical ID document photos.
 *
 * ROBUST CAMERA INIT SEQUENCE (fixes the black-preview bug):
 *   1. Progressive getUserMedia constraint fallback (advanced → environment → any).
 *   2. The <video> element is MOUNTED during "starting" and "live" phases —
 *      the stream is attached to a real element, never to a null ref.
 *   3. Wait for loadedmetadata → play() → readyState >= 2 with non-zero
 *      videoWidth/videoHeight — only then is the camera marked READY and
 *      Capture Photo enabled.
 *   4. Autofocus capabilities are applied only AFTER the preview is live and
 *      only if the device reports them (getCapabilities) — unsupported focus
 *      can never break the preview.
 *   5. Stream tracks are stopped ONLY on final unmount / leaving the live
 *      camera — never by ordinary re-renders.
 *
 * On capture the image is TRULY cropped from the ORIGINAL camera-resolution
 * frame to the guide area before anything is saved. The darkened surround
 * darkens only OUTSIDE the guide (a box-shadow ring) — the guide interior is
 * fully transparent to the live video.
 *
 * Physical document PHOTO subsystem only — Barkoder/SecureScan is untouched.
 */
import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Camera, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Image as ImageIcon,
} from "lucide-react";
import { guideForIdType, visibleSourceRect, cropToGuide, captureWarnings } from "@/lib/documentPhoto";

// Progressive camera constraints — never fail because an advanced
// resolution/facing combination is unsupported on a device.
const CAMERA_CONSTRAINTS = [
  { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false },
  { video: { facingMode: "environment" }, audio: false },
  { video: true, audio: false },
];

export default function DocumentCamera({ title, idType = "sa_id", onUse, onCancel }) {
  const [phase, setPhase] = useState("starting"); // starting | live | still | preview | denied
  const [errorMsg, setErrorMsg] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [statusLine, setStatusLine] = useState(null);
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
  const cancelledRef = useRef(false);

  const guide = guideForIdType(idType);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  /**
   * Attach the stream to the (mounted) video element and wait until REAL
   * video frames are available: loadedmetadata → play() → readyState >= 2
   * with non-zero videoWidth/videoHeight.
   */
  const attachAndWaitForFrames = async (stream) => {
    const video = videoRef.current;
    if (!video) return false;
    video.srcObject = stream;
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        const done = () => {
          video.removeEventListener("loadedmetadata", done);
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, 5000);
        video.addEventListener("loadedmetadata", done);
      });
    }
    try { await video.play(); } catch (_) {}
    for (let i = 0; i < 80; i++) {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0;
  };

  const startCamera = async () => {
    cancelledRef.current = false;
    setPhase("starting");
    setErrorMsg(null);
    setWarnings([]);
    setStatusLine(null);
    setCameraReady(false);

    // 1) Request the stream with progressive constraint fallback
    let stream = null;
    let lastErr = null;
    for (const constraints of CAMERA_CONSTRAINTS) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (e) { lastErr = e; }
    }
    if (cancelledRef.current) {
      stream?.getTracks().forEach((t) => t.stop());
      return;
    }
    if (!stream) {
      setPhase("denied");
      setErrorMsg(
        lastErr?.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser/app settings, or choose an existing photo below."
          : "The camera could not be opened on this device. You can retry, or choose an existing photo below."
      );
      return;
    }
    streamRef.current = stream;
    // "live" mounts the <video> element (if not already mounted) and shows the guide
    setPhase("live");

    // 2) Attach + wait until real frames are flowing
    const framesReady = await attachAndWaitForFrames(stream);
    if (cancelledRef.current) { stopStream(); return; }

    // 3) Focus capabilities only AFTER the preview is live, only if supported
    const track = stream.getVideoTracks()[0];
    try {
      const caps = track?.getCapabilities?.();
      if (caps?.focusMode?.includes?.("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
      }
    } catch (_) {}
    if (cancelledRef.current) { stopStream(); return; }

    // 4) Ready gate — Capture Photo stays disabled until this is true
    if (framesReady) {
      setCameraReady(true);
    } else {
      stopStream();
      setPhase("denied");
      setErrorMsg("The camera opened but no video image is available. Close any other app using the camera and try again.");
    }
  };

  // Start once on mount; stop tracks ONLY on final unmount. Ordinary
  // re-renders never touch the stream.
  useEffect(() => {
    startCamera();
    return () => {
      cancelledRef.current = true;
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
        gw = gh * guide.aspect;
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

  // Tap-to-focus — only when the camera is READY and the device supports it
  const tapToFocus = async (e) => {
    if (phase !== "live" || !cameraReady || !streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    const video = videoRef.current;
    if (!track || !video) return;
    try {
      const caps = track.getCapabilities?.();
      if (!caps?.focusMode?.includes?.("single-shot")) return;
      const r = video.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      setStatusLine("Focusing…");
      await track.applyConstraints({ advanced: [{ focusMode: "single-shot", pointsOfInterest: [x, y] }] });
      setTimeout(() => setStatusLine(null), 800);
    } catch (_) {}
  };

  const setPreviewFromCrop = (crop) => {
    if (!crop) {
      setStatusLine("Capture failed — please try again.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(crop.file);
    setPreviewUrl(objectUrlRef.current);
    setPreviewFile(crop.file);
    setWarnings(captureWarnings(crop));
    stopStream(); // leaving the live camera after a successful capture
    setPhase("preview");
  };

  // Capture from the LIVE video frame — guarded: no capture unless real
  // frames are actually available.
  const grabFrame = async () => {
    const video = videoRef.current, container = containerRef.current, guideEl = guideRef.current;
    if (!video || !video.videoWidth || video.readyState < 2) {
      setStatusLine("Camera is not ready yet. Please wait.");
      setTimeout(() => setStatusLine(null), 2500);
      return;
    }
    if (!container || !guideEl) return;
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
          {phase === "still" ? (
            <img ref={stillImgRef} src={stillUrl} alt="Document" className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
          )}

          {/* Initialising overlay — removed the moment the live phase begins
              (frames verified separately before CAMERA READY). */}
          {phase === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-slate-300 animate-spin" />
              <p className="text-slate-300 text-sm">INITIALISING CAMERA…</p>
            </div>
          )}

          {/* Camera status chip */}
          {phase === "live" && (
            <div className={`absolute top-2 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-full flex items-center gap-1.5 z-10 ${cameraReady ? "bg-emerald-600/85 text-white" : "bg-slate-900/85 text-slate-200"}`}>
              {cameraReady
                ? <><CheckCircle2 className="w-3 h-3" /> CAMERA READY</>
                : <><Loader2 className="w-3 h-3 animate-spin" /> STARTING CAMERA…</>}
            </div>
          )}

          {statusLine && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-900/90 text-slate-200 text-xs px-3 py-1.5 rounded-full z-10">
              {statusLine}
            </div>
          )}

          {/* Document alignment guide — the darkened surround is a box-shadow
              RING outside the frame only; the guide interior is fully
              transparent to the live video underneath. */}
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
        </div>
      )}

      {phase === "denied" && (
        <div className="space-y-3">
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1">
            <p className="text-amber-300 text-sm font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> CAMERA UNAVAILABLE
            </p>
            <p className="text-amber-300/90 text-sm">{errorMsg}</p>
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
        <Button onClick={grabFrame} disabled={!cameraReady} variant="brand" className="w-full h-12">
          {cameraReady
            ? <><Camera className="w-4 h-4 mr-2" /> Capture Photo</>
            : <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting camera…</>}
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