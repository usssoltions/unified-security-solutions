import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data } = await req.json();
    const { targetUserId, callId, callType } = data;

    // CALLER IDENTITY — resolved server-side; the browser-supplied caller
    // name is never trusted (impersonation fix).
    const [callerRec] = await base44.asServiceRole.entities.User.filter({ id: String(user.id) }).catch(() => []);
    const callerName = callerRec?.display_name || callerRec?.full_name || user.full_name || 'Unknown';

    // CALL MEMBERSHIP — the target must be in the caller's own tenant
    // (platform oversight excepted); sequential User IDs were previously
    // callable by anyone.
    if (!targetUserId) {
      return Response.json({ error: 'Missing targetUserId' }, { status: 400 });
    }
    const targetUser = await base44.asServiceRole.entities.User.get(targetUserId).catch(() => null);
    if (!targetUser) {
      return Response.json({ error: 'Target user not found' }, { status: 404 });
    }
    const isPlatform = (u) => !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
    if (!isPlatform(callerRec) && !(callerRec?.customer_id && targetUser.customer_id === callerRec.customer_id)) {
      return Response.json({ error: 'Forbidden — calls are limited to your own organisation' }, { status: 403 });
    }

    console.log(`[sendCallNotification] Creating in-app call notification — callId: ${callId}, caller: ${callerName}, target: ${targetUserId}`);

    
    // Check for existing unread notification with the same callId (dedup)
    const existing = await base44.asServiceRole.entities.Notification.filter({
      recipient_id: targetUserId,
      related_entity: 'voice_call',
      related_id: callId,
      read: false
    });
    if (existing.length > 0) {
      console.log(`[sendCallNotification] Notification already exists for callId: ${callId} — skipping creation`);
      return Response.json({ success: true, message: 'Notification already exists' });
    }

    // Create in-app notification with critical priority
    await base44.asServiceRole.entities.Notification.create({
      recipient_id: targetUserId,
      recipient_name: targetUser?.full_name,
      type: 'system',
      priority: 'critical',
      title: 'Incoming Call 📞',
      message: `${callerName} is calling you. Tap to answer.`,
      related_entity: 'voice_call',
      related_id: callId,
      action_url: `/?call_id=${callId}&caller_name=${encodeURIComponent(callerName)}`
    });
    console.log(`[sendCallNotification] ✅ In-app notification created for callId: ${callId}`);
    
    // Push notifications are handled by sendCallPushNotification (OneSignal)
    // This function only creates the in-app notification for foreground polling.

    return Response.json({ success: true });
  } catch (error) {
    console.error('Error sending call notification:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});