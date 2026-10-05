/**
 * DocumentCamera — FULLY AUTOMATIC ID-document photo capture.
 *
 * The operator only holds the document in the camera view:
 *   1. The live preview is analysed ~3×/s (docQuadFinder). The detected outer
 *      edges are drawn amber, turning green once the WHOLE document is
 *      visible, correctly shaped, sharp and glare-free.
 *   2. After the green outline stays steady for ~1.2 s the frame is captured
 *      automatically — there is no manual shutter and no corner dragging.
 *   3. The full-resolution frame is re-detected, straightened and cropped to
 *      the document's outer edges (border kept, background removed). If the
 *      whole document cannot be confirmed nothing is produced; a clear retake
 *      message is shown and live detection simply continues.
 *   4. The crop is shown for approval (Retake / Use Photo) before anything is
 *      uploaded or saved.
 *
 * Camera init (progressive constraints, frame-ready gate, focus) is the
 * existing working flow. Physical document PHOTO subsystem only —
 * Barkoder/SecureScan is untouched.
 */
import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Image as ImageIcon } from "lucide-react";
import { guideForIdType } from "@/lib/documentPhoto";
import { analyseLiveFrame, captureDocument } from "@/lib/docAutoCapture";

const CAMERA_CONSTRAINTS = [
  { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false },
  { video: { facingMode: "environment" }, audio: false },
  { video: true, audio: false },
];
const STEADY_NEEDED = 4;          // consecutive aligned frames (~1.2 s)
const ANALYSE_INTERVAL_MS = 300;

const GUIDANCE = {
  partial: "Show the whole document — all four edges must be inside the frame",
  not_found: "Hold the document inside the frame on a contrasting surface",
  too_small: "Move closer — the document should fill the frame",
  shape: "Hold the document flat and straight inside the frame",
  blurry: "Hold steady — the image is not sharp yet",
  glare: "Tilt the document slightly to remove the light glare",
  too_dark: "Move to better light — the photo is too dark",
};
const RETAKE_MSG = "The whole document could not be confirmed — nothing was saved. Keep the entire document inside the frame and hold it steady.";

export default function DocumentCamera({ title, idType = "sa_id", onUse, onCancel }) {
  const [phase, setPhase] = useState("starting"); // starting | live | still | preview | denied
  const [errorMsg, setErrorMsg] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [liveMsg, setLiveMsg] = useState({ ok: false, text: GUIDANCE.not_found });
  const [retakeMsg, setRetakeMsg] = useState(null);
  const [guideStyle, setGuideStyle] = useState({});
  const [stillUrl, setStillUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [retakeSource, setRetakeSource] = useState("camera");
  const [processing, setProcessing] = useState(false);
  const [flash, setFlash] = useState(false);

  const videoRef = useRef(null);
  const stillImgRef = useRef(null);
  const containerRef = useRef(null);
  const guideRef = useRef(null);
  const overlayRef = useRef(null);
  const streamRef = useRef(null);
  const objectUrlRef = useRef(null);
  const cancelledRef = useRef(false);
  const analysisCanvasRef = useRef(null);
  const guideStyleRef = useRef(null);
  const lastQuadRef = useRef(null);
  const steadyRef = useRef(0);
  const busyRef = useRef(false);

  const guide = guideForIdType(idType);

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const attachAndWaitForFrames = async (stream) => {
    const video = videoRef.current;
    if (!video) return false;
    video.srcObject = stream;
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        const done = () => { video.removeEventListener("loadedmetadata", done); clearTimeout(timer); resolve(); };
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
    setCameraReady(false);
    steadyRef.current = 0;
    lastQuadRef.current = null;
    busyRef.current = false;
    setLiveMsg({ ok: false, text: GUIDANCE.not_found });
    let stream = null, lastErr = null;
    for (const constraints of CAMERA_CONSTRAINTS) {
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); break; } catch (e) { lastErr = e; }
    }
    if (cancelledRef.current) { stream?.getTracks().forEach((t) => t.stop()); return; }
    if (!stream) {
      setPhase("denied");
      setErrorMsg(lastErr?.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in your browser/app settings, or choose an existing photo below."
        : "The camera could not be opened on this device. You can retry, or choose an existing photo below.");
      return;
    }
    streamRef.current = stream;
    setPhase("live");
    const framesReady = await attachAndWaitForFrames(stream);
    if (cancelledRef.current) { stopStream(); return; }
    const track = stream.getVideoTracks()[0];
    try {
      const caps = track?.getCapabilities?.();
      if (caps?.focusMode?.includes?.("continuous")) await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
    } catch (_) {}
    if (cancelledRef.current) { stopStream(); return; }
    if (framesReady) setCameraReady(true);
    else {
      stopStream();
      setPhase("denied");
      setErrorMsg("The camera opened but no video image is available. Close any other app using the camera and try again.");
    }
  };

  useEffect(() => {
    startCamera();
    return () => {
      cancelledRef.current = true;
      stopStream();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // Guide geometry — scales with the viewport, preserving the document aspect.
  useEffect(() => {
    if (phase !== "live" && phase !== "still") return;
    const c = containerRef.current;
    if (!c) return;
    const measure = () => {
      const cw = c.clientWidth, ch = c.clientHeight;
      let gw, gh;
      if (guide.orientation === "landscape") {
        gw = cw * 0.84; gh = gw / guide.aspect;
        if (gh > ch * 0.6) { gh = ch * 0.6; gw = gh * guide.aspect; }
      } else {
        gh = ch * 0.68; gw = gh * guide.aspect;
        if (gw > cw * 0.84) { gw = cw * 0.84; gh = gw / guide.aspect; }
      }
      const st = { left: Math.round((cw - gw) / 2), top: Math.round((ch - gh) / 2), width: Math.round(gw), height: Math.round(gh) };
      guideStyleRef.current = st;
      setGuideStyle(st);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [phase, guide]);

  const drawOverlay = (res, ready) => {
    const canvas = overlayRef.current, container = containerRef.current;
    if (!canvas || !container) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, cw, ch);
    if (!res?.quad) return;
    const k = res.toContainer;
    ctx.beginPath();
    res.quad.forEach((p, i) => (i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)));
    ctx.closePath();
    if (ready) { ctx.fillStyle = "rgba(16, 185, 129, 0.12)"; ctx.fill(); }
    ctx.lineWidth = ready ? 4 : 3;
    ctx.strokeStyle = ready ? "#10b981" : "rgba(245, 158, 11, 0.95)";
    ctx.stroke();
  };

  const showPreview = (file) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setPreviewUrl(objectUrlRef.current);
    setPreviewFile(file);
    setRetakeMsg(null);
    stopStream();
    setPhase("preview");
  };

  // Full-resolution detect → straighten → crop. Never produces a partial image.
  const runCapture = async (source, fit) => {
    busyRef.current = true;
    setProcessing(true);
    try {
      const out = await captureDocument({ source, fit, container: containerRef.current, guideEl: guideRef.current, idType });
      if (out?.file) { showPreview(out.file); return true; }
      setRetakeMsg(RETAKE_MSG);
      return false;
    } catch (_) {
      setRetakeMsg(RETAKE_MSG);
      return false;
    } finally {
      setProcessing(false);
      busyRef.current = false;
      steadyRef.current = 0;
      lastQuadRef.current = null;
    }
  };

  const analyseFrame = async () => {
    const video = videoRef.current, container = containerRef.current, gs = guideStyleRef.current;
    if (!video || !video.videoWidth || video.readyState < 2 || !container || !gs?.width) return;
    const res = analyseLiveFrame(video, container, gs, idType, analysisCanvasRef);
    const q = res.ok ? res.quad : null;
    let steady = 0;
    if (q && lastQuadRef.current) {
      const tol = 360 * 0.02;
      steady = q.every((p, i) => Math.hypot(p.x - lastQuadRef.current[i].x, p.y - lastQuadRef.current[i].y) <= tol) ? steadyRef.current + 1 : 1;
    } else if (q) steady = 1;
    steadyRef.current = steady;
    lastQuadRef.current = q;
    drawOverlay(res, res.ok);
    const text = res.ok ? (steady >= 2 ? "Hold still… capturing" : "Document found — hold it steady") : (GUIDANCE[res.reason] || GUIDANCE.not_found);
    setLiveMsg((prev) => (prev.text === text && prev.ok === res.ok ? prev : { ok: res.ok, text }));
    if (res.ok && steady >= STEADY_NEEDED) {
      setFlash(true);
      setTimeout(() => setFlash(false), 280);
      await runCapture(video, "cover");
    }
  };

  useEffect(() => {
    if (phase !== "live" || !cameraReady) return undefined;
    let alive = true;
    const id = setInterval(async () => {
      if (!alive || busyRef.current) return;
      busyRef.current = true;
      try { await analyseFrame(); } catch (_) {}
      busyRef.current = false;
    }, ANALYSE_INTERVAL_MS);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, cameraReady, idType]);

  const tapToFocus = async (e) => {
    if (phase !== "live" || !cameraReady || !streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0], video = videoRef.current;
    if (!track || !video) return;
    try {
      const caps = track.getCapabilities?.();
      if (!caps?.focusMode?.includes?.("single-shot")) return;
      const r = video.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      await track.applyConstraints({ advanced: [{ focusMode: "single-shot", pointsOfInterest: [x, y] }] });
    } catch (_) {}
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(f);
    setStillUrl(objectUrlRef.current);
    setRetakeSource("still");
    setRetakeMsg(null);
    setPhase("still");
  };

  // Gallery fallback (camera unavailable): same automatic detection on the photo.
  const onStillLoaded = () => {
    if (stillImgRef.current && !busyRef.current) setTimeout(() => runCapture(stillImgRef.current, "contain"), 50);
  };

  const handleRetake = () => {
    setPreviewUrl(null);
    setPreviewFile(null);
    setRetakeMsg(null);
    if (retakeSource === "still") setPhase("denied");
    else startCamera();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-white text-sm font-semibold">{title}</p>
        <Button variant="ghost" onClick={onCancel} className="text-slate-400 h-9">Cancel</Button>
      </div>

      {(phase === "starting" || phase === "live" || phase === "still") && (
        <div ref={containerRef} onClick={phase === "live" ? tapToFocus : undefined}
          className="relative w-full h-[56vh] max-h-[520px] bg-black rounded-xl overflow-hidden">
          {phase === "still" ? (
            <img ref={stillImgRef} src={stillUrl} onLoad={onStillLoaded} alt="Document" className="absolute inset-0 w-full h-full object-contain" />
          ) : (
            <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />
          )}
          {phase === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-8 h-8 text-slate-300 animate-spin" />
              <p className="text-slate-300 text-sm">INITIALISING CAMERA…</p>
            </div>
          )}
          {guideStyle.width != null && (
            <div ref={guideRef} className="absolute rounded-lg pointer-events-none"
              style={{ left: guideStyle.left, top: guideStyle.top, width: guideStyle.width, height: guideStyle.height,
                boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.45)", border: "2px dashed rgba(255, 255, 255, 0.6)" }} />
          )}
          {phase === "live" && <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none z-[5]" />}
          {phase === "live" && cameraReady && (
            <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-10 max-w-[94%] text-center text-xs px-3 py-1.5 rounded-full ${liveMsg.ok ? "bg-emerald-600/90 text-white" : "bg-slate-900/90 text-amber-200"}`}>
              {liveMsg.text}
            </div>
          )}
          {phase === "live" && !cameraReady && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs px-3 py-1 rounded-full bg-slate-900/85 text-slate-200 flex items-center gap-1.5 z-10">
              <Loader2 className="w-3 h-3 animate-spin" /> STARTING CAMERA…
            </div>
          )}
          {flash && <div className="absolute inset-0 bg-white/80 z-20 pointer-events-none" />}
        </div>
      )}

      {retakeMsg && phase !== "preview" && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
          <p className="text-amber-300 text-sm flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {retakeMsg}</p>
        </div>
      )}

      {phase === "live" && cameraReady && (
        <p className="text-slate-400 text-xs text-center">Hold the document inside the frame — it is captured automatically.</p>
      )}

      {(phase === "denied" || (phase === "still" && retakeMsg)) && (
        <div className="space-y-3">
          {phase === "denied" && errorMsg && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-1">
              <p className="text-amber-300 text-sm font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> CAMERA UNAVAILABLE</p>
              <p className="text-amber-300/90 text-sm">{errorMsg}</p>
            </div>
          )}
          <Button onClick={startCamera} variant="brand" className="w-full h-12"><Camera className="w-4 h-4 mr-2" /> Retry Camera</Button>
          <label htmlFor="doc-cam-gallery" className="cursor-pointer block">
            <span className="flex items-center justify-center gap-2 h-12 w-full rounded-md border border-[var(--border-default)] text-slate-200 active:scale-95 transition">
              <ImageIcon className="w-4 h-4" /> Choose {phase === "still" ? "Another" : "from"} Gallery Photo
            </span>
            <input id="doc-cam-gallery" type="file" accept="image/*" className="hidden" onChange={pickFile} />
          </label>
        </div>
      )}

      {phase === "preview" && (
        <>
          <div className="bg-black rounded-xl overflow-hidden border border-[var(--border-default)]">
            <img src={previewUrl} alt="Cropped document" className="w-full max-h-[48vh] object-contain" />
          </div>
          <p className="text-xs flex items-start gap-1.5 text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> Straightened and cropped to the document's edges. Confirm the WHOLE document (all corners, border and text) is visible.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRetake} className="flex-1 border-[var(--border-default)] text-slate-200 h-12">
              <RefreshCw className="w-4 h-4 mr-1.5" /> Retake
            </Button>
            <Button onClick={() => onUse(previewFile)} variant="brand" className="flex-1 h-12">
              <CheckCircle2 className="w-4 h-4 mr-1.5" /> Use Photo
            </Button>
          </div>
        </>
      )}

      {processing && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          <p className="text-slate-200 text-sm">Straightening and cropping document…</p>
        </div>
      )}
    </div>
  );
}