/**
 * Access Control visitor resolution + access-log helpers.
 *
 * resolveOrCreateVisitor: matches an existing Visitor by SA ID number or
 * driver's licence number; if none exists, creates one populated from the
 * barKoder mapped fields + photograph + scan metadata. A successful scan with
 * identifying information must NEVER produce an "Unknown" visitor.
 */
import { base44 } from "@/api/base44Client";

const VISITOR_FIELDS = [
  "surname", "first_names", "initials", "driver_licence_number",
  "date_of_birth", "gender", "nationality", "country", "issue_date",
  "expiry_date", "vehicle_classes", "restrictions", "prdp", "licence_status",
];

export function getDeviceDescriptor() {
  if (typeof navigator === "undefined") return "unknown";
  return String(navigator.userAgent || "unknown").slice(0, 160);
}

export function getGPS() {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
    );
  });
}

/**
 * @param {object} args { mapped, photoUrl, scan }
 * @returns {Promise<{visitor, created, error?}>}
 */
export async function resolveOrCreateVisitor({ mapped, photoUrl, scan, createIfMissing = true }) {
  const idNum = mapped?.visitor_id_number || "";
  const licNum = mapped?.driver_licence_number || "";

  let visitor = null;
  if (idNum) {
    try { const m = await base44.entities.Visitor.filter({ visitor_id_number: idNum }); if (m.length) visitor = m[0]; } catch (_) {}
  }
  if (!visitor && licNum) {
    try { const m = await base44.entities.Visitor.filter({ driver_licence_number: licNum }); if (m.length) visitor = m[0]; } catch (_) {}
  }

  const scanMeta = {
    scan_document_type: scan?.resolvedProfileId || "",
    scan_barcode_type: scan?.result?.barcodeType || "",
    scan_sdk_version: scan?.sdkVersion || "",
    scan_parser_used: scan?.parserUsed || "",
    scan_timestamp: new Date().toISOString(),
    scan_raw_json: scan?.result?.formattedJSONRaw || scan?.result?.textualData || "",
  };
  if (photoUrl) { scanMeta.id_scan_url = photoUrl; scanMeta.scan_thumbnail_url = photoUrl; }

  if (visitor) {
    const updates = { ...scanMeta };
    // The scanned document is the source of truth for identity fields. Always
    // overwrite the stored name + OCR fields with the freshly scanned data so
    // that a previously mis-named visitor record (e.g. a QR pass created with
    // the wrong name, like "Tania Oelofse") is corrected on the next scan
    // instead of perpetuating the wrong name on every subsequent entry.
    for (const k of VISITOR_FIELDS) {
      if (mapped?.[k]) updates[k] = mapped[k];
    }
    const scanName = mapped?.visitor_name
      || [mapped?.first_names, mapped?.surname].filter(Boolean).join(" ").trim();
    if (scanName) updates.visitor_name = scanName;
    try { await base44.entities.Visitor.update(visitor.id, updates); } catch (_) {}
    // Return the merged object so callers (VisitorCard, AccessLog) immediately
    // reflect the corrected scanned name, not the stale stored one.
    return { visitor: { ...visitor, ...updates }, created: false };
  }

  if (!createIfMissing) return { visitor: null, created: false };

  const name = mapped?.visitor_name
    || [mapped?.first_names, mapped?.surname].filter(Boolean).join(" ").trim()
    || "Unknown";
  const payload = {
    visitor_name: name,
    resident_id: "",
    visit_type: "unexpected",
    status: "pending",
    visitor_id_number: idNum,
    ...Object.fromEntries(VISITOR_FIELDS.map((k) => [k, mapped?.[k] || ""])),
    ...scanMeta,
  };
  try {
    const created = await base44.entities.Visitor.create(payload);
    return { visitor: created, created: true };
  } catch (e) {
    console.warn("[access] visitor create failed", e?.message || e);
    return { visitor: { id: null, ...payload }, created: false, error: e };
  }
}

export async function countPreviousVisits(visitorId) {
  if (!visitorId) return 0;
  try {
    const logs = await base44.entities.AccessLog.filter({ visitor_id: visitorId });
    return logs.length;
  } catch (_) { return 0; }
}

/**
 * Returns all AccessLog records for a visitor that are still 'inside' (active
 * entries awaiting exit), newest first. Used by the exit flow to UPDATE the
 * correct record instead of creating a duplicate (Phase B). Multiple results
 * trigger the ambiguous-match picker.
 */
export async function findActiveInsideRecords(visitorId) {
  if (!visitorId) return [];
  try {
    const recs = await base44.entities.AccessLog.filter({ visitor_id: visitorId, status: "inside" });
    return recs.sort((a, b) => new Date(b.entry_time || b.timestamp) - new Date(a.entry_time || a.timestamp));
  } catch (_) { return []; }
}

/**
 * Checks scanned identifiers against active BlacklistEntry records.
 * Returns the first active entry whose identifier_value matches any of the
 * supplied SA ID / driver's licence / vehicle registration (Phase D).
 */
export async function checkBlacklist({ saId, driverLicence, vehicleReg }) {
  const norm = (v) => (v || "").toString().toUpperCase().replace(/\s+/g, "");
  const ids = [norm(saId), norm(driverLicence), norm(vehicleReg)].filter(Boolean);
  if (!ids.length) return null;
  try {
    const entries = await base44.entities.BlacklistEntry.filter({ active: true });
    return entries.find((e) => ids.includes(norm(e.identifier_value))) || null;
  } catch (_) { return null; }
}