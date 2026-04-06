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
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 800px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #0ea5e9 0%, #1e40af 100%); padding: 30px; text-align: center; color: white; }
    .logo { width: 80px; height: 80px; background: white; border-radius: 50%; margin: 0 auto 15px; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; color: #0ea5e9; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 600; }
    .header p { margin: 5px 0 0; opacity: 0.95; font-size: 16px; }
    .content { padding: 30px; }
    .summary { background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%); padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #0ea5e9; }
    .summary h2 { margin: 0 0 10px; color: #1e40af; font-size: 20px; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin: 25px 0; }
    .metric-card { background: #f8fafc; padding: 15px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .metric-card h3 { margin: 0 0 8px; font-size: 13px; color: #64748b; font-weight: 500; text-transform: uppercase; }
    .metric-value { font-size: 28px; font-weight: bold; color: #1e293b; margin-bottom: 5px; }
    .metric-change { font-size: 14px; font-weight: 600; }
    .metric-change.up { color: #dc2626; }
    .metric-change.down { color: #16a34a; }
    .metric-change.neutral { color: #64748b; }
    .chart-section { margin: 30px 0; }
    .chart-section h3 { color: #1e293b; font-size: 18px; margin-bottom: 15px; border-bottom: 2px solid #0ea5e9; padding-bottom: 8px; }
    .comparison-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .comparison-table th { background: #0ea5e9; color: white; padding: 12px; text-align: left; font-size: 14px; font-weight: 600; }
    .comparison-table td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .comparison-table tr:hover { background: #f8fafc; }
    .bar-chart { margin: 20px 0; }
    .bar-row { display: flex; align-items: center; margin-bottom: 15px; }
    .bar-label { width: 150px; font-size: 13px; color: #475569; font-weight: 500; }
    .bar-container { flex: 1; background: #e2e8f0; border-radius: 4px; height: 30px; position: relative; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; justify-content: flex-end; padding-right: 10px; color: white; font-size: 12px; font-weight: 600; transition: width 0.3s ease; }
    .bar-current { background: linear-gradient(90deg, #0ea5e9 0%, #3b82f6 100%); }
    .bar-previous { background: linear-gradient(90deg, #64748b 0%, #94a3b8 100%); }
    .insights { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 20px; border-radius: 8px; margin: 25px 0; }
    .insights h3 { margin: 0 0 15px; color: #166534; font-size: 18px; }
    .insights p { line-height: 1.6; color: #166534; margin: 10px 0; }
    .footer { background: #1e293b; color: #94a3b8; padding: 20px; text-align: center; font-size: 13px; }
    .footer strong { color: #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">SG</div>
      <h1>Monthly Comparison Report</h1>
      <p>${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
    </div>
    
    <div class="content">
      <div class="summary">
        <h2>📊 Executive Summary</h2>
        <p>Comparative analysis of security operations showing month-over-month performance metrics, incident trends, and maintenance activities.</p>
      </div>

      <div class="metric-grid">
        <div class="metric-card">
          <h3>Total Incidents</h3>
          <div class="metric-value">${currentIncidents.length}</div>
          <div class="metric-change ${incidentChange > 0 ? 'up' : incidentChange < 0 ? 'down' : 'neutral'}">
            ${incidentChange > 0 ? '▲' : incidentChange < 0 ? '▼' : '●'} ${Math.abs(incidentChange)}% vs last month
          </div>
        </div>
        <div class="metric-card">
          <h3>Critical Incidents</h3>
          <div class="metric-value">${currentIncidents.filter(i => i.priority === 'critical').length}</div>
          <div class="metric-change neutral">Previous: ${prevIncidents.filter(i => i.priority === 'critical').length}</div>
        </div>
        <div class="metric-card">
          <h3>Maintenance</h3>
          <div class="metric-value">${currentMaintenance.length}</div>
          <div class="metric-change ${maintenanceChange > 0 ? 'up' : maintenanceChange < 0 ? 'down' : 'neutral'}">
            ${maintenanceChange > 0 ? '▲' : maintenanceChange < 0 ? '▼' : '●'} ${Math.abs(maintenanceChange)}% vs last month
          </div>
        </div>
        <div class="metric-card">
          <h3>Patrol Stops</h3>
          <div class="metric-value">${currentPatrols.length}</div>
          <div class="metric-change ${patrolChange < 0 ? 'up' : patrolChange > 0 ? 'down' : 'neutral'}">
            ${patrolChange > 0 ? '▲' : patrolChange < 0 ? '▼' : '●'} ${Math.abs(patrolChange)}% vs last month
          </div>
        </div>
      </div>

      <div class="chart-section">
        <h3>📈 Activity Comparison Chart</h3>
        <div class="bar-chart">
          <div class="bar-row">
            <div class="bar-label">Incidents (Current)</div>
            <div class="bar-container">
              <div class="bar-fill bar-current" style="width: ${Math.min(currentIncidents.length / Math.max(currentIncidents.length, prevIncidents.length) * 100, 100)}%">
                ${currentIncidents.length}
              </div>
            </div>
          </div>
          <div class="bar-row">
            <div class="bar-label">Incidents (Previous)</div>
            <div class="bar-container">
              <div class="bar-fill bar-previous" style="width: ${Math.min(prevIncidents.length / Math.max(currentIncidents.length, prevIncidents.length) * 100, 100)}%">
                ${prevIncidents.length}
              </div>
            </div>
          </div>
          <div class="bar-row">
            <div class="bar-label">Maintenance (Current)</div>
            <div class="bar-container">
              <div class="bar-fill bar-current" style="width: ${Math.min(currentMaintenance.length / Math.max(currentMaintenance.length, prevMaintenance.length) * 100, 100)}%">
                ${currentMaintenance.length}
              </div>
            </div>
          </div>
          <div class="bar-row">
            <div class="bar-label">Maintenance (Previous)</div>
            <div class="bar-container">
              <div class="bar-fill bar-previous" style="width: ${Math.min(prevMaintenance.length / Math.max(currentMaintenance.length, prevMaintenance.length) * 100, 100)}%">
                ${prevMaintenance.length}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="chart-section">
        <h3>🏢 Site Performance Comparison</h3>
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Current Incidents</th>
              <th>Previous Incidents</th>
              <th>Change</th>
              <th>Current Maintenance</th>
              <th>Previous Maintenance</th>
            </tr>
          </thead>
          <tbody>
            ${siteComparison.slice(0, 5).map(s => `
            <tr>
              <td><strong>${s.name}</strong></td>
              <td>${s.currentIncidents}</td>
              <td>${s.prevIncidents}</td>
              <td style="color: ${s.incidentChange > 0 ? '#dc2626' : s.incidentChange < 0 ? '#16a34a' : '#64748b'}; font-weight: 600;">
                ${s.incidentChange > 0 ? '▲' : s.incidentChange < 0 ? '▼' : '●'} ${Math.abs(s.incidentChange)}%
              </td>
              <td>${s.currentMaintenance}</td>
              <td>${s.prevMaintenance}</td>
            </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="insights">
        <h3>🤖 AI Analysis & Recommendations</h3>
        <p style="white-space: pre-wrap;">${aiAnalysis}</p>
      </div>
    </div>

    <div class="footer">
      <p><strong>SecureGuard Analytics</strong></p>
      <p>This is an automated monthly comparison report</p>
      <p>Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>
  </div>
</body>
</html>
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