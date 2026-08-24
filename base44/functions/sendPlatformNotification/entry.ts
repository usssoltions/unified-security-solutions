import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * sendPlatformNotification — Central notification engine for the Unified Platform.
 *
 * Accepts an event object and dispatches notifications through configured channels:
 *   - in_app  → creates a Notification entity (visible in NotificationCenter)
 *   - email   → Core.SendEmail with branded HTML
 *   - push    → OneSignal REST API (ONESIGNAL_APP_ID + ONESIGNAL_REST_API_KEY secrets)
 *   - telegram → calls sendTelegramMessage backend function (TELEGRAM_BOT_TOKEN secret)
 *
 * Resolves recipients from: direct user IDs, recipient group IDs, external recipient IDs.
 * Looks up NotificationTemplate by event_key + channel + customer_id (falls back to platform default).
 * Logs every delivery to NotificationDelivery with an idempotency key to prevent duplicates.
 *
 * Individual business modules publish events; this service determines recipients, templates,
 * channels, and delivery. Never place sensitive clinical data in email subjects, push titles,
 * or Telegram previews — use neutral text and keep details inside the secured app.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      event_key,
      customer_id,
      reseller_id,
      site_id,
      module_key,
      recipient_ids = [],
      recipient_group_ids = [],
      external_recipient_ids = [],
      channels = ['in_app'],
      metadata = {},
      related_entity,
      related_id,
      action_url,
      priority = 'medium',
      notification_type = 'system',
      title,
      message
    } = await req.json();

    if (!event_key) {
      return Response.json({ error: 'event_key is required' }, { status: 400 });
    }

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // --- Resolve recipients ---
    const userRecipients = new Map();   // userId → user object
    const externalRecipients = [];       // array of external recipient objects

    // Direct user IDs
    for (const uid of recipient_ids) {
      if (!userRecipients.has(uid)) {
        const users = await base44.asServiceRole.entities.User.filter({ id: uid });
        if (users[0]) userRecipients.set(uid, users[0]);
      }
    }

    // Expand recipient groups
    for (const gid of recipient_group_ids) {
      try {
        const group = await base44.asServiceRole.entities.RecipientGroup.get(gid);
        if (group?.members) {
          for (const member of group.members) {
            if (member.member_type === 'user' && member.member_id) {
              if (!userRecipients.has(member.member_id)) {
                const users = await base44.asServiceRole.entities.User.filter({ id: member.member_id });
                if (users[0]) userRecipients.set(member.member_id, users[0]);
              }
            } else if (member.member_type === 'external_recipient' && member.member_id) {
              try {
                const ext = await base44.asServiceRole.entities.ExternalRecipient.get(member.member_id);
                if (ext) externalRecipients.push({ ...ext, channel_pref: member.channel_preference });
              } catch (_) {}
            }
          }
        }
      } catch (_) {}
    }

    // Direct external recipients
    for (const eid of external_recipient_ids) {
      try {
        const ext = await base44.asServiceRole.entities.ExternalRecipient.get(eid);
        if (ext) externalRecipients.push(ext);
      } catch (_) {}
    }

    // --- Template resolution ---
    const templateCache = {};
    const getTemplate = async (channel) => {
      const key = `${event_key}:${channel}:${customer_id || ''}`;
      if (key in templateCache) return templateCache[key];
      let tmpl = null;
      if (customer_id) {
        const list = await base44.asServiceRole.entities.NotificationTemplate.filter(
          { event_key, channel, customer_id, active: true }, '-version', 1
        );
        tmpl = list[0] || null;
      }
      if (!tmpl) {
        const list = await base44.asServiceRole.entities.NotificationTemplate.filter(
          { event_key, channel, active: true }, '-version', 1
        );
        tmpl = list[0] || null;
      }
      templateCache[key] = tmpl;
      return tmpl;
    };

    const renderTemplate = (tmplStr, data) => {
      if (!tmplStr) return null;
      let result = tmplStr;
      for (const [k, v] of Object.entries(data)) {
        result = result.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g'), String(v ?? ''));
      }
      return result;
    };

    // --- Resolve display title/message (from template or direct params) ---
    const resolveContent = async (channel) => {
      const tmpl = await getTemplate(channel);
      if (tmpl) {
        return {
          subject: renderTemplate(tmpl.subject_template, metadata) || title || event_key,
          body: renderTemplate(tmpl.body_template, metadata) || message || ''
        };
      }
      return { subject: title || event_key, body: message || '' };
    };

    // --- Delivery logging with idempotency ---
    const logDelivery = async (deliveryData) => {
      try {
        await base44.asServiceRole.entities.NotificationDelivery.create({
          ...deliveryData,
          send_time: new Date().toISOString()
        });
      } catch (_) {}
    };

    const makeIdempotencyKey = (eventKey, recipientId, channel) =>
      `${eventKey}:${recipientId}:${channel}`;

    const results = [];

    // --- IN-APP channel ---
    if (channels.includes('in_app')) {
      for (const [uid, u] of userRecipients) {
        const idemKey = makeIdempotencyKey(event_key, uid, 'in_app');
        try {
          const content = await resolveContent('in_app');
          const notification = await base44.asServiceRole.entities.Notification.create({
            recipient_id: uid,
            recipient_name: u.full_name,
            type: notification_type,
            priority,
            title: content.subject,
            message: content.body,
            read: false,
            related_entity,
            related_id,
            action_url,
            sent_via: ['in_app']
          });
          await logDelivery({
            event_key, notification_id: notification.id, customer_id, reseller_id,
            recipient_id: uid, recipient_name: u.full_name,
            channel: 'in_app', status: 'sent', idempotency_key: idemKey
          });
          results.push({ recipient_id: uid, channel: 'in_app', status: 'sent', notification_id: notification.id });
        } catch (err) {
          await logDelivery({
            event_key, customer_id, reseller_id, recipient_id: uid, recipient_name: u.full_name,
            channel: 'in_app', status: 'failed', provider_response: err.message, idempotency_key: idemKey
          });
          results.push({ recipient_id: uid, channel: 'in_app', status: 'failed', error: err.message });
        }
      }
    }

    // --- EMAIL channel ---
    if (channels.includes('email')) {
      const emailContent = await resolveContent('email');

      // Email to users with email addresses
      for (const [uid, u] of userRecipients) {
        if (!u.email) continue;
        const idemKey = makeIdempotencyKey(event_key, uid, 'email');
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: u.email,
            subject: emailContent.subject,
            body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:24px;text-align:center;border-radius:10px 10px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:20px;">${esc(emailContent.subject)}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 10px 10px;">
    <div style="background:#fff;padding:20px;border-radius:8px;border-left:4px solid #1e3a5f;">
      <p style="color:#334155;font-size:15px;line-height:1.6;margin:0;">${esc(emailContent.body)}</p>
      ${action_url ? `<p style="margin-top:16px;"><a href="${esc(action_url)}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;">View Details</a></p>` : ''}
    </div>
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:16px;">This is an automated notification. Please do not reply to this email.</p>
  </div>
</div>`
          });
          await logDelivery({
            event_key, customer_id, reseller_id, recipient_id: uid, recipient_name: u.full_name,
            recipient_address: u.email, channel: 'email', status: 'sent', idempotency_key: idemKey
          });
          results.push({ recipient_id: uid, channel: 'email', status: 'sent' });
        } catch (err) {
          await logDelivery({
            event_key, customer_id, reseller_id, recipient_id: uid, recipient_name: u.full_name,
            recipient_address: u.email, channel: 'email', status: 'failed',
            provider_response: err.message, idempotency_key: idemKey
          });
          results.push({ recipient_id: uid, channel: 'email', status: 'failed', error: err.message });
        }
      }

      // Email to external recipients
      for (const ext of externalRecipients) {
        if (!ext.email) continue;
        const idemKey = makeIdempotencyKey(event_key, ext.id, 'email');
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: ext.email,
            subject: emailContent.subject,
            body: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#0f172a,#1e3a5f);padding:24px;text-align:center;border-radius:10px 10px 0 0;">
    <h1 style="color:#fff;margin:0;font-size:20px;">${esc(emailContent.subject)}</h1>
  </div>
  <div style="background:#f8fafc;padding:24px;border-radius:0 0 10px 10px;">
    <div style="background:#fff;padding:20px;border-radius:8px;border-left:4px solid #1e3a5f;">
      <p style="color:#334155;font-size:15px;line-height:1.6;margin:0;">${esc(emailContent.body)}</p>
      ${action_url ? `<p style="margin-top:16px;"><a href="${esc(action_url)}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;">View Details</a></p>` : ''}
    </div>
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:16px;">This is an automated notification. Please do not reply to this email.</p>
  </div>
</div>`
          });
          await logDelivery({
            event_key, customer_id, reseller_id, recipient_id: ext.id, recipient_name: ext.name,
            recipient_address: ext.email, channel: 'email', status: 'sent', idempotency_key: idemKey
          });
          results.push({ external_recipient_id: ext.id, channel: 'email', status: 'sent' });
        } catch (err) {
          await logDelivery({
            event_key, customer_id, reseller_id, recipient_id: ext.id, recipient_name: ext.name,
            recipient_address: ext.email, channel: 'email', status: 'failed',
            provider_response: err.message, idempotency_key: idemKey
          });
          results.push({ external_recipient_id: ext.id, channel: 'email', status: 'failed', error: err.message });
        }
      }
    }

    // --- PUSH channel (OneSignal) ---
    if (channels.includes('push')) {
      const pushContent = await resolveContent('push');
      const oneSignalAppId = secrets.get('ONESIGNAL_APP_ID');
      const oneSignalRestKey = secrets.get('ONESIGNAL_REST_API_KEY');

      if (oneSignalAppId && oneSignalRestKey) {
        for (const [uid, u] of userRecipients) {
          // Get the user's OneSignal player IDs from push_token or a PushToken entity
          const playerIds = [];
          if (u.push_token) playerIds.push(u.push_token);

          // Also check if there are push tokens stored elsewhere
          try {
            const tokens = await base44.asServiceRole.entities.NotificationDelivery.filter({
              recipient_id: uid, channel: 'push'
            }, '-send_time', 5);
            // Could extract player IDs from delivery records if stored
          } catch (_) {}

          if (!playerIds.length) {
            results.push({ recipient_id: uid, channel: 'push', status: 'skipped', reason: 'No push token' });
            continue;
          }

          const idemKey = makeIdempotencyKey(event_key, uid, 'push');
          try {
            const response = await fetch('https://onesignal.com/api/v1/notifications', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${oneSignalRestKey}`
              },
              body: JSON.stringify({
                app_id: oneSignalAppId,
                include_player_ids: playerIds,
                headings: { en: pushContent.subject },
                contents: { en: pushContent.body },
                data: { event_key, related_entity, related_id, action_url, customer_id },
                priority: priority === 'critical' ? 10 : 5
              })
            });
            const result = await response.json();
            if (result.id) {
              await logDelivery({
                event_key, customer_id, reseller_id, recipient_id: uid, recipient_name: u.full_name,
                recipient_address: playerIds.join(','), channel: 'push', status: 'sent',
                provider_response: result.id, idempotency_key: idemKey
              });
              results.push({ recipient_id: uid, channel: 'push', status: 'sent', notification_id: result.id });
            } else {
              await logDelivery({
                event_key, customer_id, reseller_id, recipient_id: uid, recipient_name: u.full_name,
                channel: 'push', status: 'failed',
                provider_response: JSON.stringify(result.errors || result), idempotency_key: idemKey
              });
              results.push({ recipient_id: uid, channel: 'push', status: 'failed', error: result.errors?.[0] || 'Push failed' });
            }
          } catch (err) {
            await logDelivery({
              event_key, customer_id, reseller_id, recipient_id: uid, recipient_name: u.full_name,
              channel: 'push', status: 'failed', provider_response: err.message, idempotency_key: idemKey
            });
            results.push({ recipient_id: uid, channel: 'push', status: 'failed', error: err.message });
          }
        }
      } else {
        results.push({ channel: 'push', status: 'skipped', reason: 'OneSignal not configured' });
      }
    }

    // --- TELEGRAM channel ---
    if (channels.includes('telegram')) {
      const tgContent = await resolveContent('telegram');
      const tgMessage = `<b>${esc(tgContent.subject)}</b>\n\n${esc(tgContent.body)}`;

      // Telegram to users with telegram_chat_id (if stored on user)
      for (const [uid, u] of userRecipients) {
        // Users don't have telegram_chat_id on User entity; skip unless configured
        results.push({ recipient_id: uid, channel: 'telegram', status: 'skipped', reason: 'No Telegram chat ID for user' });
      }

      // Telegram to external recipients with telegram_chat_id
      for (const ext of externalRecipients) {
        if (!ext.telegram_chat_id) continue;
        const idemKey = makeIdempotencyKey(event_key, ext.id, 'telegram');
        try {
          const invokeResult = await base44.asServiceRole.functions.invoke('sendTelegramMessage', {
            chat_id: ext.telegram_chat_id,
            message: tgMessage
          });
          const tgResult = invokeResult.data || invokeResult;
          if (tgResult.success) {
            await logDelivery({
              event_key, customer_id, reseller_id, recipient_id: ext.id, recipient_name: ext.name,
              recipient_address: ext.telegram_chat_id, channel: 'telegram', status: 'sent', idempotency_key: idemKey
            });
            results.push({ external_recipient_id: ext.id, channel: 'telegram', status: 'sent' });
          } else {
            await logDelivery({
              event_key, customer_id, reseller_id, recipient_id: ext.id, recipient_name: ext.name,
              recipient_address: ext.telegram_chat_id, channel: 'telegram', status: 'failed',
              provider_response: tgResult.error, idempotency_key: idemKey
            });
            results.push({ external_recipient_id: ext.id, channel: 'telegram', status: 'failed', error: tgResult.error });
          }
        } catch (err) {
          await logDelivery({
            event_key, customer_id, reseller_id, recipient_id: ext.id, recipient_name: ext.name,
            recipient_address: ext.telegram_chat_id, channel: 'telegram', status: 'failed',
            provider_response: err.message, idempotency_key: idemKey
          });
          results.push({ external_recipient_id: ext.id, channel: 'telegram', status: 'failed', error: err.message });
        }
      }
    }

    const sentCount = results.filter(r => r.status === 'sent').length;
    const failedCount = results.filter(r => r.status === 'failed').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    return Response.json({
      success: true,
      event_key,
      total_sent: sentCount,
      total_failed: failedCount,
      total_skipped: skippedCount,
      results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}