import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * sendTelegramMessage — Sends a message via the Telegram Bot API.
 * Bot token is stored as a secret (TELEGRAM_BOT_TOKEN) and never exposed client-side.
 * Supports HTML parse_mode by default for formatted messages.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { chat_id, message, parse_mode = 'HTML', disable_preview = true } = await req.json();

    if (!chat_id || !message) {
      return Response.json({ error: 'chat_id and message are required' }, { status: 400 });
    }

    const botToken = secrets.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      return Response.json({ error: 'Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN secret.' }, { status: 503 });
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id,
        text: message,
        parse_mode,
        disable_web_page_preview: disable_preview
      })
    });

    const result = await response.json();

    if (!result.ok) {
      return Response.json({
        success: false,
        error: result.description || 'Telegram send failed',
        error_code: result.error_code
      }, { status: 502 });
    }

    return Response.json({
      success: true,
      message_id: result.result?.message_id,
      chat_id: result.result?.chat?.id,
      sent_at: new Date().toISOString()
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}