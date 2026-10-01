/**
 * hospitalityDocCapture — SERVER-SIDE normalisation + validation of the GRID
 * GATE document captures ("Scan Vehicle Disk" then "Licence Disk").
 *
 * INTERPRETATION (disclosed): the PDF's "Vehicle Disk" = the vehicle licence
 * disc, and the following "Licence Disk" = the driver's licence card. Both are
 * captured with the EXISTING scanner services (PDF417 via barKoder, decoded
 * on-device). Each capture is one of:
 *   - method 'scanned'      — the decoded barcode payload is submitted and the
 *                             key identifier (registration / licence number)
 *                             MUST appear inside that payload. A bare
 *                             "scanned=true" flag is never accepted.
 *   - method 'manual_photo' — scanning was not possible (damaged/unreadable
 *                             barcode, unsupported document): a photograph
 *                             of the document (ownership-verified private
 *                             evidence) + the typed identifier are required,
 *                             and the record is labelled as a manual capture.
 *
 * LIMITATION: the barcode is decoded on the device; the server verifies the
 * decoded identifier is consistent with the submitted payload and stores a
 * SHA-256 fingerprint of it, but it cannot cryptographically prove a camera
 * decode took place (a deliberately modified client could fabricate both).
 */

export interface DocCapture {
  method: 'scanned' | 'manual_photo';
  identifier: string;          // registration number / licence number
  payload_sha256: string | null;
  photo_uri: string | null;
  fields: Record<string, string>;
}

const MAX_PAYLOAD = 64 * 1024;
const alnum = (v: any) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const str = (v: any, n = 120) => String(v ?? '').trim().slice(0, n);

async function sha256(text: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Returns { capture } when valid, { error } when present-but-invalid, {} when absent. */
async function normalise(raw: any, idKey: string, extraKeys: string[]): Promise<{ capture?: DocCapture; error?: string }> {
  if (!raw || typeof raw !== 'object') return {};
  const method = raw.method;
  const identifier = alnum(raw[idKey]);
  const fields: Record<string, string> = {};
  for (const k of extraKeys) if (raw[k]) fields[k] = str(raw[k]);
  if (method === 'scanned') {
    const payload = typeof raw.payload === 'string' ? raw.payload : '';
    if (payload.length < 16 || payload.length > MAX_PAYLOAD) return { error: 'scan_payload_missing' };
    if (identifier.length < 4 || !alnum(payload).includes(identifier)) return { error: 'scan_payload_mismatch' };
    return { capture: { method, identifier, payload_sha256: await sha256(payload), photo_uri: null, fields } };
  }
  if (method === 'manual_photo') {
    const photo = typeof raw.photo_uri === 'string' && raw.photo_uri.trim() ? raw.photo_uri.trim() : null;
    if (!photo) return { error: 'manual_photo_missing' };
    if (identifier.length < 4) return { error: 'manual_identifier_missing' };
    return { capture: { method, identifier, payload_sha256: null, photo_uri: photo, fields } };
  }
  return { error: 'invalid_method' };
}

export async function normaliseVehicleDisc(raw: any) {
  return normalise(raw, 'registration_number', ['licence_number', 'make', 'model', 'colour', 'vin']);
}

export async function normaliseDriverLicence(raw: any) {
  return normalise(raw, 'licence_number', ['holder_name', 'id_number']);
}