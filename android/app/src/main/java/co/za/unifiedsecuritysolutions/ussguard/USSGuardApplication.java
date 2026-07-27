package co.za.unifiedsecuritysolutions.ussguard;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.util.Log;

import com.onesignal.OneSignal;
import com.onesignal.notifications.INotification;
import com.onesignal.notifications.INotificationClickEvent;
import com.onesignal.notifications.INotificationClickHandler;
import com.onesignal.notifications.INotificationWillDisplayEvent;
import com.onesignal.notifications.INotificationWillDisplayHandler;

import org.json.JSONObject;

import java.net.URLEncoder;

/**
 * USS Guard Application — initializes native OneSignal Android SDK for
 * reliable push notification delivery when the app is minimized or closed.
 *
 * This replaces reliance on the OneSignal Web SDK / browser service worker
 * inside the WebView, which does not work reliably when the WebView is
 * suspended or the app process is killed.
 */
public class USSGuardApplication extends Application {
    private static final String TAG = "USSGuard";
    private static final String ONESIGNAL_APP_ID = "efd5b25f-e103-4aca-bc00-2b010194fdb9";
    private static final String APP_URL = "https://guard-track-pro-26cedab8.base44.app";

    /** Set by the notification click handler; consumed by MainActivity.onResume() */
    public static String pendingCallUrl = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createCallNotificationChannel();
        initOneSignal();
    }

    /**
     * Creates a high-priority notification channel for incoming calls.
     * The channel ID "calls" matches the android_channel_id sent by the backend.
     */
    private void createCallNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                "calls",
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Incoming voice call notifications");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500});
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channel.enableLights(true);
            channel.setLightColor(0xFF10B981);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
            Log.d(TAG, "✅ Call notification channel created (IMPORTANCE_HIGH)");
        }
    }

    /**
     * Initializes OneSignal Android SDK for native push delivery.
     * - Shows notifications even when app is in foreground
     * - Handles notification clicks to open the incoming call screen
     */
    private void initOneSignal() {
        try {
            OneSignal.initWithContext(this);
            OneSignal.setAppId(ONESIGNAL_APP_ID);

            // Show notifications even when app is in foreground
            OneSignal.getNotifications().addForegroundWillDisplayHandler(
                new INotificationWillDisplayHandler() {
                    @Override
                    public void onNotificationWillDisplay(INotificationWillDisplayEvent event) {
                        event.getNotification().show();
                        Log.d(TAG, "📨 Notification displayed (foreground)");
                    }
                }
            );

            // Handle notification clicks — extract call data and open call screen
            OneSignal.getNotifications().addClickHandler(
                new INotificationClickHandler() {
                    @Override
                    public void onClick(INotificationClickEvent event) {
                        try {
                            INotification notification = event.getNotification();
                            JSONObject data = notification.getAdditionalData();
                            if (data != null && "call".equals(data.optString("type"))) {
                                String callId = data.optString("callId");
                                String callerName = data.optString("callerName");
                                String url = APP_URL + "/?call_id=" + callId +
                                    "&caller_name=" + URLEncoder.encode(callerName, "UTF-8");
                                pendingCallUrl = url;
                                Log.d(TAG, "📞 Call notification clicked — pending URL: " + url);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error handling notification click", e);
                        }
                    }
                }
            );

            Log.d(TAG, "✅ OneSignal initialized — native push ready");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to initialize OneSignal", e);
        }
    }

    /**
     * Sets the OneSignal external user ID so the backend can send pushes
     * to all of the user's devices (Android + web) via include_external_user_ids.
     * Called from the JavaScript bridge when the web app authenticates.
     */
    public static void setExternalId(String userId) {
        try {
            OneSignal.login(userId);
            Log.d(TAG, "✅ OneSignal external ID set: " + userId);
        } catch (Exception e) {
            Log.e(TAG, "Failed to set external ID", e);
        }
    }

    /**
     * Returns the OneSignal player/subscription ID for the current device.
     */
    public static String getOneSignalPlayerId() {
        try {
            return OneSignal.getUser().getPushSubscription().getId();
        } catch (Exception e) {
            Log.w(TAG, "Could not get OneSignal player ID: " + e.getMessage());
            return null;
        }
    }
}