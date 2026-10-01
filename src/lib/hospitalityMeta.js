// GRID GATE Hospitality — shared display metadata for management views/exports.
export const HOSP_CATEGORY_LABELS = {
  check_in: "Check Ins", contractor: "Contractors", delivery: "Deliveries",
  event_visitor: "Event or Function Visitor", guest: "Guests",
  service_provider: "Service Provider", staff: "Staff",
  uber_eats_mrd: "Uber Eats / Mr D", uber: "Uber", visitor: "Visitors",
};

export const PARTY_LABELS = { reception: "Reception", relevant_department: "Relevant department" };

// Presence is DERIVED from the linked entry record — separate from the
// admission decision ("confirmed").
export function presenceOf(v) {
  if (v.status === "pending" || v.status === "confirming") return "pending";
  if (v.status === "cancelled") return "cancelled";
  const s = v.entry?.status;
  if (s === "inside") return "on_site";
  if (s === "exited") return "exited";
  if (s === "blacklisted" || s === "denied") return "denied";
  if (s === "voided") return "void";
  return "unknown";
}

export const PRESENCE_LABELS = {
  pending: "Pending", cancelled: "Cancelled", on_site: "On site", exited: "Exited",
  denied: "Denied (blacklist)", void: "Void", unknown: "No entry record",
};

export const PRESENCE_STYLES = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  cancelled: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  on_site: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  exited: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  denied: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  void: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  unknown: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

export const ADMISSION_LABELS = { pending: "Pending", confirming: "Confirming", confirmed: "Confirmed", cancelled: "Cancelled" };

// Platform built-in stamps (created_date / updated_date) are stored as UTC
// WITHOUT a timezone designator ("2026-10-01T17:59:43.284"), while most other
// timestamps carry "Z". A timezone-less ISO string parses as DEVICE-LOCAL
// time, which rendered "Created" exactly 2 h off on SAST devices. Normalise
// here — stored records are never altered.
export function parseTs(iso) {
  if (!iso) return null;
  if (iso instanceof Date) return iso;
  if (typeof iso !== "string") return null;
  const s = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) return new Date(`${s}Z`);
  return new Date(s);
}

export const fmtDT = (iso) => {
  const d = parseTs(iso);
  return d && !isNaN(d) ? d.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "—";
};
export const yesNo = (b) => (b === true ? "Yes" : b === false ? "No" : "N/A");
export const maskPhone = (p) => (p ? String(p).replace(/.(?=.{4})/g, "•") : "—");

export function confirmationText(v) {
  if (!v.confirmation_party && v.category !== "visitor") return "Not required";
  if (v.category === "visitor") {
    if (v.room_number_source === "provided") return "Not required — visitor knew room";
    if (v.room_number_source === "confirmed_by_reception") return `Reception: ${yesNo(v.reception_confirmed)}`;
    return "—";
  }
  return `${PARTY_LABELS[v.confirmation_party] || "—"}: ${yesNo(v.reception_confirmed)}`;
}

export function evidenceCount(v) {
  return (v.vehicle_photo_count || 0) + (v.staff_declaration_photo_count || 0) +
    ["firearm_photo_present", "po_invoice_photo_present", "food_photo_present", "delivery_person_photo_present", "identity_document_photo_present"]
      .filter((k) => v[k]).length;
}

export function computeTotals(visits) {
  const t = { total: visits.length, byPresence: {}, byCategory: {} };
  for (const v of visits) {
    const p = presenceOf(v);
    t.byPresence[p] = (t.byPresence[p] || 0) + 1;
    t.byCategory[v.category] = (t.byCategory[v.category] || 0) + 1;
  }
  return t;
}