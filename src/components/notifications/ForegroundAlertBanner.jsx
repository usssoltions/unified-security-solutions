import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Zap } from "lucide-react";
import { base44 } from "@/api/base44Client";

/**
 * ForegroundAlertBanner — SHARED PLATFORM SERVICE (foreground experience).
 *
 * When the app is OPEN and a qualifying operational notification arrives
 * (realtime Notification create for this user), show a professional in-app
 * banner + short chime (critical/high only) + immediate bell-badge update
 * (the Layout's own subscription) + one tappable deep link. This never
 * relies on an OS banner while the app is foregrounded, and dedupes by
 * notification id so websocket reconnects never double-alert.
 */
function chime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 830;
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(); osc.stop(ctx.currentTime + 0.65);
    setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch (_) {}
}

export default function ForegroundAlertBanner({ user }) {
  const navigate = useNavigate();
  const [banners, setBanners] = useState([]);
  const seen = useRef(new Set());

  useEffect(() => {
    if (!user) return;
    const unsub = base44.entities.Notification.subscribe((event) => {
      if (!event || event.type !== "create" || !event.data) return;
      const n = event.data;
      if (n.recipient_id !== user.id || seen.current.has(n.id)) return;
      seen.current.add(n.id);
      if (document.visibilityState !== "visible") return;
      setBanners((prev) => [{ ...n, _ts: Date.now() }, ...prev].slice(0, 3));
      if (n.priority === "critical" || n.priority === "high") chime();
      if (n.priority === "critical" && "vibrate" in navigator) {
        try { navigator.vibrate([200, 100, 200]); } catch (_) {}
      }
    });
    return unsub;
  }, [user?.id]);

  useEffect(() => {
    if (!banners.length) return;
    const t = setTimeout(() => setBanners((prev) => prev.slice(0, -1)), 7000);
    return () => clearTimeout(t);
  }, [banners]);

  if (!user || !banners.length) return null;

  return (
    <div className="fixed top-20 inset-x-3 md:inset-x-auto md:right-6 md:max-w-sm z-[60] flex flex-col gap-2">
      {banners.map((n) => (
        <div
          key={n.id}
          onClick={() => { if (n.action_url) navigate(n.action_url); setBanners((p) => p.filter((b) => b.id !== n.id)); }}
          className={`cursor-pointer bg-slate-900/95 backdrop-blur border rounded-2xl p-3.5 shadow-2xl active:scale-[0.98] transition ${
            n.priority === "critical" ? "border-red-500/60" : n.priority === "high" ? "border-amber-500/50" : "border-slate-600"
          }`}
        >
          <div className="flex items-start gap-3">
            {n.priority === "critical" && <Zap className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{n.title}</p>
              <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.message}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setBanners((p) => p.filter((b) => b.id !== n.id)); }}
              className="text-slate-500 hover:text-slate-300 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}