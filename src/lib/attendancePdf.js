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

function drawRow(doc, row, y, rowNum, lineColor) {
  const tW = totalTableW();
  doc.setDrawColor(...lineColor);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN, y, tW, ROW_H, "S");

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

  let cx = MARGIN;
  COL_WIDTHS.forEach((w, i) => {
    if (i > 0) { doc.setDrawColor(...lineColor); doc.line(cx, y, cx, y + ROW_H); }
    if (i !== 8) {
      doc.setFontSize(6.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(20, 20, 20);
      const wrapped = doc.splitTextToSize(values[i], w - 2);
      doc.text(wrapped[0] || "", cx + 1.5, y + ROW_H / 2 + 2.2);
    }
    cx += w;
  });

  // Render signature image if present
  if (row?.signature_data_url) {
    try {
      const sigX = colX(8) + 1;
      const sigY = y + 0.8;
      const sigW = COL_WIDTHS[8] - 2;
      const sigH = ROW_H - 1.6;
      doc.addImage(row.signature_data_url, sigX, sigY, sigW, sigH);
    } catch (_) { /* signature rendering failed */ }
  }
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
    // Chunk into pages of ROWS_PER_PAGE
    const chunks = [];
    for (let i = 0; i < dayRecords.length; i += ROWS_PER_PAGE) {
      chunks.push(dayRecords.slice(i, i + ROWS_PER_PAGE));
    }
    if (chunks.length === 0) chunks.push([]); // empty day (should not happen with our filter)

    chunks.forEach((chunk, pageIdx) => {
      if (!isFirstPage) doc.addPage();
      isFirstPage = false;

      const tableTop = dateHeader(doc, dateStr, branding, pageIdx + 1, chunks.length);
      drawTableHeader(doc, tableTop, lineColor);

      let rowY = tableTop + HEADER_ROWS_H;
      for (let ri = 0; ri < ROWS_PER_PAGE; ri++) {
        const record = chunk[ri] || null;
        // Alternate faint row tint for legibility
        if (record && ri % 2 === 1) {
          doc.setFillColor(250, 250, 252);
          doc.rect(MARGIN, rowY, totalTableW(), ROW_H, "F");
        }
        drawRow(doc, record, rowY, ri + 1 + pageIdx * ROWS_PER_PAGE, lineColor);
        rowY += ROW_H;
      }

      pageFooter(doc, branding);
    });
  });

  return doc.output("blob");
}

export function generateIndividualAttendancePdf(record, worker, branding) {
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
    doc.text(String(value || "—"), 75, y);
  };

  let fy = 42;
  const fGap = 9;
  field("Date", dateStr, fy); fy += fGap;
  field("Time", record.attendance_time || "—", fy); fy += fGap;
  field("Surname, Initials", `${record.surname_snapshot || ""}${record.initials_snapshot ? ", " + record.initials_snapshot : ""}`, fy); fy += fGap;
  field("ID / Passport Number", record.id_number_snapshot || "—", fy); fy += fGap;
  field("Company / Customer", record.company_snapshot || "—", fy); fy += fGap;
  field("Job Description", record.job_description_snapshot || "—", fy); fy += fGap;
  field("Medical Centre", record.medical_centre || "—", fy); fy += fGap;
  field("Additional Information", record.additional_information || "—", fy); fy += fGap;
  field("Assessment Type", record.assessment_type || "—", fy); fy += fGap;
  field("Cellphone Number", record.cellphone_snapshot || "—", fy); fy += fGap;
  field("Captured By", record.captured_by_name || "—", fy); fy += fGap + 4;

  if (record.signature_data_url) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);
    doc.text("Signature:", 15, fy);
    fy += 2;
    try { doc.addImage(record.signature_data_url, 15, fy, 80, 25); } catch (_) {}
    fy += 30;
  }

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

export function generateWorkerIdPdf(worker, branding) {
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
    doc.text(String(value || "—"), 75, y);
  };

  let fy = 42;
  const fGap = 9;
  field("Name", worker.first_names || "—", fy); fy += fGap;
  field("Surname / Initials", `${worker.surname || ""}${worker.initials ? ", " + worker.initials : ""}`, fy); fy += fGap;
  field("ID / Passport Number", worker.id_number || "—", fy); fy += fGap;
  field("Document Type", ({ sa_id: "SA ID", drivers_licence: "Driver's Licence", passport: "Passport", other: "Other" })[worker.id_type] || "—", fy); fy += fGap;
  field("Company / Customer", worker.company || "—", fy); fy += fGap;
  field("Job Description", worker.job_description || "—", fy); fy += fGap;
  if (worker.id_captured_at) {
    field("Date Document Captured", new Date(worker.id_captured_at).toLocaleDateString("en-ZA"), fy); fy += fGap;
  }
  fy += 6;

  if (worker.id_front_url) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text("IDENTIFICATION DOCUMENT — FRONT", 105, fy, { align: "center" });
    fy += 3;
    try { doc.addImage(worker.id_front_url, 15, fy, 85, 55); } catch (_) {}
    if (worker.id_back_url) {
      try { doc.addImage(worker.id_back_url, 110, fy, 85, 55); } catch (_) {}
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text("FRONT", 57, fy + 58, { align: "center" });
      doc.text("BACK", 152, fy + 58, { align: "center" });
    }
    fy += 65;
  }

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