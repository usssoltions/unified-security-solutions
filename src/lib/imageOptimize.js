/**
 * USS Guard — Image Optimization Utility (Permanent Data-Efficient Architecture)
 *
 * Every photo captured by the app (incident evidence, maintenance evidence,
 * profile photos, visitor photos, signatures) must be resized + compressed
 * BEFORE upload. A full-resolution phone-camera photo is 3–8 MB; after
 * optimisation the same photo is 50–200 KB — a 30×+ reduction with no visible
 * quality loss at the resolutions actually displayed on screen.
 *
 * Pipeline:  CAPTURE → RESIZE → COMPRESS (JPEG) → return Blob/File
 *           (metadata is stripped automatically by canvas re-encoding)
 *
 * Security evidence retains sufficient resolution via the `maxDim` / `quality`
 * params — callers that need higher detail pass larger values.
 *
 * Usage:
 *   import { optimizeImageFile, optimizeImageBlob } from "@/lib/imageOptimize";
 *   const optimized = await optimizeImageFile(rawFile, { maxDim: 1000, quality: 0.7 });
 *   await base44.integrations.Core.UploadFile({ file: optimized });
 */

/**
 * Resize + compress an image File/Blob to a JPEG Blob.
 * @param {File|Blob} file        Source image (any browser-supported format)
 * @param {object}   opts
 * @param {number}   opts.maxDim    Longest edge in px (default 1000). 0 = no resize.
 * @param {number}   opts.quality   JPEG quality 0–1 (default 0.7)
 * @param {string}   opts.type      Output MIME (default image/jpeg)
 * @returns {Promise<File|null>}    Optimised File, or null on failure (never throws)
 */
export async function optimizeImageBlob(file, opts = {}) {
  if (!file) return null;
  const maxDim = opts.maxDim ?? 1000;
  const quality = opts.quality ?? 0.7;
  const outType = opts.type ?? "image/jpeg";

  try {
    // Decode the source image
    const bitmap = await createImageBitmap(file).catch(() => null);
    const img = bitmap ?? await loadImg(URL.createObjectURL(file));
    if (!img) return null;

    const srcW = bitmap ? img.width : img.naturalWidth || img.width;
    const srcH = bitmap ? img.height : img.naturalHeight || img.height;

    // Compute target dimensions — only downscale, never upscale
    let w = srcW, h = srcH;
    if (maxDim > 0 && (srcW > maxDim || srcH > maxDim)) {
      const scale = maxDim / Math.max(srcW, srcH);
      w = Math.max(1, Math.round(srcW * scale));
      h = Math.max(1, Math.round(srcH * scale));
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    // Revoke object URL if we created one (bitmap doesn't need it)
    if (!bitmap) URL.revokeObjectURL(img.src);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, outType, quality)
    );
    if (!blob) return null;

    const ext = outType === "image/png" ? "png" : "jpg";
    const name = (file.name || "photo").replace(/\.[^.]+$/, "") + "." + ext;
    return new File([blob], name, { type: outType });
  } catch (_) {
    return null;
  }
}

/**
 * Convenience wrapper: optimise a File from an <input type=file> or camera capture.
 * Falls back to the original file if optimisation fails (never loses evidence).
 */
export async function optimizeImageFile(file, opts = {}) {
  const optimized = await optimizeImageBlob(file, opts);
  return optimized || file; // never lose the original on failure
}

/**
 * Generate a small thumbnail Blob from an image (for list views).
 * Default 200px longest edge, JPEG 0.6 quality.
 */
export async function makeThumb(file, maxDim = 200, quality = 0.6) {
  return await optimizeImageBlob(file, { maxDim, quality });
}

// ── Helper: load an Image element from a URL ──────────────────────────────
function loadImg(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Convenience: optimise an image File and upload it in one call.
 * Returns the permanent file URL, or null on failure (never throws —
 * the caller can still save the record without a photo).
 *
 * This is the PERMANENT STANDARD for all photo uploads in the app.
 * Every component that captures a camera/file photo should use this
 * instead of calling Core.UploadFile directly on a raw file.
 *
 * @param {File}   file   Source image
 * @param {object} opts   { maxDim, quality } — defaults: 1000px, 0.7 JPEG
 * @returns {Promise<string|null>}  file_url
 */
export async function uploadOptimizedImage(file, opts = {}) {
  if (!file) return null;
  try {
    const optimized = await optimizeImageFile(file, opts);
    const { base44 } = await import("@/api/base44Client");
    const { file_url } = await base44.integrations.Core.UploadFile({ file: optimized });
    return file_url || null;
  } catch (_) {
    return null;
  }
}