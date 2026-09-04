/**
 * White-label branding helpers — safe resolution, hex validation and colour
 * mixing. Shared by the Layout (app-wide application), the Branding editor's
 * live preview, and any branded surface that needs a tint of the brand colour.
 *
 * These helpers NEVER override semantic safety/status colours. Callers apply
 * brand colours only to branded surfaces (active nav, headers, primary
 * actions). Emergency/error/warning/success colours remain untouched.
 */

export const DEFAULT_BRAND_PRIMARY = "#0ea5e9"; // sky-500 (USS platform default)
export const DEFAULT_BRAND_ACCENT = "#2563eb"; // blue-600

/** Platform fallback application name — the FINAL step of the white-label
 * hierarchy (Customer branding → Reseller branding → Platform fallback).
 * Used only when neither the customer nor the reseller has configured an
 * app_name. Never a vertical product label: "SecureGuard" / "EstateHub" are
 * NOT platform fallbacks — they are module-specific names. */
export const PLATFORM_APP_NAME = "USS Platform";

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function isValidHex(h) {
  if (!h || typeof h !== "string") return false;
  return HEX_RE.test(h.trim());
}

/** Returns a clean hex string or "" if invalid/empty. Used by the editor before save. */
export function sanitizeHex(h) {
  if (!h) return "";
  const v = h.trim();
  return isValidHex(v) ? v : "";
}

/** rgba() for a hex colour; falls back to the default primary if invalid. */
export function hexToRgba(hex, alpha) {
  if (!isValidHex(hex)) {
    return `rgba(14, 165, 233, ${alpha})`;
  }
  let h = hex.replace("#", "").trim();
  if (h.length === 3) {
    h = h.split("").map((c) => c + c).join("");
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Normalises a branding object (from useBranding / the Reseller editor) into a
 * safe theme with guaranteed fallbacks. Never throws, never returns invalid
 * CSS — missing/invalid values fall back to the USS platform defaults so the
 * app never renders broken colours, "undefined" or empty styles.
 */
export function resolveBrand(branding) {
  const b = branding || {};
  return {
    primary: isValidHex(b.primary_color) ? b.primary_color : DEFAULT_BRAND_PRIMARY,
    accent: isValidHex(b.accent_color) ? b.accent_color : DEFAULT_BRAND_ACCENT,
    logoUrl: b.logo_url || null,
    appName: b.app_name || null,
    supportName: b.support_name || null,
    supportEmail: b.support_email || null,
    supportPhone: b.support_phone || null,
    website: b.website || null,
  };
}