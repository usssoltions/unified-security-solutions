import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const { recipientId, callerName, callId, isGroupCall } = await req.json();

    if (!recipientId || !callerName) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Send OneSignal push notification
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      console.warn('OneSignal not configured');
      return Response.json({ 
        success: false, 
        message: 'OneSignal not configured' 
      });
    }

    const recipient = await base44.asServiceRole.entities.User.get(recipientId);
    
    if (!recipient || !recipient.onesignal_player_id) {
      return Response.json({ 
        success: false, 
        message: 'Recipient not subscribed to push' 
      });
    }

    // Send high-priority push notification
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_player_ids: [recipient.onesignal_player_id],
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
        url: `${Deno.env.get('BASE44_APP_URL') || 'https://app.base44.ai'}?call_id=${callId}&caller_name=${encodeURIComponent(callerName)}`,
        web_url: `${Deno.env.get('BASE44_APP_URL') || 'https://app.base44.ai'}?call_id=${callId}&caller_name=${encodeURIComponent(callerName)}`,
        data: {
          type: 'call',
          callId: callId,
          callerName: callerName,
          isGroupCall: isGroupCall
        }
      })
    });

    const result = await response.json();

    return Response.json({ 
      success: true,
      onesignal_response: result
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});