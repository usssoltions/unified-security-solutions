import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { reportType, frequency, sites, emailRecipients } = await req.json();

    // Calculate date range based on frequency
    const now = new Date();
    let startDate, endDate = now;
    
    if (frequency === 'daily') {
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    } else if (frequency === 'weekly') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (frequency === 'monthly') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Fetch all relevant data
    const incidents = await base44.asServiceRole.entities.Incident.list();
    const maintenance = await base44.asServiceRole.entities.MaintenanceRequest.list();
    const shifts = await base44.asServiceRole.entities.Shift.list();
    const guards = await base44.asServiceRole.entities.User.list();
    const sitesList = await base44.asServiceRole.entities.Site.list();

    // Filter by date and sites
    const filterByDateAndSites = (items, dateField) => {
      return items.filter(item => {
        const itemDate = new Date(item[dateField] || item.created_date);
        const dateMatch = itemDate >= startDate && itemDate <= endDate;
        const siteMatch = !sites || sites.length === 0 || sites.includes(item.site_id);
        return dateMatch && siteMatch;
      });
    };

    const filteredIncidents = filterByDateAndSites(incidents, 'reported_at');
    const filteredMaintenance = filterByDateAndSites(maintenance, 'reported_at');
    const filteredShifts = filterByDateAndSites(shifts, 'start_time');

    // Build AI prompt based on report type
    let prompt = '';
    let reportTitle = '';

    if (reportType === 'weekly_summary' || reportType === 'daily_activity') {
      reportTitle = `${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Security Summary Report`;
      prompt = `Generate a comprehensive ${frequency} security summary report based on the following data:

INCIDENTS (${filteredIncidents.length} total):
${filteredIncidents.map((inc, idx) => `
${idx + 1}. ${inc.title}
   Priority: ${inc.priority}
   Category: ${inc.category}
   Site: ${inc.site_name}
   Status: ${inc.status}
   Date: ${inc.reported_at || inc.created_date}
   Guard: ${inc.guard_name}
`).join('\n')}

MAINTENANCE REQUESTS (${filteredMaintenance.length} total):
${filteredMaintenance.map((m, idx) => `
${idx + 1}. ${m.title}
   Urgency: ${m.urgency}
   Category: ${m.category}
   Site: ${m.site_name}
   Status: ${m.status}
   Date: ${m.reported_at || m.created_date}
`).join('\n')}

SHIFTS (${filteredShifts.length} total):
${filteredShifts.filter((_, idx) => idx < 20).map(s => `
- Guard: ${s.guard_name}, Site: ${s.site_name}, Status: ${s.status}
`).join('\n')}

Provide a professional executive summary including:
1. Overview of key metrics and statistics
2. Critical incidents and their outcomes
3. Maintenance issues and resolution status
4. Guard activity summary
5. Trends and patterns identified
6. Recommendations for improvement
7. Areas of concern requiring immediate attention`;

    } else if (reportType === 'monthly_performance') {
      reportTitle = 'Monthly Guard Performance Review';
      const guardsList = guards.filter(g => g.role_type === 'guard');
      
      prompt = `Generate a detailed monthly guard performance review:

GUARDS (${guardsList.length} total):
${guardsList.map(g => {
  const guardShifts = filteredShifts.filter(s => s.guard_id === g.id);
  const guardIncidents = filteredIncidents.filter(i => i.guard_id === g.id);
  return `
${g.full_name} (${g.badge_number || 'N/A'}):
- Shifts: ${guardShifts.length} (${guardShifts.filter(s => s.status === 'completed').length} completed)
- Incidents Reported: ${guardIncidents.length}
- Late Clock-ins: ${guardShifts.filter(s => {
    if (!s.clock_in?.timestamp || !s.start_time) return false;
    const diff = new Date(s.clock_in.timestamp) - new Date(s.start_time);
    return diff > 15 * 60 * 1000;
  }).length}
`;
}).join('\n')}

Provide:
1. Top performers and recognition
2. Performance improvement areas
3. Training recommendations
4. Attendance and punctuality analysis
5. Incident response effectiveness
6. Overall team performance rating`;

    } else if (reportType === 'maintenance_summary') {
      reportTitle = `${frequency.charAt(0).toUpperCase() + frequency.slice(1)} Maintenance Summary`;
      prompt = `Generate a maintenance summary report:

MAINTENANCE REQUESTS (${filteredMaintenance.length} total):
${filteredMaintenance.map((m, idx) => `
${idx + 1}. ${m.title}
   Category: ${m.category}
   Urgency: ${m.urgency}
   Status: ${m.status}
   Site: ${m.site_name}
   Reported: ${m.reported_at || m.created_date}
   ${m.completed_at ? `Completed: ${m.completed_at}` : 'Pending'}
`).join('\n')}

Analyze and provide:
1. Maintenance completion rate
2. Average response time
3. Most common issues by category
4. Sites requiring most attention
5. Preventive maintenance recommendations
6. Budget impact assessment`;

    } else if (reportType === 'guard_performance') {
      reportTitle = 'Guard Performance Metrics Report';
      const guardsList = guards.filter(g => g.role_type === 'guard');
      
      prompt = `Generate detailed guard performance metrics:

${guardsList.map(g => {
  const guardShifts = filteredShifts.filter(s => s.guard_id === g.id);
  const completedShifts = guardShifts.filter(s => s.status === 'completed');
  const guardIncidents = filteredIncidents.filter(i => i.guard_id === g.id);
  
  return `
${g.full_name}:
- Total Shifts: ${guardShifts.length}
- Completed: ${completedShifts.length}
- Missed: ${guardShifts.filter(s => s.status === 'missed').length}
- Incidents Handled: ${guardIncidents.length}
- Response Quality: ${guardIncidents.filter(i => i.status === 'resolved').length} resolved
`;
}).join('\n')}

Provide metrics analysis including:
1. Individual performance scores
2. Reliability metrics
3. Incident handling effectiveness
4. Areas for improvement per guard
5. Training needs identification`;

    } else if (reportType === 'incident_trends') {
      reportTitle = 'Incident Trends Analysis';
      prompt = `Analyze incident trends and patterns:

INCIDENTS BY CATEGORY:
${Object.entries(
  filteredIncidents.reduce((acc, inc) => {
    acc[inc.category] = (acc[inc.category] || 0) + 1;
    return acc;
  }, {})
).map(([cat, count]) => `- ${cat}: ${count}`).join('\n')}

INCIDENTS BY PRIORITY:
${Object.entries(
  filteredIncidents.reduce((acc, inc) => {
    acc[inc.priority] = (acc[inc.priority] || 0) + 1;
    return acc;
  }, {})
).map(([pri, count]) => `- ${pri}: ${count}`).join('\n')}

INCIDENTS BY SITE:
${Object.entries(
  filteredIncidents.reduce((acc, inc) => {
    acc[inc.site_name] = (acc[inc.site_name] || 0) + 1;
    return acc;
  }, {})
).map(([site, count]) => `- ${site}: ${count}`).join('\n')}

Analyze and provide:
1. Emerging patterns and trends
2. High-risk locations and times
3. Correlation analysis
4. Predictive insights
5. Resource allocation recommendations
6. Risk mitigation strategies`;
    }

    // Generate AI report
    const aiReport = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: prompt,
      add_context_from_internet: false
    });

    // Store the generated report
    const reportRecord = await base44.asServiceRole.entities.GeneratedReport.create({
      title: reportTitle,
      report_type: reportType,
      content: aiReport,
      report_date: now.toISOString().split('T')[0],
      summary: aiReport.substring(0, 500) + '...',
      statistics: {
        incidents_count: filteredIncidents.length,
        maintenance_count: filteredMaintenance.length,
        shifts_count: filteredShifts.length,
        critical_incidents: filteredIncidents.filter(i => i.priority === 'critical').length
      }
    });

    // Send email to recipients
    if (emailRecipients && emailRecipients.length > 0) {
      for (const email of emailRecipients) {
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: email,
            subject: `${reportTitle} - ${now.toLocaleDateString()}`,
            body: `
<html>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
  <div style="max-width: 800px; margin: 0 auto; padding: 20px;">
    <h1 style="color: #0ea5e9; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">
      ${reportTitle}
    </h1>
    <p style="color: #666; font-size: 14px;">
      Generated on: ${now.toLocaleString()}
    </p>
    
    <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <h2 style="color: #334155; margin-top: 0;">Summary Statistics</h2>
      <ul style="list-style: none; padding: 0;">
        <li style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
          <strong>Total Incidents:</strong> ${filteredIncidents.length}
        </li>
        <li style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
          <strong>Maintenance Requests:</strong> ${filteredMaintenance.length}
        </li>
        <li style="padding: 8px 0; border-bottom: 1px solid #e2e8f0;">
          <strong>Shifts Logged:</strong> ${filteredShifts.length}
        </li>
        <li style="padding: 8px 0;">
          <strong>Critical Incidents:</strong> ${filteredIncidents.filter(i => i.priority === 'critical').length}
        </li>
      </ul>
    </div>

    <div style="background: white; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; margin: 20px 0;">
      <h2 style="color: #334155; margin-top: 0;">AI-Generated Analysis</h2>
      <div style="white-space: pre-wrap; font-size: 14px;">
${aiReport}
      </div>
    </div>

    <p style="color: #666; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
      This is an automated report generated by the SecureGuard AI system.
    </p>
  </div>
</body>
</html>
            `
          });
        } catch (emailError) {
          console.error(`Failed to send email to ${email}:`, emailError);
        }
      }
    }

    return Response.json({
      success: true,
      reportId: reportRecord.id,
      emailsSent: emailRecipients?.length || 0,
      summary: {
        incidents: filteredIncidents.length,
        maintenance: filteredMaintenance.length,
        shifts: filteredShifts.length
      }
    });

  } catch (error) {
    console.error('Report generation error:', error);
    return Response.json({ 
      error: error.message || 'Failed to generate report' 
    }, { status: 500 });
  }
});