import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { sendAuditedEmail, currentDeliveryMode, testMailboxAllowlist } from '../../shared/auditedEmail.ts';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import { isPlatformAdmin } from '../../shared/deviceLicensing.ts';
import {
  computeReportingPeriod, makeZonedFormatters, buildDailyAccessModel,
  buildDailyAccessPdf, DEFAULT_REPORT_TIMEZONE,
} from '../../shared/dailyAccessReport.ts';

/**
 * deliveryControlTest — PLATFORM ADMIN ONLY email delivery diagnostics.
 * Sends control email 1 (plain text), 2 (small HTML) or 3 (PDF only) through
 * the SAME sendAuditedEmail path the Daily Access Report uses, and returns
 * the delivery diagnostics. Never claims inbox delivery.
 * Body: { control: 1|2|3, site_id? (control 3) }
 */
const TO = 'sales@unifiedbusiness.co.za';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) return Response.json({ error: 'Authentication required' }, { status: 401 });
    if (!isPlatformAdmin(caller)) return Response.json({ error: 'Platform admin only' }, { status: 403 });
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const control = Number(body?.control);
    const ref = `CONTROL${control}:${Date.now()}`;
    const brand = await resolveCommunicationBrand(svc, { customer_id: null, reseller_id: null });
    const base: any = {
      to: TO, brand, from_name: brand.brand_name,
      event_type: 'delivery_control_test', reference_id: ref, template_name: `control_${control}`,
    };
    let filename: string | null = null;
    let privateUri: string | null = null;
    let bytesLen = 0;
    let pdfPages: number | null = null;

    if (control === 1) {
      Object.assign(base, {
        subject: 'USS EMAIL DELIVERY CONTROL TEST',
        text: 'This is a plain-text delivery test from Unified Security Solutions.',
      });
    } else if (control === 2) {
      Object.assign(base, {
        subject: 'USS HTML DELIVERY CONTROL TEST',
        html: '<p>This is a small HTML delivery test from Unified Security Solutions.</p>',
      });
    } else if (control === 3) {
      const siteId = String(body?.site_id || '');
      const site = (await svc.entities.Site.filter({ id: siteId }))[0];
      if (!site) return Response.json({ error: 'Site not found' }, { status: 404 });
      const cid = String(site.customer_id);
      const customer = (await svc.entities.Customer.filter({ id: cid }))[0];
      const tz = DEFAULT_REPORT_TIMEZONE;
      const nowMs = Date.now();
      const period = computeReportingPeriod(nowMs, tz);
      const [inside, exited, denied, over, devices] = await Promise.all([
        svc.entities.AccessLog.filter({ site_id: site.id, status: 'inside' }, '-timestamp', 200).catch(() => []),
        svc.entities.AccessLog.filter({ site_id: site.id, status: 'exited' }, '-timestamp', 1000).catch(() => []),
        svc.entities.AccessLog.filter({ site_id: site.id, status: 'denied' }, '-timestamp', 200).catch(() => []),
        svc.entities.AccessLog.filter({ site_id: site.id, status: 'overridden' }, '-timestamp', 200).catch(() => []),
        svc.entities.DeviceRegistration.filter({ customer_id: cid, status: 'active' }).catch(() => []),
      ]);
      const model = buildDailyAccessModel({
        period, fmt: makeZonedFormatters(tz), stillInside: inside || [], exited: exited || [],
        denied: [...(denied || []), ...(over || [])], devices: devices || [],
        customerName: customer.name, siteName: site.name, generatedAtMs: nowMs,
      });
      const pbrand = await resolveCommunicationBrand(svc, { customer_id: cid, reseller_id: site.reseller_id || null });
      const pdf: Uint8Array = buildDailyAccessPdf(model, pbrand);
      bytesLen = pdf.length;
      pdfPages = (new TextDecoder('latin1').decode(pdf).match(/\/Type\s*\/Page[^s]/g) || []).length;
      filename = `Daily_Access_Report_${String(customer.name).replace(/[^A-Za-z0-9]+/g, '_')}_${String(site.name).replace(/[^A-Za-z0-9]+/g, '_')}_${period.reportDateIso}.pdf`;
      // Keep the artifact for manual review (PRIVATE storage).
      const up = await svc.integrations.Core.UploadPrivateFile({
        file: new File([pdf], filename, { type: 'application/pdf' }),
      });
      privateUri = up?.file_uri || null;
      Object.assign(base, {
        subject: 'USS PDF ATTACHMENT DELIVERY CONTROL TEST',
        text: 'PDF attachment delivery test from Unified Security Solutions.',
        attachments: [{ filename, content: toBase64(pdf) }],
        customer_id: cid, reseller_id: site.reseller_id || undefined,
      });
    } else {
      return Response.json({ error: 'control must be 1, 2 or 3' }, { status: 400 });
    }

    const requestedSubject = base.subject;
    const startedAt = new Date().toISOString();
    const res = await sendAuditedEmail(svc, base);
    return Response.json({
      control, timestamp: startedAt, intended_recipient: TO,
      delivery_mode: currentDeliveryMode(),
      test_mailbox_allowlist: testMailboxAllowlist(),
      requested_subject: requestedSubject,
      from_name: brand.brand_name,
      accepted: !!res.ok, skipped: !!res.skipped, error: res.error || null,
      audit_id: res.audit_id || null,
      send_email_result: res.provider_result ?? null,
      reference_id: `delivery_control_test:${ref}`,
      pdf: filename ? { filename, bytes: bytesLen, pages: pdfPages, private_file_uri: privateUri } : null,
    });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}