import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { sendNativePush } from '../../shared/nativePush.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only logged-in users may send notifications.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recipient_id, type, priority, title, message, related_entity, related_id, action_url } = await req.json();

    if (!recipient_id || !type || !title || !message) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get user preferences
    const prefs = await base44.asServiceRole.entities.NotificationPreference.filter({
      user_id: recipient_id
    });
    const userPref = prefs[0];

    // Check if notification type is enabled
    if (userPref && userPref[type] && !userPref[type].enabled) {
      return Response.json({ message: 'Notification disabled by user preference' });
    }

    // Check quiet hours for non-critical notifications
    if (userPref?.quiet_hours?.enabled && priority !== 'critical') {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const start = userPref.quiet_hours.start;
      const end = userPref.quiet_hours.end;

      if (start > end) {
        if (currentTime >= start || currentTime < end) {
          return Response.json({ message: 'Quiet hours active' });
        }
      } else {
        if (currentTime >= start && currentTime < end) {
          return Response.json({ message: 'Quiet hours active' });
        }
      }
    }

    // Get recipient details
    const recipient = await base44.asServiceRole.entities.User.get(recipient_id);
    const sent_via = ['in_app'];

    // Create in-app notification
    const notification = await base44.asServiceRole.entities.Notification.create({
      recipient_id,
      recipient_name: recipient.full_name,
      type,
      priority: priority || 'medium',
      title,
      message,
      related_entity,
      related_id,
      action_url,
      sent_via,
      read: false
    });

    // Send push notification if enabled — NATIVE PUSH via the shared platform
    // service (replaces the retired OneSignal path; delivered with the app
    // closed). User preferences and quiet hours above still govern delivery.
    if (userPref?.[type]?.push !== false) {
      try {
        const pr = await sendNativePush(base44.asServiceRole, {
          user_id: recipient_id,
          title,
          body: message,
          priority: priority || 'medium',
          action_label: action_url ? 'Open' : undefined,
          action_url: action_url || undefined,
          event_key: 'generic:' + notification.id,
          customer_id: user.customer_id || null,
          reseller_id: user.reseller_id || null,
        });
        if (pr.status === 'sent') notification.sent_via.push('push');
      } catch (error) {
        console.error('Push notification failed:', error);
      }
    }

    // Send email if enabled
    if (userPref?.[type]?.email) {
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: recipient.email,
          subject: title,
          body: `${message}\n\n---\nThis is an automated notification from SecureGuard.`
        });
        notification.sent_via.push('email');
      } catch (error) {
        console.error('Email notification failed:', error);
      }
    }

    return Response.json({ 
      success: true, 
      notification_id: notification.id,
      sent_via: notification.sent_via
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});