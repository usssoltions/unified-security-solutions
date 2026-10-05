/**
 * docWarp — perspective straightening of a detected document quad into an
 * upright rectangle (bilinear sampling). Attendance ID photos only.
 */

function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

/** Homography mapping output-rect (u,v) → source quad [tl,tr,br,bl]. */
function rectToQuad(W, H, quad) {
  const dst = [[0, 0], [W, 0], [W, H], [0, H]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i], { x, y } = quad[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

/** Warp `quad` of srcCanvas into a new outW×outH canvas. */
export function warpQuadToCanvas(srcCanvas, quad, outW, outH) {
  const H = rectToQuad(outW, outH, quad);
  if (!H) return null;
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const src = srcCanvas.getContext("2d").getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas");
  out.width = outW; out.height = outH;
  const octx = out.getContext("2d");
  const img = octx.createImageData(outW, outH);
  const d = img.data;
  for (let v = 0; v < outH; v++) {
    for (let u = 0; u < outW; u++) {
      const den = H[6] * u + H[7] * v + H[8];
      let x = (H[0] * u + H[1] * v + H[2]) / den, y = (H[3] * u + H[4] * v + H[5]) / den;
      x = Math.min(sw - 1.001, Math.max(0, x)); y = Math.min(sh - 1.001, Math.max(0, y));
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (v * outW + u) * 4;
      for (let c = 0; c < 3; c++) {
        d[o + c] = (src[i00 + c] * (1 - fx) + src[i10 + c] * fx) * (1 - fy) + (src[i01 + c] * (1 - fx) + src[i11 + c] * fx) * fy;
      }
      d[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}