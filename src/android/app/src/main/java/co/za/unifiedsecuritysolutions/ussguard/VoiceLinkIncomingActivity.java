package co.za.unifiedsecuritysolutions.ussguard;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * USS VOICE LINK (pilot) — native incoming-call screen.
 *
 * Completely separate from the legacy IncomingCallActivity: legacy push data
 * (type "call") never opens this screen and Voice Link push data (type
 * "voicelink_call") never opens the legacy screen.
 *
 * ANSWER IS A REAL ANSWER: the gateway 'accept' action claims the call
 * atomically (a claim lost to another device or a terminated call returns
 * without any call UI), then the native WebRTC engine service starts and
 * audio connects directly — no web page, no second press.
 *
 * Every open VALIDATES the call against the server (state action), so a stale
 * or ended call's notification can never reopen a ringing screen.
 */
public class VoiceLinkIncomingActivity extends Activity {
    private static final String TAG = "USSGuard";
    private static final long RING_TIMEOUT_MS = 45000;

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private Handler timeoutHandler;
    private Runnable timeoutRunnable;
    private volatile boolean settled = false;

    private String callId;
    private String callerName;
    private String token;

    /** Static handle so a call-state push can dismiss a stale ringing screen. */
    public static volatile VoiceLinkIncomingActivity showingInstance;
    public static volatile String showingCallId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }

        setContentView(R.layout.activity_voicelink_incoming);

        callId = getIntent().getStringExtra("callId");
        callerName = getIntent().getStringExtra("callerName");
        token = getIntent().getStringExtra("token");

        TextView tvName = findViewById(R.id.vlTvCallerName);
        TextView tvInitials = findViewById(R.id.vlTvInitials);
        if (callerName != null && !callerName.isEmpty()) {
            tvName.setText(callerName);
            StringBuilder initials = new StringBuilder();
            for (String part : callerName.trim().split("\\s+")) {
                if (!part.isEmpty()) initials.append(part.charAt(0));
            }
            String init = initials.toString().toUpperCase();
            tvInitials.setText(init.length() > 2 ? init.substring(0, 2) : init);
        } else {
            tvName.setText("Unknown Caller");
            tvInitials.setText("?");
        }

        ImageButton accept = findViewById(R.id.vlBtnAccept);
        ImageButton decline = findViewById(R.id.vlBtnDecline);
        accept.setOnClickListener(v -> acceptCall());
        decline.setOnClickListener(v -> declineCall());

        // Validate FIRST — stale or ended calls never ring.
        new Thread(() -> {
            JSONObject res = VoiceLinkApi.post("state", callId, token, null);
            JSONObject call = res == null ? null : res.optJSONObject("call");
            String status = call == null ? "ended" : call.optString("status", "ended");
            if (!"ringing".equals(status)) {
                Log.w(TAG, "📞 Voice Link stale/ended call open refused: " + status);
                runOnUiThread(this::finish);
            } else {
                runOnUiThread(() -> {
                    startRinging();
                    showingInstance = this;
                    showingCallId = callId;
                    startTimeout();
                });
            }
        }).start();

        Log.d(TAG, "📞 VoiceLinkIncomingActivity created — call: " + callId);
    }

    private void startRinging() {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            am.setMode(AudioManager.MODE_RINGTONE);
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            if (ringtoneUri != null) {
                mediaPlayer = new MediaPlayer();
                mediaPlayer.setDataSource(this, ringtoneUri);
                mediaPlayer.setAudioStreamType(AudioManager.STREAM_RING);
                mediaPlayer.setLooping(true);
                mediaPlayer.prepare();
                mediaPlayer.start();
            }
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 500, 200, 500, 200, 500};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Voice Link ring failed", e);
        }
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "USSGuard:VoiceLinkIncoming");
            wakeLock.acquire(RING_TIMEOUT_MS);
        } catch (Exception ignored) {}
    }

    private void startTimeout() {
        timeoutHandler = new Handler(Looper.getMainLooper());
        timeoutRunnable = () -> {
            Log.d(TAG, "📞 Voice Link ring timed out — the server records 'missed'");
            finish();
        };
        timeoutHandler.postDelayed(timeoutRunnable, RING_TIMEOUT_MS);
    }

    private void acceptCall() {
        if (settled) return;
        settled = true;
        stopRingtoneOnly();
        final Activity activity = this;
        new Thread(() -> {
            String deviceId = "and-" + Settings.Secure.getString(getContentResolver(), Settings.Secure.ANDROID_ID);
            JSONObject extra = new JSONObject();
            try { extra.put("device_id", deviceId); } catch (Exception ignored) {}
            JSONObject res = VoiceLinkApi.post("accept", callId, token, extra);
            if (res != null && res.optBoolean("accepted", false)) {
                // Real connection: the native WebRTC engine starts now.
                Intent service = new Intent(activity, VoiceLinkCallService.class);
                service.putExtra("callId", callId);
                service.putExtra("token", token);
                service.putExtra("peerName", callerName);
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(service);
                    } else {
                        startService(service);
                    }
                    Intent ui = new Intent(activity, VoiceLinkCallActivity.class);
                    ui.putExtra("callId", callId);
                    ui.putExtra("peerName", callerName);
                    startActivity(ui);
                } catch (Exception e) {
                    Log.e(TAG, "Voice Link call UI failed", e);
                    VoiceLinkApi.post("hangup", callId, token, null);
                }
            } else {
                Log.w(TAG, "📞 Voice Link accept lost the claim (answered elsewhere or call gone)");
            }
            runOnUiThread(this::finish);
        }).start();
    }

    private void declineCall() {
        if (settled) return;
        settled = true;
        final Activity activity = this;
        new Thread(() -> {
            VoiceLinkApi.post("decline", callId, token, null);
            runOnUiThread(this::finish);
        }).start();
    }

    private void stopRingtoneOnly() {
        if (timeoutHandler != null && timeoutRunnable != null) timeoutHandler.removeCallbacks(timeoutRunnable);
        if (mediaPlayer != null) {
            try { mediaPlayer.stop(); mediaPlayer.release(); } catch (Exception ignored) {}
            mediaPlayer = null;
        }
        if (vibrator != null) { try { vibrator.cancel(); } catch (Exception ignored) {} vibrator = null; }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    /** Called by the Application class when a call-state push ends this call. */
    public static void dismissIfShowing(String endedCallId) {
        VoiceLinkIncomingActivity inst = showingInstance;
        if (inst != null && endedCallId != null && endedCallId.equals(showingCallId)) {
            inst.runOnUiThread(() -> inst.finish());
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopRingtoneOnly();
        if (showingInstance == this) { showingInstance = null; showingCallId = null; }
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            am.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception ignored) {}
        if (callId != null) {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                nm.cancel(callId.hashCode());
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onBackPressed() {
        // Back must not dismiss the ring screen — Decline is explicit.
    }
}