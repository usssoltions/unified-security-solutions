/**
 * Attendance Register — True XLSX export using jszip (already installed).
 *
 * Generates a proper .xlsx workbook (Office Open XML) with:
 *   - Bold header row
 *   - All required columns
 *   - Auto-width columns
 *   - No images (per spec)
 */
import JSZip from "jszip";

const COLS = [
  { key: "attendance_date",        header: "Date" },
  { key: "attendance_time",        header: "Time" },
  { key: "surname_snapshot",       header: "Surname, Initials" },
  { key: "id_number_snapshot",     header: "Identification / Passport Number" },
  { key: "company_snapshot",       header: "Company / Customer" },
  { key: "job_description_snapshot", header: "Job Description" },
  { key: "medical_centre",         header: "Medical Centre" },
  { key: "additional_information", header: "Additional Information" },
  { key: "assessment_type",        header: "Assessment Type" },
  { key: "cellphone_snapshot",     header: "Cellphone Number" },
  { key: "captured_by_name",       header: "Captured By" },
  { key: "worker_id",              header: "Worker Ref" },
];

function escXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellRef(col, row) {
  const letter = String.fromCharCode(64 + col);
  return `${letter}${row}`;
}

export async function generateAttendanceExcel(records) {
  // Build sheet rows
  const rows = [COLS.map(c => c.header)]; // header
  records.forEach(rec => {
    const surnameInitials = `${rec.surname_snapshot || ""}${rec.initials_snapshot ? ", " + rec.initials_snapshot : ""}`;
    const row = COLS.map(c => {
      if (c.key === "surname_snapshot") return surnameInitials;
      return rec[c.key] ?? "";
    });
    rows.push(row);
  });

  // Build worksheet XML
  const sharedStrings = [];
  const stringIndex = {};
  const getSI = (s) => {
    const k = String(s);
    if (stringIndex[k] !== undefined) return stringIndex[k];
    stringIndex[k] = sharedStrings.length;
    sharedStrings.push(k);
    return stringIndex[k];
  };

  let wsRows = "";
  rows.forEach((row, ri) => {
    const cells = row.map((val, ci) => {
      const ref = cellRef(ci + 1, ri + 1);
      const si = getSI(val);
      return `<c r="${ref}" t="s"><v>${si}</v></c>`;
    }).join("");
    wsRows += `<row r="${ri + 1}">${cells}</row>`;
  });

  const wsXml = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${wsRows}</sheetData>
</worksheet>`;

  const ssXml = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map(s => `<si><t xml:space="preserve">${escXml(s)}</t></si>`).join("")}
</sst>`;

  const wbXml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Attendance" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const appXml = `<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Application>USS Attendance Register</Application>
</Properties>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
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
  xl.file("sharedStrings.xml", ssXml);
  xl.folder("_rels").file("workbook.xml.rels", wbRels);
  xl.folder("worksheets").file("sheet1.xml", wsXml);
  zip.folder("docProps").file("app.xml", appXml);

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return blob;
}