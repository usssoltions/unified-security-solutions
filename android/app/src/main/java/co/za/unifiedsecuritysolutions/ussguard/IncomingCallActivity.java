package co.za.unifiedsecuritysolutions.ussguard;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Intent;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.net.URLEncoder;

/**
 * Full-screen incoming call activity.
 *
 * Shown directly over the lock screen with:
 *  - Caller name and initials avatar
 *  - Accept (green) and Decline (red) buttons
 *  - Continuous ringtone until answered or timed out (45s)
 *  - Screen wake + wake lock
 *  - Auto-dismiss on timeout
 */
public class IncomingCallActivity extends Activity {
    private static final String TAG = "USSGuard";
    private static final String APP_URL = "https://guard-track-pro-26cedab8.base44.app";
    private static final int CALL_TIMEOUT_MS = 45000;

    private MediaPlayer mediaPlayer;
    private PowerManager.WakeLock wakeLock;
    private Handler timeoutHandler;
    private Runnable timeoutRunnable;
    private String callId;
    private String callerName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ── Full-screen, show over lock screen, wake screen ──
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
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }

        setContentView(R.layout.activity_incoming_call);

        // ── Get call data from intent ──
        callId = getIntent().getStringExtra("callId");
        callerName = getIntent().getStringExtra("callerName");
        String callerAvatar = getIntent().getStringExtra("callerAvatar");
        boolean isGroupCall = getIntent().getBooleanExtra("isGroupCall", false);

        // ── Set caller name ──
        TextView tvCallerName = findViewById(R.id.tvCallerName);
        if (callerName != null && !callerName.isEmpty()) {
            tvCallerName.setText(callerName);
        } else {
            tvCallerName.setText("Unknown Caller");
        }

        // ── Set subtitle ──
        TextView tvSubtitle = findViewById(R.id.tvSubtitle);
        if (tvSubtitle != null) {
            tvSubtitle.setText(isGroupCall ? "Incoming Group Call..." : "Incoming Call...");
        }

        // ── Set initials avatar ──
        TextView tvInitials = findViewById(R.id.tvInitials);
        if (callerName != null && !callerName.isEmpty()) {
            StringBuilder initials = new StringBuilder();
            for (String part : callerName.trim().split("\\s+")) {
                if (!part.isEmpty()) {
                    initials.append(part.charAt(0));
                }
            }
            String initStr = initials.toString().toUpperCase();
            tvInitials.setText(initStr.length() > 2 ? initStr.substring(0, 2) : initStr);
        } else {
            tvInitials.setText("?");
        }

        // ── Buttons ──
        findViewById(R.id.btnAccept).setOnClickListener(v -> acceptCall());
        findViewById(R.id.btnDecline).setOnClickListener(v -> declineCall());

        // ── Start ringtone + wake lock + timeout ──
        startRingtone();
        acquireWakeLock();
        startTimeout();

        Log.d(TAG, "📞 IncomingCallActivity created — callId: " + callId + ", caller: " + callerName);
    }

    private void startRingtone() {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            am.setMode(AudioManager.MODE_IN_COMMUNICATION);

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
                Log.d(TAG, "📞 Ringtone started (looping)");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to start ringtone", e);
        }
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK,
                "USSGuard:IncomingCall"
            );
            wakeLock.acquire(CALL_TIMEOUT_MS);
            Log.d(TAG, "📞 Wake lock acquired");
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire wake lock", e);
        }
    }

    private void startTimeout() {
        timeoutHandler = new Handler(Looper.getMainLooper());
        timeoutRunnable = () -> {
            Log.d(TAG, "📞 Call timed out — auto-dismissing");
            finish();
        };
        timeoutHandler.postDelayed(timeoutRunnable, CALL_TIMEOUT_MS);
    }

    private void acceptCall() {
        Log.d(TAG, "📞 Call accepted — loading WebView");

        // Set pending URL for MainActivity.onResume() to pick up
        try {
            USSGuardApplication.pendingCallUrl = APP_URL + "/?call_id=" + callId +
                "&caller_name=" + URLEncoder.encode(callerName != null ? callerName : "", "UTF-8");
        } catch (Exception e) {
            USSGuardApplication.pendingCallUrl = APP_URL + "/?call_id=" + callId;
        }

        // Launch MainActivity (brings app to foreground)
        Intent mainIntent = new Intent(this, MainActivity.class);
        mainIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(mainIntent);

        finish();
    }

    private void declineCall() {
        Log.d(TAG, "📞 Call declined");
        finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();

        if (mediaPlayer != null) {
            try {
                mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception e) {}
            mediaPlayer = null;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }

        if (timeoutHandler != null && timeoutRunnable != null) {
            timeoutHandler.removeCallbacks(timeoutRunnable);
        }

        // Restore audio mode
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            am.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception e) {}

        // Cancel the notification
        if (callId != null) {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                nm.cancel(callId.hashCode());
            } catch (Exception e) {}
        }
    }

    @Override
    public void onBackPressed() {
        // Prevent back button from dismissing the call screen
        // User must explicitly tap Decline
    }
}