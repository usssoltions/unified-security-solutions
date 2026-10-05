/** Resolves true only when the image at `url` actually loads (fresh fetch). */
export function canLoadImage(url, timeoutMs = 15000) {
  if (!url) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), timeoutMs);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}