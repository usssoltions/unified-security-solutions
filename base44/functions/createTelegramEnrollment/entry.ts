import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * createTelegramEnrollment — Generates a secure one-time enrollment token
 * for connecting a USS user (or ExternalRecipient) to Telegram.
 *
 * Returns a t.me deep link with the token as the start parameter.
 * The token is hashed at rest; plaintext is returned once to the caller.
 *
 * The caller (authenticated USS user) initiates enrollment for themselves,
 * or a management user initiates it for an ExternalRecipient.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { externalRecipientId } = body;

    // If externalRecipientId is provided, the caller must be authorized to manage that recipient.
    // Otherwise, enroll the caller themselves.
    let subjectType = 'user';
    let subjectId = caller.id;
    let customerId = caller.customer_id;
    let resellerId = caller.reseller_id;
    let siteId = caller.site_id;

    if (externalRecipientId) {
      subjectType = 'external_recipient';
      subjectId = externalRecipientId;
      const exts = await base44.asServiceRole.entities.ExternalRecipient.filter({ id: externalRecipientId }).catch(() => []);
      if (!exts.length) return Response.json({ error: 'External recipient not found' }, { status: 404 });
      const ext = exts[0];
      // Tenant check: caller must belong to same customer or be platform admin
      const isPlatformAdmin = !caller.customer_id && (caller.role === 'admin' || caller.role_type === 'platform_admin');
      if (!isPlatformAdmin && ext.customer_id && ext.customer_id !== caller.customer_id) {
        return Response.json({ error: 'Cross-tenant access denied' }, { status: 403 });
      }
      customerId = ext.customer_id;
      resellerId = ext.reseller_id;
      siteId = ext.site_id;
    }

    // Generate a random one-time token
    const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
    const tokenHash = await sha256(token);

    // Token expires in 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Revoke any existing pending enrollments for this subject
    const existing = await base44.asServiceRole.entities.TelegramEnrollment.filter({
      $and: [
        { [subjectType === 'user' ? 'user_id' : 'external_recipient_id']: subjectId },
        { status: 'pending' }
      ]
    }).catch(() => []);
    for (const e of existing) {
      await base44.asServiceRole.entities.TelegramEnrollment.update(e.id, { status: 'revoked' }).catch(() => {});
    }

    // Create the enrollment record
    const enrollment = await base44.asServiceRole.entities.TelegramEnrollment.create({
      user_id: subjectType === 'user' ? subjectId : undefined,
      subject_type: subjectType,
      external_recipient_id: subjectType === 'external_recipient' ? subjectId : undefined,
      customer_id: customerId,
      reseller_id: resellerId,
      site_id: siteId,
      token_hash: tokenHash,
      status: 'pending',
      expires_at: expiresAt,
    });

    // Get bot username to construct deep link
    const botToken = secrets.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) return Response.json({ error: 'Telegram bot token not configured' }, { status: 503 });

    const meResp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    const meResult = await meResp.json();
    if (!meResult.ok) return Response.json({ error: 'Failed to resolve bot username' }, { status: 502 });

    const botUsername = meResult.result.username;
    const deepLink = `https://t.me/${botUsername}?start=${token}`;

    // Log audit
    await base44.asServiceRole.entities.PlatformAuditLog.create({
      action: subjectType === 'user' ? 'TELEGRAM_CONNECT_REQUESTED' : 'EXTERNAL_RECIPIENT_TELEGRAM_INVITE',
      entity_name: 'TelegramEnrollment',
      entity_id: enrollment.id,
      performed_by_id: caller.id,
      performed_by_name: caller.display_name || caller.full_name || caller.email,
      customer_id: customerId,
      reseller_id: resellerId,
      details: JSON.stringify({ subject_type: subjectType, subject_id: subjectId }),
    }).catch(() => {});

    return Response.json({
      success: true,
      enrollment_id: enrollment.id,
      deep_link: deepLink,
      bot_username: botUsername,
      expires_at: expiresAt,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}