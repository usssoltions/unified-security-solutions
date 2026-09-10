/**
 * Compulsory visitor mobile number — shared client-side validation.
 *
 * Twin of the server-side validation in the finalizeAccessEntry gateway
 * (base44/ code can never be imported into frontend files on this platform).
 * The SERVER is authoritative: the gateway re-validates and normalises to
 * E.164 before any entry record is created. This module only gives the guard
 * live feedback while typing — it never alters what they typed.
 *
 * Default country: South Africa (+27). Accepts:
 *   0821234567          → +27821234567
 *   27821234567         → +27821234567
 *   +27821234567        → +27821234567
 *   +<any 8–15 digits>  → international visitor numbers
 * Rejects: empty, letters, too short/too long, obvious junk.
 */
export function validateMobileNumber(raw) {
  const digits = String(raw || "").replace(/[\s()\-.]/g, "");
  if (!digits) {
    return { ok: false, message: "Visitor mobile number is required before entry can be completed." };
  }
  if (/[a-zA-Z]/.test(digits)) {
    return { ok: false, message: "Mobile number cannot contain letters." };
  }
  let e164 = null;
  if (/^0\d{9}$/.test(digits)) e164 = "+27" + digits.slice(1);
  else if (/^\+27\d{9}$/.test(digits)) e164 = digits;
  else if (/^27\d{9}$/.test(digits)) e164 = "+" + digits;
  else if (/^\+\d{8,15}$/.test(digits)) e164 = digits;
  if (!e164) {
    return { ok: false, message: "Enter a valid mobile number, e.g. 0821234567 or +27821234567." };
  }
  return { ok: true, value: e164 };
}