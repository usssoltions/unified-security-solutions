/**
 * Device installation identity + registration client.
 *
 * LICENSING MODEL: a device licence is consumed per PHYSICAL APP INSTALLATION
 * (never per user). The installation id is a cryptographically strong UUID
 * generated ONCE on first install and persisted in local storage — it must
 * SURVIVE logout (a licence slot is never freed by logging out), and it is
 * never derived from IP, account, user-agent or hardware fingerprinting.
 */
import { base44 } from "@/api/base44Client";

const INSTALLATION_KEY = "uss_installation_id";

/** Stable per-installation UUID — created once, persisted, never reset. */
export function getInstallationId() {
  try {
    let id = localStorage.getItem(INSTALLATION_KEY);
    if (!id || !/^[A-Za-z0-9-]{16,64}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALLATION_KEY, id);
    }
    return id;
  } catch (_) {
    return null;
  }
}

/** Informational device summary (platform/model/app type) — never identity. */
export function getDeviceInfo() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const platform = /android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "ios" : "web";
  let model = "";
  const m = ua.match(/Android;[^;]*;\s*([^)]+)/i);
  if (m) model = m[1];
  if (!model && /Android/i.test(ua)) {
    const a = ua.match(/Android\s([\d.]+)/i);
    model = a ? `Android ${a[1]}` : "Android";
  }
  if (!model && /iPhone|iPad/i.test(ua)) {
    const a = ua.match(/(iPhone|iPad)[^;]*;\s*([^)]+)/i);
    model = a ? `${a[1]}` : "iOS";
  }
  const standalone =
    (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (typeof navigator !== "undefined" && navigator.standalone === true);
  // The native Android shell installs window.__ussHardwareBack (MainActivity).
  const app_type = (typeof window !== "undefined" && window.__ussHardwareBack) ? "native" : standalone ? "pwa" : "web";
  return {
    device_platform: platform,
    device_model: String(model || "").slice(0, 120),
    app_type,
  };
}

/**
 * Register THIS installation against the caller's customer licence
 * (deviceAccess gateway — server-authoritative, idempotent, limit-enforced).
 * Returns { status: 'active' | 'blocked' | 'inactive' | 'busy' | 'error', ... }.
 */
export async function registerThisDevice() {
  const installation_id = getInstallationId();
  if (!installation_id) return { status: "error", message: "This device could not be identified." };
  try {
    const res = await base44.functions.invoke("deviceAccess", {
      action: "register",
      installation_id,
      ...getDeviceInfo(),
    });
    return res?.data ?? res;
  } catch (e) {
    return { status: "error", message: e?.response?.data?.error || e?.message || "Device verification failed." };
  }
}

/** Refresh this installation's last-seen presence (no licence effect). */
export async function heartbeatThisDevice() {
  const installation_id = getInstallationId();
  if (!installation_id) return;
  try {
    await base44.functions.invoke("deviceAccess", { action: "heartbeat", installation_id });
  } catch (_) { /* presence only */ }
}