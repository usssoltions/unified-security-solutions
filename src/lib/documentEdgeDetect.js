/**
 * Client-side document edge detection + perspective straightening for the
 * Attendance Register ID-photo capture (Attendance Register only).
 *
 * Pipeline: guide-cropped camera frame → detect the document's actual four
 * edges (Sobel gradients + Hough line voting + quadrilateral fitting) →
 * perspective-warp to an upright rectangle → JPEG master. The operator ALWAYS
 * sees the final crop before upload and can retake or adjust the corners
 * manually. Uncertain detection NEVER saves silently — it falls back to the
 * manual corner editor.
 *
 * Physical document PHOTO subsystem only — Barkoder/SecureScan is untouched.
 * No content of the document is altered: this is a geometric crop/straighten
 * of the operator's own photo (no enhancement, no OCR, no erasing).
 */

const DETECT_EDGE_PX = 220; // detection working resolution (long edge)
const WARP_MAX_EDGE = 1600; // saved master long edge (matches previous quality)
const BOUND_MARGIN = 0.12;  // quad corners may sit up to 12% outside the frame

// ── Image loading ───────────────────────────────────────────────────────────

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

/** Decode an image File/Blob into a full-resolution canvas. */
export async function fileToCanvas(file) {
  let url = null;
  try {
    let src;
    try {
      src = await createImageBitmap(file);
      const c = document.createElement("canvas");
      c.width = src.width;
      c.height = src.height;
      c.getContext("2d").drawImage(src, 0, 0);
      src.close?.();
      return c;
    } catch (_) { /* fall through to <img> */ }
    url = URL.createObjectURL(file);
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

// ── Quadrilateral fitting on the detection canvas ───────────────────────────

/**
 * Detect the dominant document quadrilateral in a canvas.
 * @returns {{confident:boolean, fillsFrame:boolean, quad:[{x,y}×4],
 *            coverage:number, areaFrac:number}|null} quad in CANVAS pixels,
 *            ordered [top-left, top-right, bottom-right, bottom-left].
 */
export function detectDocumentQuad(canvas) {
  try {
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return null;

    // Downscale for detection
    const scale = Math.min(1, DETECT_EDGE_PX / Math.max(W, H));
    const sW = Math.max(32, Math.round(W * scale));
    const sH = Math.max(32, Math.round(H * scale));
    const small = document.createElement("canvas");
    small.width = sW; small.height = sH;
    const sctx = small.getContext("2d");
    sctx.drawImage(canvas, 0, 0, sW, sH);

    // Grayscale
    const data = sctx.getImageData(0, 0, sW, sH).data;
    const gray = new Float32Array(sW * sH);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }

    // Sobel gradients
    const mag = new Float32Array(sW * sH);
    let maxMag = 0;
    for (let y = 1; y < sH - 1; y++) {
      for (let x = 1; x < sW - 1; x++) {
        const i = y * sW + x;
        const gx =
          -gray[i - sW - 1] - 2 * gray[i - 1] - gray[i + sW - 1] +
           gray[i - sW + 1] + 2 * gray[i + 1] + gray[i + sW + 1];
        const gy =
          -gray[i - sW - 1] - 2 * gray[i - sW] - gray[i - sW + 1] +
           gray[i + sW - 1] + 2 * gray[i + sW] + gray[i + sW + 1];
        const m = Math.sqrt(gx * gx + gy * gy);
        mag[i] = m;
        if (m > maxMag) maxMag = m;
      }
    }
    if (maxMag <= 0) return null;

    const edgeThresh = Math.max(18, 0.16 * maxMag);

    // Hough transform (θ ∈ [0°,180°) step 3°, ρ step 2px, ρ ∈ [-r,r])
    const N_ANG = 60;
    const angStep = Math.PI / N_ANG;
    const rMax = Math.ceil(Math.sqrt(sW * sW + sH * sH)) + 2;
    const N_RHO = Math.ceil(rMax / 2);
    const acc = new Float32Array(N_ANG * N_RHO);
    const cosT = new Float32Array(N_ANG), sinT = new Float32Array(N_ANG);
    for (let a = 0; a < N_ANG; a++) {
      cosT[a] = Math.cos(a * angStep);
      sinT[a] = Math.sin(a * angStep);
    }
    let edgeCount = 0;
    for (let y = 1; y < sH - 1; y++) {
      for (let x = 1; x < sW - 1; x++) {
        const m = mag[y * sW + x];
        if (m < edgeThresh) continue;
        edgeCount++;
        const wgt = Math.min(1, m / (0.6 * maxMag));
        for (let a = 0; a < N_ANG; a++) {
          const rho = x * cosT[a] + y * sinT[a];
          const ri = Math.round((rho + rMax) / 2);
          if (ri >= 0 && ri < N_RHO) acc[a * N_RHO + ri] += wgt;
        }
      }
    }
    if (edgeCount < 200) return null;

    // Peak extraction with neighbourhood suppression
    const lines = [];
    const peakMin = Math.max(6, edgeCount * 0.008);
    for (let pick = 0; pick < 24; pick++) {
      let best = -1, bestVal = 0;
      for (let a = 0; a < N_ANG; a++) {
        for (let r = 0; r < N_RHO; r++) {
          const v = acc[a * N_RHO + r];
          if (v > bestVal) { bestVal = v; best = a * N_RHO + r; }
        }
      }
      if (best < 0 || bestVal < peakMin) break;
      const aIdx = Math.floor(best / N_RHO), rIdx = best % N_RHO;
      const theta = aIdx * angStep;
      const rho = rIdx * 2 - rMax;
      const sup = lineSupport(mag, maxMag, sW, sH, theta, rho, edgeThresh);
      if (sup) lines.push({ theta, rho, coverage: sup.coverage });
      // suppress: ±12° (4 idx), ±12px (6 bins)
      for (let da = -4; da <= 4; da++) {
        const aa = ((aIdx + da) % N_ANG + N_ANG) % N_ANG;
        for (let dr = -6; dr <= 6; dr++) {
          const rr = rIdx + dr;
          if (rr >= 0 && rr < N_RHO) acc[aa * N_RHO + rr] = 0;
        }
      }
    }

    const strong = lines
      .filter((l) => l.coverage >= 0.45)
      .sort((a, b) => b.coverage - a.coverage)
      .slice(0, 10);
    if (strong.length < 4) return null;

    // Try every 4-line combination; keep the best valid quadrilateral
    let bestQuad = null;
    const n = strong.length;
    for (let i = 0; i < n - 3; i++) {
      for (let j = i + 1; j < n - 2; j++) {
        for (let k = j + 1; k < n - 1; k++) {
          for (let l = k + 1; l < n; l++) {
            const cand = fitQuad(
              [strong[i], strong[j], strong[k], strong[l]], sW, sH, mag, maxMag
            );
            if (cand && (!bestQuad || cand.score > bestQuad.score)) bestQuad = cand;
          }
        }
      }
    }
    if (!bestQuad) return null;

    const quadFull = bestQuad.pts.map((p) => ({
      x: Math.round(p[0] / scale),
      y: Math.round(p[1] / scale),
    }));

    // Document already fills the frame → the guide crop IS the document
    const tol = 0.03;
    const fillsFrame = bestQuad.areaFrac >= 0.92 && quadFull.every((p) =>
      p.x >= -tol * W && p.x <= W + tol * W && p.y >= -tol * H && p.y <= H + tol * H
    );

    return {
      confident: bestQuad.coverage >= 0.5 && bestQuad.areaFrac >= 0.08,
      fillsFrame,
      quad: quadFull,
      coverage: bestQuad.coverage,
      areaFrac: bestQuad.areaFrac,
    };
  } catch (_) {
    return null;
  }
}

/** Coverage of a Hough line: fraction of sampled points sitting on image edges. */
function lineSupport(mag, maxMag, w, h, theta, rho, edgeThresh) {
  const seg = clipLineToRect(theta, rho, w, h);
  if (!seg || seg.len < 0.2 * Math.max(w, h)) return null;
  const dx = -Math.sin(theta), dy = Math.cos(theta);
  const steps = 40;
  let hit = 0;
  for (let s = 0; s <= steps; s++) {
    const t = seg.t0 + ((seg.t1 - seg.t0) * s) / steps;
    const x = Math.round(seg.px + dx * t);
    const y = Math.round(seg.py + dy * t);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    // accept a 1px band around the line
    if (mag[y * w + x] >= edgeThresh ||
        (x > 0 && mag[y * w + x - 1] >= edgeThresh) ||
        (x < w - 1 && mag[y * w + x + 1] >= edgeThresh)) hit++;
  }
  return { coverage: hit / (steps + 1) };
}

/** Clip the infinite line to the image rect; returns a parametrised segment. */
function clipLineToRect(theta, rho, w, h) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const px = rho * c, py = rho * s;
  const dx = -s, dy = c; // direction along the line
  let t0 = -Infinity, t1 = Infinity;
  const eps = 1e-9;
  const slab = (p, d, lo, hi) => {
    if (Math.abs(d) < eps) return p >= lo - eps && p <= hi + eps;
    let a = (lo - p) / d, b = (hi - p) / d;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    return true;
  };
  if (!slab(px, dx, 0, w) || !slab(py, dy, 0, h)) return null;
  if (t1 <= t0) return null;
  return { px, py, t0, t1, len: t1 - t0 };
}

/** Validate + score one 4-line combination as a document quadrilateral. */
function fitQuad(cand, sW, sH, mag, maxMag) {
  // Pair opposing sides: the split of 4 lines into 2 pairs with the smallest
  // total direction difference (opposing sides of a document are parallel).
  const angDist = (a, b) => {
    let d = Math.abs(a.theta - b.theta) % Math.PI;
    return Math.min(d, Math.PI - d);
  };
  const idx = [0, 1, 2, 3];
  const splits = [
    [[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]],
  ];
  let bestSplit = null, bestCost = Infinity;
  for (const sp of splits) {
    const cost = angDist(cand[sp[0][0]], cand[sp[0][1]]) + angDist(cand[sp[1][0]], cand[sp[1][1]]);
    if (cost < bestCost) { bestCost = cost; bestSplit = sp; }
  }
  const [pairA, pairB] = [bestSplit[0].map((i) => cand[idx[i]]), bestSplit[1].map((i) => cand[idx[i]])];

  // Corners = intersections of each line in pairA with each in pairB
  const pts = [];
  for (const la of pairA) {
    for (const lb of pairB) {
      const p = lineIntersection(la, lb);
      if (!p) return null;
      pts.push(p);
    }
  }

  // Order around centroid, enforce positive (clockwise, y-down) winding
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= 4; cy /= 4;
  pts.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  if (area2 < 0) pts.reverse();

  // Start at the topmost (then leftmost) corner → [tl, tr, br, bl]
  let startIdx = 0;
  for (let i = 1; i < 4; i++) {
    const p = pts[i], s = pts[startIdx];
    if (p[1] < s[1] - 1 || (Math.abs(p[1] - s[1]) <= 1 && p[0] < s[0])) startIdx = i;
  }
  const quad = pts.slice(startIdx).concat(pts.slice(0, startIdx));

  // Bounds
  const loX = -BOUND_MARGIN * sW, hiX = sW + BOUND_MARGIN * sW;
  const loY = -BOUND_MARGIN * sH, hiY = sH + BOUND_MARGIN * sH;
  for (const p of quad) {
    if (p[0] < loX || p[0] > hiX || p[1] < loY || p[1] > hiY) return null;
  }

  // Convexity (consistent cross-product sign) + sane corner angles
  let pos = 0, neg = 0;
  const angles = [];
  for (let i = 0; i < 4; i++) {
    const p0 = quad[i], p1 = quad[(i + 1) % 4], p2 = quad[(i + 2) % 4];
    const cross = (p1[0] - p0[0]) * (p2[1] - p1[1]) - (p1[1] - p0[1]) * (p2[0] - p1[0]);
    if (cross > 0) pos++; else if (cross < 0) neg++;
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const dot = (v1[0] * v2[0] + v1[1] * v2[1]) /
      (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
    angles.push(Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI));
  }
  if (pos !== 4 && neg !== 4) return null;
  if (angles.some((a) => a < 50 || a > 130)) return null;

  // Area fraction
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i], q = quad[(i + 1) % 4];
    area += p[0] * q[1] - q[0] * p[1];
  }
  area = Math.abs(area) / 2;
  const areaFrac = area / (sW * sH);
  if (areaFrac < 0.06 || areaFrac > 1.0) return null;

  // Edge support along the four sides
  let cov = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const steps = 20;
    let hit = 0;
    for (let s = 1; s < steps; s++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * s) / steps);
      const y = Math.round(a[1] + ((b[1] - a[1]) * s) / steps);
      if (x < 0 || y < 0 || x >= sW || y >= sH) continue;
      if (mag[y * sW + x] >= 0.16 * maxMag) hit++;
    }
    cov += hit / (steps - 1);
  }
  const coverage = cov / 4;

  return { pts: quad, coverage, areaFrac, score: coverage * (0.4 + 0.6 * areaFrac) };
}

function lineIntersection(l1, l2) {
  const c1 = Math.cos(l1.theta), s1 = Math.sin(l1.theta);
  const c2 = Math.cos(l2.theta), s2 = Math.sin(l2.theta);
  const denom = c1 * s2 - s1 * c2;
  if (Math.abs(denom) < 1e-6) return null;
  const x = (l1.rho * s2 - s1 * l2.rho) / denom;
  const y = (c1 * l2.rho - l1.rho * c2) / denom;
  return [x, y];
}

// ── Perspective warp (dest rect → source quad, mesh of clipped triangles) ──

/** Solve h (8 unknowns) so that dst = H·src for the 4 point pairs. */
export function computeHomography(srcPts, dstPts) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPts[i], [X, Y] = dstPts[i];
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]); b.push(Y);
  }
  const h = solveLinear(A, b, 8);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function solveLinear(A, b, n) {
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    }
    if (Math.abs(A[piv][col]) < 1e-10) return null;
    if (piv !== col) {
      const t = A[piv]; A[piv] = A[col]; A[col] = t;
      const tb = b[piv]; b[piv] = b[col]; b[col] = tb;
    }
    const d = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / d;
      if (!f) continue;
      for (let c2 = col; c2 < n; c2++) A[r][c2] -= f * A[col][c2];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c2 = r + 1; c2 < n; c2++) s -= A[r][c2] * x[c2];
    x[r] = s / A[r][r];
  }
  return x;
}

export function applyHomography(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return [
    (H[0] * x + H[1] * y + H[2]) / w,
    (H[3] * x + H[4] * y + H[5]) / w,
  ];
}

/** Warp the quad region of srcCanvas into an upright rectangle canvas. */
export function warpQuad(srcCanvas, quad, { maxDim = WARP_MAX_EDGE, minDim = 64 } = {}) {
  const [q0, q1, q2, q3] = quad.map((p) => [p.x, p.y]); // tl, tr, br, bl
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let outW = Math.max(dist(q0, q1), dist(q3, q2));
  let outH = Math.max(dist(q0, q3), dist(q1, q2));
  const scale = Math.min(1, maxDim / Math.max(outW, outH));
  outW = Math.max(minDim, Math.round(outW * scale));
  outH = Math.max(minDim, Math.round(outH * scale));

  const H = computeHomography(
    [[0, 0], [outW, 0], [outW, outH], [0, outH]],
    [q0, q1, q2, q3]
  );
  if (!H) return null;

  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outW, outH);

  const N = 24; // mesh density — sub-pixel seam control
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x0 = (i * outW) / N, x1 = ((i + 1) * outW) / N;
      const y0 = (j * outH) / N, y1 = ((j + 1) * outH) / N;
      const s00 = applyHomography(H, x0, y0);
      const s10 = applyHomography(H, x1, y0);
      const s11 = applyHomography(H, x1, y1);
      const s01 = applyHomography(H, x0, y1);
      drawWarpedTriangle(ctx, srcCanvas, [x0, y0], [x1, y0], [x1, y1], s00, s10, s11);
      drawWarpedTriangle(ctx, srcCanvas, [x0, y0], [x1, y1], [x0, y1], s00, s11, s01);
    }
  }
  return canvas;
}

function drawWarpedTriangle(ctx, img, d1, d2, d3, s1, s2, s3) {
  ctx.save();
  // Expand the clip ~0.7px beyond each vertex to hide mesh seams
  const ex = (p) => {
    const cx = (d1[0] + d2[0] + d3[0]) / 3, cy = (d1[1] + d2[1] + d3[1]) / 3;
    const dx = p[0] - cx, dy = p[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / len) * 0.7, p[1] + (dy / len) * 0.7];
  };
  const e1 = ex(d1), e2 = ex(d2), e3 = ex(d3);
  ctx.beginPath();
  ctx.moveTo(e1[0], e1[1]);
  ctx.lineTo(e2[0], e2[1]);
  ctx.lineTo(e3[0], e3[1]);
  ctx.closePath();
  ctx.clip();
  const denom = (d2[0] - d1[0]) * (d3[1] - d1[1]) - (d3[0] - d1[0]) * (d2[1] - d1[1]);
  if (Math.abs(denom) < 1e-8) { ctx.restore(); return; }
  const a = ((s2[0] - s1[0]) * (d3[1] - d1[1]) - (s3[0] - s1[0]) * (d2[1] - d1[1])) / denom;
  const b = ((s3[0] - s1[0]) * (d2[0] - d1[0]) - (s2[0] - s1[0]) * (d3[0] - d1[0])) / denom;
  const c = s1[0] - a * d1[0] - b * d1[1];
  const e = ((s2[1] - s1[1]) * (d3[1] - d1[1]) - (s3[1] - s1[1]) * (d2[1] - d1[1])) / denom;
  const f = ((s3[1] - s1[1]) * (d2[0] - d1[0]) - (s2[1] - s1[1]) * (d3[0] - d1[0])) / denom;
  const g = s1[1] - e * d1[0] - f * d1[1];
  ctx.transform(a, e, b, f, c, g);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/** Warp + single high-quality JPEG encode → File named id_document.jpg. */
export function warpQuadToJpegFile(srcCanvas, quad, opts = {}) {
  return new Promise((resolve) => {
    let out = null;
    try { out = warpQuad(srcCanvas, quad, opts); } catch (_) { out = null; }
    if (!out) return resolve(null);
    out.toBlob((blob) => {
      if (!blob) return resolve(null);
      resolve(new File([blob], "id_document.jpg", { type: "image/jpeg" }));
    }, "image/jpeg", opts.quality ?? 0.92);
  });
}

// ── Fraction helpers for the manual corner editor ───────────────────────────

export function quadToFrac(quad, w, h) {
  return quad.map((p) => [
    Math.max(0, Math.min(1, p.x / w)),
    Math.max(0, Math.min(1, p.y / h)),
  ]);
}

export function fracToQuad(frac, w, h) {
  return frac.map((p) => ({ x: p[0] * w, y: p[1] * h }));
}