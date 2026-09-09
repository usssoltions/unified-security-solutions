import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { sendNativePush } from '../../shared/nativePush.ts';

/**
 * sendTestPushNotification — DIAGNOSTIC native test push.
 *
 * Sends a REAL Base44 native push (no fake business event, no records
 * created beyond the delivery log) to the selected user's registered
 * devices. Any authenticated user may test THEIR OWN device; targeting
 * ANOTHER user requires platform-admin authority. Intended for the admin
 * diagnostics surface (registered devices / last push state) and the
 * user's own Profile test button.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const isPlatformAdmin =
      caller.role_type === 'admin' ||
      caller.role_type === 'platform_admin' ||
      caller.admin_level === 'platform';

    const targetUserId = String(body.userId || body.user_id || caller.id);
    if (targetUserId !== caller.id && !isPlatformAdmin) {
      return Response.json({ error: 'Only platform administrators may send a test push to another user' }, { status: 403 });
    }

    // Unique event key per test — diagnostic sends are never deduped.
    const pr = await sendNativePush(base44.asServiceRole, {
      user_id: targetUserId,
      title: String(body.title || 'USS Test Notification'),
      body: String(body.message || 'This is a diagnostic test push from your USS app. If you can read this with the app closed, native push is working.'),
      priority: 'normal',
      force: true,
      action_label: 'Open App',
      action_url: '/',
      event_key: 'test_push:' + targetUserId + ':' + Date.now(),
      customer_id: caller.customer_id || null,
      reseller_id: caller.reseller_id || null,
    });

    return Response.json({
      success: pr.status === 'sent',
      status: pr.status,
      reason: pr.reason || null,
      error: pr.error || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}