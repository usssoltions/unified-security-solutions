import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get current month and previous month date ranges
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Fetch all data
    const [incidents, maintenance, patrols, shifts, alerts, sites] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({}),
      base44.asServiceRole.entities.Site.filter({})
    ]);

    // Filter by current month
    const currentIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });
    const currentMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });
    const currentPatrols = patrols.filter(p => {
      const date = new Date(p.timestamp || p.created_date);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });
    const currentShifts = shifts.filter(s => {
      const date = new Date(s.start_time);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });
    const currentAlerts = alerts.filter(a => {
      const date = new Date(a.created_date);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });

    // Filter by previous month
    const prevIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });
    const prevMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });
    const prevPatrols = patrols.filter(p => {
      const date = new Date(p.timestamp || p.created_date);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });
    const prevShifts = shifts.filter(s => {
      const date = new Date(s.start_time);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });
    const prevAlerts = alerts.filter(a => {
      const date = new Date(a.created_date);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });

    // Calculate changes
    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous * 100).toFixed(1);
    };

    const incidentChange = calculateChange(currentIncidents.length, prevIncidents.length);
    const maintenanceChange = calculateChange(currentMaintenance.length, prevMaintenance.length);
    const patrolChange = calculateChange(currentPatrols.length, prevPatrols.length);
    const shiftChange = calculateChange(currentShifts.length, prevShifts.length);

    // Site-by-site comparison
    const siteComparison = sites.map(site => {
      const currentSiteIncidents = currentIncidents.filter(i => i.site_id === site.id).length;
      const prevSiteIncidents = prevIncidents.filter(i => i.site_id === site.id).length;
      const currentSiteMaintenance = currentMaintenance.filter(m => m.site_id === site.id).length;
      const prevSiteMaintenance = prevMaintenance.filter(m => m.site_id === site.id).length;
      
      return {
        name: site.name,
        currentIncidents: currentSiteIncidents,
        prevIncidents: prevSiteIncidents,
        incidentChange: calculateChange(currentSiteIncidents, prevSiteIncidents),
        currentMaintenance: currentSiteMaintenance,
        prevMaintenance: prevSiteMaintenance,
        maintenanceChange: calculateChange(currentSiteMaintenance, prevSiteMaintenance)
      };
    }).sort((a, b) => b.currentIncidents - a.currentIncidents);

    // Generate AI analysis
    const analysisPrompt = `Generate a comprehensive monthly comparison report for ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}:

CURRENT MONTH (${currentMonthStart.toLocaleDateString('en-US', { month: 'long' })}):
- Incidents: ${currentIncidents.length} (Critical: ${currentIncidents.filter(i => i.priority === 'critical').length})
- Maintenance: ${currentMaintenance.length}
- Patrol Stops: ${currentPatrols.length}
- Shifts: ${currentShifts.length}
- Alerts: ${currentAlerts.length}

PREVIOUS MONTH (${prevMonthStart.toLocaleDateString('en-US', { month: 'long' })}):
- Incidents: ${prevIncidents.length} (Critical: ${prevIncidents.filter(i => i.priority === 'critical').length})
- Maintenance: ${prevMaintenance.length}
- Patrol Stops: ${prevPatrols.length}
- Shifts: ${prevShifts.length}
- Alerts: ${prevAlerts.length}

PERCENTAGE CHANGES:
- Incidents: ${incidentChange}%
- Maintenance: ${maintenanceChange}%
- Patrols: ${patrolChange}%
- Shifts: ${shiftChange}%

TOP 5 SITES COMPARISON:
${siteComparison.slice(0, 5).map(s => 
  `${s.name}: Incidents ${s.currentIncidents} vs ${s.prevIncidents} (${s.incidentChange}%), Maintenance ${s.currentMaintenance} vs ${s.prevMaintenance} (${s.maintenanceChange}%)`
).join('\n')}

INCIDENT CATEGORY TRENDS:
Current: ${Object.entries(currentIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {})).map(([cat, count]) => `${cat}: ${count}`).join(', ')}
Previous: ${Object.entries(prevIncidents.reduce((acc, i) => { acc[i.category] = (acc[i.category] || 0) + 1; return acc; }, {})).map(([cat, count]) => `${cat}: ${count}`).join(', ')}

Provide:
1. Executive Summary with key month-over-month changes
2. Performance Analysis (improvements and concerns)
3. Trend Insights (what's getting better, what's getting worse)
4. Site-Specific Observations
5. Actionable Recommendations for next month
6. Risk Assessment and Predictions`;

    const aiAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: analysisPrompt
    });

    // Get recipients
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const recipients = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'management' ||
      u.role_type === 'supervisor'
    );

    // Send email report
    const emailPromises = recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard Monthly Analytics',
        to: recipient.email,
        subject: `Monthly Comparison Report - ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        body: `
<h2>Monthly Comparison Report</h2>
<h3>${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>

<h3>Key Metrics Comparison</h3>
<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <th>Metric</th>
    <th>Current Month</th>
    <th>Previous Month</th>
    <th>Change</th>
  </tr>
  <tr>
    <td><strong>Total Incidents</strong></td>
    <td>${currentIncidents.length}</td>
    <td>${prevIncidents.length}</td>
    <td style="color: ${incidentChange > 0 ? 'red' : 'green'}">${incidentChange > 0 ? '+' : ''}${incidentChange}%</td>
  </tr>
  <tr>
    <td><strong>Critical Incidents</strong></td>
    <td>${currentIncidents.filter(i => i.priority === 'critical').length}</td>
    <td>${prevIncidents.filter(i => i.priority === 'critical').length}</td>
    <td>-</td>
  </tr>
  <tr>
    <td><strong>Maintenance Requests</strong></td>
    <td>${currentMaintenance.length}</td>
    <td>${prevMaintenance.length}</td>
    <td style="color: ${maintenanceChange > 0 ? 'orange' : 'green'}">${maintenanceChange > 0 ? '+' : ''}${maintenanceChange}%</td>
  </tr>
  <tr>
    <td><strong>Patrol Stops</strong></td>
    <td>${currentPatrols.length}</td>
    <td>${prevPatrols.length}</td>
    <td style="color: ${patrolChange < 0 ? 'red' : 'green'}">${patrolChange > 0 ? '+' : ''}${patrolChange}%</td>
  </tr>
  <tr>
    <td><strong>Shifts Completed</strong></td>
    <td>${currentShifts.length}</td>
    <td>${prevShifts.length}</td>
    <td>${shiftChange > 0 ? '+' : ''}${shiftChange}%</td>
  </tr>
  <tr>
    <td><strong>System Alerts</strong></td>
    <td>${currentAlerts.length}</td>
    <td>${prevAlerts.length}</td>
    <td>-</td>
  </tr>
</table>

<h3>Site Performance Comparison (Top 5)</h3>
<table border="1" cellpadding="10" style="border-collapse: collapse;">
  <tr>
    <th>Site</th>
    <th>Current Incidents</th>
    <th>Previous Incidents</th>
    <th>Change</th>
    <th>Current Maintenance</th>
    <th>Previous Maintenance</th>
  </tr>
  ${siteComparison.slice(0, 5).map(s => `
  <tr>
    <td>${s.name}</td>
    <td>${s.currentIncidents}</td>
    <td>${s.prevIncidents}</td>
    <td style="color: ${s.incidentChange > 0 ? 'red' : 'green'}">${s.incidentChange > 0 ? '+' : ''}${s.incidentChange}%</td>
    <td>${s.currentMaintenance}</td>
    <td>${s.prevMaintenance}</td>
  </tr>
  `).join('')}
</table>

<h3>AI Analysis & Insights</h3>
<div style="white-space: pre-wrap; font-family: Arial; background-color: #f5f5f5; padding: 15px; border-radius: 5px;">${aiAnalysis}</div>

<p><em>This is an automated monthly comparison report from SecureGuard Analytics System</em></p>
        `
      })
    );

    await Promise.all(emailPromises);

    return Response.json({ 
      success: true, 
      reportsSent: recipients.length,
      period: `${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    });
  } catch (error) {
    console.error('Error generating monthly comparison report:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});