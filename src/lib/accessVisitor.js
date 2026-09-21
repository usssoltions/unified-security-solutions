/**
 * Access Control visitor resolution + access-log helpers.
 *
 * resolveOrCreateVisitor: matches an existing Visitor by SA ID number or
 * driver's licence number; if none exists, creates one populated from the
 * barKoder mapped fields + photograph + scan metadata. A successful scan with
 * identifying information must NEVER produce an "Unknown" visitor.
 *
 * TENANT ISOLATION: visitor matching and creation happen SERVER-SIDE through
 * the finalizeAccessEntry gateway (action resolve_visitor), which resolves
 * the caller's customer scope from the authoritative User record and scopes
 * the lookup to their own customer — a visitor profile of another customer is
 * never matched, and the created record is stamped with the caller's tenant
 * server-side (never trusted from the client).
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

const unwrap = (res) => (res?.data !== undefined ? res.data : res);

/**
 * @param {object} args { mapped, photoUrl, scan, createIfMissing }
 * @returns {Promise<{visitor, created, error?}>}
 */
export async function resolveOrCreateVisitor({ mapped, photoUrl, scan, createIfMissing = true }) {
  const scanName = mapped?.visitor_name
    || [mapped?.first_names, mapped?.surname].filter(Boolean).join(" ").trim();
  try {
    const res = await base44.functions.invoke("finalizeAccessEntry", {
      action: "resolve_visitor",
      access_data: {
        mapped: mapped || {},
        photo_url: photoUrl || "",
        scan: scan || null,
        create_if_missing: createIfMissing,
      },
    });
    const d = unwrap(res);
    if (d?.error) {
      console.warn("[access] visitor resolve failed:", d.error);
      return { visitor: null, created: false, error: d.error };
    }
    return { visitor: d?.visitor || null, created: !!d?.created };
  } catch (e) {
    console.warn("[access] visitor resolve failed", e?.message || e);
    // Never fabricate a usable visitor client-side — the caller surfaces a
    // retryable error instead of persisting an unsccoped record.
    return {
      visitor: null,
      created: false,
      error: e?.response?.data?.error || e?.message || "Visitor resolution failed",
    };
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
 * trigger the ambiguous-match picker. Reads are tenant-scoped by the
 * AccessLog RLS (own customer / own records only).
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
 * Reads are tenant-scoped by the BlacklistEntry RLS (own customer only) —
 * another customer's bans never match here.
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