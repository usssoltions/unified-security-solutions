import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    const [incidents, maintenance, patrols, shifts, alerts, sites] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({}),
      base44.asServiceRole.entities.Site.filter({}),
    ]);

    const weekIncidents = incidents.filter(i => new Date(i.reported_at || i.created_date) >= weekAgo);
    const weekMaintenance = maintenance.filter(m => new Date(m.reported_at || m.created_date) >= weekAgo);
    const weekPatrols = patrols.filter(p => new Date(p.timestamp || p.created_date) >= weekAgo);
    const weekShifts = shifts.filter(s => new Date(s.start_time) >= weekAgo);
    const weekAlerts = alerts.filter(a => new Date(a.created_date) >= weekAgo);

    // Skip sending if there was absolutely no activity this week
    if (weekShifts.length === 0 && weekIncidents.length === 0) {
      return Response.json({ success: true, reportsSent: 0, reason: 'No activity this week' });
    }

    const siteAnalysis = sites.map(site => ({
      name: site.name,
      incidents: weekIncidents.filter(i => i.site_id === site.id).length,
      criticalIncidents: weekIncidents.filter(i => i.site_id === site.id && i.priority === 'critical').length,
      maintenance: weekMaintenance.filter(m => m.site_id === site.id).length,
      patrols: weekPatrols.filter(p => p.site_id === site.id).length,
    })).sort((a, b) => b.incidents - a.incidents);

    const criticalCount = weekIncidents.filter(i => i.priority === 'critical').length;
    const openIncidents = weekIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
    const pendingMaintenance = weekMaintenance.filter(m => m.status !== 'completed').length;
    const categoryBreakdown = Object.entries(
      weekIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {})
    ).map(([cat, count]) => `${cat}: ${count}`).join(', ');
    const topSite = siteAnalysis[0];

    const analysis = [
      `Weekly Security Analysis: ${weekAgo.toLocaleDateString('en-ZA')} – ${today.toLocaleDateString('en-ZA')}`,
      ``,
      `OVERVIEW`,
      `• ${weekIncidents.length} incident(s) — ${criticalCount} critical, ${openIncidents} still open.`,
      `• ${weekMaintenance.length} maintenance request(s) — ${pendingMaintenance} pending.`,
      `• ${weekPatrols.length} patrol stop(s) completed.`,
      `• ${weekShifts.length} shift(s) worked, ${weekAlerts.length} alert(s) triggered.`,
      ``,
      `INCIDENT CATEGORIES`,
      categoryBreakdown || 'No incidents this week.',
      ``,
      `SITE ACTIVITY (Top 5)`,
      ...siteAnalysis.slice(0, 5).map(s => `• ${s.name}: ${s.incidents} incidents (${s.criticalIncidents} critical), ${s.maintenance} maintenance, ${s.patrols} patrols`),
      ``,
      topSite && topSite.incidents > 0 ? `⚠️ Highest activity site: ${topSite.name} — review security posture.` : `✅ No single site showing elevated activity.`,
      openIncidents > 0 ? `⚠️ ${openIncidents} unresolved incident(s) require follow-up.` : `✅ All incidents resolved.`,
    ].join('\n');

    // Email only — no WhatsApp integration calls
    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = allUsers.filter(u =>
      (u.role_type === 'admin' || u.role_type === 'management' || u.role_type === 'supervisor') && u.email
    );

    if (recipients.length === 0) {
      return Response.json({ success: true, reportsSent: 0, reason: 'No recipients' });
    }

    await Promise.all(recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard Analytics',
        to: recipient.email,
        subject: `Weekly Security Analysis — ${weekAgo.toLocaleDateString('en-ZA')} to ${today.toLocaleDateString('en-ZA')}`,
        body: `<h2>Weekly Security Analysis Report</h2>
<h3>${weekAgo.toLocaleDateString('en-ZA')} to ${today.toLocaleDateString('en-ZA')}</h3>
<table border="1" cellpadding="10" style="border-collapse:collapse;">
  <tr><td><strong>Total Incidents</strong></td><td>${weekIncidents.length}</td></tr>
  <tr><td><strong>Critical Incidents</strong></td><td>${criticalCount}</td></tr>
  <tr><td><strong>Maintenance Requests</strong></td><td>${weekMaintenance.length}</td></tr>
  <tr><td><strong>Patrol Stops</strong></td><td>${weekPatrols.length}</td></tr>
  <tr><td><strong>Shifts Completed</strong></td><td>${weekShifts.length}</td></tr>
</table>
<h3>Site Performance (Top 5)</h3>
<table border="1" cellpadding="10" style="border-collapse:collapse;">
  <tr><th>Site</th><th>Incidents</th><th>Critical</th><th>Maintenance</th><th>Patrols</th></tr>
  ${siteAnalysis.slice(0, 5).map(s => `<tr><td>${s.name}</td><td>${s.incidents}</td><td>${s.criticalIncidents}</td><td>${s.maintenance}</td><td>${s.patrols}</td></tr>`).join('')}
</table>
<h3>Weekly Analysis</h3>
<pre style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;white-space:pre-wrap;">${analysis}</pre>
<p><em>Automated weekly report from SecureGuard</em></p>`
      }).catch(err => console.error(`Email failed to ${recipient.email}:`, err.message))
    ));

    return Response.json({ success: true, reportsSent: recipients.length, period: `${weekAgo.toLocaleDateString('en-ZA')} to ${today.toLocaleDateString('en-ZA')}` });
  } catch (error) {
    console.error('Error generating weekly analysis report:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});