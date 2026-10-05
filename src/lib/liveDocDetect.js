/**
 * Live document-corner detection for the Attendance Register ID-photo
 * camera (Attendance Register only — Barkoder/SecureScan untouched).
 *
 * detectQuadImageData() analyses ONE RGBA frame and returns the document's
 * actual four corners plus the reason it is NOT yet ready, so the camera can
 * show live alignment feedback (amber outline → green outline) and
 * auto-capture only a steady, complete, sharp, glare-free document.
 *
 * Pipeline per frame: grayscale + mild blur (suppresses sensor noise and fine
 * surface patterns) → Sobel gradients → strong-edge scan-line crossings on
 * each side → RANSAC line fits (one per side) → corner intersections →
 * plausibility + quality checks (shape, aspect, containment, sharpness,
 * glare, contrast at the boundary).
 *
 * The core maths are DOM-free (pure typed arrays) so they run identically on
 * the live preview loop and on a captured still. No content of the document
 * is ever altered — only its geometric boundary is located.
 */

// ── Plausibility per document type ──────────────────────────────────────────

/** Plausible LONG:SHORT side ratios (≥ 1) for the document type, ANY orientation. */
export function plausibleRatiosForIdType(idType) {
  // ISO/IEC 7810 ID-1 landscape card — SA ID Card, Driver's Licence
  if (idType === "sa_id" || idType === "drivers_licence") return [85.6 / 54];
  // Passport bio-data page / ID-book identity page (A5-like portrait)
  return [125 / 88];
}

// ── Frame analysis ──────────────────────────────────────────────────────────

/** Grayscale (two-pass box blur) + Sobel gradient magnitude of an RGBA frame. */
export function analyzeFrame(frame) {
  const { data, width: w, height: h } = frame;
  const n = w * h;
  const g0 = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    g0[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  // Two 3×3 box-blur passes — smooths sensor noise and fine surface patterns
  // (weaves, textures) so the document's long straight edges dominate.
  const b1 = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      b1[i] = (g0[i] * 2 + g0[i - 1] + g0[i + 1] + g0[i - w] + g0[i + w] +
        g0[i - w - 1] + g0[i - w + 1] + g0[i + w - 1] + g0[i + w + 1]) / 10;
    }
  }
  const gray = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      gray[i] = (b1[i] * 2 + b1[i - 1] + b1[i + 1] + b1[i - w] + b1[i + w] +
        b1[i - w - 1] + b1[i - w + 1] + b1[i + w - 1] + b1[i + w + 1]) / 10;
    }
  }
  // Copy borders so every pixel has a defined value
  for (let x = 0; x < w; x++) { gray[x] = g0[x]; gray[(h - 1) * w + x] = g0[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { gray[y * w] = g0[y * w]; gray[y * w + w - 1] = g0[y * w + w - 1]; }

  const mag = new Float32Array(n);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
         gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
         gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const m = Math.sqrt(gx * gx + gy * gy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  return { gray, mag, maxMag, w, h };
}

// ── Scan-line side candidates ───────────────────────────────────────────────

const SCAN_SAMPLES = 11;   // scan lines per side
const MAX_CROSSINGS = 12;  // candidate edge crossings kept per scan line

function sampleRange(a, b, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.round(a + ((b - a) * (i + 0.5)) / count));
  return out;
}

/**
 * For each side, walk scan lines across the region and record the positions
 * of strong edge crossings (up to MAX_CROSSINGS per line). The document's
 * edge is one consistent line among these; RANSAC picks it out.
 */
function collectSideCandidates(an, region, ethr) {
  const { mag, w, h } = an;
  const pts = { left: [], right: [], top: [], bottom: [] };
  const strongAt = (x, y) => {
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
    const i = y * w + x;
    return mag[i] >= ethr || mag[i - 1] >= ethr || mag[i + 1] >= ethr ||
      mag[i - w] >= ethr || mag[i + w] >= ethr;
  };
  const x0 = Math.max(1, Math.round(region.x0));
  const x1 = Math.min(w - 2, Math.round(region.x1) - 1);
  const y0 = Math.max(1, Math.round(region.y0));
  const y1 = Math.min(h - 2, Math.round(region.y1) - 1);
  if (y1 - y0 < 10 || x1 - x0 < 10) return pts;

  const crossingsH = (from, to, step, y) => {
    const found = [];
    let inRun = false;
    for (let x = from; step > 0 ? x <= to : x >= to; x += step) {
      const s = strongAt(x, y);
      if (s && !inRun) { found.push(x); inRun = true; if (found.length >= MAX_CROSSINGS) break; }
      else if (!s) inRun = false;
    }
    return found;
  };
  const crossingsV = (from, to, step, x) => {
    const found = [];
    let inRun = false;
    for (let y = from; step > 0 ? y <= to : y >= to; y += step) {
      const s = strongAt(x, y);
      if (s && !inRun) { found.push(y); inRun = true; if (found.length >= MAX_CROSSINGS) break; }
      else if (!s) inRun = false;
    }
    return found;
  };

  for (const y of sampleRange(y0, y1, SCAN_SAMPLES)) {
    for (const x of crossingsH(x0, x1, 1, y)) pts.left.push([x, y]);
    for (const x of crossingsH(x1, x0, -1, y)) pts.right.push([x, y]);
  }
  for (const x of sampleRange(x0, x1, SCAN_SAMPLES)) {
    for (const y of crossingsV(y0, y1, 1, x)) pts.top.push([x, y]);
    for (const y of crossingsV(y1, y0, -1, x)) pts.bottom.push([x, y]);
  }
  return pts;
}

// ── RANSAC line fit per side ────────────────────────────────────────────────

const RANSAC_TOL = 3.0;
const RANSAC_ITERATIONS = 90;
const MIN_SIDE_ROWS = 6; // at least 6 of the 11 scan lines must support the line

/**
 * Fit one line to a side's candidate crossings. Score = DISTINCT scan lines
 * with inliers (so a cluster of crossings on one row can never fake support).
 * Refit by total least squares on the inliers.
 */
function ransacLine(pts) {
  if (!pts || pts.length < MIN_SIDE_ROWS) return null;
  const rowsFor = (a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 8) return null;
    const rows = new Map();
    for (const p of pts) {
      const d = Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
      if (d <= RANSAC_TOL && !rows.has(p[1])) rows.set(p[1], p);
    }
    return rows;
  };
  let best = null;
  for (let it = 0; it < RANSAC_ITERATIONS; it++) {
    const a = pts[(Math.random() * pts.length) | 0];
    const b = pts[(Math.random() * pts.length) | 0];
    if (a === b) continue;
    const rows = rowsFor(a, b);
    if (!rows || rows.size <= (best?.rows.size || 0)) continue;
    best = { rows };
  }
  if (!best || best.rows.size < MIN_SIDE_ROWS) return null;

  const inl = [...best.rows.values()];
  let cx = 0, cy = 0;
  for (const p of inl) { cx += p[0]; cy += p[1]; }
  cx /= inl.length; cy /= inl.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of inl) {
    const dx = p[0] - cx, dy = p[1] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: cx, py: cy, dx: Math.cos(theta), dy: Math.sin(theta), count: inl.length };
}

function lineIntersect(l1, l2) {
  const det = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
  return [l1.px + t * l1.dx, l1.py + t * l1.dy];
}

// ── Geometry + quality helpers ──────────────────────────────────────────────

function quadArea(quad) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = quad[i], s = quad[(i + 1) % 4];
    a += p[0] * s[1] - s[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Point in convex quad (all cross products same sign). */
function pointInQuad(quad, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cr) < 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

function expandQuad(quad, factor) {
  let cx = 0, cy = 0;
  for (const p of quad) { cx += p[0]; cy += p[1]; }
  cx /= 4; cy /= 4;
  return quad.map((p) => [cx + (p[0] - cx) * factor, cy + (p[1] - cy) * factor]);
}

/**
 * Boundary contrast: at sampled points along each side, the luminance a few
 * px INSIDE the quad must differ from OUTSIDE — the signature of a real
 * document boundary (rejects texture-only "quads" and same-colour surfaces).
 */
function sideContrastScore(an, quad) {
  const { gray, w, h } = an;
  let cx = 0, cy = 0;
  for (const p of quad) { cx += p[0]; cy += p[1]; }
  cx /= 4; cy /= 4;
  const at = (x, y) => {
    const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
    return gray[yi * w + xi];
  };
  let goodSides = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4];
    let good = 0, tot = 0;
    for (let s = 1; s < 9; s++) {
      const x = a[0] + ((b[0] - a[0]) * s) / 9;
      const y = a[1] + ((b[1] - a[1]) * s) / 9;
      const mx = cx - x, my = cy - y;
      const ml = Math.hypot(mx, my) || 1;
      const gIn = at(x + (mx / ml) * 3, y + (my / ml) * 3);
      const gOut = at(x - (mx / ml) * 3, y - (my / ml) * 3);
      tot++;
      if (Math.abs(gIn - gOut) >= 10) good++;
    }
    if (good >= Math.ceil(tot * 0.5)) goodSides++;
  }
  return goodSides;
}

/** Interior quality metrics sampled on a grid inside the quad. */
function interiorMetrics(an, quad) {
  const { gray, mag, maxMag, w, h } = an;
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const step = Math.max(1, Math.round(Math.min(w, h) / 90));
  const sharpThresh = Math.max(45, 0.3 * maxMag);
  let count = 0, sharp = 0, glare = 0, sumGray = 0, sumMag = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!pointInQuad(quad, x, y)) continue;
      const i = y * w + x;
      count++;
      sumGray += gray[i];
      sumMag += mag[i];
      if (mag[i] >= sharpThresh) sharp++;
      if (gray[i] >= 244) glare++;
    }
  }
  if (!count) return null;
  return {
    meanGray: sumGray / count,
    meanMag: sumMag / count,
    sharpFrac: sharp / count,
    glareFrac: glare / count,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

const PRIORITY = ["alignment", "not_in_frame", "too_far", "shape", "blurry", "glare", "too_dark"];

/**
 * Detect the document quadrilateral in one RGBA frame.
 *
 * @param {object} frame { data: Uint8ClampedArray(RGBA), width, height }
 * @param {object} opts
 *   guideRect           {x0,y0,x1,y1} px — alignment guide in THIS frame's space
 *   requireInsideGuide  all corners must sit inside the guide (live mode)
 *   ratios              plausible LONG:SHORT ratios (see plausibleRatiosForIdType)
 * @returns {{found, confident, fillsFrame, quad:[{x,y}×4]|null, areaFrac, reasons[]}}
 *   quad corners ordered [tl, tr, br, bl] in THIS frame's pixel space.
 *   reasons: prioritised machine codes explaining why NOT confident.
 */
export function detectQuadImageData(frame, opts = {}) {
  const result = { found: false, confident: false, fillsFrame: false, quad: null, areaFrac: 0, reasons: ["not_in_frame"] };
  try {
    const an = analyzeFrame(frame);
    const { w, h, maxMag } = an;
    if (!w || !h || maxMag <= 0) return result;

    const ethr = Math.max(28, 0.28 * maxMag);
    const region = opts.guideRect
      ? opts.guideRect
      : { x0: w * 0.02, y0: h * 0.02, x1: w * 0.98, y1: h * 0.98 };
    const cands = collectSideCandidates(an, region, ethr);
    const lines = {
      left: ransacLine(cands.left),
      right: ransacLine(cands.right),
      top: ransacLine(cands.top),
      bottom: ransacLine(cands.bottom),
    };
    if (!lines.left || !lines.right || !lines.top || !lines.bottom) return result;

    const tl = lineIntersect(lines.top, lines.left);
    const tr = lineIntersect(lines.top, lines.right);
    const br = lineIntersect(lines.bottom, lines.right);
    const bl = lineIntersect(lines.bottom, lines.left);
    const quad = [tl, tr, br, bl];
    if (quad.some((p) => !p || !isFinite(p[0]) || !isFinite(p[1]))) {
      return { ...result, reasons: ["alignment"] };
    }
    result.found = true;
    result.quad = quad.map((p) => ({ x: p[0], y: p[1] }));

    const reasons = [];
    const area = quadArea(quad);
    const areaFrac = area / (w * h);
    result.areaFrac = areaFrac;

    // Convexity + sane corner angles
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
    if ((pos !== 4 && neg !== 4) || angles.some((a) => a < 50 || a > 130)) {
      reasons.push("alignment");
    }

    // Containment — the whole document must be inside the guide (live) or the
    // frame (still): a cut-off document is never accepted.
    const gx = opts.guideRect || { x0: 0, y0: 0, x1: w, y1: h };
    const tolX = (gx.x1 - gx.x0) * 0.05;
    const tolY = (gx.y1 - gx.y0) * 0.05;
    const loX = gx.x0 - tolX, hiX = gx.x1 + tolX, loY = gx.y0 - tolY, hiY = gx.y1 + tolY;
    if (quad.some((p) => p[0] < loX || p[0] > hiX || p[1] < loY || p[1] > hiY)) {
      reasons.push("alignment");
    }

    // Size — big enough to read, small enough that all edges are visible
    if (areaFrac < 0.1) reasons.push("too_far");
    if (opts.guideRect) {
      const guideArea = (gx.x1 - gx.x0) * (gx.y1 - gx.y0);
      if (guideArea > 0 && area / guideArea < 0.4) reasons.push("too_far");
    }

    // Shape plausibility for the selected document type (any orientation)
    const side = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
    const dims = [side(tl, tr), side(bl, br), side(tl, bl), side(tr, br)];
    const long = Math.max(...dims), short = Math.min(...dims);
    const ratio = long / Math.max(1, short);
    const ratios = opts.ratios?.length ? opts.ratios : [1.6];
    if (!ratios.some((r) => Math.abs(ratio - r) <= 0.3 * Math.max(r, ratio))) {
      reasons.push("shape");
    }

    // Interior quality
    const m = interiorMetrics(an, quad);
    if (!m) {
      reasons.push("alignment");
    } else {
      if (m.meanMag < 10 || m.sharpFrac < 0.015) reasons.push("blurry");
      if (m.glareFrac > 0.12) reasons.push("glare");
      if (m.meanGray < 25) reasons.push("too_dark");
    }

    // Real document boundary — contrast across at least 3 of the 4 sides
    if (sideContrastScore(an, quad) < 3) reasons.push("not_distinct");

    reasons.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
    result.reasons = reasons.length ? reasons : [];

    // "Fills the frame" — the guide crop already IS the document (still mode)
    const ftol = 0.03;
    result.fillsFrame = areaFrac >= 0.9 && quad.every((p) =>
      p[0] >= -ftol * w && p[0] <= w + ftol * w && p[1] >= -ftol * h && p[1] <= h + ftol * h
    );
    result.confident = reasons.length === 0;
    return result;
  } catch (_) {
    return result;
  }
}

/**
 * Detect on a full-resolution canvas: downsamples internally, and returns the
 * quad scaled back to the ORIGINAL canvas pixel space (so the caller can warp
 * directly from the full-resolution source).
 */
export function detectQuadCanvas(canvas, opts = {}) {
  const fail = { found: false, confident: false, fillsFrame: false, quad: null, areaFrac: 0, reasons: ["not_in_frame"] };
  try {
    const scale = Math.min(1, 300 / Math.max(canvas.width, canvas.height));
    const sW = Math.max(32, Math.round(canvas.width * scale));
    const sH = Math.max(32, Math.round(canvas.height * scale));
    const small = document.createElement("canvas");
    small.width = sW; small.height = sH;
    const ctx = small.getContext("2d");
    ctx.drawImage(canvas, 0, 0, sW, sH);
    const img = ctx.getImageData(0, 0, sW, sH);
    const det = detectQuadImageData({ data: img.data, width: sW, height: sH }, opts);
    if (det.quad && scale < 1) {
      det.quad = det.quad.map((p) => ({ x: p.x / scale, y: p.y / scale }));
    }
    return det;
  } catch (_) {
    return fail;
  }
}