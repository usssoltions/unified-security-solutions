/**
 * docQuadFinder — automatic physical-document edge finder (Attendance ID photos).
 *
 * Pure functions on a grayscale buffer (no DOM) so the same code runs on the
 * live preview and on the full-resolution capture.
 *
 * Strategy (guide-constrained, polarity-consistent):
 *   1. Light blur + Sobel gradients; thin edges with non-maximum suppression.
 *   2. Each of the four sides is searched ONLY in a band around the matching
 *      edge of the on-screen guide, with near-axis slopes (±12°) — the
 *      operator holds the document in the guide, so background far from the
 *      guide edges can never be chosen.
 *   3. Line candidates are voted per POLARITY (dark→light vs light→dark).
 *      A real document edge has one consistent polarity along its full length
 *      and opposite sides have opposite polarity; fabric / wood / table
 *      patterns alternate and are rejected.
 *   4. Every combination of side candidates is checked for: all four corners
 *      inside the frame (whole document visible), document aspect ratio,
 *      near-parallel opposite sides, size relative to the guide and
 *      continuous edge support along each side between its corners. Among
 *      valid quads the outermost well-supported one wins, so the printed /
 *      security border INSIDE the card is kept, not cut off.
 *   5. Sharpness and glare are measured inside the found document.
 * Anything uncertain returns ok:false with a reason — never a partial quad.
 */

const SLOPE_DEG = [];
for (let d = -12; d <= 12; d += 1.5) SLOPE_DEG.push(d);
const SLOPES = SLOPE_DEG.map((d) => Math.tan((d * Math.PI) / 180));

export function rgbaToGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
  return g;
}

function boxBlur(src, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    tmp[i] = (src[i - (x > 0 ? 1 : 0)] + src[i] + src[i + (x < w - 1 ? 1 : 0)]) / 3;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = (tmp[i - (y > 0 ? w : 0)] + tmp[i] + tmp[i + (y < h - 1 ? w : 0)]) / 3;
  }
  return out;
}

/** Thinned, polarity-signed edge maps: eh = horizontal edges (gy), ev = vertical edges (gx). */
function edgeMaps(gray, w, h) {
  const b = boxBlur(boxBlur(gray, w, h), w, h);
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const mags = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const tl = b[i - w - 1], t = b[i - w], tr = b[i - w + 1], l = b[i - 1], r = b[i + 1], bl = b[i + w - 1], bo = b[i + w], br = b[i + w + 1];
    gx[i] = (tr + 2 * r + br) - (tl + 2 * l + bl);
    gy[i] = (bl + 2 * bo + br) - (tl + 2 * t + tr);
    if ((x + y) % 3 === 0) mags.push(Math.abs(gx[i]) + Math.abs(gy[i]));
  }
  mags.sort((a, c) => a - c);
  // Low, mostly absolute threshold (≈10 grey levels of step contrast) so a
  // document edge stays continuous even where the background is similar in
  // tone; texture is rejected later by polarity, continuity and geometry.
  const thr = Math.max(24, Math.min(60, (mags[Math.floor(mags.length * 0.5)] || 0) * 1.5));
  const eh = new Int8Array(w * h), ev = new Int8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    if (ay > thr && ay >= 1.2 * ax && ay >= Math.abs(gy[i - w]) && ay >= Math.abs(gy[i + w])) eh[i] = gy[i] > 0 ? 1 : -1;
    if (ax > thr && ax >= 1.2 * ay && ax >= Math.abs(gx[i - 1]) && ax >= Math.abs(gx[i + 1])) ev[i] = gx[i] > 0 ? 1 : -1;
  }
  return { eh, ev };
}

/**
 * Candidate lines for one side. horizontal: y = a + b(x - c); vertical: x = a + b(y - c).
 * Band is in the perpendicular coordinate; span is the along-side extent.
 */
function sideCandidates(map, w, h, horizontal, band, span, c, minVotes) {
  const p0 = Math.max(1, Math.floor(band[0])), p1 = Math.min((horizontal ? h : w) - 2, Math.ceil(band[1]));
  const s0 = Math.max(1, Math.floor(span[0])), s1 = Math.min((horizontal ? w : h) - 2, Math.ceil(span[1]));
  if (p1 <= p0 || s1 <= s0) return [];
  const pad = Math.ceil(Math.tan((12 * Math.PI) / 180) * Math.max(s1 - c, c - s0)) + 2;
  const nA = p1 - p0 + 1 + 2 * pad, nK = SLOPES.length;
  const acc = [new Float32Array(nK * nA), new Float32Array(nK * nA)];
  for (let p = p0; p <= p1; p++) for (let s = s0; s <= s1; s++) {
    const v = horizontal ? map[p * w + s] : map[s * w + p];
    if (!v) continue;
    const A = acc[v > 0 ? 0 : 1];
    for (let k = 0; k < nK; k++) {
      const a = Math.round(p - SLOPES[k] * (s - c)) - p0 + pad;
      if (a >= 0 && a < nA) A[k * nA + a] += 1;
    }
  }
  const peaks = [];
  for (let pol = 0; pol < 2; pol++) for (let k = 0; k < nK; k++) for (let a = 1; a < nA - 1; a++) {
    const A = acc[pol], i = k * nA + a;
    const votes = A[i - 1] * 0.5 + A[i] + A[i + 1] * 0.5;
    if (votes >= minVotes && A[i] >= A[i - 1] && A[i] >= A[i + 1]) peaks.push({ votes, a: a - pad + p0, b: SLOPES[k], pol: pol === 0 ? 1 : -1 });
  }
  peaks.sort((x, y) => y.votes - x.votes);
  const out = [];
  for (const pk of peaks) {
    if (out.some((o) => o.pol === pk.pol && Math.abs(o.a - pk.a) < 5 && Math.abs(o.b - pk.b) < 0.08)) continue;
    out.push(pk);
    if (out.length >= 10) break;
  }
  return out;
}

function intersect(H, V, cx, cy) {
  const x = (V.a + V.b * (H.a - H.b * cx - cy)) / (1 - V.b * H.b);
  return { x, y: H.a + H.b * (x - cx) };
}

const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/**
 * Edge support along segment p→q: fraction of sample points with a
 * matching-polarity edge within ±2 px. Also measures how often an
 * OPPOSITE-polarity edge sits 2–7 px further OUTWARD (out = -1 / +1 along the
 * perpendicular axis) — that pattern is a thin printed line (e.g. the
 * card's security border), not the physical document edge.
 */
function support(map, w, h, p, q, horizontal, pol, out) {
  const n = 48; let hit = 0;
  const oMax = Math.max(8, Math.round(w * 0.045));
  const offs = new Array(oMax + 2).fill(0);
  for (let i = 0; i < n; i++) {
    const t = 0.04 + (0.92 * i) / (n - 1);
    const x = Math.round(p.x + (q.x - p.x) * t), y = Math.round(p.y + (q.y - p.y) * t);
    for (let d = -2; d <= 2; d++) {
      const xx = horizontal ? x : x + d, yy = horizontal ? y + d : y;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (map[yy * w + xx] !== pol) continue;
      hit++;
      // First opposite-polarity edge further OUTWARD; its offset is recorded.
      for (let o = 2; o <= oMax; o++) {
        const sx = horizontal ? xx : xx + out * o, sy = horizontal ? yy + out * o : yy;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
        if (map[sy * w + sx] === -pol) { offs[o]++; break; }
      }
      break;
    }
  }
  // A PARALLEL opposite edge at a consistent outward offset means this side is
  // a printed line inside the card (the real edge lies further out).
  // Background texture gives scattered offsets and is not counted.
  let stroke = 0;
  for (let o = 2; o <= oMax; o++) stroke = Math.max(stroke, offs[o - 1] + offs[o] + offs[o + 1]);
  return { s: hit / n, stroke: hit ? stroke / hit : 0 };
}

function interiorQuality(gray, w, h, quad) {
  const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ix0 = Math.round(x0 + (x1 - x0) * 0.12), ix1 = Math.round(x1 - (x1 - x0) * 0.12);
  const iy0 = Math.round(y0 + (y1 - y0) * 0.12), iy1 = Math.round(y1 - (y1 - y0) * 0.12);
  let n = 0, sum = 0, sum2 = 0, bright = 0, lum = 0;
  for (let y = Math.max(1, iy0); y < Math.min(h - 1, iy1); y++) for (let x = Math.max(1, ix0); x < Math.min(w - 1, ix1); x++) {
    const i = y * w + x;
    const lap = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
    sum += lap; sum2 += lap * lap; n++; lum += gray[i];
    if (gray[i] >= 250) bright++;
  }
  if (!n) return { sharpness: 0, glare: 0, luma: 0 };
  const mean = sum / n;
  return { sharpness: sum2 / n - mean * mean, glare: bright / n, luma: lum / n };
}

/**
 * Find the document quad.
 * @param gray Float32Array grayscale, w×h
 * @param opts.roi {x0,y0,x1,y1} guide rectangle in buffer px
 * @param opts.aspect expected width/height of the document (as held in the guide)
 * @returns {{ok:boolean, quad?:Array<{x,y}>, reason?:string, fill?:number, support?:number}}
 */
export function findDocQuad(gray, w, h, { roi, aspect, aspectTol = 0.15, minFill = 0.5, maxFill = 1.35, minSharpness = 18, maxGlare = 0.05 } = {}) {
  const gw = roi.x1 - roi.x0, gh = roi.y1 - roi.y0;
  const cx = (roi.x0 + roi.x1) / 2, cy = (roi.y0 + roi.y1) / 2;
  const { eh, ev } = edgeMaps(gray, w, h);
  const spanX = [roi.x0 - gw * 0.12, roi.x1 + gw * 0.12], spanY = [roi.y0 - gh * 0.12, roi.y1 + gh * 0.12];
  const minH = gw * 0.3, minV = gh * 0.3;
  const T = sideCandidates(eh, w, h, true, [roi.y0 - gh * 0.12, roi.y0 + gh * 0.32], spanX, cx, minH);
  const B = sideCandidates(eh, w, h, true, [roi.y1 - gh * 0.32, roi.y1 + gh * 0.12], spanX, cx, minH);
  const L = sideCandidates(ev, w, h, false, [roi.x0 - gw * 0.12, roi.x0 + gw * 0.32], spanY, cy, minV);
  const R = sideCandidates(ev, w, h, false, [roi.x1 - gw * 0.32, roi.x1 + gw * 0.12], spanY, cy, minV);
  if (!T.length || !B.length || !L.length || !R.length) return { ok: false, reason: "partial" };

  let best = null, tooSmall = false, shapeOff = false;
  for (const t of T) for (const bo of B) {
    if (t.pol === bo.pol) continue;
    for (const l of L) {
      if (l.pol !== t.pol) continue;
      for (const r of R) {
        if (r.pol === l.pol) continue;
        const tl = intersect(t, l, cx, cy), tr = intersect(t, r, cx, cy), br = intersect(bo, r, cx, cy), bl = intersect(bo, l, cx, cy);
        const q = [tl, tr, br, bl];
        if (q.some((p) => !isFinite(p.x) || p.x < 2 || p.y < 2 || p.x > w - 3 || p.y > h - 3)) continue;
        if (!(tl.x < tr.x && bl.x < br.x && tl.y < bl.y && tr.y < br.y)) continue;
        const wt = dist(tl, tr), wb = dist(bl, br), hl = dist(tl, bl), hr = dist(tr, br);
        if (Math.min(wt, wb) / Math.max(wt, wb) < 0.85 || Math.min(hl, hr) / Math.max(hl, hr) < 0.85) continue;
        const area = Math.abs((tl.x * tr.y - tr.x * tl.y) + (tr.x * br.y - br.x * tr.y) + (br.x * bl.y - bl.x * br.y) + (bl.x * tl.y - tl.x * bl.y)) / 2;
        const fill = area / (gw * gh);
        if (fill > maxFill) continue;
        const aspErr = Math.abs((wt + wb) / (hl + hr) / aspect - 1);
        if (aspErr > aspectTol) { shapeOff = true; continue; }
        if (fill < minFill) { tooSmall = true; continue; }
        const sides = [
          support(eh, w, h, tl, tr, true, t.pol, -1), support(eh, w, h, bl, br, true, bo.pol, 1),
          support(ev, w, h, tl, bl, false, l.pol, -1), support(ev, w, h, tr, br, false, r.pol, 1),
        ];
        if (Math.min(...sides.map((x) => x.s)) < 0.72) continue;
        // A side that is really a printed line inside the card is never the edge.
        if (sides.some((x) => x.stroke >= 0.6)) continue;
        const avgS = sides.reduce((n, x) => n + x.s, 0) / 4;
        // Outermost well-supported quad wins: the physical card edge lies
        // OUTSIDE any printed/security border line, which must stay in the crop.
        const score = 0.4 * avgS + Math.min(fill, maxFill) - 1.5 * aspErr;
        if (!best || score > best.score) best = { score, quad: q, fill, support: avgS };
      }
    }
  }
  if (!best) return { ok: false, reason: tooSmall ? "too_small" : shapeOff ? "shape" : "not_found" };
  const qual = interiorQuality(gray, w, h, best.quad);
  if (qual.luma < 35) return { ok: false, reason: "too_dark", quad: best.quad };
  if (qual.glare > maxGlare) return { ok: false, reason: "glare", quad: best.quad };
  if (qual.sharpness < minSharpness) return { ok: false, reason: "blurry", quad: best.quad };
  return { ok: true, quad: best.quad, fill: best.fill, support: best.support };
}