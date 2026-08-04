/**
 * USS Guard — Document Scan Audit (Phase 3)
 *
 * Writes a DocumentScan record for every scan attempt (success or failure).
 * Also exposes a best-effort GPS + device descriptor helper.
 *
 * Never stores licence keys.
 */
import { base44 } from "@/api/base44Client";

export function getDeviceDescriptor() {
  try { return navigator?.userAgent || "unknown"; } catch (_) { return "unknown"; }
}

export function getQuickGPS(timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      if (!navigator?.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60000 }
      );
    } catch (_) { resolve(null); }
  });
}

export async function recordScanAudit({
  user, callerPage, documentType, barcodeType, success, reason,
  durationMs, sdkVersion, parserUsed, profile, rawJson, photoUrl,
  mappedSummary, relatedId, relatedEntity, gps, device,
}) {
  try {
    return await base44.entities.DocumentScan.create({
      user_id: user?.id || "",
      user_name: user?.full_name || "",
      guard_id: user?.badge_number || "",
      estate_name: user?.estate_name || "",
      device: device || getDeviceDescriptor(),
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      time: new Date().toISOString(),
      document_type: documentType || "unknown",
      barcode_type: barcodeType || "",
      success: !!success,
      failure_reason: reason || "",
      duration_ms: durationMs || 0,
      sdk_version: sdkVersion || "",
      parser_used: parserUsed || "",
      profile: profile || "",
      raw_json: rawJson || "",
      photo_url: photoUrl || "",
      mapped_summary: mappedSummary || "",
      related_id: relatedId || "",
      related_entity: relatedEntity || "",
      caller_page: callerPage || "",
    });
  } catch (_) {
    return null;
  }
}