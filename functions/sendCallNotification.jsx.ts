import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data } = await req.json();
    const { targetUserId, callerName, callId, callType } = data;

    // Get target user's push subscription
    const targetUser = await base44.asServiceRole.entities.User.get(targetUserId);
    
    if (!targetUser?.push_subscription) {
      return Response.json({ error: 'No push subscription found' }, { status: 400 });
    }

    // Send push notification
    const pushSubscription = JSON.parse(targetUser.push_subscription);
    
    const payload = JSON.stringify({
      title: '📞 Incoming Voice Call',
      body: `${callerName} is calling you`,
      icon: '/logo.png',
      badge: '/logo.png',
      tag: `call-${callId}`,
      requireInteraction: true,
      vibrate: [400, 200, 400, 200, 400, 200, 400],
      silent: false,
      data: {
        type: 'incoming_call',
        callId: callId,
        callerId: user.id,
        callerName: callerName,
        callType: callType || 'direct',
        timestamp: Date.now()
      },
      actions: [
        { action: 'answer', title: '✅ Answer' },
        { action: 'decline', title: '❌ Decline' }
      ]
    });

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const vapidSubject = 'mailto:admin@secureguard.app';

    // Use web-push library
    const webpush = await import('npm:web-push@3.6.7');
    
    webpush.setVapidDetails(
      vapidSubject,
      vapidPublicKey,
      vapidPrivateKey
    );

    await webpush.sendNotification(pushSubscription, payload);

    // Also create in-app notification as backup
    await base44.asServiceRole.entities.Notification.create({
      recipient_id: targetUserId,
      recipient_name: targetUser.full_name,
      type: 'system',
      priority: 'critical',
      title: 'Incoming Call',
      message: `${callerName} is calling you`,
      related_entity: 'voice_call',
      related_id: callId
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error sending call notification:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});