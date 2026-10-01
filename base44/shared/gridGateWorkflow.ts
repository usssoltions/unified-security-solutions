/**
 * gridGateWorkflow — shared, server-side definition and validation of the
 * GRID GATE Hospitality custom access-control workflow (Hyatt House Sandton
 * — Demo under Grid Protection). Source: "Workflow for Access Control.pdf".
 *
 * SECURITY-CRITICAL: this is the SINGLE authoritative place that decides
 * whether a hospitality category submission has met every documented
 * confirmation/evidence requirement. It is invoked SERVER-SIDE from
 * finalizeAccessEntry's hospitality_submit action — never trust a client
 * "confirmed"/"allRequirementsMet" flag; every underlying field is
 * re-checked here. An unanswered or negative required confirmation always
 * returns pending (never ok) — access is never granted on missing/false
 * input, per the PDF's "No" branches which are left undefined upstream.
 */

export const HOSPITALITY_WORKFLOW_ID = 'grid_gate_hospitality';

export const HOSPITALITY_CATEGORIES = [
  'check_in',
  'contractor',
  'delivery',
  'event_visitor',
  'guest',
  'service_provider',
  'staff',
  'uber_eats_mrd',
  'uber',
  'visitor',
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

// Maps a hospitality category to the AccessLog.person_type enum (resident,
// visitor, guard, vendor, contractor, unknown). AccessLog's schema is
// deliberately left UNCHANGED (shared by every customer) — the category
// itself and every custom answer/evidence item live only on HospitalityVisit.
// LIMITATION: AccessLog has no "staff"/"hotel guest" person type; 'staff' is
// mapped to 'unknown' (closest safe default — never 'resident', which means
// an estate resident in this app). This is a documented limitation, not a
// silent reinterpretation.
export const CATEGORY_PERSON_TYPE: Record<string, string> = {
  check_in: 'visitor',
  contractor: 'contractor',
  delivery: 'vendor',
  event_visitor: 'visitor',
  guest: 'visitor',
  service_provider: 'vendor',
  staff: 'unknown',
  uber_eats_mrd: 'vendor',
  uber: 'vendor',
  visitor: 'visitor',
};

type Answers = Record<string, any>;

export interface ValidationResult {
  ok: boolean;
  pending: boolean;
  code?: string;
  error?: string;
}

const PENDING = (code: string, error: string): ValidationResult => ({ ok: false, pending: true, code, error });
const OK: ValidationResult = { ok: true, pending: false };

function isNonEmptyString(v: any): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
function isBoolean(v: any): boolean {
  return typeof v === 'boolean';
}
function isNonNegInt(v: any): boolean {
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}
function isNonEmptyArray(v: any): boolean {
  return Array.isArray(v) && v.length >= 1 && v.every((x) => isNonEmptyString(x));
}

/** Firearm declaration — shared by Check Ins, Event/Function Visitor, Guests, Uber, Visitors. */
function checkFirearmDeclaration(a: Answers): ValidationResult | null {
  if (!isBoolean(a.firearm_declared)) {
    return PENDING('firearm_declaration_required', 'Ask whether the person has any firearms to declare (Yes or No) before access can be granted.');
  }
  if (a.firearm_declared && !isNonEmptyString(a.firearm_photo_uri)) {
    return PENDING('firearm_photo_required', 'A photograph of the firearm licence card is required when a firearm is declared.');
  }
  return null;
}

function checkOccupantCount(a: Answers): ValidationResult | null {
  if (!isNonNegInt(a.occupant_count)) {
    return PENDING('occupant_count_required', 'Enter how many people are in the vehicle before access can be granted.');
  }
  return null;
}

function checkReceptionConfirmed(a: Answers, prompt: string): ValidationResult | null {
  if (a.reception_confirmed !== true) {
    return PENDING('reception_confirmation_required', prompt);
  }
  return null;
}

/**
 * Validate one category submission. Returns ok:true ONLY when every
 * documented required confirmation and piece of evidence for that category
 * is present and valid — in every other case returns pending (never grants
 * access), with a code/error identifying exactly what is missing so the UI
 * can keep the visit open for completion or offer cancellation.
 */
export function validateHospitalitySubmission(category: string, a: Answers): ValidationResult {
  if (!HOSPITALITY_CATEGORIES.includes(category as any)) {
    return { ok: false, pending: false, code: 'invalid_category', error: 'Unknown hospitality category.' };
  }

  switch (category) {
    case 'check_in': {
      if (!isNonEmptyString(a.guest_name)) {
        return PENDING('guest_name_required', 'Check with Reception for the guest name and surname before proceeding.');
      }
      const recErr = checkReceptionConfirmed(a, 'Confirm the guest name & surname with Reception (Yes/No) before access can be granted.');
      if (recErr) return recErr;
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      const fireErr = checkFirearmDeclaration(a);
      if (fireErr) return fireErr;
      return OK;
    }
    case 'contractor': {
      const recErr = checkReceptionConfirmed(a, 'Call the relevant department to confirm the Contractor (Yes/No) before access can be granted.');
      if (recErr) return recErr;
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      if (!isNonEmptyArray(a.vehicle_photo_uris)) {
        return PENDING('vehicle_photo_required', 'A photograph of the vehicle is required.');
      }
      return OK;
    }
    case 'delivery': {
      const recErr = checkReceptionConfirmed(a, 'Call the relevant department to confirm the delivery (Yes/No) before access can be granted.');
      if (recErr) return recErr;
      if (!isBoolean(a.po_invoice_available)) {
        return PENDING('po_invoice_confirmation_required', 'Confirm whether a PO / Invoice is available (Yes/No).');
      }
      if (a.po_invoice_available && !isNonEmptyString(a.po_invoice_photo_uri)) {
        return PENDING('po_invoice_photo_required', 'A photograph of the PO / Invoice is required.');
      }
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      if (!isNonEmptyArray(a.vehicle_photo_uris)) {
        return PENDING('vehicle_photo_required', 'A photograph of the vehicle is required.');
      }
      return OK;
    }
    case 'event_visitor': {
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      const fireErr = checkFirearmDeclaration(a);
      if (fireErr) return fireErr;
      return OK;
    }
    case 'guest': {
      if (!isNonEmptyString(a.room_number)) {
        return PENDING('room_number_required', "Ask the guest's room number before access can be granted.");
      }
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      const fireErr = checkFirearmDeclaration(a);
      if (fireErr) return fireErr;
      return OK;
    }
    case 'service_provider': {
      const recErr = checkReceptionConfirmed(a, 'Call the relevant department to confirm the Supplier (Yes/No) before access can be granted.');
      if (recErr) return recErr;
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      if (!isNonEmptyArray(a.vehicle_photo_uris)) {
        return PENDING('vehicle_photo_required', 'A photograph of the vehicle is required.');
      }
      return OK;
    }
    case 'staff': {
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      if (!isBoolean(a.staff_declared)) {
        return PENDING('staff_declaration_required', 'Ask whether the staff member has anything to declare (Yes/No).');
      }
      if (a.staff_declared && !isNonEmptyArray(a.staff_declaration_photo_uris)) {
        return PENDING('staff_declaration_photo_required', 'At least one photograph is required for the declaration (multiple photos are allowed).');
      }
      return OK;
    }
    case 'uber_eats_mrd': {
      const recErr = checkReceptionConfirmed(a, 'Call reception to confirm the delivery for the guest name / room number (Yes/No) before access can be granted.');
      if (recErr) return recErr;
      if (a.pedestrian_only !== true || Number(a.occupant_count) !== 1) {
        return PENDING('pedestrian_only_required', 'Only one pedestrian entrant is allowed — the bike/car must remain outside; the delivery person enters on foot.');
      }
      if (!isNonEmptyString(a.food_photo_uri)) {
        return PENDING('food_photo_required', 'A photograph of the food is required.');
      }
      if (!isNonEmptyString(a.delivery_person_photo_uri)) {
        return PENDING('delivery_person_photo_required', 'A photograph of the delivery person is required.');
      }
      return OK;
    }
    case 'uber': {
      const recErr = checkReceptionConfirmed(a, 'Call reception to confirm the pick up for the guest name / room number (Yes/No) before access can be granted.');
      if (recErr) return recErr;
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      const fireErr = checkFirearmDeclaration(a);
      if (fireErr) return fireErr;
      return OK;
    }
    case 'visitor': {
      if (!isNonEmptyString(a.room_number)) {
        return PENDING('room_number_required', 'Confirm who the visitor is visiting and get the room number (call reception if the visitor does not know it) before access can be granted.');
      }
      const occErr = checkOccupantCount(a);
      if (occErr) return occErr;
      const fireErr = checkFirearmDeclaration(a);
      if (fireErr) return fireErr;
      return OK;
    }
    default:
      return { ok: false, pending: false, code: 'invalid_category', error: 'Unknown hospitality category.' };
  }
}