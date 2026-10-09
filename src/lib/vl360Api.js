import { base44 } from "@/api/base44Client";

/**
 * vl360Api — frontend wrapper for the vl360Access gateway (USS VOICELINK 360).
 * The SDK's invoke() returns the axios-shaped response; the JSON body lives
 * under .data (same unwrap pattern as every other gateway in this app).
 */
export async function vl360Invoke(payload) {
  const res = await base44.functions.invoke("vl360Access", payload);
  const d = res?.data !== undefined ? res.data : res;
  return d || {};
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