/**
 * docAutoCapture — DOM glue for fully automatic ID-document capture.
 *
 *  analyseLiveFrame(): detection on a small copy of the live preview.
 *  captureDocument(): on the FULL-resolution frame, re-detect the document's
 *    outer edges, straighten and crop to them. Returns { error } when the whole
 *    document cannot be confirmed — a partial image is never produced.
 */
import { guideForIdType, visibleSourceRect } from "@/lib/documentPhoto";
import { findDocQuad, rgbaToGray } from "@/lib/docQuadFinder";
import { warpQuadToCanvas } from "@/lib/docWarp";

export function detectOpts(idType) {
  const g = guideForIdType(idType);
  return { aspect: g.aspect, aspectTol: g.orientation === "landscape" ? 0.15 : 0.22 };
}

function grayOf(canvas) {
  const d = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
  return rgbaToGray(d, canvas.width, canvas.height);
}

/** Live preview analysis: draws the video as displayed (object-fit: cover). */
export function analyseLiveFrame(video, container, guideStyle, idType, canvasRef) {
  const cw = container.clientWidth, ch = container.clientHeight;
  const aW = 360, aH = Math.max(64, Math.round((aW * ch) / cw)), f = aW / cw;
  let c = canvasRef.current;
  if (!c) { c = document.createElement("canvas"); canvasRef.current = c; }
  if (c.width !== aW || c.height !== aH) { c.width = aW; c.height = aH; }
  const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
  c.getContext("2d", { willReadFrequently: true }).drawImage(
    video, ((cw - video.videoWidth * scale) / 2) * f, ((ch - video.videoHeight * scale) / 2) * f,
    video.videoWidth * scale * f, video.videoHeight * scale * f
  );
  const roi = { x0: guideStyle.left * f, y0: guideStyle.top * f, x1: (guideStyle.left + guideStyle.width) * f, y1: (guideStyle.top + guideStyle.height) * f };
  const res = findDocQuad(grayOf(c), aW, aH, { roi, ...detectOpts(idType) });
  return { ...res, toContainer: 1 / f };
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/** Full-resolution detect → straighten → crop. */
export async function captureDocument({ source, fit, container, guideEl, idType, maxDim = 1600, quality = 0.92 }) {
  const mw = source.videoWidth || source.naturalWidth, mh = source.videoHeight || source.naturalHeight;
  if (!mw || !mh) return { error: "not_ready" };
  const g = visibleSourceRect({ mediaW: mw, mediaH: mh, cw: container.clientWidth, ch: container.clientHeight, fit, guideEl, container });
  // Region = guide + 15% margin (the search bands reach 12% outside the guide).
  const rx = Math.max(0, g.sx - g.sw * 0.15), ry = Math.max(0, g.sy - g.sh * 0.15);
  const rw = Math.min(mw - rx, g.sw * 1.3), rh = Math.min(mh - ry, g.sh * 1.3);
  if (rw <= 0 || rh <= 0) return { error: "not_found" };
  const k = Math.min(1, 2400 / Math.max(rw, rh));
  const full = document.createElement("canvas");
  full.width = Math.round(rw * k); full.height = Math.round(rh * k);
  full.getContext("2d").drawImage(source, rx, ry, rw, rh, 0, 0, full.width, full.height);

  const aW = Math.min(720, full.width), a = aW / full.width;
  const an = document.createElement("canvas");
  an.width = aW; an.height = Math.round(full.height * a);
  an.getContext("2d").drawImage(full, 0, 0, an.width, an.height);
  const s = k * a;
  const roi = { x0: (g.sx - rx) * s, y0: (g.sy - ry) * s, x1: (g.sx - rx + g.sw) * s, y1: (g.sy - ry + g.sh) * s };
  const res = findDocQuad(grayOf(an), an.width, an.height, { roi, ...detectOpts(idType), minSharpness: 10 });
  if (!res.ok) return { error: res.reason || "not_found" };

  // Map to full-res and push each corner 0.6% outward so the outermost
  // border pixels are never clipped.
  let quad = res.quad.map((p) => ({ x: p.x / a, y: p.y / a }));
  const cx = quad.reduce((n, p) => n + p.x, 0) / 4, cy = quad.reduce((n, p) => n + p.y, 0) / 4;
  quad = quad.map((p) => ({ x: cx + (p.x - cx) * 1.006, y: cy + (p.y - cy) * 1.006 }));
  const [tl, tr, br, bl] = quad;
  let W = Math.max(dist(tl, tr), dist(bl, br));
  let H = detectOpts(idType).aspectTol <= 0.15 ? W / guideForIdType(idType).aspect : Math.max(dist(tl, bl), dist(tr, br));
  const sc = Math.min(1, maxDim / Math.max(W, H));
  W = Math.round(W * sc); H = Math.round(H * sc);
  const out = warpQuadToCanvas(full, quad, W, H);
  if (!out) return { error: "not_found" };
  const blob = await new Promise((r) => out.toBlob(r, "image/jpeg", quality));
  if (!blob) return { error: "not_found" };
  return { file: new File([blob], "id_document.jpg", { type: "image/jpeg" }), width: W, height: H, meanLuma: 128 };
}