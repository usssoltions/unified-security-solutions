import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get yesterday's date range
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Fetch all activity from yesterday
    const [incidents, maintenance, patrols, shifts, alerts] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({})
    ]);

    // Filter by yesterday's date
    const yesterdayIncidents = incidents.filter(i => {
      const date = new Date(i.reported_at || i.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayMaintenance = maintenance.filter(m => {
      const date = new Date(m.reported_at || m.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayPatrols = patrols.filter(p => {
      const date = new Date(p.timestamp || p.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayShifts = shifts.filter(s => {
      const date = new Date(s.start_time);
      return date >= yesterday && date <= endOfYesterday;
    });
    
    const yesterdayAlerts = alerts.filter(a => {
      const date = new Date(a.created_date);
      return date >= yesterday && date <= endOfYesterday;
    });

    // Generate summary using AI
    const summaryPrompt = `Generate a professional daily activity summary report for ${yesterday.toLocaleDateString()}:

Incidents: ${yesterdayIncidents.length}
${yesterdayIncidents.map(i => `- ${i.title} at ${i.site_name} (Priority: ${i.priority})`).join('\n')}

Maintenance Requests: ${yesterdayMaintenance.length}
${yesterdayMaintenance.map(m => `- ${m.title} at ${m.site_name} (Urgency: ${m.urgency})`).join('\n')}

Patrol Stops: ${yesterdayPatrols.length}
${yesterdayPatrols.map(p => `- ${p.checkpoint_name} by ${p.guard_name}`).join('\n')}

Shifts Completed: ${yesterdayShifts.length}
${yesterdayShifts.map(s => `- ${s.guard_name} at ${s.site_name}`).join('\n')}

Alerts: ${yesterdayAlerts.length}
${yesterdayAlerts.map(a => `- ${a.type}: ${a.title}`).join('\n')}

Provide a concise executive summary with key insights and recommendations.`;

    const aiSummary = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: summaryPrompt
    });

    // Get all admins and supervisors
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const recipients = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'dispatcher' || 
      u.role_type === 'supervisor' ||
      u.role_type === 'management'
    );

    // Send email report to each recipient
    const emailPromises = recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard System',
        to: recipient.email,
        subject: `Daily Activity Report - ${yesterday.toLocaleDateString()}`,
        body: `
<h2>Daily Activity Report - ${yesterday.toLocaleDateString()}</h2>

<h3>Summary Statistics</h3>
<ul>
  <li><strong>Incidents:</strong> ${yesterdayIncidents.length}</li>
  <li><strong>Maintenance Requests:</strong> ${yesterdayMaintenance.length}</li>
  <li><strong>Patrol Stops:</strong> ${yesterdayPatrols.length}</li>
  <li><strong>Shifts Completed:</strong> ${yesterdayShifts.length}</li>
  <li><strong>Alerts:</strong> ${yesterdayAlerts.length}</li>
</ul>

<h3>AI Summary & Insights</h3>
<p>${aiSummary.replace(/\n/g, '<br>')}</p>

<h3>Critical Incidents</h3>
${yesterdayIncidents.filter(i => i.priority === 'critical' || i.priority === 'high')
  .map(i => `<p><strong>${i.title}</strong><br>Site: ${i.site_name}<br>Priority: ${i.priority}<br>Status: ${i.status}</p>`)
  .join('') || '<p>No critical incidents</p>'}

<h3>Pending Items</h3>
<ul>
  <li>Open Incidents: ${yesterdayIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length}</li>
  <li>Pending Maintenance: ${yesterdayMaintenance.filter(m => m.status !== 'completed').length}</li>
</ul>

<p><em>This is an automated report from SecureGuard System</em></p>
        `
      })
    );

    await Promise.all(emailPromises);

    return Response.json({ 
      success: true, 
      reportsSent: recipients.length,
      date: yesterday.toLocaleDateString()
    });
  } catch (error) {
    console.error('Error generating daily activity report:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});