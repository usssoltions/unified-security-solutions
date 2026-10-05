/**
 * DocumentCamera — guided live capture for physical ID document photos.
 *
 * LIVE AUTO-CAPTURE FLOW:
 *   1. The live video is analysed continuously (a downscaled offscreen copy,
 *      ~3-4 fps): the document's actual four corners are detected via
 *      scan-line edge crossings + RANSAC side fits (liveDocDetect).
 *   2. The detected quad is drawn live: amber while the document is incomplete
 *      / blurred / glared, GREEN once all four corners sit inside the guide
 *      with sufficient quality — then, after the document has remained steady
 *      for ~1.2 s, the frame is captured AUTOMATICALLY.
 *   3. A manual Capture button always remains available as fallback — manual
 *      corner-dragging is never forced when the document is clearly aligned.
 *   4. After capture the SAME detection runs at higher quality on the
 *      full-resolution frame: the document is straightened and cropped to its
 *      actual edges and the result is ALWAYS shown for approval (Retake /
 *      Adjust / Use) — nothing is uploaded or saved before approval.
 *
 * ROBUST CAMERA INIT (unchanged): progressive getUserMedia fallback, video
 * mounted during starting/live, frames verified before CAPTURE is enabled,
 * autofocus applied only when supported, tracks stopped only on final unmount.
 *
 * Physical document PHOTO subsystem only — Barkoder/SecureScan is untouched.
 */
import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Camera, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Image as ImageIcon, Crop,
} from "lucide-react";
import { guideForIdType, visibleSourceRect, cropToGuide, captureWarnings } from "@/lib/documentPhoto";
import {
  detectDocumentQuad, warpQuadToJpegFile, fileToCanvas, quadToFrac, fracToQuad,
} from "@/lib/documentEdgeDetect";
import {
  detectQuadImageData, detectQuadCanvas, plausibleRatiosForIdType,
} from "@/lib/liveDocDetect";
import DocCropAdjust from "./DocCropAdjust";

// Progressive camera constraints — never fail because an advanced
// resolution/facing combination is unsupported on a device.
const CAMERA_CONSTRAINTS = [
  { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false },
  { video: { facingMode: "environment" }, audio: false },
  { video: true, audio: false },
];

// Auto-capture: the aligned quad must persist this many analysis frames
// (~300 ms apart) before the shutter fires (~1.2 s of steadiness).
const STEADY_NEEDED = 4;
const ANALYSE_INTERVAL_MS = 300;

// Operator guidance for each detector reason code.
const GUIDANCE = {
  not_in_frame: "Position the whole document inside the frame",
  alignment: "Align the document inside the guide — all corners must be visible",
  too_far: "Move closer until the document fills the guide",
  shape: "This does not look like the selected document — check the document type",
  blurry: "Hold steady — the image is not sharp enough yet",
  glare: "Tilt the document slightly to remove the light glare",
  too_dark: "Move to better light — the photo is too dark",
  not_distinct: "Place the document on a plainer, contrasting surface",
};

export default function DocumentCamera({ title, idType = "sa_id", onUse, onCancel }) {
  const [phase, setPhase] = useState("starting"); // starting | live | still | preview | adjust | denied
  const [errorMsg, setErrorMsg] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [statusLine, setStatusLine] = useState(null);
  const [liveMsg, setLiveMsg] = useState({ ok: false, text: "Position the document inside the frame" });
  const [guideStyle, setGuideStyle] = useState({});
  const [stillUrl, setStillUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [retakeSource, setRetakeSource] = useState("camera");
  const [processing, setProcessing] = useState(false);
  const [flash, setFlash] = useState(false);
  // { finalFile, originalFile, quadFrac, detected, uncertain } — the guide
  // crop, the automatic edge-detection result and the final approved crop.
  const [processInfo, setProcessInfo] = useState(null);

  const videoRef = useRef(null);
  const stillImgRef = useRef(null);
  const containerRef = useRef(null);
  const guideRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const objectUrlRef = useRef(null);
  const cancelledRef = useRef(false);
  // Live detection loop state (refs — the interval callback always sees fresh values)
  const analysisCanvasRef = useRef(null);
  const guideStyleRef = useRef(null);
  const lastQuadRef = useRef(null);
  const steadyRef = useRef(0);
  const autoLockRef = useRef(false);   // one automatic capture per camera session
  const processingRef = useRef(false);
  const ratios = plausibleRatiosForIdType(idType);

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
    autoLockRef.current = false;
    steadyRef.current = 0;
    lastQuadRef.current = null;
    setLiveMsg({ ok: false, text: "Position the document inside the frame" });

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
      const st = {
        left: Math.round((cw - gw) / 2),
        top: Math.round((ch - gh) / 2),
        width: Math.round(gw),
        height: Math.round(gh),
      };
      guideStyleRef.current = st;
      setGuideStyle(st);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [phase, guide]);

  // ── Live detection loop ───────────────────────────────────────────────────
  const drawOverlay = (res, ready) => {
    const canvas = overlayRef.current, container = containerRef.current, analysis = analysisCanvasRef.current;
    if (!canvas || !container || !analysis) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);
    if (!res?.quad) return;
    // analysis px → container px
    const k = cw / analysis.width;
    ctx.beginPath();
    res.quad.forEach((p, i) => {
      const x = p.x * k, y = p.y * k;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    if (ready) {
      ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
      ctx.fill();
    }
    ctx.lineWidth = ready ? 4 : 3;
    ctx.strokeStyle = ready ? "#10b981" : "rgba(245, 158, 11, 0.95)";
    ctx.stroke();
    for (const p of res.quad) {
      ctx.beginPath();
      ctx.arc(p.x * k, p.y * k, ready ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = ready ? "#10b981" : "rgba(245, 158, 11, 0.95)";
      ctx.fill();
    }
  };

  const analyseFrame = async () => {
    const video = videoRef.current, container = containerRef.current;
    if (!video || !video.videoWidth || video.readyState < 2 || !container) return;
    const gs = guideStyleRef.current;
    if (!gs?.width) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    const aW = 300;
    const aH = Math.max(64, Math.round((aW * ch) / cw));
    let ac = analysisCanvasRef.current;
    if (!ac) { ac = document.createElement("canvas"); analysisCanvasRef.current = ac; }
    if (ac.width !== aW || ac.height !== aH) { ac.width = aW; ac.height = aH; }
    const ctx = ac.getContext("2d", { willReadFrequently: true });
    // Draw the video exactly as displayed (object-fit: cover), scaled into the
    // analysis canvas — analysis px = container px × (aW / cw).
    const f = aW / cw;
    const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
    ctx.drawImage(
      video,
      ((cw - video.videoWidth * scale) / 2) * f,
      ((ch - video.videoHeight * scale) / 2) * f,
      video.videoWidth * scale * f,
      video.videoHeight * scale * f
    );
    let img;
    try { img = ctx.getImageData(0, 0, aW, aH); } catch (_) { return; }

    const guideRect = {
      x0: gs.left * f, y0: gs.top * f,
      x1: (gs.left + gs.width) * f, y1: (gs.top + gs.height) * f,
    };
    const res = detectQuadImageData(
      { data: img.data, width: aW, height: aH },
      { guideRect, requireInsideGuide: true, ratios }
    );

    // Steadiness: the aligned quad must persist (corners within 3% movement)
    const q = res.confident ? res.quad : null;
    let steady = 0;
    if (q && lastQuadRef.current) {
      const tol = aW * 0.03;
      const close = q.every((p, i) =>
        Math.hypot(p.x - lastQuadRef.current[i].x, p.y - lastQuadRef.current[i].y) <= tol
      );
      steady = close ? steadyRef.current + 1 : 1;
    } else if (q) {
      steady = 1;
    }
    steadyRef.current = steady;
    lastQuadRef.current = q;

    const ready = res.confident && steady >= 1;
    drawOverlay(res, ready);

    // Operator feedback
    let text;
    if (res.confident && steady >= 2) text = "Hold steady… capturing";
    else if (res.confident) text = "Aligned — hold the document steady";
    else {
      const code = res.reasons?.[0] || "not_in_frame";
      text = GUIDANCE[code] || "Position the document inside the frame";
    }
    setLiveMsg((prev) => (prev.text === text && prev.ok === res.confident ? prev : { ok: res.confident, text }));

    // AUTO-CAPTURE: aligned + steady for ~1.2 s → fire the shutter once
    if (res.confident && steady >= STEADY_NEEDED && !autoLockRef.current && !processingRef.current) {
      autoLockRef.current = true;
      setFlash(true);
      setTimeout(() => setFlash(false), 280);
      grabFrame();
    }
  };

  useEffect(() => {
    if (phase !== "live" || !cameraReady) return undefined;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (!alive || busy || autoLockRef.current || processingRef.current) return;
      busy = true;
      try { await analyseFrame(); } catch (_) {}
      busy = false;
    };
    const id = setInterval(tick, ANALYSE_INTERVAL_MS);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cameraReady, idType]);

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

  const finishReview = (info) => {
    if (!info?.finalFile) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(info.finalFile);
    setPreviewUrl(objectUrlRef.current);
    setPreviewFile(info.finalFile);
    setProcessInfo(info);
    stopStream(); // leaving the live camera after a successful capture
    setPhase("preview");
  };

  /**
   * Detect the document's actual edges in the guide crop, straighten and
   * crop to them. CONFIDENT result → the straightened crop is previewed for
   * approval. UNCERTAIN result → the manual corner editor is shown (seeded
   * with the best-effort quad when one exists) and nothing misleading is
   * ever saved silently.
   */
  const preparePreview = async (crop) => {
    if (!crop) {
      setStatusLine("Capture failed — please try again.");
      return;
    }
    processingRef.current = true;
    setProcessing(true);
    try {
      const canvas = await fileToCanvas(crop.file);
      const info = {
        originalFile: crop.file,
        finalFile: null,
        quadFrac: null,
        detected: false,
        uncertain: false,
      };
      // Primary: scan-line detector (tuned for real document boundaries).
      let det = detectQuadCanvas(canvas, { ratios });
      // Fallback: Hough-line detector on the same crop.
      if (!det?.confident) {
        const hough = detectDocumentQuad(canvas);
        if (hough?.confident) {
          det = {
            confident: true,
            fillsFrame: hough.fillsFrame,
            quad: hough.quad,
            areaFrac: hough.areaFrac,
            coverage: hough.coverage,
          };
        } else if (hough?.quad && !det?.quad) {
          det = { ...det, quad: hough.quad };
        }
      }
      if (det?.confident && det.fillsFrame) {
        // The document already fills the frame — the guide crop IS the document.
        info.finalFile = crop.file;
        info.quadFrac = [[0, 0], [1, 0], [1, 1], [0, 1]];
        info.detected = true;
      } else if (det?.confident && det.quad) {
        const warped = await warpQuadToJpegFile(canvas, det.quad, { maxDim: 1600, quality: 0.92 });
        if (warped) {
          info.finalFile = warped;
          info.quadFrac = quadToFrac(det.quad, canvas.width, canvas.height);
          info.detected = true;
        }
      }
      if (!info.finalFile) {
        info.uncertain = true;
        // Seed the manual editor with the best-effort quad when one exists
        if (det?.quad && (det.areaFrac || 0) >= 0.15) {
          info.quadFrac = quadToFrac(det.quad, canvas.width, canvas.height);
        }
        setWarnings(captureWarnings(crop));
        setProcessInfo(info);
        stopStream();
        setPhase("adjust");
        return;
      }
      setWarnings(captureWarnings(crop));
      finishReview(info);
    } catch (_) {
      // Edge pipeline failed — fall back to the manual corner editor rather
      // than silently saving a crop that may include background.
      setWarnings(captureWarnings(crop));
      setProcessInfo({
        originalFile: crop.file, finalFile: null, quadFrac: null,
        detected: false, uncertain: true,
      });
      stopStream();
      setPhase("adjust");
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  const applyManualCrop = async (frac) => {
    const info = processInfo;
    if (!info?.originalFile) return;
    processingRef.current = true;
    setProcessing(true);
    try {
      const canvas = await fileToCanvas(info.originalFile);
      const quad = fracToQuad(frac, canvas.width, canvas.height);
      const warped = await warpQuadToJpegFile(canvas, quad, { maxDim: 1600, quality: 0.92 });
      if (!warped) throw new Error("warp failed");
      finishReview({ ...info, finalFile: warped, quadFrac: frac, detected: true, uncertain: false });
    } catch (_) {
      setStatusLine("Could not crop with those corners — please adjust and try again.");
      setTimeout(() => setStatusLine(null), 2500);
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
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
    preparePreview(await cropToGuide(video, rect));
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
    preparePreview(await cropToGuide(img, rect));
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
    setProcessInfo(null);
    setWarnings([]);
    if (retakeSource === "still" && stillUrl) {
      setPhase("still");
    } else {
      startCamera();
    }
  };

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
            <div className="absolute top-11 left-1/2 -translate-x-1/2 bg-slate-900/90 text-slate-200 text-xs px-3 py-1.5 rounded-full z-10">
              {statusLine}
            </div>
          )}

          {/* Document alignment guide — the darkened surround is a box-shadow
              RING outside the frame only; the guide interior is fully
              transparent to the live video underneath. */}
          {guideStyle.width != null && (
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
          )}

          {/* Live detected-quad outline (amber → green) */}
          {phase === "live" && (
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none z-[5]" />
          )}

          {/* Live alignment / auto-capture feedback */}
          {phase === "live" && cameraReady && (
            <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-10 max-w-[94%] text-center text-xs px-3 py-1.5 rounded-full ${liveMsg.ok ? "bg-emerald-600/90 text-white" : "bg-slate-900/90 text-amber-200"}`}>
              {liveMsg.text}
            </div>
          )}

          {/* Shutter flash on automatic capture */}
          {flash && <div className="absolute inset-0 bg-white/80 z-20 pointer-events-none" />}
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
        <Button onClick={() => { autoLockRef.current = true; grabFrame(); }} disabled={!cameraReady || processing} variant="brand" className="w-full h-12">
          {cameraReady
            ? <><Camera className="w-4 h-4 mr-2" /> Capture Photo Now</>
            : <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Starting camera…</>}
        </Button>
      )}

      {phase === "still" && (
        <Button onClick={grabStill} disabled={processing} variant="brand" className="w-full h-12">
          <CheckCircle2 className="w-4 h-4 mr-2" /> Use Photo
        </Button>
      )}

      {phase === "adjust" && (
        <DocCropAdjust
          file={processInfo?.originalFile}
          initialCorners={processInfo?.quadFrac || undefined}
          busy={processing}
          note={
            processInfo?.uncertain
              ? "We could not confidently find the document's edges. Drag each corner circle onto the document's corners, then Apply Crop — or retake the photo."
              : "Drag the corner circles onto the document's corners, then Apply Crop."
          }
          onApply={applyManualCrop}
          onCancel={() => (previewFile ? setPhase("preview") : handleRetake())}
        />
      )}

      {phase === "preview" && (
        <>
          <div className="bg-black rounded-xl overflow-hidden border border-[var(--border-default)]">
            <img src={previewUrl} alt="Cropped document" className="w-full max-h-[48vh] object-contain" />
          </div>
          <p className={`text-xs flex items-start gap-1.5 ${processInfo?.detected ? "text-emerald-400" : "text-amber-300"}`}>
            {processInfo?.detected
              ? <><CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Cropped to the detected document edges — confirm the WHOLE document (all corners, borders and text) is visible before saving.</>
              : <><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Manually cropped — confirm the WHOLE document is visible before saving.</>}
          </p>
          {warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1">
              {warnings.map((w) => (
                <p key={w} className="text-amber-300 text-xs flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRetake} disabled={processing} className="flex-1 border-[var(--border-default)] text-slate-200 h-12">
              <RefreshCw className="w-4 h-4 mr-1.5" /> Retake
            </Button>
            <Button variant="outline" onClick={() => setPhase("adjust")} disabled={processing} className="flex-1 border-[var(--border-default)] text-slate-200 h-12">
              <Crop className="w-4 h-4 mr-1.5" /> Adjust
            </Button>
            <Button onClick={() => onUse(previewFile)} disabled={processing} variant="brand" className="flex-1 h-12">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Use Photo
            </Button>
          </div>
        </>
      )}

      {processing && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          <p className="text-slate-200 text-sm">Processing document…</p>
        </div>
      )}
    </div>
  );
}