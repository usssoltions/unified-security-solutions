import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * setTelegramWebhook — Sets the Telegram bot webhook to point to the
 * telegramWebhook backend function on this app's deployed URL.
 *
 * Platform admin only. Reads the app domain from the incoming request URL.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const isPlatformAdmin = !caller.customer_id && (caller.role === 'admin' || caller.role_type === 'platform_admin');
    if (!isPlatformAdmin) return Response.json({ error: 'Platform admin only' }, { status: 403 });

    const botToken = secrets.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return Response.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, { status: 503 });

    // Construct webhook URL from the incoming request URL
    const url = new URL(req.url);
    const webhookUrl = `${url.protocol}//${url.host}/api/functions/telegramWebhook`;

    const resp = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: JSON.stringify(['message']),
        drop_pending_updates: true,
      }),
    });
    const result = await resp.json();

    return Response.json({
      success: result.ok,
      webhook_url: webhookUrl,
      telegram_response: result,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}