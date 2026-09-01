import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * generateDailyAccessReport — Server-side daily access report.
 *
 * TWO invocation modes:
 *  1. Per-site (body.site_id): generates a report for that one site only.
 *     Used by manual/per-site callers.
 *  2. Scheduled bulk (no site_id): iterates ALL active sites that have
 *     access activity today, and generates one report per site — skipping any
 *     site that already has a daily report for today (idempotent). This is the
 *     mode the scheduled automation uses; previously the function 400'd on the
 *     missing site_id, which is why the automation failed 5x and was paused.
 *
 * Idempotency: a GeneratedReport with report_type='daily' + site_id + report_date
 * already existing means that site is skipped on a re-run.
 *
 * Stores as GeneratedReport. Sends Email + Telegram to configured external
 * recipients for the site's customer. Uses asServiceRole for all integration
 * calls so the scheduled (no-user) invocation can still send email.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { site_id, customer_id } = body;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const reportDate = todayStart.toISOString().split('T')[0];

    // Resolve the list of sites to process.
    let sitesToProcess: any[] = [];
    if (site_id) {
      const sites = await base44.asServiceRole.entities.Site.filter({ id: site_id });
      const site = sites[0];
      if (!site) return Response.json({ error: 'Site not found' }, { status: 404 });
      sitesToProcess = [site];
    } else {
      // Scheduled bulk: all active sites.
      sitesToProcess = await base44.asServiceRole.entities.Site.filter({ status: 'active' });
    }

    let generated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const site of sitesToProcess) {
      try {
        const cid = site.customer_id || customer_id;
        const rid = site.reseller_id;

        // Idempotency: skip if a daily report for this site+date already exists.
        const existing = await base44.asServiceRole.entities.GeneratedReport.filter({
          report_type: 'daily', site_id: site.id, report_date: reportDate,
        });
        if (existing && existing.length > 0) { skipped++; continue; }

        // Today's access logs for this site.
        const allLogs = await base44.asServiceRole.entities.AccessLog.filter({ site_id }, '-timestamp', 1000);
        const todayLogs = allLogs.filter((l: any) => new Date(l.timestamp) >= todayStart);

        const entries = todayLogs.filter((l: any) => l.event_type === 'entry' || (l.event_type === 'exit' && l.status === 'exited'));
        const stillInside = todayLogs.filter((l: any) => l.status === 'inside');
        const denied = todayLogs.filter((l: any) => l.status === 'denied' || l.status === 'blacklisted');
        const overrides = todayLogs.filter((l: any) => l.status === 'override_approved' || l.status === 'overridden');

        const reportNumber = `DAR-${reportDate}-${site.id.slice(-6)}`;

        const rows = todayLogs.map((l: any) => `
          <tr>
            <td>${l.person_name || ''}</td>
            <td>${l.person_phone || ''}</td>
            <td>${l.person_type || ''}</td>
            <td>${l.vehicle_registration || ''}</td>
            <td>${l.destination || ''}</td>
            <td>${l.work_type || l.visit_or_work || ''}</td>
            <td>${l.gate_name || ''}</td>
            <td>${l.entry_time ? new Date(l.entry_time).toLocaleTimeString('en-ZA') : ''}</td>
            <td>${l.exit_time ? new Date(l.exit_time).toLocaleTimeString('en-ZA') : ''}</td>
            <td>${l.time_on_site_minutes || ''}</td>
            <td>${l.guard_name || ''}</td>
            <td>${l.status}</td>
          </tr>`).join('');

        const html = `
          <html><body style="font-family: Arial, sans-serif;">
          <h2>Daily Access Report — ${site.name}</h2>
          <p>Date: ${reportDate}</p>
          <p>Generated: ${new Date().toISOString()}</p>
          <h3>Summary</h3>
          <ul>
            <li>Total events: ${todayLogs.length}</li>
            <li>Entries: ${entries.length}</li>
            <li>Currently inside: ${stillInside.length}</li>
            <li>Denied/Blacklisted: ${denied.length}</li>
            <li>Overrides: ${overrides.length}</li>
          </ul>
          <h3>Detail</h3>
          <table border="1" cellpadding="5" style="border-collapse: collapse; font-size: 12px;">
            <tr><th>Visitor</th><th>Phone</th><th>Type</th><th>Vehicle</th><th>Destination</th><th>Purpose</th><th>Gate</th><th>Entry</th><th>Exit</th><th>Minutes</th><th>Guard</th><th>Status</th></tr>
            ${rows}
          </table>
          </body></html>`;

        const report = await base44.asServiceRole.entities.GeneratedReport.create({
          title: `Daily Access Report — ${site.name} — ${reportDate}`,
          report_type: 'daily',
          guard_id: 'system_automation',
          guard_name: 'System Automation',
          site_id: site.id,
          site_name: site.name,
          report_date: reportDate,
          content: html,
          summary: `${entries.length} entries, ${stillInside.length} inside, ${denied.length} denied`,
          statistics: {
            patrols_completed: 0,
            incidents_reported: denied.length,
            trainings_completed: 0,
            checkpoints_scanned: entries.length,
            alerts_responded: overrides.length,
          },
          generated_at: new Date().toISOString(),
        });

        // Send notifications (Email + Telegram) to configured external recipients.
        // asServiceRole so the scheduled (no-user) invocation can send.
        try {
          if (cid) {
            const externalRecipients = await base44.asServiceRole.entities.ExternalRecipient.filter({ customer_id: cid, active: true });
            const botToken = secrets.get('TELEGRAM_BOT_TOKEN');
            for (const er of externalRecipients) {
              if (er.email) {
                await base44.asServiceRole.integrations.Core.SendEmail({
                  to: er.email,
                  subject: `Daily Access Report — ${site.name} — ${reportDate}`,
                  body: html
                }).catch((e: any) => console.error('DAR email failed:', e.message));
              }
              if (er.telegram_chat_id && botToken) {
                try {
                  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: er.telegram_chat_id,
                      text: `<b>Daily Access Report — ${site.name}</b>\nDate: ${reportDate}\nEntries: ${entries.length} | Inside: ${stillInside.length} | Denied: ${denied.length}`,
                      parse_mode: 'HTML',
                      disable_web_page_preview: true,
                    }),
                  });
                } catch (tgErr) { console.error('Telegram send error:', tgErr.message); }
              }
            }
          }
        } catch (e) {
          console.error('DAR notification error:', e.message);
        }

        generated++;
      } catch (siteErr: any) {
        errors.push(`${site.id}: ${siteErr.message}`);
      }
    }

    return Response.json({
      success: true,
      sites_processed: sitesToProcess.length,
      generated,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}