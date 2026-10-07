import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Volume2, VolumeX, AlertTriangle } from "lucide-react";
import { voiceLinkApi } from "@/lib/voiceLinkApi";
import { createPeer, attachLocalMic, attachRemoteAudio, startSignalPump, startRingback } from "@/lib/voicelinkWebRTC";

/**
 * USS VOICE LINK (pilot) — in-call screen for an individual call, web side.
 * Role 'caller': waits for 'connecting', then offers. Role 'callee': waits for
 * the offer, answers. Audio is direct P2P WebRTC; lifecycle state is polled
 * from the server (authoritative), so remote decline/cancel/end/missed always
 * surfaces here. Mute, hang-up and speaker controls; audio continues during
 * navigation only while this component stays mounted (the VoiceLink page keeps
 * it mounted across in-page views).
 */
export default function VoiceLinkCallScreen({ callId, role, peerName, iceServers, onEnded, onCancel }) {
  const [phase, setPhase] = useState(role === "caller" ? "waiting_answer" : "connecting");
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(null);
  const pcRef = useRef(null);
  const micStreamRef = useRef(null);
  const audioElRef = useRef(null);
  const pumpRef = useRef(null);
  const stateTimerRef = useRef(null);
  const ringbackRef = useRef(null);
  const durationTimerRef = useRef(null);
  const iceCandidatesRef = useRef([]); // caller: queue ICE until remote SDP set
  const remoteReadyRef = useRef(false);
  const endedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const cleanup = () => {
      endedRef.current = true;
      pumpRef.current?.stop?.();
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      ringbackRef.current?.stop?.();
      try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { pcRef.current && pcRef.current.close(); } catch (_) {}
      pcRef.current = null;
    };

    const finishLocal = async (reason, terminalState) => {
      if (endedRef.current) return;
      cleanup();
      try {
        if (reason === "hangup") await voiceLinkApi.hangup(callId, "hangup");
      } catch (_) {}
      onEnded?.(terminalState || reason);
    };

    const handleTerminal = (status) => {
      if (endedRef.current) return;
      cleanup();
      onEnded?.(status);
    };

    const drainQueuedIce = async () => {
      if (!remoteReadyRef.current || !pcRef.current) return;
      const queued = iceCandidatesRef.current; iceCandidatesRef.current = [];
      for (const c of queued) {
        try { await pcRef.current.addIceCandidate(c); } catch (_) {}
      }
    };

    const onSignal = async (kind, payload) => {
      if (endedRef.current || !pcRef.current) return;
      if (kind === "offer" && role === "callee") {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload));
        remoteReadyRef.current = true;
        await drainQueuedIce();
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        await voiceLinkApi.signal(callId, "answer", answer);
        setPhase("connecting");
      } else if (kind === "answer" && role === "caller") {
        if (!pcRef.current.remoteDescription) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload));
          remoteReadyRef.current = true;
          await drainQueuedIce();
        }
      } else if (kind === "ice") {
        if (remoteReadyRef.current) {
          try { await pcRef.current.addIceCandidate(payload); } catch (_) {}
        } else {
          iceCandidatesRef.current.push(payload);
        }
      }
    };

    const setupPeer = async () => {
      const pc = createPeer({
        iceServers,
        isCaller: role === "caller",
        onIceCandidate: async (c) => {
          try { await voiceLinkApi.signal(callId, "ice", c.toJSON ? c.toJSON() : c); } catch (_) {}
        },
        onConnectionState: async (state) => {
          if (cancelled || endedRef.current) return;
          if (state === "connected") {
            ringbackRef.current?.stop?.();
            setPhase("in_call");
            if (!durationTimerRef.current) {
              await voiceLinkApi.markConnected(callId).catch(() => {});
              durationTimerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
            }
          } else if (state === "disconnected") {
            setPhase("reconnecting");
          } else if (state === "failed") {
            if (role === "caller") {
              // ICE restart attempt (reconnection) — re-offer permitted while connected.
              try {
                remoteReadyRef.current = false;
                const offer = await pcRef.current.createOffer({ iceRestart: true });
                await pcRef.current.setLocalDescription(offer);
                await voiceLinkApi.signal(callId, "offer", offer);
                setPhase("reconnecting");
              } catch (_) {
                await finishLocal("connection_lost", "failed");
              }
            } else {
              await finishLocal("connection_lost", "failed");
            }
          }
        },
      });
      pcRef.current = pc;
      const stream = await attachLocalMic(pc);
      micStreamRef.current = stream;
      attachRemoteAudio(pc, audioElRef.current);
      pumpRef.current = startSignalPump({ callId, onSignal });

      if (role === "caller") {
        // Authoritative state machine: offer only once the callee has claimed
        // the call (status 'connecting').
        const awaitAnswer = async () => {
          while (!cancelled && !endedRef.current) {
            try {
              const res = await voiceLinkApi.state(callId);
              const st = res?.call?.status;
              if (["declined", "cancelled", "missed", "expired", "ended"].includes(st)) { handleTerminal(st); return; }
              if (st === "connecting") {
                setPhase("connecting");
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await voiceLinkApi.signal(callId, "offer", offer);
                return;
              }
            } catch (e) { setError("Connection to call service lost — retrying"); }
            await new Promise((r) => setTimeout(r, 2000));
          }
        };
        ringbackRef.current = startRingback();
        awaitAnswer();
      } else {
        // Callee (web): offer arrives via the signal pump.
        setPhase("connecting");
      }

      // Authoritative terminal-state watchdog (covers decline/cancel/missed/end).
      const pollState = async () => {
        if (cancelled || endedRef.current) return;
        try {
          const res = await voiceLinkApi.state(callId);
          const st = res?.call?.status;
          if (["declined", "cancelled", "missed", "expired", "ended"].includes(st)) { handleTerminal(st); return; }
        } catch (_) {}
        stateTimerRef.current = setTimeout(pollState, 3000);
      };
      stateTimerRef.current = setTimeout(pollState, 3000);
    };

    setupPeer().catch((e) => {
      if (!cancelled) { setError("Microphone unavailable: " + (e?.message || e)); setPhase("failed"); }
    });

    return () => { cancelled = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    } catch (_) {}
  };

  const toggleSpeaker = async () => {
    // Browser-side speaker routing is device-managed; apply where supported.
    try {
      const el = audioElRef.current;
      if (el && el.setSinkId && navigator.mediaDevices?.enumerateDevices) {
        const outs = await navigator.mediaDevices.enumerateDevices();
        const target = outs.find((d) => d.kind === "audiooutput" &&
          (speaker ? d.label.toLowerCase().includes("ear") || /default/.test(d.deviceId) : /speaker|loud/i.test(d.label)));
        if (target) await el.setSinkId(target.deviceId);
      }
    } catch (_) {}
    setSpeaker(!speaker);
  };

  const mmss = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;

  const statusText = {
    waiting_answer: "Ringing…",
    connecting: "Connecting…",
    in_call: mmss,
    reconnecting: "Reconnecting…",
    failed: "Call failed",
  }[phase] || phase;

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950 flex flex-col items-center justify-between py-10 px-6">
      <audio ref={audioElRef} autoPlay playsInline className="hidden" />
      <div className="text-center mt-8">
        <div className="w-24 h-24 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl font-bold text-slate-200">{(peerName || "?").slice(0, 1)}</span>
        </div>
        <h2 className="text-xl font-bold text-white">{peerName || "Call"}</h2>
        <p className="text-slate-400 mt-1 text-sm">USS Voice Link · {role === "caller" ? "Outgoing" : "Incoming"}</p>
        <p className={`mt-3 text-lg font-semibold ${phase === "in_call" ? "text-emerald-400" : phase === "reconnecting" ? "text-amber-400" : "text-slate-300"}`}>
          {statusText}
        </p>
        {error && (
          <p className="mt-2 text-xs text-amber-400 flex items-center justify-center gap-1">
            <AlertTriangle className="w-3 h-3 inline" /> {error}
          </p>
        )}
      </div>

      <div className="flex flex-col items-center gap-4 w-full max-w-xs">
        <div className="flex items-center justify-center gap-4 w-full">
          <button
            onClick={toggleMute}
            disabled={phase !== "in_call"}
            className={`w-14 h-14 rounded-full flex items-center justify-center border transition active:scale-95 ${muted ? "bg-amber-500/20 border-amber-500/40 text-amber-400" : "bg-slate-800 border-slate-700 text-slate-200"}`}
          >
            {muted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </button>
          <button
            onClick={toggleSpeaker}
            disabled={phase !== "in_call"}
            className={`w-14 h-14 rounded-full flex items-center justify-center border transition active:scale-95 ${speaker ? "bg-sky-500/20 border-sky-500/40 text-sky-400" : "bg-slate-800 border-slate-700 text-slate-200"}`}
          >
            {speaker ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
          </button>
        </div>
        <button
          onClick={() => {
            if (phase === "waiting_answer" && onCancel) { onCancel(); }
            else { voiceLinkApi.hangup(callId, "hangup").catch(() => {}); }
          }}
          className="w-16 h-16 rounded-full bg-rose-500 flex items-center justify-center text-white shadow-lg active:scale-95 transition"
        >
          <PhoneOff className="w-7 h-7" />
        </button>
        <p className="text-xs text-slate-500">End Call</p>
      </div>
    </div>
  );
}