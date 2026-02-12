import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const { guardName, location, notes } = await req.json();

    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      return Response.json({ 
        success: false, 
        message: 'OneSignal not configured' 
      });
    }

    // Get all admin users with OneSignal IDs
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const adminUsers = allUsers.filter(u => 
      (u.role_type === 'admin' || u.role_type === 'dispatcher' || u.role_type === 'supervisor') &&
      u.onesignal_player_id
    );

    if (adminUsers.length === 0) {
      return Response.json({ 
        success: false, 
        message: 'No admins subscribed to push' 
      });
    }

    const playerIds = adminUsers.map(u => u.onesignal_player_id);

    // Send critical push notification
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_player_ids: playerIds,
        headings: { en: "🚨 PANIC ALERT - IMMEDIATE ACTION REQUIRED" },
        contents: { 
          en: `EMERGENCY: ${guardName} has triggered panic button! Location: ${location?.lat}, ${location?.lng}` 
        },
        priority: 10,
        ttl: 0,
        android_channel_id: 'emergency',
        android_visibility: 1,
        android_led_color: 'FFFF0000',
        android_accent_color: 'FFDC2626',
        big_picture: 'https://via.placeholder.com/1024x512/dc2626/ffffff?text=PANIC+ALERT',
        data: {
          type: 'panic',
          guardName: guardName,
          lat: location?.lat,
          lng: location?.lng,
          notes: notes || '',
          timestamp: new Date().toISOString()
        }
      })
    });

    const result = await response.json();

    return Response.json({ 
      success: true,
      sentTo: playerIds.length,
      onesignal_response: result
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});