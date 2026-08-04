/**
 * USS Guard — Document Photo Manager (Phase 3)
 *
 * Reusable image manager for scanned document photos.
 *  - Session-level dedupe (same data URL → reuse uploaded URL, no re-upload)
 *  - Thumbnail generation (canvas downscale)
 *  - Upload via Core.UploadFile, returns a permanent file URL
 *
 * Never throws on failure — returns null so the caller can still save the
 * record without a photo.
 */
import { base44 } from "@/api/base44Client";

const uploadCache = new Map(); // dataUrl hash -> file_url

function hashDataUrl(d) {
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) | 0;
  return String(h);
}

export function makeThumbnail(dataUrl, max = 160) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(max / img.width, max / img.height, 1);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch (_) { resolve(dataUrl); }
  });
}

export async function uploadDocumentPhoto(dataUrl, filename = "document.png") {
  if (!dataUrl) return null;
  const key = hashDataUrl(dataUrl);
  if (uploadCache.has(key)) return uploadCache.get(key);
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: blob.type || "image/png" });
    const up = await base44.integrations.Core.UploadFile({ file });
    const url = up?.file_url || null;
    if (url) uploadCache.set(key, url);
    return url;
  } catch (_) {
    return null;
  }
}

export async function uploadDocumentPhotoWithThumbnail(dataUrl, filename = "document.png") {
  const [url, thumb] = await Promise.all([
    uploadDocumentPhoto(dataUrl, filename),
    makeThumbnail(dataUrl, 160),
  ]);
  return { url, thumbnail: thumb };
}