import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * disconnectTelegram — Clears the Telegram mapping for the authenticated user
 * or a specified ExternalRecipient (management only).
 *
 * - Clears telegram_chat_id, sets telegram_connected = false
 * - Preserves other notification preferences
 * - Revokes any pending enrollment tokens
 * - Preserves audit trail
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { externalRecipientId } = body;

    if (externalRecipientId) {
      // Management disconnecting an external recipient — tenant check
      const exts = await base44.asServiceRole.entities.ExternalRecipient.filter({ id: externalRecipientId }).catch(() => []);
      if (!exts.length) return Response.json({ error: 'External recipient not found' }, { status: 404 });
      const ext = exts[0];
      const isPlatformAdmin = !caller.customer_id && (caller.role === 'admin' || caller.role_type === 'platform_admin');
      if (!isPlatformAdmin && ext.customer_id && ext.customer_id !== caller.customer_id) {
        return Response.json({ error: 'Cross-tenant access denied' }, { status: 403 });
      }
      await base44.asServiceRole.entities.ExternalRecipient.update(externalRecipientId, {
        telegram_chat_id: undefined,
        telegram_connected: false,
        telegram_connected_at: undefined,
        telegram_username: undefined,
      });
      // Revoke pending enrollments
      const pending = await base44.asServiceRole.entities.TelegramEnrollment.filter({
        external_recipient_id: externalRecipientId,
        status: 'pending'
      }).catch(() => []);
      for (const e of pending) {
        await base44.asServiceRole.entities.TelegramEnrollment.update(e.id, { status: 'revoked' }).catch(() => {});
      }
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        action: 'TELEGRAM_DISCONNECTED',
        entity_name: 'ExternalRecipient',
        entity_id: externalRecipientId,
        performed_by_id: caller.id,
        performed_by_name: caller.display_name || caller.full_name,
        customer_id: ext.customer_id,
        details: JSON.stringify({ subject: 'external_recipient' }),
      }).catch(() => {});
    } else {
      // User disconnecting themselves
      await base44.asServiceRole.entities.User.update(caller.id, {
        telegram_chat_id: undefined,
        telegram_connected: false,
        telegram_connected_at: undefined,
        telegram_username: undefined,
        telegram_first_name: undefined,
        telegram_last_name: undefined,
      });
      // Revoke pending enrollments
      const pending = await base44.asServiceRole.entities.TelegramEnrollment.filter({
        user_id: caller.id,
        status: 'pending'
      }).catch(() => []);
      for (const e of pending) {
        await base44.asServiceRole.entities.TelegramEnrollment.update(e.id, { status: 'revoked' }).catch(() => {});
      }
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        action: 'TELEGRAM_DISCONNECTED',
        entity_name: 'User',
        entity_id: caller.id,
        performed_by_id: caller.id,
        performed_by_name: caller.display_name || caller.full_name,
        customer_id: caller.customer_id,
        details: JSON.stringify({ subject: 'user' }),
      }).catch(() => {});
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}