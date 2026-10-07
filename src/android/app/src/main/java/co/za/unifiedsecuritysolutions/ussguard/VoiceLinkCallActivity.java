package co.za.unifiedsecuritysolutions.ussguard;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Button;
import android.widget.TextView;

/**
 * USS VOICE LINK (pilot) — in-call controls bound to the native engine
 * service. Mute, speaker/earpiece routing and hang-up. Navigating away (back)
 * finishes ONLY the activity — the foreground service keeps the audio alive
 * with the screen off.
 */
public class VoiceLinkCallActivity extends Activity {
    private static final String TAG = "USSGuard";

    private TextView tvPhase;
    private Button btnMute;
    private Button btnSpeaker;
    private boolean muted = false;
    private boolean speaker = true; // loudspeaker default for security devices
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private Runnable phaseWatcher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_voicelink_call);

        String peerName = getIntent().getStringExtra("peerName");
        TextView tvPeer = findViewById(R.id.vlCallPeerName);
        tvPeer.setText(peerName != null ? peerName : "Call");
        tvPhase = findViewById(R.id.vlCallPhase);
        btnMute = findViewById(R.id.vlBtnMute);
        btnSpeaker = findViewById(R.id.vlBtnSpeaker);
        Button btnEnd = findViewById(R.id.vlBtnEnd);

        // Service-driven routing state wins (this activity may be opened after
        // the service already started, e.g. from its notification).
        VoiceLinkCallService svc = VoiceLinkCallService.instance;
        if (svc != null) speaker = svc.isSpeakerOn();
        btnSpeaker.setText(speaker ? "Speaker: ON" : "Earpiece");

        btnMute.setOnClickListener(v -> {
            muted = !muted;
            btnMute.setText(muted ? "Muted" : "Mute");
            btnMute.setAlpha(muted ? 0.55f : 1f);
            VoiceLinkCallService s = VoiceLinkCallService.instance;
            if (s != null) s.setMuted(muted);
        });

        btnSpeaker.setOnClickListener(v -> {
            speaker = !speaker;
            btnSpeaker.setText(speaker ? "Speaker: ON" : "Earpiece");
            VoiceLinkCallService s = VoiceLinkCallService.instance;
            if (s != null) s.setSpeaker(speaker);
        });

        btnEnd.setOnClickListener(v -> {
            VoiceLinkCallService s = VoiceLinkCallService.instance;
            if (s != null) s.endCall("hangup");
            finish();
        });

        phaseWatcher = () -> {
            String p = VoiceLinkCallService.phase;
            String text;
            switch (p) {
                case "in_call": text = "Connected"; break;
                case "reconnecting": text = "Reconnecting…"; break;
                case "ended": text = "Call ended"; break;
                default: text = "Connecting…";
            }
            tvPhase.setText(text);
            if ("ended".equals(p)) { finish(); return; }
            uiHandler.postDelayed(phaseWatcher, 500);
        };
        uiHandler.post(phaseWatcher);
    }

    /** Service pushes phase changes here (called on its polling thread). */
    public static void onPhaseChanged(String phase) {
        Log.d(TAG, "📞 Voice Link phase: " + phase);
    }

    @Override
    public void onBackPressed() {
        // Back leaves the call CONNECTED — the foreground service keeps audio.
        finish();
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacks(phaseWatcher);
        super.onDestroy();
    }
}