import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, BellRing, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { base44 } from "@/api/base44Client";

const FINGERPRINT_KEY = "uss_push_device_fingerprint";
const PROMPT_DISMISS_KEY = "uss_push_prompt_dismissed";

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

function osPermission() {
  return typeof Notification !== "undefined" ? Notification.permission : "denied";
}

const unwrap = (res) => (res?.data !== undefined ? res.data : res);

export default function PushPermissionManager({ user, variant = "card" }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(PROMPT_DISMISS_KEY) === "1"; } catch { return false; }
  });
  // "First appropriate use": the OS permission request is never fired at
  // launch — only after the user explicitly taps Enable on the explanation.
  const [promptVisible, setPromptVisible] = useState(false);
  useEffect(() => {
    if (variant !== "prompt") return;
    const t = setTimeout(() => setPromptVisible(true), 25000);
    return () => clearTimeout(t);
  }, [variant]);

  const { data: regs = [] } = useQuery({
    queryKey: ["pushRegistrations", user?.id],
    queryFn: async () =>
      base44.entities.PushRegistration.filter({ user_id: user.id, status: "active" }).catch(() => []),
    enabled: !!user?.id,
    staleTime: 0,
  });

  const registered = regs.length > 0;
  const permission = osPermission();
  const status = useMemo(() => {
    if (!registered) return "device_not_registered";
    if (permission === "granted") return "enabled";
    if (permission === "denied") return "disabled";
    return "permission_required";
  }, [registered, permission]);

  const register = async () => {
    setBusy(true); setError(null); setTestResult(null);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
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
      try { localStorage.removeItem(PROMPT_DISMISS_KEY); setDismissed(false); } catch {}
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

  if (variant === "prompt") {
    if (status === "enabled" || dismissed || !promptVisible) return null;
    return (
      <div className="fixed bottom-20 md:bottom-6 inset-x-3 md:inset-x-auto md:left-6 md:max-w-sm z-40 bg-slate-900 border border-slate-700 rounded-2xl p-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <BellRing className="w-5 h-5 text-sky-400" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-white text-sm">Enable Operational Notifications</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Receive important task assignments, incidents, patrol alerts and operational updates even when the app is closed.
            </p>
            {error && <p className="text-xs text-rose-400 mt-2">{error}</p>}
            <div className="flex gap-2 mt-3">
              <Button onClick={register} disabled={busy} size="sm" className="h-9 active:scale-95 bg-sky-500 hover:bg-sky-600 text-white">
                {busy ? "Enabling…" : "Enable Notifications"}
              </Button>
              <Button
                onClick={() => { try { localStorage.setItem(PROMPT_DISMISS_KEY, "1"); } catch {} setDismissed(true); }}
                variant="outline" size="sm" className="h-9 border-slate-600 text-slate-300"
              >
                Not now
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 'card' variant: Profile / Settings status surface ──────────────
  const statusMeta = {
    enabled: { label: "Notifications Enabled", tone: "text-emerald-400", Icon: Bell, desc: "This device receives native operational push notifications." },
    disabled: { label: "Notifications Disabled", tone: "text-rose-400", Icon: BellOff, desc: "Notifications are blocked for this app in your device settings." },
    permission_required: { label: "Permission Required", tone: "text-amber-400", Icon: BellRing, desc: "This device is registered — allow notifications when prompted." },
    device_not_registered: { label: "Device Not Registered", tone: "text-slate-400", Icon: Smartphone, desc: "Register this device to receive operational push notifications." },
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
          {status !== "enabled" && (
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