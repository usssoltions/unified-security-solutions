/**
 * GRID GATE Hospitality exports (CSV/Excel + PDF). Routine bulk exports
 * deliberately EXCLUDE evidence photos, identity/licence numbers and full
 * mobile numbers — evidence is viewed per visit in the app only.
 */
import jsPDF from "jspdf";
import {
  HOSP_CATEGORY_LABELS, PRESENCE_LABELS, ADMISSION_LABELS, presenceOf, fmtDT, parseTs, yesNo,
  maskPhone, confirmationText, evidenceCount, computeTotals,
} from "@/lib/hospitalityMeta";

const COLUMNS = [
  ["Visit ref", (v) => String(v.id).slice(-8).toUpperCase()],
  ["Created", (v) => fmtDT(v.created_date)],
  ["Site", (v) => v.site_name || ""],
  ["Category", (v) => HOSP_CATEGORY_LABELS[v.category] || v.category],
  ["Name", (v) => v.person_name || ""],
  ["Mobile (masked)", (v) => maskPhone(v.person_phone)],
  ["Admission", (v) => ADMISSION_LABELS[v.status] || v.status],
  ["Presence", (v) => PRESENCE_LABELS[presenceOf(v)]],
  ["Confirmation", (v) => confirmationText(v)],
  ["Guest", (v) => [v.guest_name, v.guest_surname].filter(Boolean).join(" ")],
  ["Room", (v) => v.room_number || ""],
  ["Occupants", (v) => v.occupant_count ?? ""],
  ["Firearm declared", (v) => yesNo(v.firearm_declared)],
  ["PO/Invoice", (v) => yesNo(v.po_invoice_available)],
  ["Staff declaration", (v) => yesNo(v.staff_declared)],
  ["Pedestrian only", (v) => (v.pedestrian_only ? "Yes" : "No")],
  ["Evidence items", (v) => evidenceCount(v)],
  ["Entry time", (v) => fmtDT(v.entry?.entry_time)],
  ["Entry gate", (v) => v.entry?.gate_name || ""],
  ["Entry by", (v) => v.entry?.guard_name || v.created_by_guard_name || ""],
  ["Entry device", (v) => v.entry?.entry_device_name || ""],
  ["Exit time", (v) => fmtDT(v.entry?.exit_time)],
  ["Exit gate", (v) => v.entry?.exit_gate || ""],
  ["Exit by", (v) => v.entry?.exit_guard_name || ""],
  ["Exit device", (v) => v.entry?.exit_device_name || ""],
  ["Minutes on site", (v) => v.entry?.time_on_site_minutes ?? ""],
  ["Cancel reason", (v) => v.cancel_reason || ""],
];

const download = (blob, name) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

export function exportVisitsCsv(visits, fileBase) {
  const esc = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const lines = [COLUMNS.map(([h]) => esc(h)).join(",")];
  for (const v of visits) lines.push(COLUMNS.map(([, f]) => esc(f(v))).join(","));
  // BOM so Excel opens UTF-8 correctly.
  download(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${fileBase}.csv`);
}

const hexRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  const n = m ? parseInt(m[1], 16) : 0x062b49;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ── Compact SAST time formatting for the PDF ────────────────────────────────
// Consistent, explicit-timezone rendering for every report date: "01 Oct 14:35".
// The timezone itself is stated once per page ("All times SAST — UTC+2").
const SAST_TZ = "Africa/Johannesburg";
const sastFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: SAST_TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
});
const fmtSastCell = (iso) => {
  const d = parseTs(iso);
  return d && !isNaN(d) ? sastFmt.format(d).replace(",", "") : "—";
};

// ── Logo optimisation ───────────────────────────────────────────────────────
// The gateway inlines the RAW logo files as data URLs (several MB each for
// high-res PNGs), which made even a 2-page report ~12.5 MB. Rasterise each
// logo once, downscaled to its print size at ~300 dpi and re-encoded as a
// compact JPEG on white, then reuse that single optimised data URL on every
// page (jsPDF embeds a reused data URL only once per document).
async function optimizeLogo(dataUrl, maxWmm, maxHmm) {
  if (!dataUrl) return null;
  try {
    // Already compact — keep the original (preserves sharpness/transparency).
    if (dataUrl.length < 160_000) return dataUrl;
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("logo decode failed"));
      i.src = dataUrl;
    });
    const capPx = Math.round((Math.min(maxWmm, maxHmm) / 25.4) * 300);
    const r = Math.min(capPx / Math.max(img.width, img.height), 1);
    const w = Math.max(1, Math.round(img.width * r));
    const h = Math.max(1, Math.round(img.height * r));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.92);
  } catch (_) {
    return dataUrl; // never block the report on logo processing
  }
}

function addLogo(doc, dataUrl, x, y, maxW, maxH, alignRight) {
  if (!dataUrl) return;
  try {
    const p = doc.getImageProperties(dataUrl);
    const r = Math.min(maxW / p.width, maxH / p.height);
    const w = p.width * r, h = p.height * r;
    doc.addImage(dataUrl, alignRight ? x - w : x, y, w, h);
  } catch (_) { /* logo optional */ }
}

// PDF columns: [label, weight, getter]. Weights are scaled to fill the full
// printable width; long values wrap (never truncated).
const PDF_COLS = [
  ["Created", 26, (v) => fmtSastCell(v.created_date)],
  ["Category", 26, (v) => HOSP_CATEGORY_LABELS[v.category] || v.category],
  ["Name", 44, (v) => v.person_name || ""],
  ["Room", 11, (v) => v.room_number || ""],
  ["Occ.", 8, (v) => String(v.occupant_count ?? "")],
  ["Admission", 18, (v) => ADMISSION_LABELS[v.status] || v.status],
  ["Presence", 19, (v) => PRESENCE_LABELS[presenceOf(v)]],
  ["Entry", 26, (v) => fmtSastCell(v.entry?.entry_time)],
  ["Exit", 26, (v) => fmtSastCell(v.entry?.exit_time)],
  ["Processed by", 36, (v) => v.entry?.guard_name || v.created_by_guard_name || ""],
];

export async function exportVisitsPdf(visits, brand, filterSummary, fileBase) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, H = 210, M = 8;
  const W2 = W - 2 * M;
  const primary = hexRgb(brand?.primary_color);

  const FONT = 8, LINE = 3.1, PADX = 1.2, ROW_MIN = 4.3, HEAD_H = 4.6, BAND_H = 4.8;
  const BOTTOM = H - 9; // last baseline a row may occupy; footer sits below

  // Scale column weights to fill the printable width exactly.
  const weightSum = PDF_COLS.reduce((n, [, w]) => n + w, 0);
  const COLS = PDF_COLS.map(([h, w, f]) => [h, (w / weightSum) * W2, f]);
  const colX = []; let cx = M; COLS.forEach(([, w]) => { colX.push(cx); cx += w; });

  // ── Site handling: one site → header line; several sites → group bands ──
  const siteKey = (v) => v.site_name || "(Unspecified site)";
  const siteNames = [...new Set(visits.map(siteKey))];
  const oneSite = siteNames.length === 1;
  const siteLine = oneSite
    ? `Site: ${siteNames[0]}`
    : `Sites: ${siteNames.length} — ${siteNames.slice(0, 4).join(", ")}${siteNames.length > 4 ? ", …" : ""}`;

  const logoPrimary = await optimizeLogo(brand?.logo_data_url, 40, 11);
  const logoSecondary = await optimizeLogo(brand?.secondary_logo_data_url, 36, 10);

  let y = 0;
  let pageIndex = 0;

  const drawColHead = (yy) => {
    doc.setFillColor(...primary);
    doc.rect(M, yy, W2, HEAD_H, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(FONT);
    COLS.forEach(([h], i) => doc.text(h, colX[i] + PADX, yy + 3.2));
    return yy + HEAD_H;
  };

  // Compact page header — repeated on every page; totals only on page 1.
  const startPage = (showTotals) => {
    if (pageIndex > 0) doc.addPage();
    pageIndex++;
    let hy = 5;
    addLogo(doc, logoPrimary, M, hy, 40, 11, false);
    addLogo(doc, logoSecondary, W - M, hy + 0.5, 36, 10, true);
    doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...primary);
    doc.text(`${brand?.brand_name || ""} — Hospitality Visits`, W / 2, hy + 3.5, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(90);
    doc.text(`${filterSummary}  ·  ${siteLine}`, W / 2, hy + 7.5, { align: "center", maxWidth: W2 - 90 });
    doc.setDrawColor(...primary); doc.setLineWidth(0.4); doc.line(M, hy + 10.5, W - M, hy + 10.5);
    hy += 12.8;
    if (showTotals) {
      const t = computeTotals(visits);
      const presence = Object.entries(t.byPresence).map(([k, n]) => `${PRESENCE_LABELS[k]}: ${n}`).join(" · ");
      const categories = Object.entries(t.byCategory).map(([k, n]) => `${HOSP_CATEGORY_LABELS[k]} ${n}`).join(" · ");
      doc.setFontSize(7.5); doc.setFont("helvetica", "normal"); doc.setTextColor(30);
      doc.text(`Total visits: ${t.total} — ${presence}`, M, hy);
      doc.setTextColor(110);
      doc.text("All times SAST (Africa/Johannesburg, UTC+2)", W - M, hy, { align: "right" });
      hy += 3.3;
      doc.setTextColor(90);
      doc.text(doc.splitTextToSize(`By category: ${categories}`, W2), M, hy);
      hy += 3.3 * Math.min(2, doc.splitTextToSize(`By category: ${categories}`, W2).length);
    }
    y = drawColHead(hy);
  };

  // One data row (or site band). Long values wrap; the row grows as needed.
  const drawRow = (cells, fill) => {
    const wrapped = cells.map((s, i) => doc.splitTextToSize(String(s ?? ""), COLS[i][1] - 2 * PADX));
    const lines = Math.max(1, ...wrapped.map((a) => a.length));
    const rowH = Math.max(ROW_MIN, lines * LINE + 1.2);
    if (y + rowH > BOTTOM) startPage(false);
    if (fill) { doc.setFillColor(242, 245, 249); doc.rect(M, y, W2, rowH, "F"); }
    doc.setFont("helvetica", "normal"); doc.setFontSize(FONT); doc.setTextColor(30);
    wrapped.forEach((ws, i) => ws.forEach((ln, li) => doc.text(ln, colX[i] + PADX, y + 3.0 + li * LINE)));
    y += rowH;
  };

  const drawSiteBand = (name, count) => {
    if (y + BAND_H > BOTTOM) startPage(false);
    doc.setFillColor(...primary); doc.rect(M, y, W2, BAND_H, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(FONT);
    doc.text(`Site — ${name} (${count} ${count === 1 ? "visit" : "visits"})`, M + PADX, y + 3.4);
    y += BAND_H;
  };

  startPage(true);

  const rows = oneSite
    ? visits.map((v) => ({ v, band: null }))
    : [...siteNames].sort()
        .flatMap((sn) => [
          { band: sn, count: visits.filter((v) => siteKey(v) === sn).length },
          ...visits.filter((v) => siteKey(v) === sn).map((v) => ({ v, band: null })),
        ]);

  let stripe = false;
  for (const r of rows) {
    if (r.band) { drawSiteBand(r.band, r.count); stripe = false; continue; }
    drawRow(COLS.map(([, , f]) => f(r.v)), stripe);
    stripe = !stripe;
  }

  const pages = doc.getNumberOfPages();
  const now = fmtSastCell(new Date().toISOString());
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(120);
    doc.text(
      `Generated ${now} SAST · Evidence and identity numbers are excluded from this report · Page ${p} of ${pages}`,
      W / 2, H - 4, { align: "center" }
    );
  }
  doc.save(`${fileBase}.pdf`);
}