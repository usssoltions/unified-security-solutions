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

    // Get target user
    const targetUser = await base44.asServiceRole.entities.User.get(targetUserId);
    
    // Create in-app notification with critical priority
    await base44.asServiceRole.entities.Notification.create({
      recipient_id: targetUserId,
      recipient_name: targetUser.full_name,
      type: 'system',
      priority: 'critical',
      title: 'Incoming Call 📞',
      message: `${callerName} is calling you. Tap to answer.`,
      related_entity: 'voice_call',
      related_id: callId,
      action_url: `Contacts?incoming_call=${callId}&caller_id=${user.id}&caller_name=${encodeURIComponent(callerName)}`
    });
    
    // Try to send push notification if supported
    if (targetUser?.push_subscription) {
      try {
        const pushSubscription = JSON.parse(targetUser.push_subscription);
        
        const payload = JSON.stringify({
          title: '📞 Incoming Call',
          body: `${callerName} is calling you - Tap to answer`,
          tag: 'incoming-call-' + callId,
          requireInteraction: true, // Keep notification visible
          vibrate: [500, 100, 500, 100, 500],
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          data: {
            callId: callId,
            callerId: user.id,
            callerName: callerName,
            callType: callType || 'direct',
            url: `/Contacts?incoming_call=${callId}&caller_id=${user.id}&caller_name=${encodeURIComponent(callerName)}&auto_answer=false`
          },
          actions: [
            { action: 'answer', title: '📞 Answer' },
            { action: 'decline', title: '❌ Decline' }
          ]
        });

        const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
        const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
        const vapidSubject = 'mailto:admin@secureguard.app';

        if (vapidPublicKey && vapidPrivateKey) {
          const webpush = await import('npm:web-push@3.6.7');
          
          webpush.setVapidDetails(
            vapidSubject,
            vapidPublicKey,
            vapidPrivateKey
          );

          await webpush.sendNotification(pushSubscription, payload, {
            TTL: 60,
            urgency: 'high'
          });
        }
      } catch (pushError) {
        console.error('Push notification error:', pushError);
        // Continue even if push fails - in-app notification was created
      }
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error sending call notification:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});