/**
 * Attendance Register — OFFICIAL XLSX export (Office Open XML via JSZip).
 *
 * Mirrors the Official PDF register exactly — one shared register dataset
 * (server-scoped through the attendanceAccess gateway) feeds BOTH renderers:
 *
 *   - Title "RFA ATTENDANCE REGISTER", optional business name,
 *     DATE / DATE RANGE line at the top
 *   - The same 9 official register columns, in the same order
 *   - Records grouped by date (like the PDF's per-date pages)
 *   - The captured electronic signature EMBEDDED as an image in the
 *     Signature cell of each record — never a URL or raw base64 text
 *   - Bold header row, wrapped text, sensible column widths, taller
 *     signature rows, frozen header block
 *   - No internal IDs, no debug/developer fields, no raw JSON
 */
import JSZip from "jszip";

// Official register columns — SAME order as the Official PDF register.
const COLS = [
  { header: "Surname, Initials", width: 22 },
  { header: "Identification / Passport number", width: 24 },
  { header: "Company / Customer", width: 20 },
  { header: "Job Description", width: 20 },
  { header: "Medical Centre", width: 16 },
  { header: "Additional Information", width: 26 },
  { header: "Assessment Type", width: 16 },
  { header: "Cell phone number", width: 16 },
  { header: "Signature", width: 20 },
];
const SIG_COL = 8; // 0-based index of the Signature column (I)

// Cell style indexes into cellXfs below
const STYLE_HEADER = 1, STYLE_TITLE = 2, STYLE_DATELINE = 3,
      STYLE_BUSINESS = 4, STYLE_DATA = 5, STYLE_SIG_CELL = 6;

const EMU_PER_PX = 9525;
const SIG_W_PX = 108;  // embedded signature image size
const SIG_H_PX = 42;

function escXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colLetter(i) { // 0-based → A, B, … I
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function fmtDate(iso) {
  const [y, m, d] = String(iso || "").split("-");
  return y ? `${d}/${m}/${y}` : "—";
}

// One record → one row, official register order. Signature stays empty text —
// the captured image is embedded over this cell.
function recordRowValues(rec) {
  return [
    `${rec.surname_snapshot || ""}${rec.initials_snapshot ? ", " + rec.initials_snapshot : ""}`,
    rec.id_number_snapshot || "",
    rec.company_snapshot || "",
    rec.job_description_snapshot || "",
    rec.medical_centre || "",
    rec.additional_information || "",
    rec.assessment_type || "",
    rec.cellphone_snapshot || "",
    "",
  ];
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF1E293B"/><name val="Calibri"/></font>
<font><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB4B4B4"/></left><right style="thin"><color rgb="FFB4B4B4"/></right><top style="thin"><color rgb="FFB4B4B4"/></top><bottom style="thin"><color rgb="FFB4B4B4"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * records: AttendanceRecord[] (with signature_data_url fetched fresh at
 *          generation time via withSignatures), same dataset as the PDF.
 * branding: from the useBranding hook (may be null).
 * dateFrom/dateTo: ISO YYYY-MM-DD of the selected reporting period.
 */
export async function generateOfficialRegisterExcel(records, branding, dateFrom, dateTo) {
  const sharedStrings = [];
  const siMap = new Map();
  const getSI = (s) => {
    const k = String(s ?? "");
    if (!siMap.has(k)) { siMap.set(k, sharedStrings.length); sharedStrings.push(k); }
    return siMap.get(k);
  };

  // Group by date + sort, same as the Official PDF register.
  const byDate = {};
  (records || []).forEach((rec) => {
    const d = rec.attendance_date || rec.attendance_timestamp?.slice(0, 10) || "unknown";
    (byDate[d] = byDate[d] || []).push(rec);
  });
  const dates = Object.keys(byDate).sort();
  dates.forEach((d) => byDate[d].sort((a, b) =>
    (a.attendance_time || "").localeCompare(b.attendance_time || "")));
  const multiDay = dates.length > 1;

  const businessName = branding?.app_name || branding?.name || "";
  const dateLine = dateFrom && dateTo
    ? (dateFrom === dateTo
      ? `DATE: ${fmtDate(dateFrom)}`
      : `DATE: ${fmtDate(dateFrom)} to ${fmtDate(dateTo)}`)
    : "";

  const rowsXml = [];
  const images = []; // { row0, col0, base64, ext }
  let rowIdx = 0; // 1-based

  const stringCell = (row, col0, value, style) =>
    `<c r="${colLetter(col0)}${row}" t="s" s="${style}"><v>${getSI(value)}</v></c>`;

  // ── Title block ──
  rowIdx += 1;
  rowsXml.push(`<row r="${rowIdx}">${stringCell(rowIdx, 0, "RFA ATTENDANCE REGISTER", STYLE_TITLE)}</row>`);
  if (businessName) {
    rowIdx += 1;
    rowsXml.push(`<row r="${rowIdx}">${stringCell(rowIdx, 0, businessName, STYLE_BUSINESS)}</row>`);
  }
  if (dateLine) {
    rowIdx += 1;
    rowsXml.push(`<row r="${rowIdx}">${stringCell(rowIdx, 0, dateLine, STYLE_DATELINE)}</row>`);
  }
  rowIdx += 1; // spacer
  rowsXml.push(`<row r="${rowIdx}"/>`);

  // ── Header row (bold, filled, bordered, wrapped) ──
  rowIdx += 1;
  rowsXml.push(`<row r="${rowIdx}" ht="30" customHeight="1">${
    COLS.map((c, i) => stringCell(rowIdx, i, c.header, STYLE_HEADER)).join("")
  }</row>`);
  const headerRow = rowIdx;

  // ── Data rows, grouped by date like the PDF's per-date pages ──
  dates.forEach((d) => {
    if (multiDay) {
      rowIdx += 1;
      rowsXml.push(`<row r="${rowIdx}" ht="20" customHeight="1">${
        stringCell(rowIdx, 0, `DATE: ${fmtDate(d)}`, STYLE_DATELINE)
      }</row>`);
    }
    byDate[d].forEach((rec) => {
      rowIdx += 1;
      const vals = recordRowValues(rec);
      const hasSig = !!rec.signature_data_url && String(rec.signature_data_url).startsWith("data:image");
      const cells = COLS.map((c, i) => {
        if (i === SIG_COL) return `<c r="${colLetter(i)}${rowIdx}" s="${STYLE_SIG_CELL}"/>`;
        return stringCell(rowIdx, i, vals[i], STYLE_DATA);
      }).join("");
      rowsXml.push(`<row r="${rowIdx}" ht="${hasSig ? 48 : 28}" customHeight="1">${cells}</row>`);
      if (hasSig) {
        const [meta, b64] = rec.signature_data_url.split(",");
        images.push({
          row0: rowIdx - 1, // 0-based for the drawing anchor
          col0: SIG_COL,
          base64: b64 || "",
          ext: meta?.includes("image/jpeg") ? "jpeg" : "png",
        });
      }
    });
  });

  // ── Package parts ──
  const colsXml = `<cols>${COLS.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join("")}</cols>`;

  const wsParts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`,
    colsXml,
    `<sheetData>${rowsXml.join("")}</sheetData>`,
  ];
  if (images.length > 0) wsParts.push(`<drawing r:id="rId1"/>`);
  wsParts.push(`</worksheet>`);
  const wsXml = wsParts.join("\n");

  const ssXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map((s) => `<si><t xml:space="preserve">${escXml(s)}</t></si>`).join("")}
</sst>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Attendance Register" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // Drawing (embedded signature images) — only when there is at least one.
  let drawingXml = "";
  let drawingRelsXml = "";
  let wsRelsXml = "";
  if (images.length > 0) {
    const anchors = images.map((img, i) => {
      const cx = SIG_W_PX * EMU_PER_PX;
      const cy = SIG_H_PX * EMU_PER_PX;
      return `<xdr:oneCellAnchor><xdr:from><xdr:col>${img.col0}</xdr:col><xdr:colOff>19050</xdr:colOff><xdr:row>${img.row0}</xdr:row><xdr:rowOff>9525</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Signature ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvGraphicFramePr><xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
    }).join("");
    drawingXml = `<?xml version="1.0" encoding="UTF-8"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
    drawingRelsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${images.map((img, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.${img.ext}"/>`).join("")}
</Relationships>`;
    wsRelsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>`;
  }

  const appXml = `<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>Attendance Register</Application>
</Properties>`;

  let ctExtra = "";
  if (images.some((i) => i.ext === "png")) ctExtra += `<Default Extension="png" ContentType="image/png"/>`;
  if (images.some((i) => i.ext === "jpeg")) ctExtra += `<Default Extension="jpeg" ContentType="image/jpeg"/>`;
  const drawingOverride = images.length > 0
    ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    : "";
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${ctExtra}
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${drawingOverride}
</Types>`;

  const pkgRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.folder("_rels").file(".rels", pkgRels);
  const xl = zip.folder("xl");
  xl.file("workbook.xml", wbXml);
  xl.file("styles.xml", STYLES_XML);
  xl.file("sharedStrings.xml", ssXml);
  xl.folder("_rels").file("workbook.xml.rels", wbRels);
  xl.folder("worksheets").file("sheet1.xml", wsXml);
  if (images.length > 0) {
    xl.folder("worksheets").folder("_rels").file("sheet1.xml.rels", wsRelsXml);
    xl.folder("drawings").file("drawing1.xml", drawingXml);
    xl.folder("drawings").folder("_rels").file("drawing1.xml.rels", drawingRelsXml);
    const media = xl.folder("media");
    images.forEach((img, i) => media.file(`image${i + 1}.${img.ext}`, img.base64, { base64: true }));
  }
  zip.folder("docProps").file("app.xml", appXml);

  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Official register filename: single date or date range. */
export function attendanceRegisterFilename(dateFrom, dateTo) {
  const suffix = dateFrom === dateTo
    ? String(dateFrom || "export")
    : `${dateFrom}_to_${dateTo}`;
  return `attendance_register_${suffix}.xlsx`;
}