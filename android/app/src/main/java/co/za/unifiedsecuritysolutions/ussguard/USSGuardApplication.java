package co.za.unifiedsecuritysolutions.ussguard;

import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
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

            // Intercept notifications — show full-screen UI for calls
            OneSignal.getNotifications().addForegroundWillDisplayHandler(
                new INotificationWillDisplayHandler() {
                    @Override
                    public void onNotificationWillDisplay(INotificationWillDisplayEvent event) {
                        INotification notification = event.getNotification();
                        JSONObject data = notification.getAdditionalData();

                        if (data != null && "call".equals(data.optString("type"))) {
                            // It's a call notification — show full-screen call UI
                            String callId = data.optString("callId");
                            String callerName = data.optString("callerName");
                            String callerAvatar = data.optString("callerAvatar", "");
                            boolean isGroupCall = data.optBoolean("isGroupCall", false);

                            showFullScreenCallNotification(callId, callerName, callerAvatar, isGroupCall);

                            // Don't call event.getNotification().show() — we've posted our own
                        } else {
                            // Non-call notification — show normally
                            event.getNotification().show();
                            Log.d(TAG, "📨 Notification displayed (foreground)");
                        }
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
     * Posts a full-screen call notification that launches IncomingCallActivity.
     * On locked screen / background: the system shows the full-screen activity.
     * On foreground: shows as a heads-up notification (Android standard behavior).
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

            int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pendingIntentFlags |= PendingIntent.FLAG_IMMUTABLE;
            }

            PendingIntent fullScreenIntent = PendingIntent.getActivity(
                this, callId.hashCode(), callIntent, pendingIntentFlags
            );

            Notification.Builder builder = new Notification.Builder(this, "calls")
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("Incoming Call")
                .setContentText(callerName != null ? callerName : "Unknown Caller")
                .setPriority(Notification.PRIORITY_MAX)
                .setCategory(Notification.CATEGORY_CALL)
                .setContentIntent(fullScreenIntent)
                .setFullScreenIntent(fullScreenIntent, true)
                .setOngoing(true)
                .setTimeoutAfter(45000);

            // Use CallStyle on Android 12+ for the native call look
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Notification.CallStyle callStyle = new Notification.CallStyle()
                    .setIsIncoming(true)
                    .setCaller(callerName != null ? callerName : "Unknown");
                builder.setStyle(callStyle);
            }

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(callId.hashCode(), builder.build());

            Log.d(TAG, "📞 Full-screen call notification posted — callId: " + callId
                + ", caller: " + callerName);
        } catch (Exception e) {
            Log.e(TAG, "Failed to post full-screen call notification", e);
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