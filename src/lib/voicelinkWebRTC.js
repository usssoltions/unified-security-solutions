/**
 * USS VOICE LINK (pilot) — shared browser WebRTC audio engine.
 * Direct peer-to-peer audio with the gateway's ICE configuration (STUN +
 * best-effort TURN). Signalling flows only through the voiceLink gateway.
 */

export function createPeer({ iceServers, isCaller, onIceCandidate, onConnectionState }) {
  const pc = new RTCPeerConnection({
    iceServers: iceServers || [],
    iceCandidatePoolSize: 10,
    sdpSemantics: "unified-plan",
  });
  pc.onicecandidate = (e) => { if (e.candidate) onIceCandidate?.(e.candidate); };
  pc.onconnectionstatechange = () => onConnectionState?.(pc.connectionState);
  pc.isCaller = !!isCaller;
  return pc;
}

export async function attachLocalMic(pc) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  for (const track of stream.getAudioTracks()) {
    pc.addTrack(track, stream);
  }
  return stream;
}

// Attach the remote audio to a hidden <audio> element and start playback.
export function attachRemoteAudio(pc, audioEl) {
  pc.ontrack = (e) => {
    if (audioEl.srcObject !== e.streams[0]) {
      audioEl.srcObject = e.streams[0];
      audioEl.play().catch(() => {});
    }
  };
}

/**
 * Signalling pump — polls the gateway for queued signals addressed to this
 * participant and dispatches them (answer / ice). Runs every intervalMs; the
 * server consumes rows exactly once, so polling is safe and idempotent.
 */
export function startSignalPump({ callId, intervalMs = 1500, onSignal }) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const { voiceLinkApi } = await import("@/lib/voiceLinkApi");
      const res = await voiceLinkApi.pollSignals(callId);
      for (const s of res?.signals || []) {
        try {
          const payload = JSON.parse(s.payload || "{}");
          await onSignal(s.kind, payload);
        } catch (_) {}
      }
    } catch (_) {}
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  tick();
  return { stop: () => { stopped = true; if (timer) clearTimeout(timer); } };
}

/** Short looping ringback tone (WebAudio) for the ringing caller. */
export function startRingback() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let timer = null;
    const beep = () => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.value = 0.04;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
      timer = setTimeout(beep, 1600);
    };
    beep();
    return { stop: () => { if (timer) clearTimeout(timer); try { ctx.close(); } catch (_) {} } };
  } catch (_) {
    return { stop: () => {} };
  }
}