/**
 * Attendance Register — Dropdown helpers.
 *
 * Options are stored per customer in the AttendanceDropdownOption entity and
 * are ONLY reachable through the attendanceAccess backend gateway (server-side
 * tenant resolution + module licence enforcement). The fixed official options
 * are seeded idempotently server-side and must never be altered.
 */
import { attendanceCall } from "@/lib/attendanceApi";

export const DEFAULT_MEDICAL_CENTRES = [
  "Alec", "First Choice", "Pro-Health", "Exxaro", "Enaex",
  "Sasolburg", "Wohsa", "Seriti New Denmark", "Seriti Kriel",
];

export const DEFAULT_ASSESSMENT_TYPES = [
  "Test", "Retest (3d)", "Retest (2w)", "Retest (4w)",
  "Retest (6w)", "FCE", "Interview (Roaming)", "Interview (Not Roaming)",
];

/** Returns { medicalCentres: string[], assessmentTypes: string[] }.
 *  Seeding + tenant scoping happen server-side (idempotent). */
export async function loadDropdownOptions() {
  try {
    const res = await attendanceCall("list_options");
    const mc = res?.medicalCentres || [];
    const at = res?.assessmentTypes || [];
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