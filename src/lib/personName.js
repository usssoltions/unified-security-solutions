/**
 * Presentation-only visitor display-name helpers for Access Control.
 * NEVER used for matching, duplicate detection or any stored/scan value —
 * these only control how a name is SHOWN (and what display name is composed
 * for a new entry record after a successful scan).
 */

/**
 * Collapses CONSECUTIVE duplicated words in a name (case-insensitive) so a
 * surname that is already part of a stored name is never displayed twice.
 * "OELOFSE OELOFSE" → "OELOFSE"; "IZAK DANIEL OELOFSE OELOFSE" → "IZAK DANIEL OELOFSE".
 * Legitimate names never repeat a word consecutively, so this is display-safe.
 */
export function dedupePersonName(name) {
  if (!name) return "Unknown";
  const words = String(name).split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    const last = out[out.length - 1];
    if (last && last.toLowerCase() === w.toLowerCase()) continue;
    out.push(w);
  }
  return out.join(" ").trim() || "Unknown";
}

/**
 * Composes the best display name from a visitor-ish object
 * ({ visitor_name, first_names, initials, surname }).
 *
 * - Full first names supplied by the document (SA ID card, etc.) are preserved:
 *   "IZAK DANIEL" + "OELOFSE" → "IZAK DANIEL OELOFSE".
 * - SA driver's licences provide surname + initials (no forenames):
 *   initials "ID" + surname "OELOFSE" → "ID OELOFSE". No first names are invented.
 * - Without parsed forename components, the stored visitor_name is used as-is.
 * - The surname can never be appended twice.
 */
export function formatVisitorName(visitor) {
  if (!visitor) return "Unknown";
  const surname = (visitor.surname || "").trim();
  const firstNames = (visitor.first_names || "").trim();
  const initials = (visitor.initials || "").trim();
  let name;
  if (firstNames) {
    name = surname && firstNames.toLowerCase() !== surname.toLowerCase()
      ? `${firstNames} ${surname}`
      : firstNames;
  } else if (initials && surname) {
    name = `${initials} ${surname}`;
  } else {
    // No parsed forename components — the stored name already contains the
    // surname (SADL scans store the surname alone), so never append it again.
    name = (visitor.visitor_name || "").trim() || surname;
  }
  return dedupePersonName(name || "Unknown");
}