import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

/**
 * generateDailyAccessReport — Server-side daily access report at 17:00 site local time.
 *
 * For each active site, generates a comprehensive daily access report including:
 * entries, exits, still inside, visitor, telephone, vehicle, destination, purpose,
 * entry time, exit time, time on site, guard, gate, denied, blacklist, override.
 *
 * Stores as GeneratedReport. Sends automatic Email + Telegram.
 * Optional manual WhatsApp share.
 * No browser dependency — triggered by scheduled automation.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { site_id, customer_id } = body;

    if (!site_id) return Response.json({ error: 'site_id required' }, { status: 400 });

    // Fetch site
    const sites = await base44.asServiceRole.entities.Site.filter({ id: site_id });
    const site = sites[0];
    if (!site) return Response.json({ error: 'Site not found' }, { status: 404 });

    const cid = site.customer_id || customer_id;
    const rid = site.reseller_id;

    // Today's access logs for this site
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const allLogs = await base44.asServiceRole.entities.AccessLog.filter({ site_id }, '-timestamp', 1000);
    const todayLogs = allLogs.filter(l => new Date(l.timestamp) >= todayStart);

    const entries = todayLogs.filter(l => l.event_type === 'entry' || (l.event_type === 'exit' && l.status === 'exited'));
    const stillInside = todayLogs.filter(l => l.status === 'inside');
    const denied = todayLogs.filter(l => l.status === 'denied' || l.status === 'blacklisted');
    const overrides = todayLogs.filter(l => l.status === 'override_approved' || l.status === 'overridden');

    const reportDate = todayStart.toISOString().split('T')[0];
    const reportNumber = `DAR-${reportDate}-${site.id.slice(-6)}`;

    // Build HTML report with visitor telephone column
    const rows = todayLogs.map(l => `
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

    // Store as GeneratedReport — uses entity-required fields (guard_id, content)
    // and the valid report_type enum value 'daily'.
    const report = await base44.asServiceRole.entities.GeneratedReport.create({
      title: `Daily Access Report — ${site.name} — ${reportDate}`,
      report_type: 'daily',
      guard_id: 'system_automation',
      guard_name: 'System Automation',
      site_id,
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

    // Send notifications (Email + Telegram) to configured recipients
    try {
      const externalRecipients = await base44.asServiceRole.entities.ExternalRecipient.filter({ customer_id: cid, active: true });
      const botToken = secrets.get('TELEGRAM_BOT_TOKEN');
      for (const er of externalRecipients) {
        if (er.email) {
          await base44.integrations.Core.SendEmail({
            to: er.email,
            subject: `Daily Access Report — ${site.name} — ${reportDate}`,
            body: html
          });
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
    } catch (e) {
      console.error('Notification error:', e.message);
    }

    return Response.json({ success: true, report_id: report.id, report_number: reportNumber, total_events: todayLogs.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}