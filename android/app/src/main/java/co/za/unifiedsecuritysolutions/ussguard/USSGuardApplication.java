package co.za.unifiedsecuritysolutions.ussguard;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.onesignal.OneSignal;
import com.onesignal.notifications.IDisplayableNotification;
import com.onesignal.notifications.INotification;
import com.onesignal.notifications.INotificationClickEvent;
import com.onesignal.notifications.INotificationClickListener;
import com.onesignal.notifications.INotificationLifecycleListener;
import com.onesignal.notifications.INotificationWillDisplayEvent;

import org.json.JSONObject;

import java.net.URLEncoder;

/**
 * USS Guard Application — initializes native OneSignal Android SDK v5 for
 * reliable push notification delivery when the app is minimized or closed.
 */
public class USSGuardApplication extends Application {
    private static final String TAG = "USSGuard";
    private static final String ONESIGNAL_APP_ID = "526d4393-9f50-4f8e-8379-05ec176dc62d";
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
            Log.d(TAG, "Call notification channel created (IMPORTANCE_HIGH)");
        }
    }

    /**
     * Initializes OneSignal Android SDK v5 for native push delivery.
     * - Uses the v5 init API: OneSignal.initWithContext(context, appId)
     * - Uses INotificationLifecycleListener for foreground notification handling
     * - Uses INotificationClickListener for notification click handling
     */
    private void initOneSignal() {
        try {
            // OneSignal v5 initialization — single call with app ID
            OneSignal.initWithContext(this, ONESIGNAL_APP_ID);

            // v5 foreground lifecycle listener — intercept notifications to show full-screen call UI
            OneSignal.getNotifications().addForegroundLifecycleListener(
                new INotificationLifecycleListener() {
                    @Override
                    public void onWillDisplay(INotificationWillDisplayEvent event) {
                        try {
                            IDisplayableNotification notification = event.getNotification();
                            JSONObject data = notification.getAdditionalData();

                            if (data != null && "call".equals(data.optString("type"))) {
                                // Call notification — show our own full-screen call UI
                                String callId = data.optString("callId");
                                String callerName = data.optString("callerName");
                                String callerAvatar = data.optString("callerAvatar", "");
                                boolean isGroupCall = data.optBoolean("isGroupCall", false);

                                showFullScreenCallNotification(callId, callerName, callerAvatar, isGroupCall);

                                // Prevent OneSignal from showing its default notification
                                event.preventDefault();
                            } else {
                                // Non-call notification — display normally via v5 API
                                notification.display();
                                Log.d(TAG, "Notification displayed (foreground)");
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error in foreground lifecycle listener", e);
                            // Fallback: display the notification
                            try { event.getNotification().display(); } catch (Exception ignored) {}
                        }
                    }
                }
            );

            // v5 click listener — extract call data and open call screen
            OneSignal.getNotifications().addClickListener(
                new INotificationClickListener() {
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
                                Log.d(TAG, "Call notification clicked — pending URL: " + url);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error handling notification click", e);
                        }
                    }
                }
            );

            Log.d(TAG, "OneSignal v5 initialized — native push ready");
        } catch (Exception e) {
            Log.e(TAG, "Failed to initialize OneSignal", e);
        }
    }

    /**
     * Posts a high-priority notification with a full-screen intent that
     * launches IncomingCallActivity.
     *
     * On locked screen / background (Android < 14): the system shows the
     * full-screen activity immediately.
     * On Android 14+: requires USE_FULL_SCREEN_INTENT permission; falls back
     * to heads-up notification if not granted.
     */
    private void showFullScreenCallNotification(String callId, String callerName,
                                                 String callerAvatar, boolean isGroupCall) {
        try {
            Intent callIntent = new Intent(this, IncomingCallActivity.class);
            callIntent.putExtra("callId", callId);
            callIntent.putExtra("callerName", callerName);
            callIntent.putExtra("callerAvatar", callerAvatar);
            callIntent.putExtra("isGroupCall", isGroupCall);
            callIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            // FLAG_IMMUTABLE is required on API 31+ and available since API 23
            int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

            PendingIntent fullScreenIntent = PendingIntent.getActivity(
                this, callId.hashCode(), callIntent, pendingIntentFlags
            );

            // Use NotificationCompat for cross-API compatibility
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, "calls")
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("Incoming Call")
                .setContentText(callerName != null ? callerName : "Unknown Caller")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(fullScreenIntent)
                .setFullScreenIntent(fullScreenIntent, true)
                .setOngoing(true)
                .setTimeoutAfter(45000)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

            // On Android 14+ check if full-screen intent is permitted
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                if (!nm.canUseFullScreenIntent()) {
                    Log.w(TAG, "Full-screen intent not permitted on Android 14+ — " +
                        "user must grant permission in Settings");
                }
            }

            nm.notify(callId.hashCode(), builder.build());

            Log.d(TAG, "Call notification posted — callId: " + callId
                + ", caller: " + callerName);
        } catch (Exception e) {
            Log.e(TAG, "Failed to post call notification", e);
        }
    }

    /**
     * Sets the OneSignal external user ID so the backend can send pushes
     * to all of the user's devices via include_external_user_ids.
     * Called from the JavaScript bridge when the web app authenticates.
     */
    public static void setExternalId(String userId) {
        try {
            OneSignal.login(userId);
            Log.d(TAG, "OneSignal external ID set: " + userId);
        } catch (Exception e) {
            Log.e(TAG, "Failed to set external ID", e);
        }
    }

    /**
     * Returns the OneSignal subscription ID for the current device.
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