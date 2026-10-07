import React, { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff } from "lucide-react";
import { voiceLinkApi } from "@/lib/voiceLinkApi";

/**
 * USS VOICE LINK (pilot) — web incoming-call overlay (pilot web devices).
 * Polls the authoritative gateway; the ANDROID native incoming path
 * (ringtone + lock screen + one-press answer) is handled natively. This
 * overlay never rings legacy calls: it reacts only to VoiceLinkCall rows.
 */
export default function VoiceLinkIncomingOverlay({ onAccepted }) {
  const [incoming, setIncoming] = useState(null);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);
  const currentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await voiceLinkApi.incoming();
        const call = res?.call || null;
        if (currentRef.current && (!call || call.call_id !== currentRef.current.call_id)) {
          // Claimed/terminated elsewhere — dismiss.
          currentRef.current = null;
          setIncoming(null);
        }
        if (call && !currentRef.current) {
          currentRef.current = call;
          setIncoming(call);
        }
      } catch (_) {}
      if (!cancelled) timerRef.current = setTimeout(poll, 4000);
    };
    poll();
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleAnswer = async () => {
    if (!incoming || busy) return;
    setBusy(true);
    try {
      const res = await voiceLinkApi.accept(incoming.call_id);
      if (res?.already_claimed) { currentRef.current = null; setIncoming(null); setBusy(false); return; }
      const ice = res?.ice_servers || [];
      const call = incoming;
      currentRef.current = null;
      setIncoming(null);
      onAccepted?.({ callId: call.call_id, role: "callee", peerName: call.caller_name, iceServers: ice });
    } catch (_) {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!incoming || busy) return;
    setBusy(true);
    try { await voiceLinkApi.decline(incoming.call_id); } catch (_) {}
    currentRef.current = null;
    setIncoming(null);
    setBusy(false);
  };

  if (!incoming) return null;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950/95 flex flex-col items-center justify-between py-10 px-6">
      <div className="text-center mt-8">
        <div className="w-24 h-24 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-emerald-300">{(incoming.caller_name || "?").slice(0, 1)}</span>
        </div>
        <h2 className="text-xl font-bold text-white">{incoming.caller_name || "Unknown Caller"}</h2>
        <p className="text-slate-400 mt-1 text-sm">Incoming call · USS Voice Link</p>
      </div>
      <div className="flex items-center gap-8">
        <button
          onClick={handleDecline}
          disabled={busy}
          className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center text-white shadow-lg active:scale-95 transition"
        >
          <PhoneOff className="w-7 h-7" />
        </button>
        <button
          onClick={handleAnswer}
          disabled={busy}
          className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-lg active:scale-95 transition animate-pulse"
        >
          <Phone className="w-7 h-7" />
        </button>
      </div>
      <p className="text-xs text-slate-500">Answer connects directly — one press</p>
    </div>
  );
}