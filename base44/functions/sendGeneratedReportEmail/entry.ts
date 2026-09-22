/**
 * sendGeneratedReportEmail — SERVER-SIDE BRANDED DISPATCH for the Auto Report
 * Generator's configured-recipient shift report emails. The client now only
 * supplies the GeneratedReport id it just saved; this function re-reads the
 * SAVED report content (authoritative — never client-resendable bodies), the
 * recipient list from the SAVED ReportTemplate record (authoritative — never
 * the client-supplied list), resolves the effective tenant branding
 * (resolveCommunicationBrand) and records every delivery attempt in the
 * NotificationDelivery audit trail.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({})) || {};
    const reportId = String(body.report_id || '');
    if (!reportId) return Response.json({ error: 'report_id is required' }, { status: 400 });

    const rows = await svc.entities.GeneratedReport.filter({ id: reportId }).catch(() => []);
    const report = (rows && rows[0]) || null;
    if (!report) return Response.json({ error: 'Report not found' }, { status: 404 });

    // TENANT CHECK — the report's tenant wins; a cross-tenant id is rejected
    // (platform admins excepted).
    const isPlatformCaller = caller.role_type === 'admin' || caller.role_type === 'platform_admin'
      || caller.admin_level === 'platform';
    if (!isPlatformCaller && report.customer_id && caller.customer_id
        && String(report.customer_id) !== String(caller.customer_id)) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }

    // AUTHORITATIVE recipients — re-read from the SAVED template record.
    let recipients: string[] = [];
    if (report.template_id) {
      const tRows = await svc.entities.ReportTemplate.filter({ id: String(report.template_id) }).catch(() => []);
      const template = (tRows && tRows[0]) || null;
      if (template && Array.isArray(template.recipients)) {
        recipients = template.recipients.map((r: any) => String(r || '').trim()).filter(Boolean);
      }
    }
    if (!recipients.length) {
      return Response.json({ sent: 0, error: 'No configured recipients on the report template' }, { status: 400 });
    }

    const brand = await resolveCommunicationBrand(svc, {
      customer_id: report.customer_id || caller.customer_id || null,
      reseller_id: report.reseller_id || caller.reseller_id || null,
    });

    // Content from the SAVED record — the same light markdown conversion the
    // previous client email used (no behaviour change in rendering).
    const contentHtml = String(report.content || '')
      .replace(/\n/g, '<br>')
      .replace(/\*\*/g, '<b>')
      .replace(/\*/g, '</b>');

    let sent = 0;
    const failures: string[] = [];
    for (const to of recipients.slice(0, 50)) {
      const res = await sendAuditedEmail(svc, {
        to,
        subject: `Shift Report: ${report.guard_name || 'Guard'} — ${report.site_name || ''}`,
        body: contentHtml,
        brand,
        customer_id: report.customer_id || caller.customer_id || null,
        reseller_id: report.reseller_id || null,
        recipient_name: to,
        event_type: 'generated_report_email',
        reference_id: report.id,
      });
      if (res.ok) sent++;
      else failures.push(String(res.error));
    }
    return Response.json({ sent, failures });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}