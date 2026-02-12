import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user || user.role_type !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { title, message, playerId } = await req.json();

    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      return Response.json({ 
        success: false, 
        error: 'OneSignal not configured - check secrets' 
      });
    }

    if (!playerId) {
      return Response.json({ 
        success: false, 
        error: 'No player ID - user not subscribed' 
      });
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_player_ids: [playerId],
        headings: { en: title || "Test Notification" },
        contents: { en: message || "This is a test" },
        data: {
          type: 'test',
          timestamp: new Date().toISOString()
        }
      })
    });

    const result = await response.json();

    if (result.errors) {
      return Response.json({ 
        success: false, 
        error: result.errors[0] || 'Unknown error',
        details: result
      });
    }

    return Response.json({ 
      success: true,
      recipients: result.recipients || 1,
      onesignal_response: result
    });

  } catch (error) {
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});