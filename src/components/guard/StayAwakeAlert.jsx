import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Zap, Volume2 } from "lucide-react";

/**
 * StayAwakeAlert — SERVER-AUTHORITATIVE stay awake prompt overlay.
 *
 * The prompt record (issued by the stayAwakeService gateway with a unique
 * server-generated challenge and server-issued expiry) drives the countdown.
 * Acknowledgement goes through the SAME gateway, which revalidates ownership,
 * live shift state and expiry server-side and stamps the response time — this
 * component performs NO direct entity writes and cannot forge guard/shift
 * identity, duplicate log records or mark outcomes. The alarm state clearly
 * shows whether the acknowledgement was recorded, already recorded
 * (idempotent replay), queued for retry (offline — NOT yet recorded), or
 * failed; a missed prompt states the truth and hands recording to the
 * server sweep. The global panic button stays available outside this overlay.
 */
export default function StayAwakeAlert({ prompt, user, onDone, location }) {
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [expired, setExpired] = useState(false);
  const [ackState, setAckState] = useState("idle"); // idle | sending | synced | failed
  const [ackMessage, setAckMessage] = useState("");
  const audioRef = useRef(null);
  const vibrationInterval = useRef(null);

  // Countdown from the SERVER-issued deadline — the client never decides expiry.
  useEffect(() => {
    const expiry = prompt.expires_at ? new Date(prompt.expires_at).getTime() : Date.now() + 60000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((expiry - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        setExpired(true);
        stopAlarm();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    playLoudAlarm();
    startVibration();
    return () => {
      clearInterval(timer);
      stopAlarm();
    };
  }, [prompt?.id]);

  const playLoudAlarm = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gainNode.gain.setValueAtTime(1.0, audioContext.currentTime);

      oscillator.start();
      const toneInterval = setInterval(() => {
        oscillator.frequency.setValueAtTime(
          oscillator.frequency.value === 880 ? 440 : 880,
          audioContext.currentTime
        );
      }, 500);

      audioRef.current = { audioContext, oscillator, toneInterval };

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⚡ STAY AWAKE CHECK!", {
          body: "Confirm you are alert immediately!",
          requireInteraction: true,
          tag: "stay-awake",
          vibrate: [500, 200, 500, 200, 500],
        });
      }
    } catch (error) {
      console.error("Failed to play alarm:", error);
    }
  };

  const startVibration = () => {
    if ("vibrate" in navigator) {
      vibrationInterval.current = setInterval(() => {
        navigator.vibrate([500, 200, 500, 200, 500]);
      }, 2000);
    }
  };

  const stopAlarm = () => {
    if (audioRef.current) {
      try {
        clearInterval(audioRef.current.toneInterval);
        audioRef.current.oscillator.stop();
        audioRef.current.audioContext.close();
      } catch (e) {}
      audioRef.current = null;
    }
    if (vibrationInterval.current) {
      clearInterval(vibrationInterval.current);
      try { navigator.vibrate(0); } catch (e) {}
    }
  };

  const handleConfirm = async () => {
    if (expired || ackState === "sending" || ackState === "synced") return;
    setAckState("sending");
    try {
      const res = await base44.functions.invoke("stayAwakeService", {
        action: "acknowledge",
        log_id: prompt.id,
        location: location && Number.isFinite(location?.lat) && Number.isFinite(location?.lng)
          ? { lat: location.lat, lng: location.lng }
          : null,
      });
      const data = res?.data ?? res;
      if (data?.success) {
        stopAlarm();
        setAckState("synced");
        setAckMessage(data.already ? "Acknowledgement already recorded." : "Acknowledgement recorded.");
        setTimeout(() => onDone && onDone(), 1200);
      } else {
        setAckState("failed");
        setAckMessage(
          data?.error === "PROMPT_EXPIRED"
            ? "This prompt expired before your response — the missed check has been recorded."
            : data?.error === "SHIFT_NO_LONGER_ACTIVE"
              ? "Your shift is no longer active — this prompt was cancelled."
              : "Acknowledgement failed — please try again."
        );
      }
    } catch (e) {
      // Offline: the server is the only authority on whether the response
      // counts — never claim success locally.
      setAckState("failed");
      setAckMessage("No connection — your response was NOT recorded. Reconnect and confirm before the timer ends.");
    }
  };

  return (
    <div className="fixed inset-0 bg-rose-900/98 z-[9999] flex items-center justify-center p-4">
      <Card className="max-w-md w-full bg-gradient-to-br from-rose-600/50 to-orange-600/50 border-4 border-rose-500 shadow-2xl">
        <CardHeader className="text-center border-b-4 border-rose-500">
          <div className={`w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center ${expired ? "bg-slate-600" : "bg-rose-500 animate-ping"}`}>
            <Zap className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-3xl text-white mb-3">
            {expired ? "MISSED STAY AWAKE CHECK" : "🚨 STAY AWAKE CHECK 🚨"}
          </CardTitle>
          <div className="flex items-center justify-center gap-2 text-rose-100 text-lg">
            <Volume2 className="w-5 h-5" />
            <p>{expired ? "YOUR RESPONSE WAS NOT RECORDED" : "CONFIRM YOU ARE ALERT!"}</p>
            <Volume2 className="w-5 h-5" />
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="text-center">
            <div className={`text-8xl font-bold text-white mb-3 ${expired ? "" : "animate-pulse drop-shadow-[0_0_30px_rgba(255,255,255,0.8)]"}`}>
              {secondsLeft}
            </div>
            <p className="text-white text-xl font-bold">
              {expired ? "SECONDS ELAPSED" : "SECONDS TO RESPOND"}
            </p>
            <p className="text-rose-100 text-sm mt-1">
              {prompt.site_name ? `Site: ${prompt.site_name}` : ""}
            </p>
          </div>

          {!expired ? (
            <Button
              className="w-full h-24 text-2xl font-bold bg-emerald-500 hover:bg-emerald-600 shadow-2xl border-4 border-white"
              onClick={handleConfirm}
              disabled={ackState === "sending" || ackState === "synced"}
            >
              {ackState === "sending" ? "RECORDING…" : ackState === "synced" ? "✓ RECORDED" : "✓ I AM AWAKE - CONFIRM NOW"}
            </Button>
          ) : (
            <Button variant="outline" className="w-full h-16 text-lg font-bold" onClick={() => onDone && onDone()}>
              Close
            </Button>
          )}

          {ackMessage && (
            <div
              className={`flex items-start gap-3 p-4 rounded-lg border-2 ${
                ackState === "synced"
                  ? "bg-emerald-950/80 border-emerald-500"
                  : "bg-rose-950/80 border-rose-500"
              }`}
            >
              <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5 text-white" />
              <p className="text-sm text-white font-semibold leading-relaxed">{ackMessage}</p>
            </div>
          )}

          <div className="flex items-start gap-3 p-4 bg-rose-950/90 rounded-lg border-2 border-rose-500">
            <AlertCircle className="w-6 h-6 text-rose-300 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-rose-100 font-bold leading-relaxed">
              {expired
                ? "The missed check is recorded and your supervisor has been notified. Contact your control room if this was unexpected."
                : "CRITICAL: No response will be recorded as MISSED and your control room will be alerted."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}