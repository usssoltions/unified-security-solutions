import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get last 7 days date range
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    weekAgo.setHours(0, 0, 0, 0);

    // Fetch all activity from last week
    const [incidents, maintenance, patrols, shifts, alerts, sites] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({}),
      base44.asServiceRole.entities.Site.filter({})
    ]);

    // Filter by last week
    const weekIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      return date >= weekAgo;
    });
    
    const weekMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= weekAgo;
    });
    
    const weekPatrols = patrols.filter(p => {
      const date = new Date(p.timestamp || p.created_date);
      return date >= weekAgo;
    });
    
    const weekShifts = shifts.filter(s => {
      const date = new Date(s.start_time);
      return date >= weekAgo;
    });
    
    const weekAlerts = alerts.filter(a => {
      const date = new Date(a.created_date);
      return date >= weekAgo;
    });

    // Analyze by site
    const siteAnalysis = sites.map(site => {
      const siteIncidents = weekIncidents.filter(i => i.site_id === site.id);
      const siteMaintenance = weekMaintenance.filter(m => m.site_id === site.id);
      const sitePatrols = weekPatrols.filter(p => p.site_id === site.id);
      
      return {
        name: site.name,
        incidents: siteIncidents.length,
        criticalIncidents: siteIncidents.filter(i => i.priority === 'critical').length,
        maintenance: siteMaintenance.length,
        patrols: sitePatrols.length
      };
    }).sort((a, b) => b.incidents - a.incidents);

    // Build analysis from data without LLM credits
    const criticalCount = weekIncidents.filter(i => i.priority === 'critical').length;
    const openIncidents = weekIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
    const pendingMaintenance = weekMaintenance.filter(m => m.status !== 'completed').length;
    const categoryBreakdown = Object.entries(weekIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {}))
      .map(([cat, count]) => `${cat}: ${count}`).join(', ');
    const topSite = siteAnalysis[0];

    const aiAnalysis = [
      `Weekly Security Analysis: ${weekAgo.toLocaleDateString()} – ${today.toLocaleDateString()}`,
      ``,
      `OVERVIEW`,
      `• ${weekIncidents.length} incident(s) reported — ${criticalCount} critical, ${openIncidents} still open.`,
      `• ${weekMaintenance.length} maintenance request(s) — ${pendingMaintenance} pending resolution.`,
      `• ${weekPatrols.length} patrol stop(s) completed across all sites.`,
      `• ${weekShifts.length} shift(s) worked, ${weekAlerts.length} system alert(s) triggered.`,
      ``,
      `INCIDENT CATEGORIES`,
      categoryBreakdown || 'No incidents this week.',
      ``,
      `SITE ACTIVITY (Top 5 by incidents)`,
      ...siteAnalysis.slice(0, 5).map(s => `• ${s.name}: ${s.incidents} incidents (${s.criticalIncidents} critical), ${s.maintenance} maintenance, ${s.patrols} patrols`),
      ``,
      topSite && topSite.incidents > 0 ? `⚠️ Highest activity site: ${topSite.name} — review security posture.` : `✅ No single site showing elevated activity.`,
      openIncidents > 0 ? `⚠️ ${openIncidents} unresolved incident(s) require follow-up.` : `✅ All incidents resolved.`,
    ].join('\n');

    // Get all admins and management
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const recipients = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'management' ||
      u.role_type === 'supervisor'
    );

    // Send email report
    const emailPromises = recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard Analytics',
        to: recipient.email,
        subject: `Weekly Security Analysis Report - ${weekAgo.toLocaleDateString()} to ${today.toLocaleDateString()}`,
        body: `
<h2>Weekly Security Analysis Report</h2>
<h3>${weekAgo.toLocaleDateString()} to ${today.toLocaleDateString()}</h3>

<h3>Key Metrics</h3>
<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <td><strong>Total Incidents</strong></td>
    <td>${weekIncidents.length}</td>
  </tr>
  <tr>
    <td><strong>Critical Incidents</strong></td>
    <td>${weekIncidents.filter(i => i.priority === 'critical').length}</td>
  </tr>
  <tr>
    <td><strong>Maintenance Requests</strong></td>
    <td>${weekMaintenance.length}</td>
  </tr>
  <tr>
    <td><strong>Patrol Stops</strong></td>
    <td>${weekPatrols.length}</td>
  </tr>
  <tr>
    <td><strong>Shifts Completed</strong></td>
    <td>${weekShifts.length}</td>
  </tr>
</table>

<h3>Site Performance (Top 5)</h3>
<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <th>Site</th>
    <th>Incidents</th>
    <th>Critical</th>
    <th>Maintenance</th>
    <th>Patrols</th>
  </tr>
  ${siteAnalysis.slice(0, 5).map(s => `
  <tr>
    <td>${s.name}</td>
    <td>${s.incidents}</td>
    <td>${s.criticalIncidents}</td>
    <td>${s.maintenance}</td>
    <td>${s.patrols}</td>
  </tr>
  `).join('')}
</table>

<h3>Weekly Analysis & Insights</h3>
<div style="white-space: pre-wrap; font-family: Arial, monospace; font-size: 14px; line-height: 1.7;">${aiAnalysis}</div>

<p><em>This is an automated weekly analysis from SecureGuard Analytics System</em></p>
        `
      })
    );

    await Promise.all(emailPromises);

    return Response.json({ 
      success: true, 
      reportsSent: recipients.length,
      period: `${weekAgo.toLocaleDateString()} to ${today.toLocaleDateString()}`
    });
  } catch (error) {
    console.error('Error generating weekly analysis report:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});