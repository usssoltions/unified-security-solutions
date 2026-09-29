import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import {
  computeReportingPeriod, makeZonedFormatters, buildDailyAccessModel,
  buildDailyAccessPdf, DEFAULT_REPORT_TIMEZONE,
} from '../../shared/dailyAccessReport.ts';

/**
 * cvPdfVisualSelfTest — TEMPORARY verification tooling (deleted after the
 * 2026-09-29 close-out visual inspection). Rebuilds the Daily Access Control
 * Report for one site using the EXACT production code path
 * (same data loading, same computeReportingPeriod, same buildDailyAccessModel,
 * same buildDailyAccessPdf as generateDailyAccessReport), then stores the
 * generated PDF in private storage so the actual rendering can be visually
 * inspected. It does not send email, does not create GeneratedReport records
 * and never touches production data.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const siteId = String(body?.site_id || '');
    if (!siteId) return Response.json({ error: 'site_id required' }, { status: 400 });

    const siteRows = await svc.entities.Site.filter({ id: siteId }).catch(() => []);
    const site = (siteRows || [])[0];
    if (!site) return Response.json({ error: 'site_not_found' }, { status: 404 });
    const cid = String(site.customer_id || '');
    const custRows = await svc.entities.Customer.filter({ id: cid }).catch(() => []);
    const customer = (custRows || [])[0];
    if (!customer) return Response.json({ error: 'customer_not_found' }, { status: 404 });

    // Identical period/model construction to generateDailyAccessReport.
    const tz = DEFAULT_REPORT_TIMEZONE;
    const nowMs = Date.now();
    const period = computeReportingPeriod(nowMs, tz);
    const fmt = makeZonedFormatters(tz);

    const [insideRows, exitedRows, deniedRows, overRows, devices] = await Promise.all([
      svc.entities.AccessLog.filter({ site_id: site.id, status: 'inside' }, '-timestamp', 200).catch(() => []),
      svc.entities.AccessLog.filter({ site_id: site.id, status: 'exited' }, '-timestamp', 1000).catch(() => []),
      svc.entities.AccessLog.filter({ site_id: site.id, status: 'denied' }, '-timestamp', 200).catch(() => []),
      svc.entities.AccessLog.filter({ site_id: site.id, status: 'overridden' }, '-timestamp', 200).catch(() => []),
      svc.entities.DeviceRegistration.filter({ customer_id: cid, status: 'active' }).catch(() => []),
    ]);

    const model = buildDailyAccessModel({
      period, fmt,
      stillInside: insideRows || [],
      exited: exitedRows || [],
      denied: [...(deniedRows || []), ...(overRows || [])],
      devices: devices || [],
      customerName: customer.name,
      siteName: site.name,
      generatedAtMs: nowMs,
    });

    const brand = await resolveCommunicationBrand(svc, { customer_id: cid, reseller_id: site.reseller_id || null });
    const pdfBytes = buildDailyAccessPdf(model, brand);
    const pdfFile = new File([pdfBytes], 'Daily_Access_Report_CV_PDF_Test_Estate.pdf', { type: 'application/pdf' });
    const up: any = await svc.integrations.Core.UploadPrivateFile({ file: pdfFile });

    return Response.json({
      success: true,
      file_uri: up?.file_uri || null,
      reporting_period: model.meta.reportingPeriod,
      brand_name: brand?.brand_name || null,
      brand_primary_color: brand?.primary_color || null,
      register_rows: model.register.length,
      still_on_site_rows: model.stillOnSite.length,
      attention_items: model.attention.length,
      pdf_bytes: pdfBytes.length,
    });
  } catch (error) {
    return Response.json({ error: String((error as any)?.message || error) }, { status: 500 });
  }
}