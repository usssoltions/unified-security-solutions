import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

/**
 * Fetches the Linkus external-calling configuration (server-side SystemConfiguration).
 * Returns { mode, linkus_package, linkus_uri_scheme, uri_scheme_verified, fallback_to_dialler, external_prefix }
 * mode: "disabled" | "linkus_mobile" | "system_dialler"
 *
 * uri_scheme_verified: false by default — the `linkusmobile://dial?number=` scheme
 * is NOT confirmed in official Yeastar documentation. The official integration
 * path is the Linkus SDK. System dialler (tel:) is the verified safe fallback.
 */
export function useLinkusConfig() {
  return useQuery({
    queryKey: ["linkusConfig"],
    queryFn: async () => {
      try {
        const res = await base44.functions.invoke("getLinkusConfig");
        return res?.data?.config || res?.config || { mode: "disabled" };
      } catch (_) {
        return { mode: "disabled" };
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/**
 * Builds the correct external-call URI for the given mode and phone number.
 * Returns null if the number is empty or mode is disabled.
 */
export function buildExternalCallUri(config, rawPhone) {
  if (!config || !rawPhone) return null;
  const phone = String(rawPhone).replace(/\s+/g, "");
  if (!phone) return null;
  if (config.mode === "disabled") return null;

  const prefix = config.external_prefix || "0";
  const number = phone.startsWith("0") ? phone : prefix + phone;

  if (config.mode === "linkus_mobile") {
    return `${config.linkus_uri_scheme || "linkusmobile://dial?number="}${encodeURIComponent(number)}`;
  }
  if (config.mode === "system_dialler") {
    return `tel:${number}`;
  }
  return null;
}

/**
 * Returns true if the Linkus URI scheme is confirmed working on the device.
 * Until an admin verifies it, the frontend should show a warning and rely on
 * the system dialler fallback.
 */
export function isLinkusUriVerified(config) {
  return Boolean(config?.uri_scheme_verified);
}