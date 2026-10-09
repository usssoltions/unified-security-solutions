import { base44 } from "@/api/base44Client";

/**
 * vl360Api — frontend wrapper for the vl360Access gateway (USS VOICELINK 360).
 *
 * The SDK's invoke() returns the axios-shaped response; the JSON body lives
 * under .data (same unwrap pattern as every other gateway in this app).
 *
 * STRUCTURED FAILURES: when the gateway answers with a non-2xx status the SDK
 * throws; the gateway's error body (message + code) lives on the thrown
 * error's response. vl360Invoke re-throws an Error carrying .code and .status
 * so the UI can distinguish "customer selection required" from "not
 * licensed", "access denied", "session expired" and genuine network/server
 * failures — instead of showing all of them as "Check your connection".
 */
export async function vl360Invoke(payload) {
  const selected = getVl360Customer();
  const body = selected ? { ...payload, customer_id: selected } : payload;
  try {
    const res = await base44.functions.invoke("vl360Access", body);
    const d = res?.data !== undefined ? res.data : res;
    return d || {};
  } catch (e) {
    const gatewayBody = e?.response?.data || e?.data || null;
    const err = new Error(gatewayBody?.error || e?.message || "VoiceLink 360 request failed.");
    err.code = gatewayBody?.code
      || (e?.response ? `http_${e.response.status}` : "network_error");
    err.status = e?.response?.status || null;
    throw err;
  }
}

/**
 * Selected operating customer for platform/reseller administrators whose own
 * account has no customer scope. Session-scoped (cleared on logout by the
 * layout's session reset); never trusted server-side — the gateway re-validates
 * every request against the caller's real authority.
 */
const CUSTOMER_KEY = "uss_vl360_customer";

export function getVl360Customer() {
  try { return sessionStorage.getItem(CUSTOMER_KEY) || null; } catch (_) { return null; }
}

export function setVl360Customer(id) {
  try {
    if (id) sessionStorage.setItem(CUSTOMER_KEY, id);
    else sessionStorage.removeItem(CUSTOMER_KEY);
  } catch (_) {}
}

/**
 * Every VoiceLink 360 query key is scoped under ["vl360", <customer|self>],
 * so a change of operating customer can never serve the previous customer's
 * cached data — and one removeQueries(["vl360"]) clears all of it.
 */
export function vl360Key(parts) {
  const list = Array.isArray(parts) ? parts : [parts];
  return ["vl360", getVl360Customer() || "self", ...list];
}

export function clearVl360Cache(queryClient) {
  try { queryClient.removeQueries({ queryKey: ["vl360"] }); } catch (_) {}
}

/**
 * resolveDestination — asks the gateway to validate scope + destination and
 * record the handoff attempt, then performs the handoff by navigating to the
 * stored Telegram link (Android resolves t.me links to the Telegram app or
 * browser — USS never launches an app automatically on page load; this only
 * runs on an explicit user tap).
 * Returns the resolution payload so the caller can explain failures.
 */
export async function openDestination(target) {
  const d = await vl360Invoke({ action: "resolve_destination", target });
  if (d?.code && (d.code === "missing_emergency" || d.code === "missing_configuration"
    || d.code === "malformed_destination")) {
    return d; // caller renders the honest explanation
  }
  if (d?.error) throw new Error(d.error);
  if (d?.link) {
    window.location.href = d.link;
    return { ...d, handed_off: true };
  }
  return d;
}