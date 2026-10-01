/**
 * gridGateWorkflow — shared, server-side definition and validation of the
 * GRID GATE Hospitality custom access-control workflow (Hyatt House Sandton
 * — Demo under Grid Protection). Source: "Workflow for Access Control.pdf"
 * (customer requirements reference).
 *
 * SECURITY-CRITICAL: this is the SINGLE authoritative place that decides
 * whether a hospitality category submission has met every documented
 * confirmation/capture/evidence requirement. It is invoked SERVER-SIDE from
 * finalizeAccessEntry's hospitality_submit action — never trust a client
 * "confirmed"/"scanned" flag; every underlying field is re-checked here. An
 * unanswered or negative required confirmation always returns pending.
 *
 * Each category is checked in the PDF's documented SEQUENCE, so the first
 * missing item reported is always the guard's next step.
 */

export const HOSPITALITY_WORKFLOW_ID = 'grid_gate_hospitality';

export const HOSPITALITY_CATEGORIES = [
  'check_in', 'contractor', 'delivery', 'event_visitor', 'guest',
  'service_provider', 'staff', 'uber_eats_mrd', 'uber', 'visitor',
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  check_in: 'Check Ins',
  contractor: 'Contractors',
  delivery: 'Deliveries',
  event_visitor: 'Event or Function Visitor',
  guest: 'Guests',
  service_provider: 'Service Provider',
  staff: 'Staff',
  uber_eats_mrd: 'Uber Eats / Mr D',
  uber: 'Uber',
  visitor: 'Visitors',
};

// AccessLog.person_type mapping (AccessLog schema shared by every customer is
// unchanged). LIMITATION: no "staff"/"hotel guest" person type — staff maps
// to 'unknown' (never 'resident', which means an estate resident here).
export const CATEGORY_PERSON_TYPE: Record<string, string> = {
  check_in: 'visitor', contractor: 'contractor', delivery: 'vendor',
  event_visitor: 'visitor', guest: 'visitor', service_provider: 'vendor',
  staff: 'unknown', uber_eats_mrd: 'vendor', uber: 'vendor', visitor: 'visitor',
};

/** Who the guard must confirm with — server-derived, stored as confirmation_party. */
export const CONFIRMATION_PARTY: Record<string, string> = {
  check_in: 'reception',
  contractor: 'relevant_department',
  delivery: 'relevant_department',
  service_provider: 'relevant_department',
  uber_eats_mrd: 'reception',
  uber: 'reception',
};

/** Categories whose PDF flow scans "Vehicle Disk" then "Licence Disk"
 * (driver's licence). Uber / Uber Eats scan the disc + an identity choice. */
export const SCAN_PAIR_CATEGORIES = ['check_in', 'contractor', 'delivery', 'event_visitor', 'guest', 'service_provider', 'staff', 'visitor'];

type Answers = Record<string, any>;

export interface ValidationResult {
  ok: boolean;
  pending: boolean;
  code?: string;
  error?: string;
}

const PENDING = (code: string, error: string): ValidationResult => ({ ok: false, pending: true, code, error });
const OK: ValidationResult = { ok: true, pending: false };

const isNonEmptyString = (v: any) => typeof v === 'string' && v.trim().length > 0;
const isBoolean = (v: any) => typeof v === 'boolean';
const isNonEmptyArray = (v: any) => Array.isArray(v) && v.length >= 1 && v.every((x) => isNonEmptyString(x));

/** Duplicate-presence identity: normalised full name + E.164 mobile. A name
 * alone is NEVER an identity. */
export function hospitalityIdentityKey(name: any, e164Phone: any): string | null {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const p = String(e164Phone || '').trim();
  return n && p ? `${n}|${p}` : null;
}

function checkFirearmDeclaration(a: Answers): ValidationResult | null {
  if (!isBoolean(a.firearm_declared)) {
    return PENDING('firearm_declaration_required', 'Ask whether the person has any firearms to declare (Yes or No) before access can be granted.');
  }
  if (a.firearm_declared && !isNonEmptyString(a.firearm_photo_uri)) {
    return PENDING('firearm_photo_required', 'A scan/photo of the firearm licence card is required when a firearm is declared.');
  }
  return null;
}

function checkOccupantCount(a: Answers): ValidationResult | null {
  // AGREED IMPLEMENTATION ASSUMPTION: positive integer (blank/0 rejected).
  const n = Number(a.occupant_count);
  if (a.occupant_count === null || a.occupant_count === undefined || !Number.isInteger(n) || n < 1) {
    return PENDING('occupant_count_required', 'Enter how many people are in the vehicle (at least 1) before access can be granted.');
  }
  return null;
}

function checkReceptionConfirmed(a: Answers, prompt: string): ValidationResult | null {
  return a.reception_confirmed === true ? null : PENDING('reception_confirmation_required', prompt);
}

const CAPTURE_ERRORS: Record<string, string> = {
  scan_payload_missing: 'the scan data was not received — scan again',
  scan_payload_mismatch: 'the decoded number does not match the scan — scan again',
  manual_photo_missing: 'a photograph of the document is required for a manual capture',
  manual_identifier_missing: 'type the number shown on the document',
  invalid_method: 'scan the document (or use the photo + manual route)',
};

/** "Scan Vehicle Disk" — decoded scan (payload-consistent) or photo + manual. */
function checkVehicleDisc(a: Answers): ValidationResult | null {
  if (a.vehicle_disc_error) return PENDING('vehicle_disc_invalid', `Vehicle licence disc: ${CAPTURE_ERRORS[a.vehicle_disc_error] || 'capture again'}.`);
  if (!a.vehicle_disc) return PENDING('vehicle_disc_scan_required', 'Scan the vehicle licence disc (use the photo + manual route only if it cannot be scanned).');
  return null;
}

/** "Licence Disk" — interpreted as the driver's licence card. */
function checkDriverLicence(a: Answers): ValidationResult | null {
  if (a.driver_licence_error) return PENDING('driver_licence_invalid', `Driver's licence: ${CAPTURE_ERRORS[a.driver_licence_error] || 'capture again'}.`);
  if (!a.driver_licence) return PENDING('driver_licence_scan_required', "Scan the driver's licence (use the photo + manual route only if it cannot be scanned).");
  return null;
}

const checkScans = (a: Answers) => checkVehicleDisc(a) || checkDriverLicence(a);

/**
 * Uber / Uber Eats identity document. ASSUMPTION (pending customer
 * confirmation): the PDF lists SA driver's licence, passport and foreign
 * driver's licence — implemented as ALTERNATIVES (one required). The SA
 * licence is scanned like every other licence; passports / foreign licences
 * cannot be decoded by the installed scanner and require a photograph.
 */
function checkIdentityDocument(a: Answers): ValidationResult | null {
  if (!['sa_drivers_licence_disc', 'passport', 'foreign_drivers_licence'].includes(a.identity_document_type)) {
    return PENDING('identity_document_type_required', "Select the driver's identity document (SA driver's licence, passport or foreign driver's licence).");
  }
  if (a.identity_document_type === 'sa_drivers_licence_disc') return checkDriverLicence(a);
  if (!isNonEmptyString(a.identity_document_photo_uri)) {
    return PENDING('identity_document_photo_required', "A photograph of the passport / foreign driver's licence is required — the installed scanner cannot decode these documents.");
  }
  return null;
}

/**
 * Validate one category submission. ok:true ONLY when every documented
 * requirement is present and valid; otherwise pending (never grants access).
 */
export function validateHospitalitySubmission(category: string, a: Answers): ValidationResult {
  const rec = (msg: string) => () => checkReceptionConfirmed(a, msg);
  const scans = () => checkScans(a);
  const occupants = () => checkOccupantCount(a);
  const firearm = () => checkFirearmDeclaration(a);
  const vehiclePhoto = () => isNonEmptyArray(a.vehicle_photo_uris) ? null : PENDING('vehicle_photo_required', 'A photograph of the vehicle is required.');
  const first = (...checks: Array<() => ValidationResult | null>) => {
    for (const c of checks) { const r = c(); if (r) return r; }
    return OK;
  };

  switch (category) {
    case 'check_in':
      return first(
        () => isNonEmptyString(a.guest_name) ? null : PENDING('guest_name_required', 'Check with Reception for the guest name and surname before proceeding.'),
        rec('Confirm the guest name & surname with Reception (Yes) before access can be granted.'),
        scans, occupants, firearm);
    case 'contractor':
      return first(rec('Call the relevant department to confirm the Contractor (Yes) before access can be granted.'), scans, occupants, vehiclePhoto);
    case 'delivery':
      return first(
        rec('Call the relevant department to confirm the delivery (Yes) before access can be granted.'),
        scans,
        () => isBoolean(a.po_invoice_available) ? null : PENDING('po_invoice_confirmation_required', 'Confirm whether a PO / Invoice is available (Yes/No).'),
        () => (a.po_invoice_available && !isNonEmptyString(a.po_invoice_photo_uri)) ? PENDING('po_invoice_photo_required', 'A photograph of the PO / Invoice is required.') : null,
        occupants, vehiclePhoto);
    case 'event_visitor':
      return first(scans, occupants, firearm);
    case 'guest':
      return first(
        scans,
        () => isNonEmptyString(a.room_number) ? null : PENDING('room_number_required', "Ask the guest's room number before access can be granted."),
        occupants, firearm);
    case 'service_provider':
      return first(rec('Call the relevant department to confirm the Supplier (Yes) before access can be granted.'), scans, occupants, vehiclePhoto);
    case 'staff':
      return first(
        scans, occupants,
        () => isBoolean(a.staff_declared) ? null : PENDING('staff_declaration_required', 'Ask whether the staff member has anything to declare (Yes/No).'),
        () => (a.staff_declared && !isNonEmptyArray(a.staff_declaration_photo_uris)) ? PENDING('staff_declaration_photo_required', 'At least one photograph is required for the declaration (multiple photos are allowed).') : null);
    case 'uber_eats_mrd':
      return first(
        rec('Call reception to confirm the delivery for the guest name / room number (Yes) before access can be granted.'),
        () => checkVehicleDisc(a), () => checkIdentityDocument(a),
        () => (a.pedestrian_only !== true || Number(a.occupant_count) !== 1) ? PENDING('pedestrian_only_required', 'Only one person may enter — the bike/car must remain outside; the delivery person enters on foot.') : null,
        () => isNonEmptyString(a.food_photo_uri) ? null : PENDING('food_photo_required', 'A photograph of the food is required.'),
        () => isNonEmptyString(a.delivery_person_photo_uri) ? null : PENDING('delivery_person_photo_required', 'A photograph of the delivery person is required.'));
    case 'uber':
      return first(
        rec('Call reception to confirm the pick up for the guest name / room number (Yes) before access can be granted.'),
        () => checkVehicleDisc(a), () => checkIdentityDocument(a), occupants, firearm);
    case 'visitor':
      return first(
        scans, occupants,
        () => isNonEmptyString(a.room_number) ? null : PENDING('room_number_required', 'Confirm who the visitor is visiting and get the room number (call reception if the visitor does not know it) before access can be granted.'),
        // 'provided' = visitor knew it (reception not applicable, stored null);
        // 'confirmed_by_reception' = reception called — must be Yes.
        () => ['provided', 'confirmed_by_reception'].includes(a.room_number_source) ? null : PENDING('room_number_source_required', 'Did the visitor know the room number, or did you call reception to obtain/confirm it?'),
        () => (a.room_number_source === 'confirmed_by_reception' && a.reception_confirmed !== true) ? PENDING('reception_confirmation_required', 'Reception must confirm the visit and room number (Yes) before access can be granted.') : null,
        firearm);
    default:
      return { ok: false, pending: false, code: 'invalid_category', error: 'Unknown hospitality category.' };
  }
}