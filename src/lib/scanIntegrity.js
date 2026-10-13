/**
 * USS Guard — Scan integrity helpers (Attendance Register + shared).
 *
 * barKoder PDF417 decodes are occasionally PARTIAL: the SDK's own formatted
 * output then contains mid-string ellipsis-masked fragments ("…BEL…",
 * "…5522…") instead of complete values. This is a decode-quality
 * characteristic of the scanner engine — the app-side rule is:
 *   1. Identity fields are populated ONLY from complete decoded values.
 *   2. Fragmented / masked / placeholder-like values are blanked, never
 *      placed into the form, and never allowed to overwrite verified
 *      details already on file.
 *   3. The operator is told exactly which fields need completion and can
 *      rescan or complete manually from the document. Nothing is invented.
 */

export const FRAGMENT_RE = /(\.{2,}|\u2026)/;

/**
 * TRUE only for ACTUAL placeholder debris:
 *  - ellipsis-masked fragments ("…BEL…", "name..."),
 *  - punctuation/symbol-only values (".", "---", "_ _", " . "),
 *  - x/0 filler runs of three or more characters ("xxx", "x-x-x", "0000000000").
 *
 * Legitimate single-character initials such as "X" (Xolile) or "O" — and any
 * real name or value containing an x or 0 among other characters — are NEVER
 * placeholders. Mirrored EXACTLY in base44/functions/attendanceAccess/entry.ts
 * (the backend cannot import src/ modules) — keep the two copies identical.
 */
export function looksLikePlaceholder(v) {
  const t = String(v ?? "").trim();
  if (!t) return false;
  if (FRAGMENT_RE.test(t)) return true; // ellipsis-masked fragment
  const core = t.replace(/[.\-_*\s]/g, "");
  if (!core) return true; // punctuation/symbol-only debris
  if (/^x{3,}$/i.test(core)) return true; // "xxx" filler
  if (/^0{3,}$/.test(core)) return true; // "0000000000" filler
  return false;
}

/** True when a decoded value is complete enough to place in an identity field. */
export function isReliableIdentityValue(v) {
  const t = String(v ?? "").trim();
  if (!t) return false;
  if (FRAGMENT_RE.test(t)) return false;
  if (looksLikePlaceholder(t)) return false;
  return true;
}

/** SA ID numbers are exactly 13 digits — a shorter/longer decode is partial. */
export function isReliableSaIdNumber(v) {
  return /^\d{13}$/.test(String(v ?? "").trim());
}

/**
 * Assesses the CANDIDATE identity values of one scanned document BEFORE any
 * form population. Pass the values exactly as they would have been used.
 *
 * Returns:
 *  - fragmented: { surname, first_names, id_number, initials } — true when a
 *    value was PRESENT but unreliable (fragment / mask / placeholder, or an
 *    SA ID number that is not 13 digits), meaning the caller must leave the
 *    form field blank and flag it.
 *  - issues: human-readable labels for the flagged fields.
 *
 * Absent values are NOT flagged here — normal required-field validation
 * already handles them.
 */
export function assessScannedIdentity(candidates, resolvedProfileId) {
  const fragmented = {};
  const issues = [];
  const check = (key, label, value, extraCheck) => {
    const t = String(value ?? "").trim();
    if (!t) return;
    const ok = isReliableIdentityValue(t) && (!extraCheck || extraCheck(t));
    if (!ok) {
      fragmented[key] = true;
      issues.push(label);
    }
  };
  check("surname", "Surname", candidates?.surname);
  check("first_names", "First names", candidates?.first_names);
  check(
    "id_number",
    "ID / document number",
    candidates?.id_number,
    resolvedProfileId === "sa_id" ? isReliableSaIdNumber : null
  );
  check("initials", "Initials", candidates?.initials);
  return { fragmented, issues };
}