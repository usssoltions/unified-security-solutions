import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { renderTransactionalShell } from '../../shared/transactionalEmail.ts';
import { isPlatformAdmin, isResellerAdmin } from '../../shared/deviceLicensing.ts';
import {
  computeReportingPeriod, makeZonedFormatters, buildDailyAccessModel,
  renderDailyAccessEmailBody, buildDailyAccessPdf, buildDailyAccessCsv,
  DEFAULT_REPORT_TIMEZONE,
} from '../../shared/dailyAccessReport.ts';

/**
 * generateDailyAccessReport — AUTHORITATIVE Daily Access Control Report.
 *
 * INVOCATION MODES:
 *  1. Scheduled bulk (no site_id, no action) — the server-side 17:00 workflow.
 *     Iterates ALL active sites with a customer; one report per site.
 *     Idempotent: a GeneratedReport (report_type 'daily' + site_id +
 *     report_date of the reporting period) means the site is skipped, so a
 *     scheduler retry never sends the same scheduled report twice.
 *  2. Manual single-site (site_id) — authenticated callers authorized for
 *     that site's customer (platform / owning reseller / owning customer
 *     admin) only. Same idempotency as the scheduled path.
 *  3. Test send (action: 'send_test', site_id) — same authorization; sends
 *     ONE clearly-marked '[TEST]' report to the CALLER only, does NOT create
 *     a GeneratedReport and does NOT touch the scheduled-send idempotency
 *     state (audited: report.test_sent).
 *
 * REPORTING PERIOD: CONTINUOUS — previous day 17:00:00 → current day 16:59:59
 * in the SITE-LOCAL timezone (default Africa/Johannesburg; never UTC-
 * hardcoded), so no activity after 17:00 ever disappears. Carry-over exits
 * (entered before the window, exited inside it) are included here and were
 * reported as still-on-site in the previous report — every visit falls into
 * exactly one period.
 *
 * TENANT ISOLATION: every query is scoped to the site's customer; only that
 * customer's authorised recipients receive it. Delivery is audited via the
 * central sendAuditedEmail path (NotificationDelivery) — the audit records
 * report type, period, recipient and delivery status only, never visitor
 * personal data.
 */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  return btoa(bin);
}

function utf8ToBase64(s: string): string {
  return bytesToBase64(new TextEncoder().encode(s));
}

const sanitizeFileToken = (v: any) =>
  String(v || 'Report').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Report';

/** Recipients for the daily report of a site: tenant-scoped, site-scoped,
 *  normalized + deduplicated by email (an internal-user record and an
 *  external record for the same address receive ONE copy). */
async function resolveDailyAccessRecipients(svc: any, customerId: string, siteId: string) {
  const rows = await svc.entities.ExternalRecipient.filter({ customer_id: String(customerId) }).catch(() => []);
  const byEmail = new Map<string, { email: string; name: string | null; telegram: string | null }>();
  for (const er of rows || []) {
    if (!er || er.active === false) continue; // deactivated → no future sends
    if (er.reports_enabled === false) continue;
    const prefs: string[] = Array.isArray(er.report_preferences) ? er.report_preferences : [];
    if (prefs.includes('daily_access_opt_out')) continue; // explicit opt-out — wins over the legacy empty/all default
    if (prefs.length && !prefs.includes('daily_access')) continue;
    if (er.site_id && String(er.site_id) !== String(siteId)) continue; // site-scoped recipient
    const email = String(er.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (!byEmail.has(email)) {
      byEmail.set(email, { email, name: er.name || null, telegram: er.telegram_chat_id || null });
    }
  }
  return Array.from(byEmail.values());
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const isTest = String(body?.action || '') === 'send_test';
    const singleSiteId = String(body?.site_id || '') || null;

    // Non-scheduled invocations REQUIRE an authenticated, authorized caller.
    let testCaller: any = null;
    if (isTest || singleSiteId) {
      const caller = await base44.auth.me().catch(() => null);
      if (!caller) return Response.json({ error: 'Authentication required', code: 'auth_required' }, { status: 401 });
      testCaller = caller;
    }

    // Resolve the sites to process.
    let sitesToProcess: any[] = [];
    if (singleSiteId) {
      const rows = await svc.entities.Site.filter({ id: singleSiteId }).catch(() => []);
      const site = (rows || [])[0];
      if (!site) return Response.json({ error: 'Site not found', code: 'site_not_found' }, { status: 404 });
      sitesToProcess = [site];
    } else {
      sitesToProcess = await svc.entities.Site.filter({ status: 'active' }).catch(() => []);
    }

    let generated = 0;
    let skipped = 0;
    let noRecipients = 0;
    const errors: string[] = [];

    for (const site of sitesToProcess) {
      try {
        const cid = String(site.customer_id || '');
        if (!cid) { skipped++; continue; }
        const rid = site.reseller_id || null;

        // ── Authorization for non-scheduled invocations ──
        if (singleSiteId) {
          const caller = testCaller;
          let authorized = false;
          if (isPlatformAdmin(caller)) authorized = true;
          else if (isResellerAdmin(caller) && rid && String(rid) === String(caller.reseller_id)) authorized = true;
          else if (caller.customer_id && String(caller.customer_id) === cid
            && ['customer_admin', 'admin'].includes(String(caller.role_type || ''))) authorized = true;
          if (!authorized) {
            return Response.json({ error: 'You do not have permission to generate reports for this site.', code: 'permission_denied' }, { status: 403 });
          }
        }

        const custRows = await svc.entities.Customer.filter({ id: cid }).catch(() => []);
        const customer = (custRows || [])[0];
        if (!customer) { skipped++; continue; }

        const tz = DEFAULT_REPORT_TIMEZONE; // per-site timezone default (SAST)
        const nowMs = Date.now();
        const period = computeReportingPeriod(nowMs, tz);
        const fmt = makeZonedFormatters(tz);

        // Scheduled idempotency — customer + site + report_type + period.
        if (!isTest) {
          const existing = await svc.entities.GeneratedReport.filter({
            report_type: 'daily', site_id: site.id, report_date: period.reportDateIso,
          }).catch(() => []);
          if (existing && existing.length > 0) { skipped++; continue; }
        }

        // ── Tenant-scoped data (site + its customer ONLY) ──
        const [insideRows, exitedRows, deniedRows, overRows, devices] = await Promise.all([
          svc.entities.AccessLog.filter({ site_id: site.id, status: 'inside' }, '-timestamp', 200).catch(() => []),
          svc.entities.AccessLog.filter({ site_id: site.id, status: 'exited' }, '-timestamp', 1000).catch(() => []),
          svc.entities.AccessLog.filter({ site_id: site.id, status: 'denied' }, '-timestamp', 200).catch(() => []),
          svc.entities.AccessLog.filter({ site_id: site.id, status: 'overridden' }, '-timestamp', 200).catch(() => []),
          svc.entities.DeviceRegistration.filter({ customer_id: cid, status: 'active' }).catch(() => []),
        ]);
        const stillInside = insideRows || [];
        const exited = exitedRows || [];
        const denied = [...(deniedRows || []), ...(overRows || [])];
        const model = buildDailyAccessModel({
          period, fmt, stillInside, exited, denied,
          devices: devices || [],
          customerName: customer.name,
          siteName: site.name,
          generatedAtMs: nowMs,
        });

        // ── Branded renders (customer → reseller → platform resolver) ──
        const brand = await resolveCommunicationBrand(svc, { customer_id: cid, reseller_id: rid });
        const html = renderTransactionalShell({
          brand,
          title: `Daily Access Control Report — ${site.name}`,
          bodyHtml: renderDailyAccessEmailBody(model),
        });
        const textSummary = [
          `DAILY ACCESS CONTROL REPORT — ${customer.name} — ${site.name}`,
          `Reporting period: ${model.meta.reportingPeriod} (${tz})`,
          `Entries: ${model.summary.totalEntries} | Exits: ${model.summary.totalExits} | Still on site: ${model.summary.stillOnSite}`,
          `Unique visitors: ${model.summary.uniqueVisitors} | Vehicles: ${model.summary.vehicleEntries} | Deliveries: ${model.summary.deliveries}`,
          model.attention.length ? `Attention: ${model.attention[0]}` : 'No access exceptions requiring attention.',
        ].join('\n');

        const periodKey = period.reportDateIso;
        const pdfB64 = bytesToBase64(buildDailyAccessPdf(model, brand));
        const csvB64 = utf8ToBase64(buildDailyAccessCsv(model));
        const attachments = [
          { filename: `Daily_Access_Report_${sanitizeFileToken(customer.name)}_${sanitizeFileToken(site.name)}_${periodKey}.pdf`, content: pdfB64 },
          { filename: `Daily_Access_Register_${sanitizeFileToken(customer.name)}_${sanitizeFileToken(site.name)}_${periodKey}.csv`, content: csvB64 },
        ];

        // ── Store the authoritative report record (scheduled + manual) ──
        if (!isTest) {
          await svc.entities.GeneratedReport.create({
            title: `Daily Access Control Report — ${customer.name} — ${site.name} — ${model.meta.reportDate}`,
            report_type: 'daily',
            guard_id: 'system_automation',
            guard_name: 'System Automation',
            site_id: site.id,
            site_name: site.name,
            report_date: periodKey,
            content: html,
            summary: `${model.summary.totalEntries} entries, ${model.summary.totalExits} exits, ${model.summary.stillOnSite} still on site, ${model.summary.denied} denied`,
            statistics: {
              total_entries: model.summary.totalEntries,
              total_exits: model.summary.totalExits,
              still_on_site: model.summary.stillOnSite,
              unique_visitors: model.summary.uniqueVisitors,
              denied: model.summary.denied,
              overrides: model.summary.overrides,
              checkpoints_scanned: model.summary.totalEntries,
              alerts_responded: model.summary.overrides,
            },
            generated_at: new Date(nowMs).toISOString(),
          }).catch(() => {});
        }

        // ── Recipients & audited delivery ──
        const subjectBase = `Daily Access Control Report — ${customer.name} — ${site.name} — ${model.meta.reportDate}`;
        let recipientCount = 0;

        if (isTest) {
          // TEST send → the authorised caller only. Marked TEST, no
          // GeneratedReport, no effect on scheduled-send idempotency.
          const to = String(testCaller.email || '').trim().toLowerCase();
          const res = await sendAuditedEmail(svc, {
            to, subject: `[TEST] ${subjectBase}`, html, text: textSummary,
            from_name: brand.brand_name, brand, customer_id: cid, reseller_id: rid,
            event_type: 'daily_access_report_test',
            reference_id: `TEST:${site.id}:${periodKey}:${Date.now()}`,
            template_name: 'daily_access_report',
            attachments,
          });
          await svc.entities.PlatformAuditLog.create({
            event_type: 'report.test_sent',
            customer_id: cid, reseller_id: rid || undefined,
            user_id: testCaller.id, user_name: testCaller.display_name || testCaller.full_name || testCaller.email,
            entity_name: 'Site', entity_id: site.id, action: 'send_test_report',
            new_values: JSON.stringify({ report_type: 'daily_access', reporting_period: periodKey, delivery_ok: !!res?.ok }),
            notes: `TEST Daily Access Control Report sent for site ${site.name}`,
          }).catch(() => {});
          return Response.json({
            success: true, test: true, site: { id: site.id, name: site.name },
            reporting_period: model.meta.reportingPeriod,
            sent_to: to, delivery_ok: !!res?.ok, delivery_note: res?.ok ? undefined : (res?.error || 'delivery skipped'),
          });
        }

        const recipients = await resolveDailyAccessRecipients(svc, cid, site.id);
        for (const r of recipients) {
          await sendAuditedEmail(svc, {
            to: r.email, subject: subjectBase, html, text: textSummary,
            from_name: brand.brand_name, brand, customer_id: cid, reseller_id: rid,
            recipient_name: r.name || undefined,
            event_type: 'daily_access_report',
            reference_id: `${site.id}:${periodKey}`,
            idempotency_key: `daily_access_report:${site.id}:${periodKey}:${r.email}`,
            dedupe: true,
            template_name: 'daily_access_report',
            attachments,
          });
          recipientCount++;
        }
        if (recipientCount === 0) noRecipients++;

        // Telegram short summary (unchanged legacy channel, best-effort).
        const botToken = secrets.get ? secrets.get('TELEGRAM_BOT_TOKEN') : (secrets as any).TELEGRAM_BOT_TOKEN;
        if (botToken) {
          for (const r of recipients) {
            if (!r.telegram) continue;
            try {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: r.telegram,
                  text: `<b>${brand.brand_name}</b>\n<b>Daily Access Control Report — ${site.name}</b>\nPeriod: ${model.meta.reportingPeriod}\nEntries: ${model.summary.totalEntries} | Exits: ${model.summary.totalExits} | Still on site: ${model.summary.stillOnSite}`,
                  parse_mode: 'HTML', disable_web_page_preview: true,
                }),
              });
            } catch (tgErr: any) { console.error('DAR telegram error:', tgErr?.message || tgErr); }
          }
        }

        generated++;
      } catch (siteErr: any) {
        errors.push(`${site.id}: ${siteErr?.message || siteErr}`);
      }
    }

    return Response.json({
      success: true,
      sites_processed: sitesToProcess.length,
      generated,
      skipped,
      no_recipient_sites: noRecipients,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return Response.json({ error: String((error as any)?.message || error) }, { status: 500 });
  }
}