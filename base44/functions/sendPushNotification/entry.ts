/**
 * sendPushNotification
 * Sends real OneSignal push notifications to specific users by ID.
 * Also creates in-app Alert records as fallback.
 * Called by: generateScheduledPatrols (patrol alerts), shift reminders, etc.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    const { user_ids, title, body, priority, data } = await req.json();

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return Response.json({ error: 'user_ids array is required' }, { status: 400 });
    }
    if (!title || !body) {
      return Response.json({ error: 'title and body are required' }, { status: 400 });
    }

    // Fetch target users (service role — no auth restriction, called by automations)
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const targets = allUsers.filter(u => user_ids.includes(u.id));

    if (targets.length === 0) {
      return Response.json({ success: false, message: 'No matching users found' });
    }

    // 1. Create in-app Alert records for all targets
    await Promise.all(targets.map(u =>
      base44.asServiceRole.entities.Alert.create({
        type: data?.type || 'system',
        priority: priority || 'medium',
        title,
        message: body,
        guard_id: u.id,
        guard_name: u.full_name,
        status: 'active',
        metadata: data,
      }).catch(() => {})
    ));

    // 2. Also create Notification records (in-app notification centre)
    await Promise.all(targets.map(u =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: u.id,
        recipient_name: u.full_name,
        type: data?.type || 'system',
        priority: priority || 'medium',
        title,
        message: body,
        read: false,
        sent_via: ['in_app'],
      }).catch(() => {})
    ));

    // 3. Send real OneSignal push to subscribed devices
    let pushResult = { skipped: 'OneSignal not configured' };

    if (ONESIGNAL_APP_ID && ONESIGNAL_API_KEY) {
      const playerIds = targets
        .map(u => u.onesignal_player_id)
        .filter(Boolean);

      if (playerIds.length > 0) {
        const isCritical = priority === 'critical' || data?.type === 'panic';
        const resp = await fetch('https://onesignal.com/api/v1/notifications', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${ONESIGNAL_API_KEY}`,
          },
          body: JSON.stringify({
            app_id: ONESIGNAL_APP_ID,
            include_player_ids: playerIds,
            headings: { en: title },
            contents: { en: body },
            priority: isCritical ? 10 : 5,
            ttl: isCritical ? 0 : 3600,
            android_channel_id: isCritical ? 'emergency' : 'default',
            android_visibility: 1,
            data: {
              type: data?.type || 'system',
              ...data,
            },
          }),
        });
        pushResult = await resp.json();
      } else {
        pushResult = { skipped: 'No subscribed devices for these users' };
      }
    }

    return Response.json({
      success: true,
      inAppAlerts: targets.length,
      push: pushResult,
    });

  } catch (error) {
    console.error('sendPushNotification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});