import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { reportType, frequency, sites, emailRecipients } = await req.json();

    const now = new Date();
    let startDate;
    if (frequency === 'daily') {
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (frequency === 'weekly') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const [incidents, maintenance, shifts, guards, sitesList] = await Promise.all([
      base44.asServiceRole.entities.Incident.list(),
      base44.asServiceRole.entities.MaintenanceRequest.list(),
      base44.asServiceRole.entities.Shift.list(),
      base44.asServiceRole.entities.User.list(),
      base44.asServiceRole.entities.Site.list(),
    ]);

    const filterByDateAndSites = (items, dateField) =>
      items.filter(item => {
        const d = new Date(item[dateField] || item.created_date);
        const dateMatch = d >= startDate && d <= now;
        const siteMatch = !sites || sites.length === 0 || sites.includes(item.site_id);
        return dateMatch && siteMatch;
      });

    const filteredIncidents = filterByDateAndSites(incidents, 'reported_at');
    const filteredMaintenance = filterByDateAndSites(maintenance, 'reported_at');
    const filteredShifts = filterByDateAndSites(shifts, 'start_time');

    let reportTitle = '';
    let reportContent = '';

    const periodLabel = `${startDate.toLocaleDateString()} – ${now.toLocaleDateString()}`;

    if (reportType === 'weekly_summary' || reportType === 'daily_activity') {
      reportTitle = `${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Security Summary Report`;
      const criticalCount = filteredIncidents.filter(i => i.priority === 'critical').length;
      const openCount = filteredIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length;
      const pendingMaint = filteredMaintenance.filter(m => m.status !== 'completed').length;
      const completedShifts = filteredShifts.filter(s => s.status === 'completed').length;
      const categoryBreakdown = Object.entries(
        filteredIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {})
      ).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(', ');

      reportContent = [
        `${reportTitle}`,
        `Period: ${periodLabel}`,
        ``,
        `OVERVIEW`,
        `• ${filteredIncidents.length} incident(s) reported — ${criticalCount} critical, ${openCount} still open.`,
        `• ${filteredMaintenance.length} maintenance request(s) — ${pendingMaint} pending.`,
        `• ${filteredShifts.length} shift(s), ${completedShifts} completed.`,
        ``,
        `INCIDENT CATEGORIES`,
        categoryBreakdown || 'No incidents in this period.',
        ``,
        `TOP INCIDENTS`,
        ...filteredIncidents.filter(i => i.priority === 'critical' || i.priority === 'high').slice(0, 5).map(i =>
          `• [${i.priority?.toUpperCase()}] ${i.title} — ${i.site_name || 'N/A'} (${i.status})`
        ),
        ``,
        criticalCount > 0 ? `⚠️ ${criticalCount} critical incident(s) require immediate review.` : `✅ No critical incidents this period.`,
        openCount > 0 ? `⚠️ ${openCount} incident(s) still unresolved.` : `✅ All incidents resolved.`,
      ].join('\n');

    } else if (reportType === 'monthly_performance' || reportType === 'guard_performance') {
      reportTitle = reportType === 'monthly_performance' ? 'Monthly Guard Performance Review' : 'Guard Performance Metrics Report';
      const guardsList = guards.filter(g => g.role_type === 'guard');
      const lines = [`${reportTitle}`, `Period: ${periodLabel}`, ``];

      guardsList.forEach(g => {
        const gShifts = filteredShifts.filter(s => s.guard_id === g.id);
        const completed = gShifts.filter(s => s.status === 'completed').length;
        const missed = gShifts.filter(s => s.status === 'missed').length;
        const late = gShifts.filter(s => {
          if (!s.clock_in?.timestamp || !s.start_time) return false;
          return new Date(s.clock_in.timestamp) - new Date(s.start_time) > 15 * 60 * 1000;
        }).length;
        const gIncidents = filteredIncidents.filter(i => i.guard_id === g.id);
        const completionRate = gShifts.length > 0 ? ((completed / gShifts.length) * 100).toFixed(0) : 'N/A';
        lines.push(`${g.full_name}`);
        lines.push(`  Shifts: ${gShifts.length} total, ${completed} completed, ${missed} missed`);
        lines.push(`  Late clock-ins: ${late} | Incidents reported: ${gIncidents.length}`);
        lines.push(`  Completion rate: ${completionRate}%`);
        lines.push(``);
      });

      lines.push(guardsList.filter(g => {
        const gShifts = filteredShifts.filter(s => s.guard_id === g.id);
        const late = gShifts.filter(s => s.clock_in?.timestamp && new Date(s.clock_in.timestamp) - new Date(s.start_time) > 15 * 60 * 1000).length;
        return late > 2;
      }).length > 0 ? `⚠️ Multiple late arrivals detected — review punctuality policies.` : `✅ Punctuality within acceptable range.`);
      reportContent = lines.join('\n');

    } else if (reportType === 'maintenance_summary') {
      reportTitle = `${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Maintenance Summary`;
      const completed = filteredMaintenance.filter(m => m.status === 'completed').length;
      const pending = filteredMaintenance.filter(m => m.status !== 'completed').length;
      const byCategory = Object.entries(
        filteredMaintenance.reduce((acc, m) => { acc[m.category] = (acc[m.category] || 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  • ${k.replace(/_/g, ' ')}: ${v}`).join('\n');

      reportContent = [
        `${reportTitle}`,
        `Period: ${periodLabel}`,
        ``,
        `SUMMARY`,
        `• Total requests: ${filteredMaintenance.length}`,
        `• Completed: ${completed}`,
        `• Pending: ${pending}`,
        `• Completion rate: ${filteredMaintenance.length > 0 ? ((completed / filteredMaintenance.length) * 100).toFixed(0) : 0}%`,
        ``,
        `BY CATEGORY`,
        byCategory || '  No maintenance requests.',
        ``,
        `URGENT PENDING`,
        ...filteredMaintenance.filter(m => (m.urgency === 'critical' || m.urgency === 'high') && m.status !== 'completed').slice(0, 5)
          .map(m => `  • [${m.urgency?.toUpperCase()}] ${m.title} — ${m.site_name || 'N/A'}`),
        pending > 0 ? `\n⚠️ ${pending} request(s) pending — schedule resolution.` : `\n✅ All requests completed.`,
      ].join('\n');

    } else if (reportType === 'incident_trends') {
      reportTitle = 'Incident Trends Analysis';
      const byCategory = Object.entries(
        filteredIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1]);
      const byPriority = Object.entries(
        filteredIncidents.reduce((acc, i) => { acc[i.priority] = (acc[i.priority] || 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1]);
      const bySite = Object.entries(
        filteredIncidents.reduce((acc, i) => { acc[i.site_name || 'Unknown'] = (acc[i.site_name || 'Unknown'] || 0) + 1; return acc; }, {})
      ).sort((a, b) => b[1] - a[1]);

      reportContent = [
        `${reportTitle}`,
        `Period: ${periodLabel}`,
        ``,
        `BY CATEGORY`,
        ...byCategory.map(([k, v]) => `  • ${k.replace(/_/g, ' ')}: ${v}`),
        ``,
        `BY PRIORITY`,
        ...byPriority.map(([k, v]) => `  • ${k}: ${v}`),
        ``,
        `BY SITE (Top 5)`,
        ...bySite.slice(0, 5).map(([k, v]) => `  • ${k}: ${v}`),
        ``,
        bySite[0] ? `⚠️ Highest activity: ${bySite[0][0]} (${bySite[0][1]} incidents) — review security posture.` : `✅ Activity distributed evenly.`,
      ].join('\n');
    }

    // Store report
    const reportRecord = await base44.asServiceRole.entities.GeneratedReport.create({
      title: reportTitle,
      report_type: reportType,
      content: reportContent,
      report_date: now.toISOString().split('T')[0],
      summary: reportContent.substring(0, 500),
      statistics: {
        incidents_count: filteredIncidents.length,
        maintenance_count: filteredMaintenance.length,
        shifts_count: filteredShifts.length,
        critical_incidents: filteredIncidents.filter(i => i.priority === 'critical').length,
      },
    });

    // Send email to recipients
    if (emailRecipients && emailRecipients.length > 0) {
      await Promise.all(emailRecipients.map(email =>
        base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject: `${reportTitle} — ${now.toLocaleDateString()}`,
          body: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; background: #f8fafc;">
  <div style="max-width: 700px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #C41E3A 0%, #1a1a1a 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 22px;">${reportTitle}</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">${periodLabel}</p>
    </div>
    <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e2e8f0;">
      <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border-left: 4px solid #C41E3A;">
        <h2 style="color: #1a1a1a; margin: 0 0 8px; font-size: 16px;">Summary Statistics</h2>
        <ul style="list-style: none; padding: 0; margin: 0; color: #475569; font-size: 14px;">
          <li style="padding: 4px 0;">Total Incidents: <strong>${filteredIncidents.length}</strong></li>
          <li style="padding: 4px 0;">Maintenance Requests: <strong>${filteredMaintenance.length}</strong></li>
          <li style="padding: 4px 0;">Shifts Logged: <strong>${filteredShifts.length}</strong></li>
          <li style="padding: 4px 0;">Critical Incidents: <strong>${filteredIncidents.filter(i => i.priority === 'critical').length}</strong></li>
        </ul>
      </div>
      <div style="margin-top: 20px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #1a1a1a; margin: 0 0 12px; font-size: 16px;">Report Details</h2>
        <pre style="white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 13px; color: #334155; line-height: 1.7; margin: 0;">${reportContent}</pre>
      </div>
      <p style="color: #94a3b8; font-size: 11px; text-align: center; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e2e8f0;">
        Automated report — Unified Security Solutions
      </p>
    </div>
  </div>
</body>
</html>`
        }).catch(e => console.error('Email failed:', e))
      ));
    }

    return Response.json({
      success: true,
      reportId: reportRecord.id,
      emailsSent: emailRecipients?.length || 0,
      summary: { incidents: filteredIncidents.length, maintenance: filteredMaintenance.length, shifts: filteredShifts.length },
    });

  } catch (error) {
    console.error('Report generation error:', error);
    return Response.json({ error: error.message || 'Failed to generate report' }, { status: 500 });
  }
});