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
      // IMPORTANT: undefined keys are dropped by the SDK and do NOT clear stored
      // values (this is how a stale chat_id previously survived disconnect).
      // Clear with explicit empty strings — the engine treats falsy chat_id as unmapped.
      await base44.asServiceRole.entities.ExternalRecipient.update(externalRecipientId, {
        telegram_chat_id: '',
        telegram_connected: false,
        telegram_username: '',
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
        event_type: 'telegram.disconnected',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        entity_name: 'ExternalRecipient',
        entity_id: externalRecipientId,
        action: 'disconnect',
        customer_id: ext.customer_id,
        reseller_id: ext.reseller_id,
        notes: 'Telegram mapping cleared. Notifications already dispatched before disconnect may still be delivered by Telegram.',
      }).catch(() => {});
    } else {
      // User disconnecting themselves
      // IMPORTANT: undefined keys are dropped by the SDK and do NOT clear stored
      // values (this is how a stale chat_id previously survived disconnect).
      // Clear with explicit empty strings — the engine treats falsy chat_id as unmapped.
      await base44.asServiceRole.entities.User.update(caller.id, {
        telegram_chat_id: '',
        telegram_connected: false,
        telegram_username: '',
        telegram_first_name: '',
        telegram_last_name: '',
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
        event_type: 'telegram.disconnected',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        entity_name: 'User',
        entity_id: caller.id,
        action: 'disconnect',
        customer_id: caller.customer_id,
        reseller_id: caller.reseller_id,
        notes: 'Telegram mapping cleared (chat_id emptied, connected=false). Notifications already dispatched before disconnect may still be delivered by Telegram.',
      }).catch(() => {});
    }

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}