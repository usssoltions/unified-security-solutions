/**
 * sendCheckpointQrEmail — SERVER-SIDE BRANDED DISPATCH for the Checkpoint QR
 * Generator's "Email QR code" action. The client now only supplies the site +
 * checkpoint ids and the operator-chosen recipient address (a MANUAL share by
 * an authorised administrator, exactly like the existing manual WhatsApp
 * link); this function resolves the checkpoint from the AUTHORITATIVE Site
 * record, rebuilds the QR image payload server-side (no client-supplied image
 * URL is ever embedded), applies the effective tenant branding
 * (resolveCommunicationBrand) and records the delivery attempt in the
 * NotificationDelivery audit trail.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { resolveCommunicationBrand, buildBrandedEmail } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({})) || {};
    const siteId = String(body.site_id || '');
    const checkpointId = String(body.checkpoint_id || '');
    const to = String(body.to || '').trim();
    if (!siteId || !checkpointId) {
      return Response.json({ error: 'site_id and checkpoint_id are required' }, { status: 400 });
    }
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return Response.json({ error: 'A valid recipient email is required' }, { status: 400 });
    }

    // AUTHORITATIVE RESOLUTION — the Site record owns the checkpoint data; the
    // caller must belong to the site's tenant (platform admins excepted).
    const rows = await svc.entities.Site.filter({ id: siteId }).catch(() => []);
    const site = (rows && rows[0]) || null;
    if (!site) return Response.json({ error: 'Site not found' }, { status: 404 });
    const isPlatformCaller = caller.role_type === 'admin' || caller.role_type === 'platform_admin'
      || caller.admin_level === 'platform';
    if (!isPlatformCaller && site.customer_id && caller.customer_id
        && String(site.customer_id) !== String(caller.customer_id)) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    const checkpoint = (site.checkpoints || []).find((c: any) => String(c?.id) === checkpointId);
    if (!checkpoint) return Response.json({ error: 'Checkpoint not found' }, { status: 404 });
    if (!checkpoint.qr_code) {
      return Response.json({ error: 'This checkpoint has no QR code' }, { status: 400 });
    }

    // QR image rebuilt server-side from the AUTHORITATIVE record — identical
    // payload structure to the on-screen generator.
    const qrData = JSON.stringify({
      checkpoint_id: checkpoint.id,
      qr_code: checkpoint.qr_code,
      site_name: site.name,
      checkpoint_name: checkpoint.name,
      location: checkpoint.location || null,
      generated_at: new Date().toISOString(),
    });
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;

    const brand = await resolveCommunicationBrand(svc, {
      customer_id: site.customer_id || caller.customer_id || null,
      reseller_id: site.reseller_id || caller.reseller_id || null,
    });

    const tpl = buildBrandedEmail({
      brand,
      heading: `Checkpoint QR Code — ${checkpoint.name}`,
      greeting: 'Hello,',
      intro: `QR code for checkpoint verification at ${site.name}. Print this QR code and place it at the checkpoint location.`,
      details: [
        { label: 'Site', value: site.name || '—' },
        { label: 'Checkpoint', value: checkpoint.name || '—' },
        { label: 'QR Code', value: String(checkpoint.qr_code) },
        { label: 'QR Code Image', value: qrUrl },
        (checkpoint.location && Number.isFinite(Number(checkpoint.location.lat)))
          ? { label: 'Location', value: `${Number(checkpoint.location.lat).toFixed(6)}, ${Number(checkpoint.location.lng).toFixed(6)}` }
          : null,
      ],
      closing: 'Scanning this code with the app logs a checkpoint visit for the patrolling guard.',
    });
    const res = await sendAuditedEmail(svc, {
      to,
      subject: `Checkpoint QR Code — ${checkpoint.name}`,
      html: tpl.html,
      text: tpl.text,
      brand,
      customer_id: site.customer_id || caller.customer_id || null,
      reseller_id: site.reseller_id || null,
      recipient_name: to,
      event_type: 'checkpoint_qr_share',
      reference_id: `${checkpoint.id}:${Date.now()}`,
    });
    return Response.json({ sent: res.ok ? 1 : 0, error: res.ok ? null : res.error });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}