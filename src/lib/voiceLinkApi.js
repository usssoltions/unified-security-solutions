import { base44 } from "@/api/base44Client";

/**
 * USS VOICE LINK (pilot) — client API wrapper for the voiceLink gateway.
 * All tenant/entitlement/pilot decisions are made server-side; this wrapper
 * only carries the action + call-scoped parameters.
 */
const invoke = async (action, payload = {}) => {
  const res = await base44.functions.invoke("voiceLink", { action, ...payload });
  return res?.data ?? res;
};

// Stable per-installation device id — used to prove WHICH device answered
// (answering on one device stops ringing on the callee's others).
export const voicelinkDeviceId = () => {
  try {
    let id = localStorage.getItem("uss_voicelink_device");
    if (!id) {
      id = "web-" + Math.random().toString(36).slice(2, 10);
      localStorage.setItem("uss_voicelink_device", id);
    }
    return id;
  } catch (_) {
    return "web-unknown";
  }
};

export const voiceLinkApi = {
  contacts: () => invoke("contacts"),
  initiate: (targetUserId) => invoke("initiate", { target_user_id: targetUserId }),
  state: (callId) => invoke("state", { call_id: callId }),
  accept: (callId) => invoke("accept", { call_id: callId, device_id: voicelinkDeviceId() }),
  decline: (callId) => invoke("decline", { call_id: callId }),
  cancel: (callId) => invoke("cancel", { call_id: callId }),
  markConnected: (callId) => invoke("mark_connected", { call_id: callId }),
  hangup: (callId, reason) => invoke("hangup", { call_id: callId, reason: reason || "hangup" }),
  signal: (callId, kind, payload) => invoke("signal", { call_id: callId, kind, payload: JSON.stringify(payload) }),
  pollSignals: (callId) => invoke("poll_signals", { call_id: callId }),
  incoming: () => invoke("incoming"),
};