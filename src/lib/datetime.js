/**
 * Central timezone-aware date/time formatting for customer-facing surfaces.
 *
 * PRODUCTION POLICY: timestamps are STORED as UTC (ISO-8601, with or without
 * an explicit "Z"). All user-facing rendering must go through these helpers
 * so times display in the deployment timezone — Africa/Johannesburg
 * (UTC+2, no DST) — via the timezone-aware Intl formatter, never naïve
 * "+2 hour" string arithmetic, and independent of the viewing device's own
 * timezone setting (the cause of the two-hour-off "11:05" invitation times).
 */
export const APP_TIMEZONE = "Africa/Johannesburg";

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a stored timestamp into a Date. Naive timestamps (no "Z" / offset)
 * are interpreted as UTC — every server-side writer in this app stores UTC —
 * so a value like "2026-09-07T11:05:04" is no longer misread as local time.
 */
export function parseTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  let s = String(value).trim();
  if (DATE_ONLY.test(s)) {
    s += "T00:00:00Z"; // date-only values are timezone-neutral; SAST date is identical
  } else if (!HAS_ZONE.test(s)) {
    s += "Z";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const DATE_TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIMEZONE,
  day: "2-digit", month: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIMEZONE,
  day: "2-digit", month: "2-digit", year: "numeric",
});

/** SAST date + time, e.g. "07/09/2026, 13:05:04" — "—" when there is no value. */
export function formatDateTime(value) {
  const d = parseTimestamp(value);
  return d ? DATE_TIME_FMT.format(d) : "—";
}

/** SAST date only, e.g. "07/09/2026" — "—" when there is no value. */
export function formatDate(value) {
  const d = parseTimestamp(value);
  return d ? DATE_FMT.format(d) : "—";
}