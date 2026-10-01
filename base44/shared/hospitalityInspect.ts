/**
 * hospitalityInspect — management-inspection helpers for GRID GATE visits.
 * Raw storage uris, idempotency/claim tokens and scan fingerprints are never
 * returned; identity numbers are returned only to senior roles.
 */

const URI_FIELDS = ['firearm_photo_uri', 'po_invoice_photo_uri', 'food_photo_uri', 'delivery_person_photo_uri',
  'identity_document_photo_uri', 'vehicle_disc_photo_uri', 'driver_licence_photo_uri'];

export function sanitizeVisitForList(v: any, l: any, canSensitive: boolean) {
  const clean: any = { ...v };
  for (const f of URI_FIELDS) { clean[f.replace('_uri', '_present')] = !!v[f]; delete clean[f]; }
  clean.vehicle_photo_count = (v.vehicle_photo_uris || []).length; delete clean.vehicle_photo_uris;
  clean.staff_declaration_photo_count = (v.staff_declaration_photo_uris || []).length; delete clean.staff_declaration_photo_uris;
  for (const k of ['submit_token', 'confirm_claim_token', 'identity_key', 'vehicle_disc_payload_sha256', 'driver_licence_payload_sha256']) delete clean[k];
  if (!canSensitive) for (const k of ['sa_id_number', 'driver_licence_number', 'identity_document_number', 'licence_holder_name']) delete clean[k];
  clean.entry = l ? {
    status: l.status, entry_time: l.entry_time, gate_name: l.gate_name, guard_name: l.guard_name,
    entry_device_name: l.entry_device_name || null, exit_time: l.exit_time || null, exit_gate: l.exit_gate || null,
    exit_guard_name: l.exit_guard_name || null, exit_device_name: l.exit_device_name || null,
    time_on_site_minutes: l.time_on_site_minutes ?? null, flag_reason: l.flag_reason || null,
    void_reason: l.void_reason || null,
  } : null;
  return clean;
}

/** Fetch a (public) logo and inline it as a data URL for client PDF rendering. */
export async function toDataUrl(url: any): Promise<string | null> {
  if (!url) return null;
  try {
    const r = await fetch(String(url));
    if (!r.ok) return null;
    const type = r.headers.get('content-type') || 'image/png';
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  } catch (_) { return null; }
}