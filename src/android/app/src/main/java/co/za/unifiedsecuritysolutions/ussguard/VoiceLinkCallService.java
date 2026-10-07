package co.za.unifiedsecuritysolutions.ussguard;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;
import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.DataChannel;
import org.webrtc.IceCandidate;
import org.webrtc.JavaAudioDeviceModule;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * USS VOICE LINK (pilot) — native WebRTC call engine (foreground service).
 *
 * Answers with REAL media: captures the microphone, exchanges offer/answer/ICE
 * through the voiceLink gateway with the call-scoped token, and keeps audio
 * alive with the screen off and during navigation (foreground service,
 * microphone type). Audio never depends on the WebView or a web page.
 *
 * Reconnection: on ICE 'disconnected' the engine waits and re-polls; a failed
 * ICE triggers an ICE-restart offer from the caller (the gateway permits
 * re-offers while connected) — as callee the engine follows the re-offer.
 * Definitive failure ends the call with reason connection_lost.
 */
public class VoiceLinkCallService extends Service {
    private static final String TAG = "USSGuard";
    private static final String CHANNEL_ID = "voicelink_calls";
    private static final int NOTIF_ID = 424242;
    private static final long SIGNAL_POLL_MS = 1200;

    public static volatile VoiceLinkCallService instance;
    public static volatile String phase = "idle"; // connecting | in_call | reconnecting | ended
    public static volatile String activeCallId = null;

    private String callId;
    private String token;
    private String peerName = "Call";

    private PeerConnectionFactory factory;
    private PeerConnection pc;
    private AudioTrack localAudioTrack;
    private AudioManager audioManager;
    private ScheduledExecutorService executor;
    private final List<IceCandidate> queuedRemoteIce = new ArrayList<>();
    private volatile boolean remoteDescriptionSet = false;
    private volatile boolean markedConnected = false;
    private volatile boolean endedLocally = false;
    private int reconnectOffersSent = 0;

    /* ── Service lifecycle ─────────────────────────────────────────────── */

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getStringExtra("callId") == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        callId = intent.getStringExtra("callId");
        token = intent.getStringExtra("token");
        peerName = intent.getStringExtra("peerName") != null ? intent.getStringExtra("peerName") : "Call";
        activeCallId = callId;

        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        // Loudness for security devices: loudspeaker on by default (toggleable).
        audioManager.setSpeakerphoneOn(true);

        startForeground(NOTIF_ID, buildNotification("Connecting…"));
        phase = "connecting";
        initWebRtc();
        startSignalPolling();

        return START_NOT_STICKY;
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, VoiceLinkCallActivity.class);
        open.putExtra("callId", callId);
        open.putExtra("peerName", peerName);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, callId.hashCode(), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setSmallIcon(android.R.drawable.sym_call_outgoing)
            .setContentTitle("USS Voice Link")
            .setContentText(peerName + " · " + text)
            .setOngoing(true)
            .setContentIntent(content)
            .build();
    }

    private void updateNotification(String text) {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(NOTIF_ID, buildNotification(text));
        } catch (Exception ignored) {}
    }

    /* ── WebRTC engine ─────────────────────────────────────────────────── */

    private void initWebRtc() {
        try {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions());
            JavaAudioDeviceModule adm = JavaAudioDeviceModule.builder(this).createAudioDeviceModule();
            factory = PeerConnectionFactory.builder().setAudioDeviceModule(adm).createPeerConnectionFactory();

            List<PeerConnection.IceServer> iceServers = new ArrayList<>();
            iceServers.add(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer());
            // Best-effort public community relay for restrictive LTE (no SLA).
            iceServers.add(PeerConnection.IceServer.builder("turn:openrelay.metered.ca:80")
                .setUsername("openrelayproject").setPassword("openrelayproject").createIceServer());
            iceServers.add(PeerConnection.IceServer.builder("turn:openrelay.metered.ca:443?transport=tcp")
                .setUsername("openrelayproject").setPassword("openrelayproject").createIceServer());

            PeerConnection.RTCConfiguration cfg = new PeerConnection.RTCConfiguration(iceServers);
            cfg.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;

            pc = factory.createPeerConnection(cfg, new PeerObserver());
            if (pc == null) { fail("Peer connection unavailable"); return; }

            AudioSource source = factory.createAudioSource(new MediaConstraints());
            localAudioTrack = factory.createAudioTrack("voicelink_audio", source);
            pc.addTrack(localAudioTrack, Collections.singletonList("voicelink"));
            instance = this;
            Log.d(TAG, "📞 Voice Link WebRTC engine ready (callee)");
        } catch (Exception e) {
            Log.e(TAG, "Voice Link WebRTC init failed", e);
            fail("engine_init_failed");
        }
    }

    private class PeerObserver implements PeerConnection.Observer {
        @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
        @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {
            Log.d(TAG, "📞 Voice Link ICE: " + state);
            if (state == PeerConnection.IceConnectionState.CONNECTED) {
                phase = "in_call";
                updateNotification("Connected");
                if (!markedConnected) {
                    markedConnected = true;
                    new Thread(() -> VoiceLinkApi.post("mark_connected", callId, token, null)).start();
                }
            } else if (state == PeerConnection.IceConnectionState.DISCONNECTED) {
                phase = "reconnecting";
                updateNotification("Reconnecting…");
            } else if (state == PeerConnection.IceConnectionState.FAILED
                    || state == PeerConnection.IceConnectionState.CLOSED) {
                endCall("connection_lost");
            }
        }
        @Override public void onIceConnectionReceivingChange(boolean receiving) {}
        @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {}
        @Override public void onIceCandidate(IceCandidate candidate) {
            try {
                JSONObject c = new JSONObject();
                c.put("candidate", candidate.sdp);
                c.put("sdpMid", candidate.sdpMid);
                c.put("sdpMLineIndex", candidate.sdpMLineIndex);
                VoiceLinkApi.post("signal", callId, token,
                    new JSONObject().put("kind", "ice").put("payload", c.toString()));
            } catch (Exception ignored) {}
        }
        @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
        @Override public void onAddStream(MediaStream stream) {}
        @Override public void onRemoveStream(MediaStream stream) {}
        @Override public void onDataChannel(DataChannel channel) {}
        @Override public void onRenegotiationNeeded() {}
        @Override public void onAddTrack(RtpReceiver receiver, MediaStream[] streams) {}
    }

    private static class EmptySdp implements SdpObserver {
        @Override public void onCreateSuccess(SessionDescription sdp) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) {}
        @Override public void onSetFailure(String error) {}
    }

    /* ── Signaling pump (authoritative gateway, token-scoped) ───────────── */

    private void startSignalPolling() {
        executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleWithFixedDelay(this::pollOnce, 300, SIGNAL_POLL_MS, TimeUnit.MILLISECONDS);
    }

    private void pollOnce() {
        if (endedLocally || pc == null) return;
        JSONObject res = VoiceLinkApi.post("poll_signals", callId, token, null);
        if (res == null) return;
        JSONArray signals = res.optJSONArray("signals");
        if (signals == null) return;
        for (int i = 0; i < signals.length(); i++) {
            JSONObject s = signals.optJSONObject(i);
            if (s == null) continue;
            String kind = s.optString("kind");
            try {
                JSONObject payload = new JSONObject(s.optString("payload", "{}"));
                if ("offer".equals(kind)) {
                    handleOffer(payload);
                } else if ("ice".equals(kind)) {
                    handleRemoteIce(payload);
                }
            } catch (Exception e) {
                Log.w(TAG, "Voice Link signal handling failed", e);
            }
        }
    }

    private void handleOffer(JSONObject offer) {
        try {
            SessionDescription remote = new SessionDescription(SessionDescription.Type.OFFER, offer.optString("sdp"));
            pc.setRemoteDescription(new EmptySdp() {
                @Override public void onSetSuccess() {
                    remoteDescriptionSet = true;
                    drainQueuedIce();
                    MediaConstraints constraints = new MediaConstraints();
                    pc.createAnswer(new EmptySdp() {
                        @Override public void onCreateSuccess(SessionDescription answer) {
                            pc.setLocalDescription(new EmptySdp(), answer);
                            try {
                                VoiceLinkApi.post("signal", callId, token,
                                    new JSONObject().put("kind", "answer").put("payload", new JSONObject().put("sdp", answer.description).toString()));
                            } catch (Exception ignored) {}
                        }
                    }, constraints);
                }
            }, remote);
            runOnMain(() -> VoiceLinkCallActivity.onPhaseChanged("connecting"));
        } catch (Exception e) {
            Log.e(TAG, "Voice Link offer handling failed", e);
        }
    }

    private void handleRemoteIce(JSONObject c) {
        try {
            IceCandidate candidate = new IceCandidate(
                c.optString("sdpMid", "0"), c.optInt("sdpMLineIndex", 0), c.optString("candidate"));
            if (remoteDescriptionSet) {
                pc.addIceCandidate(candidate);
            } else {
                synchronized (queuedRemoteIce) { queuedRemoteIce.add(candidate); }
            }
        } catch (Exception ignored) {}
    }

    private void drainQueuedIce() {
        List<IceCandidate> queued;
        synchronized (queuedRemoteIce) {
            queued = new ArrayList<>(queuedRemoteIce);
            queuedRemoteIce.clear();
        }
        for (IceCandidate c : queued) {
            try { pc.addIceCandidate(c); } catch (Exception ignored) {}
        }
    }

    /* ── Controls (bound by VoiceLinkCallActivity) ──────────────────────── */

    public void setMuted(boolean muted) {
        try { if (localAudioTrack != null) localAudioTrack.setEnabled(!muted); } catch (Exception ignored) {}
    }

    public boolean isSpeakerOn() {
        try { return audioManager != null && audioManager.isSpeakerphoneOn(); } catch (Exception e) { return false; }
    }

    public void setSpeaker(boolean on) {
        try { if (audioManager != null) audioManager.setSpeakerphoneOn(on); } catch (Exception ignored) {}
    }

    public void endCall(String reason) {
        if (endedLocally) return;
        endedLocally = true;
        phase = "ended";
        new Thread(() -> VoiceLinkApi.post("hangup", callId, token,
            new JSONObject() {{
                try { put("reason", reason); } catch (Exception ignored) {}
            }})).start();
        stopSelf();
    }

    private void fail(String reason) {
        phase = "ended";
        endedLocally = true;
        stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        if (executor != null) try { executor.shutdownNow(); } catch (Exception ignored) {}
        try { if (pc != null) pc.close(); } catch (Exception ignored) {}
        pc = null;
        try { if (localAudioTrack != null) localAudioTrack.dispose(); } catch (Exception ignored) {}
        try { if (factory != null) factory.dispose(); } catch (Exception ignored) {}
        factory = null;
        try {
            if (audioManager != null) {
                audioManager.setSpeakerphoneOn(false);
                audioManager.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Exception ignored) {}
        if (callId != null) activeCallId = null;
        Log.d(TAG, "📞 VoiceLinkCallService destroyed");
        super.onDestroy();
    }

    private void runOnMain(Runnable r) {
        new Handler(Looper.getMainLooper()).post(r);
    }
}