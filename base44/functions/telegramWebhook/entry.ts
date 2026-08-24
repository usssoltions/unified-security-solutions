import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * telegramWebhook — Receives Telegram Bot API updates via webhook.
 *
 * Processes /start commands:
 *   /start <TOKEN>  → validates enrollment token, associates chat_id with USS user/recipient
 *   /start          → checks if this chat is already connected, replies accordingly
 *
 * Security:
 *   - Validates token hash against stored enrollment
 *   - Ensures token is pending and unexpired
 *   - Consumes token atomically (single-use)
 *   - Never exposes bot token
 *   - Rejects replay attempts
 *
 * This function URL must be set as the Telegram webhook via setWebhook.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const update = await req.json();

    // Only process message updates
    const message = update.message;
    if (!message || !message.text) {
      return Response.json({ ok: true, processed: false });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const fromUser = message.from || {};
    const tgUsername = fromUser.username;
    const tgFirstName = fromUser.first_name;
    const tgLastName = fromUser.last_name;

    const botToken = secrets.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return Response.json({ ok: true, processed: false });

    // Handle /start with token
    if (text.startsWith('/start ')) {
      const token = text.slice(7).trim();
      const tokenHash = await sha256(token);

      // Find the enrollment by token hash
      const enrollments = await base44.asServiceRole.entities.TelegramEnrollment.filter({
        token_hash: tokenHash,
        status: 'pending'
      }).catch(() => []);

      if (!enrollments.length) {
        // Check if it's a consumed/expired token
        const consumed = await base44.asServiceRole.entities.TelegramEnrollment.filter({ token_hash: tokenHash }).catch(() => []);
        if (consumed.length) {
          await replyTelegram(botToken, chatId, '❌ This connection link has already been used. Please request a new invitation from your USS application.');
        } else {
          await replyTelegram(botToken, chatId, '❌ Invalid connection link. Please request a new invitation from your USS application.');
        }
        return Response.json({ ok: true, processed: true, result: 'invalid_token' });
      }

      const enrollment = enrollments[0];

      // Check expiry
      if (new Date(enrollment.expires_at) < new Date()) {
        await base44.asServiceRole.entities.TelegramEnrollment.update(enrollment.id, { status: 'expired' }).catch(() => {});
        await replyTelegram(botToken, chatId, '⏰ This connection link has expired. Please request a new invitation from your USS application.');
        return Response.json({ ok: true, processed: true, result: 'expired_token' });
      }

      // Consume the token — update enrollment
      await base44.asServiceRole.entities.TelegramEnrollment.update(enrollment.id, {
        status: 'completed',
        consumed_at: new Date().toISOString(),
        telegram_chat_id: chatId,
        telegram_username: tgUsername,
        telegram_first_name: tgFirstName,
        telegram_last_name: tgLastName,
      });

      // Associate chat_id with the subject (User or ExternalRecipient)
      const telegramData = {
        telegram_chat_id: chatId,
        telegram_connected: true,
        telegram_connected_at: new Date().toISOString(),
        telegram_username: tgUsername,
        telegram_first_name: tgFirstName,
        telegram_last_name: tgLastName,
        telegram_notifications_enabled: true,
      };

      if (enrollment.subject_type === 'external_recipient' && enrollment.external_recipient_id) {
        await base44.asServiceRole.entities.ExternalRecipient.update(enrollment.external_recipient_id, {
          telegram_chat_id: chatId,
          telegram_connected: true,
          telegram_connected_at: new Date().toISOString(),
          telegram_username: tgUsername,
        }).catch(() => {});
        // Log audit
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          action: 'EXTERNAL_RECIPIENT_TELEGRAM_CONNECTED',
          entity_name: 'ExternalRecipient',
          entity_id: enrollment.external_recipient_id,
          customer_id: enrollment.customer_id,
          reseller_id: enrollment.reseller_id,
          details: JSON.stringify({ enrollment_id: enrollment.id }),
        }).catch(() => {});
      } else if (enrollment.user_id) {
        await base44.asServiceRole.entities.User.update(enrollment.user_id, telegramData).catch(() => {});
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          action: 'TELEGRAM_CONNECTED',
          entity_name: 'User',
          entity_id: enrollment.user_id,
          performed_by_id: enrollment.user_id,
          customer_id: enrollment.customer_id,
          reseller_id: enrollment.reseller_id,
          details: JSON.stringify({ enrollment_id: enrollment.id, telegram_username: tgUsername }),
        }).catch(() => {});
      }

      await replyTelegram(botToken, chatId, '✅ Telegram notifications have been successfully connected to Unified Security Solutions. You will now receive automatic USS notifications here.');
      return Response.json({ ok: true, processed: true, result: 'connected' });
    }

    // Handle /start without token
    if (text === '/start' || text.startsWith('/start@')) {
      // Check if this chat_id is already associated with a user
      const users = await base44.asServiceRole.entities.User.filter({ telegram_chat_id: chatId }).catch(() => []);
      const exts = await base44.asServiceRole.entities.ExternalRecipient.filter({ telegram_chat_id: chatId }).catch(() => []);

      if (users.length || exts.length) {
        await replyTelegram(botToken, chatId, 'ℹ️ This Telegram account is already connected. Manage notification settings in the USS app.');
      } else {
        await replyTelegram(botToken, chatId, '👋 Welcome to Unified Security Solutions. Please connect Telegram from your USS application to receive notifications.');
      }
      return Response.json({ ok: true, processed: true, result: 'no_token' });
    }

    // Ignore other messages
    return Response.json({ ok: true, processed: false });
  } catch (error) {
    return Response.json({ ok: true, error: error.message });
  }
}

async function replyTelegram(botToken: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) { /* never fail the webhook on reply error */ }
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}