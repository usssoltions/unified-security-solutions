import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [incidents, maintenance] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({})
    ]);

    // Filter out any non-incident categories (start of shift reports should use ShiftHandover entity)
    const validIncidentCategories = ['fire', 'theft', 'vandalism', 'medical', 'trespassing', 'suspicious_activity', 'equipment_failure', 'safety_hazard', 'other'];
    
    const currentIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      const isValidCategory = validIncidentCategories.includes(i.category);
      return date >= currentMonthStart && date <= currentMonthEnd && isValidCategory;
    });
    
    const currentMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });

    const prevIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      const isValidCategory = validIncidentCategories.includes(i.category);
      return date >= prevMonthStart && date <= prevMonthEnd && isValidCategory;
    });
    
    const prevMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= prevMonthStart && date <= prevMonthEnd;
    });

    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous * 100).toFixed(1);
    };

    const incidentChange = calculateChange(currentIncidents.length, prevIncidents.length);
    const maintenanceChange = calculateChange(currentMaintenance.length, prevMaintenance.length);

    // Group by category
    const incidentsByCategory = currentIncidents.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {});

    const maintenanceByCategory = currentMaintenance.reduce((acc, m) => {
      acc[m.category] = (acc[m.category] || 0) + 1;
      return acc;
    }, {});

    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const recipients = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'management' ||
      u.role_type === 'supervisor'
    );

    const logoUrl = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/45d7f532d_ubsnew.png';

    const emailPromises = recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'Unified Security Solutions',
        to: recipient.email,
        subject: `Incident & Maintenance Summary - ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        body: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #0f172a; }
    .container { max-width: 900px; margin: 20px auto; background: #1e293b; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 40px; text-align: center; border-bottom: 4px solid #dc2626; }
    .logo { max-width: 200px; margin: 0 auto 20px; }
    .header h1 { margin: 0; font-size: 32px; font-weight: 700; color: white; text-transform: uppercase; letter-spacing: 1px; }
    .header p { margin: 10px 0 0; color: #94a3b8; font-size: 16px; }
    .content { padding: 40px; background: white; }
    .section { margin-bottom: 40px; }
    .section h2 { color: #1e293b; font-size: 24px; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 3px solid #dc2626; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
    .metric-card { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 25px; border-radius: 10px; border-left: 5px solid #dc2626; color: white; }
    .metric-card h3 { margin: 0 0 10px; font-size: 14px; color: #94a3b8; text-transform: uppercase; }
    .metric-value { font-size: 36px; font-weight: bold; margin-bottom: 5px; }
    .metric-change { font-size: 14px; font-weight: 600; }
    .metric-change.up { color: #fca5a5; }
    .metric-change.down { color: #86efac; }
    .incident-list, .maintenance-list { margin: 20px 0; }
    .item-card { background: #f8fafc; border-left: 4px solid #dc2626; padding: 20px; margin-bottom: 15px; border-radius: 6px; }
    .item-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px; }
    .item-title { font-size: 18px; font-weight: 600; color: #1e293b; margin: 0; }
    .item-badge { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .badge-critical { background: #dc2626; color: white; }
    .badge-high { background: #f59e0b; color: white; }
    .badge-medium { background: #3b82f6; color: white; }
    .badge-low { background: #10b981; color: white; }
    .item-details { color: #475569; font-size: 14px; line-height: 1.6; }
    .item-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 15px; font-size: 13px; color: #64748b; }
    .category-breakdown { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin: 20px 0; }
    .category-item { background: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center; }
    .category-item strong { display: block; font-size: 24px; color: #1e293b; margin-bottom: 5px; }
    .category-item span { color: #64748b; font-size: 13px; text-transform: capitalize; }
    .footer { background: #0f172a; color: #94a3b8; padding: 30px; text-align: center; font-size: 13px; }
    .footer strong { color: #dc2626; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${logoUrl}" alt="Unified Security Solutions" class="logo">
      <h1>Incident & Maintenance Report</h1>
      <p>${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
    </div>
    
    <div class="content">
      <div class="section">
        <h2>📊 Monthly Overview</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <h3>Total Incidents</h3>
            <div class="metric-value">${currentIncidents.length}</div>
            <div class="metric-change ${incidentChange > 0 ? 'up' : 'down'}">
              ${incidentChange > 0 ? '▲' : '▼'} ${Math.abs(incidentChange)}% vs last month (${prevIncidents.length})
            </div>
          </div>
          <div class="metric-card">
            <h3>Critical Incidents</h3>
            <div class="metric-value">${currentIncidents.filter(i => i.priority === 'critical').length}</div>
            <div class="metric-change">Requires immediate attention</div>
          </div>
          <div class="metric-card">
            <h3>Total Maintenance</h3>
            <div class="metric-value">${currentMaintenance.length}</div>
            <div class="metric-change ${maintenanceChange > 0 ? 'up' : 'down'}">
              ${maintenanceChange > 0 ? '▲' : '▼'} ${Math.abs(maintenanceChange)}% vs last month (${prevMaintenance.length})
            </div>
          </div>
          <div class="metric-card">
            <h3>Urgent Maintenance</h3>
            <div class="metric-value">${currentMaintenance.filter(m => m.urgency === 'critical' || m.urgency === 'high').length}</div>
            <div class="metric-change">Action required</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>🔥 Category Breakdown - Incidents</h2>
        <div class="category-breakdown">
          ${Object.entries(incidentsByCategory).map(([cat, count]) => `
            <div class="category-item">
              <strong>${count}</strong>
              <span>${cat.replace(/_/g, ' ')}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <h2>🔧 Category Breakdown - Maintenance</h2>
        <div class="category-breakdown">
          ${Object.entries(maintenanceByCategory).map(([cat, count]) => `
            <div class="category-item">
              <strong>${count}</strong>
              <span>${cat.replace(/_/g, ' ')}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <h2>⚠️ Detailed Incident Log</h2>
        <div class="incident-list">
          ${currentIncidents.length === 0 ? '<p style="color: #64748b; text-align: center; padding: 40px;">No incidents reported this month</p>' : ''}
          ${currentIncidents.map(incident => `
            <div class="item-card">
              <div class="item-header">
                <h3 class="item-title">${incident.title}</h3>
                <span class="item-badge badge-${incident.priority}">${incident.priority}</span>
              </div>
              <div class="item-details">
                <strong>Category:</strong> ${incident.category.replace(/_/g, ' ')}<br>
                <strong>Description:</strong> ${incident.description || 'No description provided'}<br>
                ${incident.resolution_notes ? `<strong>Resolution:</strong> ${incident.resolution_notes}<br>` : ''}
              </div>
              <div class="item-meta">
                <div><strong>Site:</strong> ${incident.site_name || 'N/A'}</div>
                <div><strong>Guard:</strong> ${incident.guard_name || 'N/A'}</div>
                <div><strong>Reported:</strong> ${new Date(incident.reported_at).toLocaleDateString()}</div>
                <div><strong>Status:</strong> ${incident.status}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section">
        <h2>🔧 Detailed Maintenance Log</h2>
        <div class="maintenance-list">
          ${currentMaintenance.length === 0 ? '<p style="color: #64748b; text-align: center; padding: 40px;">No maintenance requests this month</p>' : ''}
          ${currentMaintenance.map(maint => `
            <div class="item-card" style="border-left-color: #0ea5e9;">
              <div class="item-header">
                <h3 class="item-title">${maint.title}</h3>
                <span class="item-badge badge-${maint.urgency === 'critical' ? 'critical' : maint.urgency}">${maint.urgency}</span>
              </div>
              <div class="item-details">
                <strong>Category:</strong> ${maint.category.replace(/_/g, ' ')}<br>
                <strong>Description:</strong> ${maint.description || 'No description provided'}<br>
                ${maint.completion_notes ? `<strong>Completion:</strong> ${maint.completion_notes}<br>` : ''}
              </div>
              <div class="item-meta">
                <div><strong>Site:</strong> ${maint.site_name || 'N/A'}</div>
                <div><strong>Guard:</strong> ${maint.guard_name || 'N/A'}</div>
                <div><strong>Reported:</strong> ${new Date(maint.reported_at).toLocaleDateString()}</div>
                <div><strong>Status:</strong> ${maint.status}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="section" style="background: #fef2f2; padding: 20px; border-radius: 8px; border-left: 4px solid #dc2626;">
        <h2 style="color: #991b1b; border-bottom-color: #fca5a5;">📌 Action Items for Estate Manager</h2>
        <ul style="color: #7f1d1d; line-height: 1.8;">
          ${currentIncidents.filter(i => i.priority === 'critical' || i.priority === 'high').length > 0 ? 
            `<li><strong>Review ${currentIncidents.filter(i => i.priority === 'critical' || i.priority === 'high').length} high-priority incidents</strong> - Implement preventive measures</li>` : ''}
          ${currentMaintenance.filter(m => m.status !== 'completed').length > 0 ?
            `<li><strong>${currentMaintenance.filter(m => m.status !== 'completed').length} pending maintenance requests</strong> - Schedule repairs immediately</li>` : ''}
          ${Object.keys(incidentsByCategory).length > 0 ?
            `<li><strong>Focus areas:</strong> ${Object.entries(incidentsByCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat, count]) => `${cat} (${count})`).join(', ')}</li>` : ''}
          <li>Review guard reports for patterns and additional context</li>
          <li>Consider additional security measures at high-incident sites</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <p><strong>Unified Security Solutions</strong> - Professional Security Management</p>
      <p>Generated: ${new Date().toLocaleString()}</p>
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
      period: currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      incidents: currentIncidents.length,
      maintenance: currentMaintenance.length
    });
  } catch (error) {
    console.error('Error generating incident/maintenance summary:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});