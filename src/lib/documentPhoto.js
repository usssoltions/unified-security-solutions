/**
 * Physical ID document photo helpers — Attendance Register only.
 *
 * The SAVED document image is TRULY cropped from the original
 * camera-resolution frame to the document guide area BEFORE upload. The full
 * camera frame (table/bed/hands/background) is never stored — this is a real
 * pixel crop, not a CSS/visual mask.
 *
 * This module is for the physical document PHOTO subsystem only.
 * Barkoder/SecureScan scanning/parsing is NEVER touched from here.
 */

/** Document alignment guide shapes (physical document aspect ratios). */
export const DOC_GUIDES = {
  // ISO/IEC 7810 ID-1 landscape — SA ID Card, Driver's Licence (85.6 × 54 mm)
  card: { aspect: 85.6 / 54, orientation: "landscape" },
  // Portrait page — Passport bio-data page (88 × 125 mm) / open SA ID Book
  // identity page (A5-like). Same portrait ratio works for both.
  portrait: { aspect: 88 / 125, orientation: "portrait" },
};

/** Guide shape for an id_type. */
export function guideForIdType(idType) {
  return (idType === "sa_id" || idType === "drivers_licence")
    ? DOC_GUIDES.card
    : DOC_GUIDES.portrait;
}

/**
 * Map the on-screen guide rectangle back to SOURCE media pixel coordinates,
 * accounting for how the media is fitted in its container
 * ("cover" for live video, "contain" for a still image preview).
 *
 * @returns {{sx,sy,sw,sh}} source-pixel rect of the guide area
 */
export function visibleSourceRect({ mediaW, mediaH, cw, ch, fit, guideEl, container }) {
  const gr = guideEl.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  const gx = gr.left - cr.left, gy = gr.top - cr.top, gw = gr.width, gh = gr.height;
  const scale = fit === "cover"
    ? Math.max(cw / mediaW, ch / mediaH)
    : Math.min(cw / mediaW, ch / mediaH);
  const offX = (cw - mediaW * scale) / 2;
  const offY = (ch - mediaH * scale) / 2;
  return {
    sx: (gx - offX) / scale,
    sy: (gy - offY) / scale,
    sw: gw / scale,
    sh: gh / scale,
  };
}

/**
 * Crop a media source (live <video> frame or loaded <img>) to the guide rect —
 * from the ORIGINAL media resolution, NOT a thumbnail. Adds a tiny edge margin
 * so document edges are never cut off. Single high-quality JPEG encode
 * (quality 0.92); only downscales if the crop exceeds maxDim.
 *
 * @returns {Promise<{file: File, width: number, height: number, meanLuma: number}|null>}
 */
export function cropToGuide(source, rect, { maxDim = 1600, quality = 0.92, margin = 0.035 } = {}) {
  const srcW = source.videoWidth || source.naturalWidth || source.width;
  const srcH = source.videoHeight || source.naturalHeight || source.height;
  if (!srcW || !srcH || !rect) return Promise.resolve(null);

  // Expand by the small margin, clamped to the source bounds
  const x = Math.max(0, rect.sx - rect.sw * margin);
  const y = Math.max(0, rect.sy - rect.sh * margin);
  const w = Math.min(srcW - x, rect.sw * (1 + 2 * margin));
  const h = Math.min(srcH - y, rect.sh * (1 + 2 * margin));
  if (w <= 0 || h <= 0) return Promise.resolve(null);

  let outW = Math.round(w);
  let outH = Math.round(h);
  if (Math.max(outW, outH) > maxDim) {
    const scale = maxDim / Math.max(outW, outH);
    outW = Math.max(1, Math.round(outW * scale));
    outH = Math.max(1, Math.round(outH * scale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, x, y, w, h, 0, 0, outW, outH);

  const stats = { width: outW, height: outH, ...sampleLuminance(ctx, outW, outH) };

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null);
      resolve({ file: new File([blob], "id_document.jpg", { type: "image/jpeg" }), ...stats });
    }, "image/jpeg", quality);
  });
}

/** Lightweight mean-luminance sample of the crop (24×24). Tolerant of taint. */
function sampleLuminance(ctx, w, h) {
  try {
    const s = document.createElement("canvas");
    s.width = 24; s.height = 24;
    const sctx = s.getContext("2d");
    sctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, 24, 24);
    const d = sctx.getImageData(0, 0, 24, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    }
    return { meanLuma: sum / (d.length / 4) };
  } catch (_) {
    return { meanLuma: 128 };
  }
}

/**
 * Lightweight client-side capture validation warnings (no OCR/AI).
 * Warns (does not hard-block) when the document looks too small, too dark,
 * or blank/overexposed.
 */
export function captureWarnings(crop) {
  if (!crop) return ["Capture failed — please retake."];
  const warns = [];
  if (crop.width < 500) {
    warns.push("The document looks small in the frame — move closer and retake for a sharper photo.");
  }
  if (crop.meanLuma < 15) {
    warns.push("The photo looks very dark — check lighting and retake.");
  } else if (crop.meanLuma > 240) {
    warns.push("The photo looks blank or overexposed — please retake.");
  }
  return warns;
}

/**
 * Upload the cropped document master. The crop is ALREADY a single-encoded
 * high-quality JPEG — it is uploaded directly with NO recompression
 * (never re-encode the same image twice).
 * @returns {Promise<string|null>} permanent file URL
 */
export async function uploadDocumentPhoto(file) {
  if (!file) return null;
  try {
    const { base44 } = await import("@/api/base44Client");
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    return file_url || null;
  } catch (_) {
    return null;
  }
}