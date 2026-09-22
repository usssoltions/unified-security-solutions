import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * sendCallPushNotification — push leg of the incoming-call flow.
 *
 * PROVIDER DECISION: OneSignal is the DELIBERATELY SUPPORTED provider for
 * CALL pushes (include_external_user_ids reaches every device the recipient
 * has logged into OneSignal on, including the native Android app). The rest
 * of the app uses native push, but native push for calls requires the
 * Android Firebase credentials still pending upload — OneSignal remains
 * authoritative for CALL pushes until that migration is complete.
 *
 * Caller identity is resolved server-side from the authenticated User
 * record (impersonation fix), and the recipient must belong to the
 * caller's own tenant (call membership validation).
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only a logged-in user may trigger a call push.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recipientId, callId, isGroupCall, callerAvatar } = await req.json();

    // CALLER IDENTITY IS RESOLVED SERVER-SIDE — the browser-supplied caller
    // name is never trusted (impersonation fix): the push always carries the
    // authenticated caller's authoritative name from their User record.
    const callerRows = await base44.asServiceRole.entities.User.filter({ id: String(user.id) }).catch(() => []);
    const callerRec = callerRows?.[0] || null;
    const callerName = callerRec?.display_name || callerRec?.full_name || user.full_name || 'Unknown';

    console.log(`[sendCallPushNotification] Sending push — callId: ${callId}, caller: ${callerName}, recipient: ${recipientId}`);

    if (!recipientId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // CALL MEMBERSHIP — the recipient must be in the caller's own tenant
    // (platform oversight excepted); sequential User IDs were previously
    // pushable by anyone, enabling cross-tenant ring spam.
    const targetRec = await base44.asServiceRole.entities.User.get(recipientId).catch(() => null);
    if (!targetRec) {
      return Response.json({ error: 'Recipient not found' }, { status: 404 });
    }
    const isPlatform = (u) => !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
    if (!isPlatform(callerRec) && !(callerRec?.customer_id && targetRec.customer_id === callerRec.customer_id)) {
      return Response.json({ error: 'Forbidden — calls are limited to your own organisation' }, { status: 403 });
    }

    // Send OneSignal push notification
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      console.warn('[sendCallPushNotification] OneSignal not configured');
      return Response.json({ 
        success: false, 
        message: 'OneSignal not configured' 
      });
    }

    // Use include_external_user_ids so the push reaches ALL of the recipient's
    // devices (Android native SDK + web SDK) without needing to track player IDs.
    // The app sets the external ID via OneSignal.login(userId) on both platforms.
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_external_user_ids: [recipientId],
        headings: { en: "📞 Incoming Call" },
        contents: { 
          en: isGroupCall 
            ? `${callerName} is calling (Group Call)` 
            : `${callerName} is calling you`
        },
        priority: 10,
        ttl: 30,
        android_channel_id: 'calls',
        android_visibility: 1,
        android_importance: 5,
        android_sound: 'default',
        android_accent_color: 'FF10B981',
        android_led_color: 'FF10B981',
        android_group: 'calls',
        android_group_message: {
          en: "Incoming calls"
        },
        content_available: true,
        mutable_content: true,
        ios_sound: 'default',
        ios_badgeType: 'Increase',
        ios_badgeCount: 1,
        ios_category: 'call',
        apns_alert: {
          title: "📞 Incoming Call",
          subtitle: isGroupCall ? "Group Call" : "Direct Call"
        },
        url: `https://guard-track-pro-26cedab8.base44.app/?call_id=${callId}&caller_name=${encodeURIComponent(callerName)}`,
        web_url: `https://guard-track-pro-26cedab8.base44.app/?call_id=${callId}&caller_name=${encodeURIComponent(callerName)}`,
        data: {
          type: 'call',
          callId: callId,
          callerName: callerName,
          callerAvatar: callerAvatar || '',
          isGroupCall: isGroupCall
        }
      })
    });

    const result = await response.json();
    console.log(`[sendCallPushNotification] ✅ OneSignal response:`, JSON.stringify(result));

    return Response.json({ 
      success: true,
      onesignal_response: result
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});