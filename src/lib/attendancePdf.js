/**
 * Attendance Register — PDF generation (jsPDF text/vector only).
 *
 * Produces:
 *   generateOfficialRegisterPdf(records, branding, dateFrom, dateTo) → Blob
 *   generateIndividualAttendancePdf(record, branding) → Blob
 *   generateWorkerIdPdf(worker, branding) → Blob
 *
 * Uses only jsPDF which is already installed.
 * No screenshots, no html2canvas — pure vector/text for print quality.
 */
import jsPDF from "jspdf";

const PAGE_W = 297;   // A4 landscape width mm
const PAGE_H = 210;   // A4 landscape height mm
const MARGIN = 8;
const COL_WIDTHS = [42, 36, 30, 28, 26, 26, 30, 28, 51]; // ~297 minus margins
// Cols: Surname/Initials | ID/Passport | Company | Job Desc | Med Centre | Add Info | Assessment | Cell | Signature
const COL_HEADERS = ["Surname, Initials", "Identification /\nPassport number", "Company /\nCustomer", "Job Description", "Medical\nCentre", "Additional\nInformation", "Assessment\nType", "Cell phone\nnumber", "Signature"];
const ROWS_PER_PAGE = 20;
const ROW_H = 7.5;
const HEADER_ROWS_H = 14; // two-line header

// ── Helpers ───────────────────────────────────────────────────────────────────
function addLogo(doc, logoUrl, x, y, maxW, maxH) {
  if (!logoUrl) return;
  try {
    // jsPDF addImage supports data URLs
    if (logoUrl.startsWith("data:image")) {
      doc.addImage(logoUrl, x, y, maxW, maxH);
    }
  } catch (_) { /* logo failed — silent; text heading remains */ }
}

function wrapText(doc, text, maxWidth, fontSize) {
  doc.setFontSize(fontSize);
  return doc.splitTextToSize(String(text ?? ""), maxWidth);
}

function colX(colIndex) {
  let x = MARGIN;
  for (let i = 0; i < colIndex; i++) x += COL_WIDTHS[i];
  return x;
}
function totalTableW() { return COL_WIDTHS.reduce((s, w) => s + w, 0); }

function drawTableHeader(doc, y, lineColor) {
  const tW = totalTableW();
  // Header row background (very light grey)
  doc.setFillColor(245, 245, 245);
  doc.rect(MARGIN, y, tW, HEADER_ROWS_H, "F");

  // Draw vertical + horizontal borders
  doc.setDrawColor(...lineColor);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN, y, tW, HEADER_ROWS_H, "S");

  let cx = MARGIN;
  COL_WIDTHS.forEach((w, i) => {
    if (i > 0) { doc.line(cx, y, cx, y + HEADER_ROWS_H); }
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    const lines = COL_HEADERS[i].split("\n");
    const lh = 4;
    const startY = y + (HEADER_ROWS_H - lines.length * lh) / 2 + 3.5;
    lines.forEach((line, li) => {
      doc.text(line, cx + w / 2, startY + li * lh, { align: "center" });
    });
    cx += w;
  });

  // Row number header column label (leftmost, narrow)
  doc.setFontSize(6);
  doc.setTextColor(120, 120, 120);
  // Already included in the first column
}

const LINE_H = 2.9; // mm per wrapped text line (6.5pt font)

// Wrap every cell's FULL value across as many lines as it needs — a long
// surname/initials value or ID/passport number is never clipped to one line.
function computeRowLayout(doc, row) {
  const values = [
    row ? `${row.surname_snapshot || ""}${row.initials_snapshot ? ", " + row.initials_snapshot : ""}` : "",
    row ? row.id_number_snapshot || "" : "",
    row ? row.company_snapshot || "" : "",
    row ? row.job_description_snapshot || "" : "",
    row ? row.medical_centre || "" : "",
    row ? row.additional_information || "" : "",
    row ? row.assessment_type || "" : "",
    row ? row.cellphone_snapshot || "" : "",
    "", // Signature — rendered separately
  ];
  doc.setFontSize(6.5);
  const cellLines = values.map((v, i) => (i === 8 ? [] : doc.splitTextToSize(String(v ?? ""), COL_WIDTHS[i] - 2)));
  const maxLines = Math.max(1, ...cellLines.map(l => l.length));
  return { cellLines, rowH: Math.max(ROW_H, maxLines * LINE_H + 2.4) };
}

function measureRowHeight(doc, row) { return computeRowLayout(doc, row).rowH; }

function drawRow(doc, row, y, lineColor) {
  const tW = totalTableW();
  const { cellLines, rowH } = computeRowLayout(doc, row);
  doc.setDrawColor(...lineColor);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, tW, rowH, "S");

  let cx = MARGIN;
  cellLines.forEach((lines, i) => {
    if (i > 0) { doc.setDrawColor(...lineColor); doc.line(cx, y, cx, y + rowH); }
    if (i !== 8) {
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(20, 20, 20);
      lines.forEach((line, li) => {
        doc.text(line, cx + 1.5, y + 3.6 + li * LINE_H);
      });
    }
    cx += COL_WIDTHS[i];
  });

  // Render signature image if present — scaled to the row's actual height
  if (row?.signature_data_url) {
    try {
      const sigX = colX(8) + 1;
      const sigY = y + 0.8;
      const sigW = COL_WIDTHS[8] - 2;
      const sigH = rowH - 1.6;
      doc.addImage(row.signature_data_url, sigX, sigY, sigW, sigH);
    } catch (_) { /* signature rendering failed */ }
  }
  return rowH;
}

function dateHeader(doc, dateStr, branding, pageNum, pageTotal) {
  // Page header with branding
  const logoH = 12;
  const logoW = 20;
  let headerY = MARGIN;

  // Customer name centred
  const businessName = branding?.app_name || branding?.name || "ATTENDANCE REGISTER";
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text("RFA ATTENDANCE REGISTER", PAGE_W / 2, headerY + 6, { align: "center" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  if (businessName && businessName !== "ATTENDANCE REGISTER") {
    doc.text(businessName, PAGE_W / 2, headerY + 11, { align: "center" });
  }

  // Date
  const [y, m, d] = dateStr.split("-");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`DATE: ${d}/${m}/${y}`, MARGIN, headerY + 8);
  if (pageTotal > 1) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(`Page ${pageNum} of ${pageTotal}`, MARGIN, headerY + 13);
  }

  // Optional logo — top right
  if (branding?.logo_url && branding.logo_url.startsWith("data:image")) {
    addLogo(doc, branding.logo_url, PAGE_W - MARGIN - logoW, headerY, logoW, logoH);
  }

  return headerY + 16;
}

function pageFooter(doc, branding) {
  const y = PAGE_H - MARGIN;
  const footer = [
    branding?.support_phone ? `T: ${branding.support_phone}` : null,
    branding?.support_email ? `E: ${branding.support_email}` : null,
    branding?.address || null,
    branding?.website || null,
  ].filter(Boolean).join("  |  ");
  if (footer) {
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 120);
    doc.text(footer, PAGE_W / 2, y, { align: "center" });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────
/**
 * records: AttendanceRecord[] sorted by attendance_date ASC, then attendance_time ASC
 * branding: from useBranding hook (may be null)
 */
export function generateOfficialRegisterPdf(records, branding) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const lineColor = [180, 180, 180];
  const primaryHex = branding?.primary_color || "#1e293b";
  const r = parseInt(primaryHex.slice(1, 3), 16) || 30;
  const g = parseInt(primaryHex.slice(3, 5), 16) || 41;
  const b = parseInt(primaryHex.slice(5, 7), 16) || 59;

  // Group records by date
  const byDate = {};
  records.forEach(rec => {
    const d = rec.attendance_date || rec.attendance_timestamp?.slice(0, 10) || "unknown";
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(rec);
  });

  const dates = Object.keys(byDate).sort();
  let isFirstPage = true;

  dates.forEach(dateStr => {
    const dayRecords = byDate[dateStr].sort((a, b) =>
      (a.attendance_time || "").localeCompare(b.attendance_time || "")
    );
    // Dynamic pagination: each row grows with its wrapped content, so a page
    // holds as many rows as ACTUALLY fit — tall rows never clip and page
    // breaks never fall inside a row.
    const usableRowSpace = PAGE_H - MARGIN - 4 - (MARGIN + 16 + HEADER_ROWS_H);
    const chunks = [];
    let cur = [], used = 0;
    dayRecords.forEach(rec => {
      const h = measureRowHeight(doc, rec);
      if (cur.length && used + h > usableRowSpace) { chunks.push(cur); cur = []; used = 0; }
      cur.push(rec); used += h;
    });
    if (cur.length) chunks.push(cur);

    chunks.forEach((chunk, pageIdx) => {
      if (!isFirstPage) doc.addPage();
      isFirstPage = false;

      const tableTop = dateHeader(doc, dateStr, branding, pageIdx + 1, chunks.length);
      drawTableHeader(doc, tableTop, lineColor);

      let rowY = tableTop + HEADER_ROWS_H;
      chunk.forEach((record, ri) => {
        // Alternate faint row tint for legibility
        if (ri % 2 === 1) {
          doc.setFillColor(250, 250, 252);
          doc.rect(MARGIN, rowY, totalTableW(), measureRowHeight(doc, record), "F");
        }
        rowY += drawRow(doc, record, rowY, lineColor);
      });

      pageFooter(doc, branding);
    });
  });

  return doc.output("blob");
}

export async function generateIndividualAttendancePdf(record, worker, branding) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const [y, m, d] = (record.attendance_date || "").split("-");
  const dateStr = record.attendance_date ? `${d}/${m}/${y}` : "—";

  const businessName = branding?.app_name || branding?.name || "USS Platform";
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(businessName, 105, 18, { align: "center" });
  doc.setFontSize(11);
  doc.text("INDIVIDUAL ATTENDANCE RECORD", 105, 26, { align: "center" });
  doc.setLineWidth(0.4);
  doc.line(15, 30, 195, 30);

  const field = (label, value, y) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);
    doc.text(label, 15, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    // The full value wraps to the available width — a long surname or ID /
    // passport number is rendered completely, never clipped at the page edge.
    const lines = doc.splitTextToSize(String(value || "—"), 110);
    lines.forEach((line, li) => doc.text(line, 75, y + li * 4.2));
    return lines.length - 1;
  };

  let fy = 42;
  const fGap = 9;
  const fld = (label, value) => { fy += fGap + field(label, value, fy) * 4.2; };
  fld("Date", dateStr);
  fld("Time", record.attendance_time || "—");
  fld("Surname, Initials", `${record.surname_snapshot || ""}${record.initials_snapshot ? ", " + record.initials_snapshot : ""}`);
  fld("ID / Passport Number", record.id_number_snapshot || "—");
  fld("Document Type", ID_TYPE_LABEL[record.id_type_snapshot] || "—");
  fld("Company / Customer", record.company_snapshot || "—");
  fld("Job Description", record.job_description_snapshot || "—");
  fld("Medical Centre", record.medical_centre || "—");
  fld("Additional Information", record.additional_information || "—");
  fld("Assessment Type", record.assessment_type || "—");
  fld("Cellphone Number", record.cellphone_snapshot || "—");
  fld("Captured By", record.captured_by_name || "—");
  fy += 4;

  // Electronic signature — REQUIRED and embedded as a visible image.
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(80, 80, 80);
  doc.text("Electronic Signature:", 15, fy);
  doc.setDrawColor(200, 200, 200);
  doc.rect(15, fy + 2, 90, 32);
  await embedImage(doc, record.signature_data_url, 16, fy + 3, 88, 30, "The electronic signature");
  fy += 2 + 32 + 8;

  // ID-document photos of THIS visit (its own snapshot — never the worker's
  // newer profile photos). Every stored photo must embed, or the PDF fails.
  if (record.id_photo_front_url && !record.id_photo_front_data) throw new Error("The ID photo (front) could not be retrieved.");
  if (record.id_photo_back_url && !record.id_photo_back_data) throw new Error("The ID photo (back) could not be retrieved.");
  const captureMeta = [
    PHOTO_SOURCE_LABEL[record.id_photo_source],
    record.id_photo_captured_at ? new Date(record.id_photo_captured_at).toLocaleString("en-ZA") : null,
    record.id_photo_captured_by_name ? `by ${record.id_photo_captured_by_name}` : null,
  ].filter(Boolean).join(" · ");
  fy = await drawIdPhotos(doc, fy, {
    front: record.id_photo_front_url ? record.id_photo_front_data : null,
    back: record.id_photo_back_url ? record.id_photo_back_data : null,
    idType: record.id_type_snapshot, meta: captureMeta,
    emptyText: "No ID photos saved for this attendance.",
  });

  // Footer
  const footer = [
    branding?.support_phone ? `T: ${branding.support_phone}` : null,
    branding?.support_email ? `E: ${branding.support_email}` : null,
  ].filter(Boolean).join("  |  ");
  if (footer) {
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(footer, 105, 287, { align: "center" });
  }

  return doc.output("blob");
}

/** Contain-fit mm dimensions for an image URL, computed from the image's REAL
 * aspect ratio so documents are never stretched in the PDF. Falls back to 4:3
 * if dimensions cannot be read. */
function fittedImageRect(url, maxW, maxH) {
  return new Promise((resolve) => {
    const img = new Image();
    const fallback = () => {
      const s = Math.min(maxW / 4, maxH / 3);
      resolve({ w: 4 * s, h: 3 * s });
    };
    img.onload = () => {
      const w = img.naturalWidth || 4;
      const h = img.naturalHeight || 3;
      const s = Math.min(maxW / w, maxH / h);
      resolve({ w: w * s, h: h * s });
    };
    img.onerror = fallback;
    img.src = url;
  });
}

const ID_TYPE_LABEL = { sa_id: "SA ID", drivers_licence: "Driver's Licence", passport: "Passport", other: "Other" };
const PHOTO_SOURCE_LABEL = {
  captured_this_visit: "Captured during this attendance",
  on_file: "Worker's photos on file used for this attendance",
  attached_by_edit: "Attached by administrator edit",
};

/** Embed a data-url image contain-fit in a box. Throws (never silently
 * skips) when the image is missing or cannot be embedded. */
async function embedImage(doc, dataUrl, x, y, boxW, boxH, what) {
  if (!dataUrl || !String(dataUrl).startsWith("data:image")) throw new Error(`${what} could not be retrieved.`);
  const fit = await fittedImageRect(dataUrl, boxW, boxH);
  try {
    doc.addImage(dataUrl, x + (boxW - fit.w) / 2, y + (boxH - fit.h) / 2, fit.w, fit.h);
  } catch (_) {
    throw new Error(`${what} could not be embedded in the PDF.`);
  }
}

/** ID-document photos, one per row at a readable size, labelled with the
 * side and document type; adds pages as needed so nothing is clipped. */
async function drawIdPhotos(doc, fy, { front, back, idType, meta, emptyText }) {
  const typeLabel = ID_TYPE_LABEL[idType] || "ID document";
  const BOX_W = 180, BOX_H = 95;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(60, 60, 60);
  if (fy > 262) { doc.addPage(); fy = 20; }
  doc.text(`ID DOCUMENT PHOTOS — ${typeLabel}`, 15, fy);
  fy += 5;
  if (meta) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.splitTextToSize(meta, 180).forEach((l) => { doc.text(l, 15, fy); fy += 4; });
  }
  const items = [
    front ? { label: idType === "passport" ? "INFORMATION / PHOTO PAGE" : "FRONT", data: front } : null,
    back ? { label: "BACK", data: back } : null,
  ].filter(Boolean);
  if (!items.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text(emptyText, 15, fy + 2);
    return fy + 10;
  }
  for (const { label, data } of items) {
    if (fy + 7 + BOX_H > 280) { doc.addPage(); fy = 20; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text(`${label} — ${typeLabel}`, 15, fy + 3);
    doc.setDrawColor(200, 200, 200);
    doc.rect(15, fy + 5, BOX_W, BOX_H);
    await embedImage(doc, data, 16, fy + 6, BOX_W - 2, BOX_H - 2, `The ID photo (${label.toLowerCase()})`);
    fy += 5 + BOX_H + 6;
  }
  return fy;
}

export async function generateWorkerIdPdf(worker, branding) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const businessName = branding?.app_name || branding?.name || "USS Platform";

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(businessName, 105, 18, { align: "center" });
  doc.setFontSize(11);
  doc.text("WORKER / PATIENT IDENTIFICATION DOCUMENT", 105, 26, { align: "center" });
  doc.setLineWidth(0.4);
  doc.line(15, 30, 195, 30);

  const field = (label, value, y) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);
    doc.text(label, 15, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(20, 20, 20);
    // The full value wraps to the available width — a long surname or ID /
    // passport number is rendered completely, never clipped at the page edge.
    const lines = doc.splitTextToSize(String(value || "—"), 110);
    lines.forEach((line, li) => doc.text(line, 75, y + li * 4.2));
    return lines.length - 1;
  };

  let fy = 42;
  const fGap = 9;
  const fld = (label, value) => { fy += fGap + field(label, value, fy) * 4.2; };
  fld("Name", worker.first_names || "—");
  fld("Surname / Initials", `${worker.surname || ""}${worker.initials ? ", " + worker.initials : ""}`);
  fld("ID / Passport Number", worker.id_number || "—");
  fld("Document Type", ({ sa_id: "SA ID", drivers_licence: "Driver's Licence", passport: "Passport", other: "Other" })[worker.id_type] || "—");
  fld("Company / Customer", worker.company || "—");
  fld("Job Description", worker.job_description || "—");
  if (worker.id_captured_at) {
    fld("Date Document Captured", new Date(worker.id_captured_at).toLocaleDateString("en-ZA"));
  }
  fy += 6;

  // Document images — rendered from the STORED masters (the tightly cropped
  // high-quality document photos). Width/height are computed from each
  // image's actual aspect ratio (contain-fit) — never stretched, never an
  // upscaled thumbnail.
  if (worker.id_front_url && !worker.id_front_data) throw new Error("The ID photo (front) could not be retrieved.");
  if (worker.id_back_url && !worker.id_back_data) throw new Error("The ID photo (back) could not be retrieved.");
  fy = await drawIdPhotos(doc, fy, {
    front: worker.id_front_url ? worker.id_front_data : null,
    back: worker.id_back_url ? worker.id_back_data : null,
    idType: worker.id_type, meta: null, emptyText: "No ID photos on file.",
  });

  const footer = [
    branding?.support_phone ? `T: ${branding.support_phone}` : null,
    branding?.support_email ? `E: ${branding.support_email}` : null,
  ].filter(Boolean).join("  |  ");
  if (footer) {
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(footer, 105, 287, { align: "center" });
  }

  return doc.output("blob");
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}