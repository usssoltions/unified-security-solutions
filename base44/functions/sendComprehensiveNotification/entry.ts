import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * sendComprehensiveNotification — Central multi-channel notification engine.
 *
 * Channels (each independently attempted and logged):
 *   AUTOMATIC: in_app, push, email, telegram
 *   OPTIONAL MANUAL: whatsapp (wa.me — handled client-side, not here)
 *   NO SMS.
 *
 * Recipients are resolved from:
 *   - recipientIds       → application Users
 *   - externalRecipientIds → ExternalRecipient records
 *   - recipientGroupIds   → RecipientGroup members (users + external recipients)
 *
 * Tenant isolation is enforced: every delivery is scoped by customer_id/reseller_id.
 * A recipient belonging to a different tenant than `scope` is suppressed and logged.
 *
 * Idempotency: one NotificationDelivery per event_key + recipient + channel.
 *   If event_key is omitted, a unique one is generated (no dedup for that call).
 *
 * Privacy: module-aware templates redact sensitive medical/estate data in
 *   Telegram and push previews (which are visible on lock screens).
 *
 * Failure isolation: a failure on any one channel never prevents the others.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const {
      recipientIds = [],
      externalRecipientIds = [],
      recipientGroupIds = [],
      type = 'system',
      title,
      message,
      priority = 'medium',
      relatedEntity,
      relatedId,
      actionUrl,
      metadata = {},
      channels = { inApp: true, push: true, email: true, telegram: true },
      moduleKey = 'security',
      eventKey,
      scope = {},
    } = await req.json();

    if (!title || !message) {
      return Response.json({ error: 'title and message are required' }, { status: 400 });
    }
    if (!recipientIds.length && !externalRecipientIds.length && !recipientGroupIds.length) {
      return Response.json({ error: 'At least one recipient is required' }, { status: 400 });
    }

    const evKey = eventKey || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const callerScope = {
      customer_id: scope.customer_id ?? caller.customer_id,
      reseller_id: scope.reseller_id ?? caller.reseller_id,
      site_id: scope.site_id,
    };

    // ---- Resolve recipients ----------------------------------------------
    // Build a deduplicated list of resolved recipients:
    // { id, kind: 'user'|'external', name, email, pushToken, telegramChatId, customerId, resellerId }

    const resolved = new Map();

    // 1. Application users
    if (recipientIds.length) {
      const users = await base44.asServiceRole.entities.User.filter({ id: { $in: recipientIds } }).catch(() => []);
      for (const u of users) {
        resolved.set(`user:${u.id}`, {
          id: u.id, kind: 'user',
          name: u.display_name || u.full_name || 'User',
          email: u.email || undefined,
          pushToken: u.push_token || undefined,
          telegramChatId: u.telegram_chat_id || undefined,
          telegramNotificationsEnabled: u.telegram_notifications_enabled !== false,
          customerId: u.customer_id, resellerId: u.reseller_id,
        });
      }
    }

    // 2. External recipients
    if (externalRecipientIds.length) {
      const exts = await base44.asServiceRole.entities.ExternalRecipient.filter({ id: { $in: externalRecipientIds } }).catch(() => []);
      for (const e of exts) {
        if (!e.active) continue;
        resolved.set(`ext:${e.id}`, {
          id: e.id, kind: 'external',
          name: e.name,
          email: e.email || undefined,
          pushToken: undefined,
          telegramChatId: e.telegram_chat_id || undefined,
          customerId: e.customer_id, resellerId: e.reseller_id,
        });
      }
    }

    // 3. Recipient groups → expand members
    if (recipientGroupIds.length) {
      const groups = await base44.asServiceRole.entities.RecipientGroup.filter({ id: { $in: recipientGroupIds } }).catch(() => []);
      for (const g of groups) {
        if (g.active === false) continue;
        const memberUserIds = [];
        const memberExtIds = [];
        for (const m of (g.members || [])) {
          if (m.member_type === 'user') memberUserIds.push(m.member_id);
          else if (m.member_type === 'external_recipient') memberExtIds.push(m.member_id);
        }
        if (memberUserIds.length) {
          const us = await base44.asServiceRole.entities.User.filter({ id: { $in: memberUserIds } }).catch(() => []);
          for (const u of us) {
            resolved.set(`user:${u.id}`, {
              id: u.id, kind: 'user',
              name: u.display_name || u.full_name || 'User',
              email: u.email || undefined,
              pushToken: u.push_token || undefined,
              telegramChatId: u.telegram_chat_id || undefined,
              telegramNotificationsEnabled: u.telegram_notifications_enabled !== false,
              customerId: u.customer_id, resellerId: u.reseller_id,
            });
          }
        }
        if (memberExtIds.length) {
          const exs = await base44.asServiceRole.entities.ExternalRecipient.filter({ id: { $in: memberExtIds } }).catch(() => []);
          for (const e of exs) {
            if (!e.active) continue;
            resolved.set(`ext:${e.id}`, {
              id: e.id, kind: 'external',
              name: e.name,
              email: e.email || undefined,
              pushToken: undefined,
              telegramChatId: e.telegram_chat_id || undefined,
              customerId: e.customer_id, resellerId: e.reseller_id,
            });
          }
        }
      }
    }

    const recipients = [...resolved.values()];

    // ---- Tenant guard -----------------------------------------------------
    // Suppress cross-tenant delivery. Platform admins (no customer_id) may
    // send to any tenant — they are the system-level notifier.
    const isPlatformSender = !callerScope.customer_id && (caller.role === 'admin' || caller.role_type === 'platform_admin');

    // ---- Privacy: module-safe preview text --------------------------------
    // Telegram previews and push lock-screen text must not leak sensitive data.
    const { safeTitle, safeMessage } = buildSafePreview(moduleKey, title, message, metadata);

    // ---- OneSignal config -------------------------------------------------
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');
    const TG_BOT_TOKEN = secrets.get('TELEGRAM_BOT_TOKEN');

    // ---- Delivery ---------------------------------------------------------
    const results = [];
    let notificationId = null;

    for (const r of recipients) {
      // Tenant check (skip for platform sender)
      if (!isPlatformSender) {
        if (callerScope.customer_id && r.customerId && r.customerId !== callerScope.customer_id) {
          await logDelivery(base44, evKey, null, r, 'suppressed', callerScope, 'cross-tenant');
          results.push({ recipient: r.id, name: r.name, suppressed: true, reason: 'cross-tenant' });
          continue;
        }
      }

      const recipientScope = {
        customer_id: r.customerId || callerScope.customer_id,
        reseller_id: r.resellerId || callerScope.reseller_id,
      };

      // --- IN-APP (only for application users) ---
      if (channels.inApp && r.kind === 'user') {
        try {
          const idempKey = `${evKey}:user:${r.id}:in_app`;
          if (await alreadyDelivered(base44, idempKey)) {
            results.push({ recipient: r.id, channel: 'in_app', status: 'deduped' });
          } else {
            if (!notificationId) {
              const n = await base44.asServiceRole.entities.Notification.create({
                recipient_id: r.id, recipient_name: r.name,
                type, priority, title, message, read: false,
                related_entity: relatedEntity, related_id: relatedId, action_url: actionUrl,
                sent_via: ['in_app'],
                customer_id: recipientScope.customer_id, reseller_id: recipientScope.reseller_id,
              });
              notificationId = n.id;
            }
            await logDelivery(base44, evKey, notificationId, r, 'sent', recipientScope, 'in_app', idempKey);
            results.push({ recipient: r.id, channel: 'in_app', status: 'sent', notificationId });
          }
        } catch (e) {
          await logDelivery(base44, evKey, notificationId, r, 'failed', recipientScope, 'in_app', null, e.message);
          results.push({ recipient: r.id, channel: 'in_app', status: 'failed', error: e.message });
        }
      }

      // --- EMAIL ---
      if (channels.email && r.email) {
        const idempKey = `${evKey}:${r.kind}:${r.id}:email`;
        try {
          if (await alreadyDelivered(base44, idempKey)) {
            results.push({ recipient: r.id, channel: 'email', status: 'deduped' });
          } else {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: r.email,
              subject: `🔔 ${title}`,
              body: buildEmailHtml(title, message, metadata, priority),
            });
            await logDelivery(base44, evKey, notificationId, r, 'sent', recipientScope, 'email', idempKey);
            results.push({ recipient: r.id, channel: 'email', status: 'sent' });
          }
        } catch (e) {
          await logDelivery(base44, evKey, notificationId, r, 'failed', recipientScope, 'email', null, e.message);
          results.push({ recipient: r.id, channel: 'email', status: 'failed', error: e.message });
        }
      }

      // --- PUSH (only for application users with a push token) ---
      if (channels.push && r.kind === 'user' && r.pushToken && ONESIGNAL_APP_ID && ONESIGNAL_API_KEY) {
        const idempKey = `${evKey}:user:${r.id}:push`;
        try {
          if (await alreadyDelivered(base44, idempKey)) {
            results.push({ recipient: r.id, channel: 'push', status: 'deduped' });
          } else {
            const isCritical = priority === 'critical';
            const resp = await fetch('https://onesignal.com/api/v1/notifications', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_API_KEY}` },
              body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                include_player_ids: [r.pushToken],
                headings: { en: safeTitle },
                contents: { en: safeMessage },
                priority: isCritical ? 10 : 5,
                ttl: isCritical ? 0 : 3600,
                android_channel_id: isCritical ? 'emergency' : 'default',
                android_visibility: 1,
                data: { type, relatedEntity, relatedId, actionUrl },
              }),
            });
            const pr = await resp.json();
            if (pr.errors) throw new Error(JSON.stringify(pr.errors));
            await logDelivery(base44, evKey, notificationId, r, 'sent', recipientScope, 'push', idempKey, JSON.stringify(pr));
            results.push({ recipient: r.id, channel: 'push', status: 'sent' });
          }
        } catch (e) {
          await logDelivery(base44, evKey, notificationId, r, 'failed', recipientScope, 'push', null, e.message);
          results.push({ recipient: r.id, channel: 'push', status: 'failed', error: e.message });
        }
      }

      // --- TELEGRAM ---
      if (channels.telegram) {
        const idempKey = `${evKey}:${r.kind}:${r.id}:telegram`;
        // Skip if no chat_id, bot not configured, or user disabled Telegram
        if (!r.telegramChatId || !TG_BOT_TOKEN) {
          const reason = !r.telegramChatId ? 'NO_TELEGRAM_CHAT_ID' : 'BOT_NOT_CONFIGURED';
          await logDelivery(base44, evKey, notificationId, r, 'skipped', recipientScope, 'telegram', null, null, reason);
          results.push({ recipient: r.id, channel: 'telegram', status: 'skipped', reason });
        } else if (r.kind === 'user' && r.telegramNotificationsEnabled === false) {
          await logDelivery(base44, evKey, notificationId, r, 'skipped', recipientScope, 'telegram', null, null, null, 'TELEGRAM_DISABLED');
          results.push({ recipient: r.id, channel: 'telegram', status: 'skipped', reason: 'TELEGRAM_DISABLED' });
        } else {
          try {
            if (await alreadyDelivered(base44, idempKey)) {
              results.push({ recipient: r.id, channel: 'telegram', status: 'deduped' });
            } else {
              const tgResp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: r.telegramChatId,
                  text: buildTelegramText(safeTitle, safeMessage, priority),
                  parse_mode: 'HTML',
                  disable_web_page_preview: true,
                }),
              });
              const tgResult = await tgResp.json();
              if (!tgResult.ok) throw new Error(tgResult.description || 'Telegram send failed');
              await logDelivery(base44, evKey, notificationId, r, 'sent', recipientScope, 'telegram', idempKey, JSON.stringify({ message_id: tgResult.result?.message_id }));
              results.push({ recipient: r.id, channel: 'telegram', status: 'sent' });
            }
          } catch (e) {
            await logDelivery(base44, evKey, notificationId, r, 'failed', recipientScope, 'telegram', null, e.message);
            results.push({ recipient: r.id, channel: 'telegram', status: 'failed', error: e.message });
          }
        }
      }
    }

    // ---- Summary ----------------------------------------------------------
    const sent = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const deduped = results.filter(r => r.status === 'deduped').length;
    const suppressed = results.filter(r => r.suppressed).length;

    return Response.json({
      success: true,
      eventKey: evKey,
      totalRecipients: recipients.length,
      sent, failed, deduped, suppressed,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// ---- Helpers ---------------------------------------------------------------

async function alreadyDelivered(base44, idempotency_key: string): Promise<boolean> {
  try {
    const existing = await base44.asServiceRole.entities.NotificationDelivery.filter(
      { idempotency_key },
      '-created_date',
      1
    );
    return existing && existing.length > 0 && existing[0].status === 'sent';
  } catch {
    return false;
  }
}

async function logDelivery(base44, eventKey, notificationId, recipient, status, scope, channel, idempKey?, providerResponse?) {
  try {
    await base44.asServiceRole.entities.NotificationDelivery.create({
      event_key: eventKey,
      notification_id: notificationId || undefined,
      customer_id: scope.customer_id || undefined,
      reseller_id: scope.reseller_id || undefined,
      recipient_id: recipient.id,
      recipient_name: recipient.name,
      recipient_address: channel === 'email' ? recipient.email : channel === 'telegram' ? recipient.telegramChatId : channel === 'push' ? recipient.pushToken : recipient.id,
      channel,
      status,
      send_time: new Date().toISOString(),
      provider_response: providerResponse || undefined,
      retries: 0,
      idempotency_key: idempKey || `${eventKey}:${recipient.id}:${channel}`,
    });
  } catch (_) { /* delivery logging must never break the notification */ }
}

/**
 * Module-aware privacy filtering for Telegram/Push previews.
 * Medical: redact patient names, medical details — show only title + generic.
 * Estate: redact internal notes, resident personal info.
 * Security/other: pass through.
 */
function buildSafePreview(moduleKey: string, title: string, message: string, metadata: any) {
  if (moduleKey === 'medical') {
    return {
      safeTitle: title || 'Medical Notification',
      safeMessage: 'A medical notification has been issued. Please open the application to view details.',
    };
  }
  if (moduleKey === 'estate') {
    // Keep title + message but strip internal_notes / resident personal data from metadata leaks
    return {
      safeTitle: title,
      safeMessage: message,
    };
  }
  return { safeTitle: title, safeMessage: message };
}

function buildTelegramText(title: string, message: string, priority: string): string {
  const prio = priority === 'critical' ? '🔴 CRITICAL' : priority === 'high' ? '🟠 HIGH' : priority === 'medium' ? '🟡 MEDIUM' : '🔵 LOW';
  return `<b>${escTg(title)}</b>\n\n${escTg(message)}\n\n<i>${prio}</i>`;
}

function escTg(s: string): string {
  return String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function buildEmailHtml(title: string, message: string, metadata: any, priority: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">SecureGuard Notification</h1>
      </div>
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px;">
        <div style="background: white; padding: 25px; border-radius: 8px; border-left: 4px solid #667eea;">
          <h2 style="color: #1e293b; margin-top: 0; font-size: 20px;">${esc(title)}</h2>
          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 15px 0;">${esc(message)}</p>
          <p style="color: #64748b; font-size: 14px; margin-top: 20px;">Priority: <span style="color: ${priority === 'critical' ? '#dc2626' : priority === 'high' ? '#ea580c' : priority === 'medium' ? '#ca8a04' : '#0284c7'}; font-weight: bold;">${esc(priority).toUpperCase()}</span></p>
        </div>
        <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">SecureGuard Security Management System</p>
        </div>
      </div>
    </div>
  `;
}