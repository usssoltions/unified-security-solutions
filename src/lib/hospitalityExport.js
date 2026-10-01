/**
 * GRID GATE Hospitality exports (CSV/Excel + PDF). Routine bulk exports
 * deliberately EXCLUDE evidence photos, identity/licence numbers and full
 * mobile numbers — evidence is viewed per visit in the app only.
 */
import jsPDF from "jspdf";
import {
  HOSP_CATEGORY_LABELS, PRESENCE_LABELS, ADMISSION_LABELS, presenceOf, fmtDT, yesNo,
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

function addLogo(doc, dataUrl, x, y, maxW, maxH, alignRight) {
  if (!dataUrl) return;
  try {
    const p = doc.getImageProperties(dataUrl);
    const r = Math.min(maxW / p.width, maxH / p.height);
    const w = p.width * r, h = p.height * r;
    doc.addImage(dataUrl, alignRight ? x - w : x, y, w, h);
  } catch (_) { /* logo optional */ }
}

const PDF_COLS = [
  ["Created", 30, (v) => fmtDT(v.created_date)], ["Category", 30, (v) => HOSP_CATEGORY_LABELS[v.category]],
  ["Name", 38, (v) => v.person_name || ""], ["Room", 14, (v) => v.room_number || ""],
  ["Occ.", 10, (v) => String(v.occupant_count ?? "")], ["Admission", 20, (v) => ADMISSION_LABELS[v.status]],
  ["Presence", 24, (v) => PRESENCE_LABELS[presenceOf(v)]], ["Entry", 30, (v) => fmtDT(v.entry?.entry_time)],
  ["Exit", 30, (v) => fmtDT(v.entry?.exit_time)], ["Processed by", 55, (v) => v.entry?.guard_name || v.created_by_guard_name || ""],
];

export function exportVisitsPdf(visits, brand, filterSummary, fileBase) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const W = 297, M = 10;
  const primary = hexRgb(brand?.primary_color);
  const header = () => {
    addLogo(doc, brand?.logo_data_url, M, 6, 45, 16, false);
    addLogo(doc, brand?.secondary_logo_data_url, W - M, 6, 40, 14, true);
    doc.setTextColor(...primary); doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(`${brand?.brand_name || ""} — Hospitality Visits`, W / 2, 13, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(90);
    doc.text(filterSummary, W / 2, 18, { align: "center" });
    doc.setDrawColor(...primary); doc.setLineWidth(0.5); doc.line(M, 24, W - M, 24);
  };
  header();
  const t = computeTotals(visits);
  doc.setFontSize(9); doc.setTextColor(30);
  doc.text(`Total visits: ${t.total}   ` + Object.entries(t.byPresence).map(([k, n]) => `${PRESENCE_LABELS[k]}: ${n}`).join("   "), M, 30);
  doc.text("By category: " + Object.entries(t.byCategory).map(([k, n]) => `${HOSP_CATEGORY_LABELS[k]} ${n}`).join(", "), M, 35);
  let y = 42;
  const drawHead = () => {
    doc.setFillColor(...primary); doc.rect(M, y - 4, W - 2 * M, 6, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    let x = M + 1; PDF_COLS.forEach(([h, w]) => { doc.text(h, x, y); x += w; });
    doc.setFont("helvetica", "normal"); doc.setTextColor(30); y += 6;
  };
  drawHead();
  visits.forEach((v, i) => {
    if (y > 196) { doc.addPage(); header(); y = 32; drawHead(); }
    if (i % 2 === 0) { doc.setFillColor(244, 246, 249); doc.rect(M, y - 4, W - 2 * M, 6, "F"); }
    let x = M + 1;
    PDF_COLS.forEach(([, w, f]) => { doc.text(doc.splitTextToSize(String(f(v) ?? ""), w - 2)[0] || "", x, y); x += w; });
    y += 6;
  });
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7); doc.setTextColor(120);
    doc.text(`Generated ${fmtDT(new Date().toISOString())} · Evidence and identity numbers are excluded from this report · Page ${p} of ${pages}`, W / 2, 205, { align: "center" });
  }
  doc.save(`${fileBase}.pdf`);
}