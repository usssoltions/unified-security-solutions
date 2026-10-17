import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, BellRing, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

const FINGERPRINT_KEY = "uss_push_device_fingerprint";

function getDeviceFingerprint() {
  try {
    let fp = localStorage.getItem(FINGERPRINT_KEY);
    if (!fp) {
      fp = (crypto.randomUUID ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(36).slice(2));
      localStorage.setItem(FINGERPRINT_KEY, fp);
    }
    return fp;
  } catch { return "dev-" + Date.now(); }
}

function detectPlatform() {
  const ua = navigator.userAgent || "";
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  return "web";
}

function detectLabel() {
  const ua = navigator.userAgent || "";
  const m = ua.match(/\(([^)]+)\)/);
  return m ? m[1].slice(0, 60) : null;
}

// Native Android app (WebView) support: the Web Notification API does not
// exist in the WebView, so permission state flows through the app's JS
// bridge (AndroidBridge) backed by the native OneSignal push permission.
function nativeBridge() {
  const b = window.AndroidBridge;
  return (b && typeof b.isNativeApp === "function" && b.isNativeApp()) ? b : null;
}

function nativeSupported() {
  const b = nativeBridge();
  return !!b && typeof b.getNotificationPermissionStatus === "function";
}

function osPermission() {
  const b = nativeBridge();
  if (nativeSupported()) {
    try { return b.getNotificationPermissionStatus(); } catch (_) { return "denied"; }
  }
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}

function osSupported() {
  if (nativeSupported()) return true;
  return typeof Notification !== "undefined" && typeof Notification.requestPermission === "function";
}

// Native permission request: fires the Android system dialog once (only from
// this explicit user action), then polls the bridge until the user answers.
async function requestNativePermission() {
  const b = nativeBridge();
  if (!b || typeof b.requestNotificationPermission !== "function") return "denied";
  let state = b.requestNotificationPermission();
  if (state === "granted") return "granted";
  if (state === "unsupported") return "denied";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      state = b.getNotificationPermissionStatus();
      if (state === "granted" || state === "denied") return state;
    } catch (_) { return "denied"; }
  }
  return b.getNotificationPermissionStatus?.() || "denied";
}

const unwrap = (res) => (res?.data !== undefined ? res.data : res);

// Manual-only surface: rendered on Profile as a status card. There is NO
// automatic prompt anywhere in the app — the OS permission request fires
// exclusively when the user taps Enable Notifications here.
export default function PushPermissionManager({ user }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const { data: regs = [] } = useQuery({
    queryKey: ["pushRegistrations", user?.id],
    queryFn: async () =>
      base44.entities.PushRegistration.filter({ user_id: user.id, status: "active" }).catch(() => []),
    enabled: !!user?.id,
    staleTime: 0,
  });

  const registered = regs.length > 0;
  const permission = osPermission();
  // State reporting distinguishes: device registration, OS permission, the
  // user's own push preference, and delivery-channel uncertainty (test push).
  // "enabled" is NEVER shown from a preference alone — it requires a
  // registered device AND granted OS permission AND the preference on.
  const status = useMemo(() => {
    if (!registered) return "device_not_registered";
    if (!osSupported()) return "unsupported";
    if (permission === "denied") return "disabled";
    if (permission === "default") return "permission_required";
    const anyDelivering = regs.some(r => r.status === "active" && r.push_enabled !== false);
    return anyDelivering ? "enabled" : "paused";
  }, [registered, permission, regs]);

  const register = async () => {
    setBusy(true); setError(null); setTestResult(null);
    try {
      // Ask for the OS permission ONLY from this explicit button tap, using
      // the flow of the current app context (native bridge in the Android
      // app, the Web Notification API in browsers/PWAs). A refusal stops
      // here — notifications are never shown as enabled without a granted
      // permission AND a successful registration.
      if (nativeSupported()) {
        const granted = await requestNativePermission();
        if (granted !== "granted") {
          throw new Error("Notification permission was not granted. Allow notifications for this app in your device settings, then try again.");
        }
      } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
        await Notification.requestPermission();
      }
      const res = await base44.functions.invoke("registerPushDevice", {
        action: "register",
        device_fingerprint: getDeviceFingerprint(),
        device_platform: detectPlatform(),
        device_label: detectLabel(),
        notification_permission: osPermission(),
      });
      const d = unwrap(res);
      if (!d?.success) throw new Error(d?.error || "Registration failed");
      await queryClient.invalidateQueries({ queryKey: ["pushRegistrations", user?.id] });
    } catch (e) {
      setError(e?.message || "Unable to register this device");
    } finally { setBusy(false); }
  };

  const sendTest = async () => {
    setBusy(true); setError(null); setTestResult(null);
    try {
      const res = await base44.functions.invoke("sendTestPushNotification", {
        userId: user.id,
        title: "USS Test Notification",
        message: "Diagnostic test push — if you received this with the app closed, native push is working on this device.",
      });
      const d = unwrap(res);
      if (d?.success) setTestResult({ ok: true, text: "Test push sent — check this device's notification tray." });
      else setTestResult({ ok: false, text: `Not sent (${d?.status || d?.reason || d?.error || "unknown"}) — the app may not have native push builds yet, or no device is registered.` });
    } catch (e) {
      setTestResult({ ok: false, text: e?.message || "Test push failed" });
    } finally { setBusy(false); }
  };

  if (!user) return null;

  // ── Profile / Settings status surface (manual setup only) ──────────
  const statusMeta = {
    enabled: { label: "Notifications Enabled", tone: "text-emerald-400", Icon: Bell, desc: "This device receives native operational push notifications." },
    unsupported: { label: "Not Supported Here", tone: "text-slate-400", Icon: BellOff, desc: "This browser or in-app view cannot register device notifications. Open the app in a standard browser (or the USS Android app) to enable them." },
    disabled: { label: "Notifications Disabled", tone: "text-rose-400", Icon: BellOff, desc: "Notifications are blocked for this app in your device settings." },
    permission_required: { label: "Permission Required", tone: "text-amber-400", Icon: BellRing, desc: "This device is registered — allow notifications when prompted." },
    device_not_registered: { label: "Device Not Registered", tone: "text-slate-400", Icon: Smartphone, desc: "Register this device to receive operational push notifications." },
    paused: { label: "Notifications Paused", tone: "text-amber-400", Icon: BellOff, desc: "Push is switched off in your preferences for this device. Turn it back on to receive operational notifications." },
  }[status];

  return (
    <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl p-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
          <statusMeta.Icon className="w-5 h-5 text-slate-300" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white">Push Notifications</p>
          <p className={`text-xs ${statusMeta.tone}`}>{statusMeta.label}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {registered && <span className="text-xs text-slate-500 hidden sm:inline">{regs.length} device{regs.length > 1 ? "s" : ""}</span>}
          {status !== "enabled" && status !== "unsupported" && (
            <Button onClick={register} disabled={busy} size="sm" className="h-9 active:scale-95 bg-sky-500 hover:bg-sky-600 text-white">
              {busy ? "Enabling…" : "Enable Notifications"}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-3 leading-relaxed">{statusMeta.desc}</p>
      {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
      {status === "disabled" && (
        <p className="text-xs text-slate-500 mt-2">Allow notifications for this app in your phone's system settings, then return here.</p>
      )}
      {registered && (
        <div className="mt-3">
          <Button onClick={sendTest} disabled={busy} variant="outline" size="sm" className="h-9 border-slate-600 text-slate-300 active:scale-95">
            Send Test Push
          </Button>
          {testResult && (
            <p className={`text-xs mt-2 ${testResult.ok ? "text-emerald-400" : "text-amber-400"}`}>{testResult.text}</p>
          )}
        </div>
      )}
    </div>
  );
}