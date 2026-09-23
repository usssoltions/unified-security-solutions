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
    /** Dedicated Stay Awake channel — created ONCE per install (idempotent by
     *  channel id). Android keeps the user-controlled importance afterwards;
     *  the channel is never recreated or renamed at launch. */
    private static final String STAY_AWAKE_CHANNEL_ID = "stay_awake_alerts";

    /** Set by the notification click handler; consumed by MainActivity.onResume() */
    public static String pendingCallUrl = null;

    /** Set by the Stay Awake display handler; consumed by MainActivity.onResume() */
    public static String pendingStayAwakeUrl = null;

    @Override
    public void onCreate() {
        super.onCreate();
        createCallNotificationChannel();
        createStayAwakeNotificationChannel();
        initOneSignal();
    }

    /**
     * Dedicated Stay Awake channel: high importance, vibration, notification
     * sound, lock-screen public visibility. LIMITATION: Base44's native push
     * API (SendPushNotification) cannot select an Android channel, so this
     * channel plus the foreground display interception in initOneSignal() is
     * the supported mapping; background pushes display on the provider's
     * default channel (verified in the physical device test).
     */
    private void createStayAwakeNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                STAY_AWAKE_CHANNEL_ID,
                "Stay Awake Alerts",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Urgent on-duty fatigue-check prompts from the control room");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 200, 500});
            channel.setSound(android.media.RingtoneManager.getDefaultUri(
                android.media.RingtoneManager.TYPE_NOTIFICATION), null);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channel.enableLights(true);
            channel.setLightColor(0xFFF43F5E);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
            Log.d(TAG, "Stay Awake notification channel created (IMPORTANCE_HIGH)");
        }
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
                            } else if (isStayAwakeNotification(notification)) {
                                // Stay Awake prompt — Base44 native push cannot select an
                                // Android channel, so display it manually on the dedicated
                                // stay_awake_alerts channel. The deep link carries ONLY the
                                // opaque challenge id; the app resolves it through the
                                // authorized gateway after opening.
                                String deepLink = extractStayAwakeDeepLink(notification);
                                postStayAwakeNotification(deepLink);
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

    /** A Stay Awake prompt is detected by its deep link (challenge=) or its title. */
    private boolean isStayAwakeNotification(IDisplayableNotification notification) {
        try {
            JSONObject data = notification.getAdditionalData();
            if (data != null) {
                String url = data.optString("action_url",
                    data.optString("actionUrl", data.optString("url", "")));
                if (url.contains("challenge=")) return true;
            }
            String title = notification.getTitle();
            return title != null && title.contains("Stay Awake");
        } catch (Exception e) {
            return false;
        }
    }

    /** The deep link from the push data, if present (challenge id only). */
    private String extractStayAwakeDeepLink(IDisplayableNotification notification) {
        try {
            JSONObject data = notification.getAdditionalData();
            if (data != null) {
                String url = data.optString("action_url",
                    data.optString("actionUrl", data.optString("url", "")));
                if (url.startsWith("/") && url.contains("challenge=")) return url;
            }
        } catch (Exception ignored) {}
        return "/GuardShift";
    }

    /**
     * Posts the Stay Awake prompt on the dedicated stay_awake_alerts channel
     * and stages the deep link for MainActivity.onResume() so the WebView
     * opens the challenge route. Call notifications keep their own separate
     * channel ("calls") — this path never touches it.
     */
    private void postStayAwakeNotification(String deepLink) {
        try {
            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
            PendingIntent contentIntent = PendingIntent.getActivity(
                this, "stayawake".hashCode(), open, piFlags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, STAY_AWAKE_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle("⚡ Stay Awake Check")
                .setContentText("Confirm you are alert now — tap to respond.")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setVibrate(new long[]{0, 500, 200, 500})
                .setContentIntent(contentIntent);

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify("stayawake".hashCode(), builder.build());

            pendingStayAwakeUrl = APP_URL + deepLink;
            Log.d(TAG, "Stay Awake notification posted on " + STAY_AWAKE_CHANNEL_ID);
        } catch (Exception e) {
            Log.e(TAG, "Failed to post Stay Awake notification", e);
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