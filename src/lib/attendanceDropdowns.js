/**
 * Attendance Register — Dropdown seed + helper utilities.
 *
 * Call seedDefaultOptions(customerId) once on first use per tenant.
 * It is idempotent — existing options are never duplicated.
 */
import { base44 } from "@/api/base44Client";

export const DEFAULT_MEDICAL_CENTRES = [
  "Alec", "First Choice", "Pro-Health", "Exxaro", "Enaex",
  "Sasolburg", "Wohsa", "Seriti New Denmark", "Seriti Kriel",
];

export const DEFAULT_ASSESSMENT_TYPES = [
  "Test", "Retest (3d)", "Retest (2w)", "Retest (4w)",
  "Retest (6w)", "FCE", "Interview (Roaming)", "Interview (Not Roaming)",
];

export async function seedDefaultOptions(customerId) {
  if (!customerId) return;
  try {
    const existing = await base44.entities.AttendanceDropdownOption.filter({ customer_id: customerId });
    const hasMedical = existing.some(o => o.option_type === "medical_centre");
    const hasAssessment = existing.some(o => o.option_type === "assessment_type");

    const toCreate = [];
    if (!hasMedical) {
      DEFAULT_MEDICAL_CENTRES.forEach((label, i) =>
        toCreate.push({ customer_id: customerId, option_type: "medical_centre", label, sort_order: i, active: true })
      );
    }
    if (!hasAssessment) {
      DEFAULT_ASSESSMENT_TYPES.forEach((label, i) =>
        toCreate.push({ customer_id: customerId, option_type: "assessment_type", label, sort_order: i, active: true })
      );
    }
    if (toCreate.length > 0) {
      await base44.entities.AttendanceDropdownOption.bulkCreate(toCreate);
    }
  } catch (e) {
    console.error("seedDefaultOptions failed:", e);
  }
}

/** Returns { medicalCentres: string[], assessmentTypes: string[] } from the DB */
export async function loadDropdownOptions(customerId) {
  if (!customerId) return { medicalCentres: DEFAULT_MEDICAL_CENTRES, assessmentTypes: DEFAULT_ASSESSMENT_TYPES };
  try {
    const all = await base44.entities.AttendanceDropdownOption.filter({ customer_id: customerId, active: true });
    const sort = (arr) => arr.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
    const mc = sort(all.filter(o => o.option_type === "medical_centre")).map(o => o.label);
    const at = sort(all.filter(o => o.option_type === "assessment_type")).map(o => o.label);
    return {
      medicalCentres: mc.length ? mc : DEFAULT_MEDICAL_CENTRES,
      assessmentTypes: at.length ? at : DEFAULT_ASSESSMENT_TYPES,
    };
  } catch {
    return { medicalCentres: DEFAULT_MEDICAL_CENTRES, assessmentTypes: DEFAULT_ASSESSMENT_TYPES };
  }
}

export function idTypeLabel(type) {
  const map = { sa_id: "SA ID", drivers_licence: "Driver's Licence", passport: "Passport", other: "Other" };
  return map[type] || type || "—";
}

export function formatDisplayName(worker) {
  if (!worker) return "—";
  const parts = [worker.surname, worker.initials].filter(Boolean);
  return parts.join(", ") || worker.first_names || "—";
}

export function localDateStr(d = new Date()) {
  return d.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" });
}

export function localTimeStr(d = new Date()) {
  return d.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" });
}

export function todayISO() {
  const d = new Date();
  const tz = new Date(d.toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
  return `${tz.getFullYear()}-${String(tz.getMonth() + 1).padStart(2, "0")}-${String(tz.getDate()).padStart(2, "0")}`;
}

export function dateRangeISO(preset) {
  const tzDate = () => new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Johannesburg" }));
  const d = tzDate();
  const pad = n => String(n).padStart(2, "0");
  const fmt = dt => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  const today = fmt(d);

  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const y = new Date(d); y.setDate(y.getDate() - 1);
    const s = fmt(y); return { from: s, to: s };
  }
  if (preset === "this_week") {
    const day = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
    return { from: fmt(mon), to: today };
  }
  if (preset === "last_week") {
    const day = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7) - 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: fmt(mon), to: fmt(sun) };
  }
  if (preset === "this_month") {
    return { from: fmt(new Date(d.getFullYear(), d.getMonth(), 1)), to: today };
  }
  if (preset === "last_month") {
    const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(d.getFullYear(), d.getMonth(), 0);
    return { from: fmt(first), to: fmt(last) };
  }
  return { from: today, to: today };
}