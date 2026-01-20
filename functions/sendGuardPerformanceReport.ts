import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const [guards, shifts, stayAwakeLogs, patrolLogs, sites, locationTracking] = await Promise.all([
      base44.asServiceRole.entities.User.filter({ role_type: 'guard' }),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.StayAwakeLog.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Site.filter({}),
      base44.asServiceRole.entities.LocationTracking.filter({})
    ]);

    const currentShifts = shifts.filter(s => {
      const date = new Date(s.start_time);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });

    const currentStayAwake = stayAwakeLogs.filter(s => {
      const date = new Date(s.alert_time);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });

    const currentPatrols = patrolLogs.filter(p => {
      const date = new Date(p.timestamp);
      return date >= currentMonthStart && date <= currentMonthEnd;
    });

    // Calculate guard performance
    const guardPerformance = guards.map(guard => {
      const guardShifts = currentShifts.filter(s => s.guard_id === guard.id);
      const completedShifts = guardShifts.filter(s => s.status === 'completed');
      const clockedInShifts = guardShifts.filter(s => s.clock_in?.timestamp);
      
      // Late clock-ins (more than 15 minutes late)
      const lateClockIns = clockedInShifts.filter(s => {
        const clockIn = new Date(s.clock_in.timestamp);
        const scheduled = new Date(s.start_time);
        return clockIn > new Date(scheduled.getTime() + 15 * 60000);
      });

      // Stay awake alerts
      const guardStayAwake = currentStayAwake.filter(s => s.guard_id === guard.id);
      const missedStayAwake = guardStayAwake.filter(s => s.status === 'missed');

      // Patrols
      const guardPatrols = currentPatrols.filter(p => p.guard_id === guard.id);
      const verifiedPatrols = guardPatrols.filter(p => p.verified);

      return {
        guard_name: guard.full_name,
        guard_email: guard.email,
        total_shifts: guardShifts.length,
        completed_shifts: completedShifts.length,
        late_clock_ins: lateClockIns.length,
        late_clock_in_details: lateClockIns.map(s => ({
          date: new Date(s.start_time).toLocaleDateString(),
          site: s.site_name,
          scheduled: new Date(s.start_time).toLocaleTimeString(),
          actual: new Date(s.clock_in.timestamp).toLocaleTimeString(),
          delay_minutes: Math.round((new Date(s.clock_in.timestamp) - new Date(s.start_time)) / 60000)
        })),
        stay_awake_total: guardStayAwake.length,
        stay_awake_missed: missedStayAwake.length,
        patrols_total: guardPatrols.length,
        patrols_verified: verifiedPatrols.length,
        completion_rate: guardShifts.length > 0 ? ((completedShifts.length / guardShifts.length) * 100).toFixed(1) : 0,
        punctuality_rate: clockedInShifts.length > 0 ? (((clockedInShifts.length - lateClockIns.length) / clockedInShifts.length) * 100).toFixed(1) : 0,
        stay_awake_response_rate: guardStayAwake.length > 0 ? (((guardStayAwake.length - missedStayAwake.length) / guardStayAwake.length) * 100).toFixed(1) : 0,
        patrol_verification_rate: guardPatrols.length > 0 ? ((verifiedPatrols.length / guardPatrols.length) * 100).toFixed(1) : 0
      };
    }).filter(g => g.total_shifts > 0);

    // Calculate site activity
    const siteActivity = sites.map(site => {
      const siteShifts = currentShifts.filter(s => s.site_id === site.id);
      const sitePatrols = currentPatrols.filter(p => p.site_id === site.id);
      const uniqueGuards = [...new Set(siteShifts.map(s => s.guard_id))].length;

      return {
        site_name: site.name,
        total_shifts: siteShifts.length,
        completed_shifts: siteShifts.filter(s => s.status === 'completed').length,
        total_patrols: sitePatrols.length,
        verified_patrols: sitePatrols.filter(p => p.verified).length,
        unique_guards: uniqueGuards,
        coverage_rate: siteShifts.length > 0 ? ((siteShifts.filter(s => s.status === 'completed').length / siteShifts.length) * 100).toFixed(1) : 0
      };
    }).filter(s => s.total_shifts > 0);

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
        subject: `Guard Performance & Site Activity Report - ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        body: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #0f172a; }
    .container { max-width: 1000px; margin: 20px auto; background: #1e293b; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
    .header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); padding: 40px; text-align: center; border-bottom: 4px solid #dc2626; }
    .logo { max-width: 200px; margin: 0 auto 20px; }
    .header h1 { margin: 0; font-size: 32px; font-weight: 700; color: white; text-transform: uppercase; letter-spacing: 1px; }
    .header p { margin: 10px 0 0; color: #94a3b8; font-size: 16px; }
    .content { padding: 40px; background: white; }
    .section { margin-bottom: 40px; }
    .section h2 { color: #1e293b; font-size: 24px; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 3px solid #dc2626; }
    .performance-table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .performance-table th { background: #1e293b; color: white; padding: 15px 10px; text-align: left; font-weight: 600; }
    .performance-table td { padding: 12px 10px; border-bottom: 1px solid #e2e8f0; }
    .performance-table tr:hover { background: #f8fafc; }
    .score-badge { padding: 4px 10px; border-radius: 4px; font-weight: 600; font-size: 12px; }
    .score-excellent { background: #10b981; color: white; }
    .score-good { background: #3b82f6; color: white; }
    .score-fair { background: #f59e0b; color: white; }
    .score-poor { background: #dc2626; color: white; }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin: 30px 0; }
    .metric-card { background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 25px; border-radius: 10px; border-left: 5px solid #dc2626; color: white; }
    .metric-card h3 { margin: 0 0 10px; font-size: 14px; color: #94a3b8; text-transform: uppercase; }
    .metric-value { font-size: 36px; font-weight: bold; margin-bottom: 5px; }
    .alert-box { background: #fef2f2; border-left: 4px solid #dc2626; padding: 20px; margin: 20px 0; border-radius: 6px; }
    .alert-box h3 { color: #991b1b; margin: 0 0 10px; }
    .alert-box ul { color: #7f1d1d; margin: 10px 0; padding-left: 20px; }
    .detail-card { background: #f8fafc; padding: 15px; margin: 10px 0; border-radius: 6px; border-left: 3px solid #64748b; }
    .footer { background: #0f172a; color: #94a3b8; padding: 30px; text-align: center; font-size: 13px; }
    .footer strong { color: #dc2626; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="${logoUrl}" alt="Unified Security Solutions" class="logo">
      <h1>Guard Performance & Site Activity</h1>
      <p>${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
    </div>
    
    <div class="content">
      <div class="section">
        <h2>📊 Overall Performance Summary</h2>
        <div class="metric-grid">
          <div class="metric-card">
            <h3>Active Guards</h3>
            <div class="metric-value">${guardPerformance.length}</div>
          </div>
          <div class="metric-card">
            <h3>Total Shifts</h3>
            <div class="metric-value">${currentShifts.length}</div>
          </div>
          <div class="metric-card">
            <h3>Late Clock-Ins</h3>
            <div class="metric-value">${guardPerformance.reduce((sum, g) => sum + g.late_clock_ins, 0)}</div>
          </div>
          <div class="metric-card">
            <h3>Missed Stay-Awake</h3>
            <div class="metric-value">${guardPerformance.reduce((sum, g) => sum + g.stay_awake_missed, 0)}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>👮 Guard Performance Breakdown</h2>
        <table class="performance-table">
          <thead>
            <tr>
              <th>Guard Name</th>
              <th>Shifts</th>
              <th>Completion Rate</th>
              <th>Punctuality</th>
              <th>Late Clock-Ins</th>
              <th>Patrols</th>
              <th>Stay-Awake Response</th>
              <th>Overall Score</th>
            </tr>
          </thead>
          <tbody>
            ${guardPerformance.map(guard => {
              const overallScore = (
                parseFloat(guard.completion_rate) * 0.3 +
                parseFloat(guard.punctuality_rate) * 0.3 +
                parseFloat(guard.stay_awake_response_rate) * 0.2 +
                parseFloat(guard.patrol_verification_rate) * 0.2
              ).toFixed(1);
              const scoreClass = overallScore >= 90 ? 'excellent' : overallScore >= 75 ? 'good' : overallScore >= 60 ? 'fair' : 'poor';
              
              return `
              <tr>
                <td><strong>${guard.guard_name}</strong></td>
                <td>${guard.completed_shifts}/${guard.total_shifts}</td>
                <td>${guard.completion_rate}%</td>
                <td>${guard.punctuality_rate}%</td>
                <td style="color: ${guard.late_clock_ins > 0 ? '#dc2626' : '#10b981'}; font-weight: 600;">
                  ${guard.late_clock_ins}
                </td>
                <td>${guard.patrols_verified}/${guard.patrols_total} (${guard.patrol_verification_rate}%)</td>
                <td>
                  ${guard.stay_awake_response_rate}%
                  ${guard.stay_awake_missed > 0 ? `<span style="color: #dc2626;">(${guard.stay_awake_missed} missed)</span>` : ''}
                </td>
                <td><span class="score-badge score-${scoreClass}">${overallScore}%</span></td>
              </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>

      ${guardPerformance.some(g => g.late_clock_ins > 0) ? `
      <div class="section">
        <h2>⏰ Late Clock-In Details</h2>
        ${guardPerformance.filter(g => g.late_clock_ins > 0).map(guard => `
          <div class="detail-card">
            <strong style="color: #1e293b; font-size: 16px;">${guard.guard_name}</strong> - ${guard.late_clock_ins} late arrival(s)
            <ul style="margin: 10px 0 0; color: #475569;">
              ${guard.late_clock_in_details.map(detail => `
                <li>${detail.date} at ${detail.site}: Scheduled ${detail.scheduled}, arrived ${detail.actual} 
                <span style="color: #dc2626; font-weight: 600;">(${detail.delay_minutes} min late)</span></li>
              `).join('')}
            </ul>
          </div>
        `).join('')}
      </div>
      ` : ''}

      <div class="section">
        <h2>🏢 Site Activity Summary</h2>
        <table class="performance-table">
          <thead>
            <tr>
              <th>Site Name</th>
              <th>Total Shifts</th>
              <th>Completed</th>
              <th>Coverage Rate</th>
              <th>Patrols</th>
              <th>Verified Patrols</th>
              <th>Unique Guards</th>
            </tr>
          </thead>
          <tbody>
            ${siteActivity.map(site => `
              <tr>
                <td><strong>${site.site_name}</strong></td>
                <td>${site.total_shifts}</td>
                <td>${site.completed_shifts}</td>
                <td>
                  <span class="score-badge score-${site.coverage_rate >= 90 ? 'excellent' : site.coverage_rate >= 75 ? 'good' : 'fair'}">
                    ${site.coverage_rate}%
                  </span>
                </td>
                <td>${site.total_patrols}</td>
                <td>${site.verified_patrols} (${site.total_patrols > 0 ? ((site.verified_patrols / site.total_patrols) * 100).toFixed(1) : 0}%)</td>
                <td>${site.unique_guards}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="alert-box">
        <h3>⚠️ Action Required</h3>
        <ul>
          ${guardPerformance.filter(g => g.late_clock_ins > 2).length > 0 ? 
            `<li><strong>${guardPerformance.filter(g => g.late_clock_ins > 2).length} guard(s) with multiple late arrivals</strong> - Review punctuality and implement corrective measures</li>` : ''}
          ${guardPerformance.filter(g => g.stay_awake_missed > 1).length > 0 ?
            `<li><strong>${guardPerformance.filter(g => g.stay_awake_missed > 1).length} guard(s) missing stay-awake alerts</strong> - Investigate alertness issues</li>` : ''}
          ${guardPerformance.filter(g => parseFloat(g.patrol_verification_rate) < 80).length > 0 ?
            `<li><strong>Low patrol verification rates</strong> - ${guardPerformance.filter(g => parseFloat(g.patrol_verification_rate) < 80).map(g => g.guard_name).join(', ')}</li>` : ''}
          ${siteActivity.filter(s => parseFloat(s.coverage_rate) < 90).length > 0 ?
            `<li><strong>Sites needing attention:</strong> ${siteActivity.filter(s => parseFloat(s.coverage_rate) < 90).map(s => s.site_name).join(', ')}</li>` : ''}
        </ul>
      </div>

      <div class="section" style="background: #f0fdf4; padding: 20px; border-radius: 8px;">
        <h2 style="color: #166534;">✅ Recommendations</h2>
        <ul style="color: #166534; line-height: 1.8;">
          <li>Implement progressive discipline for repeated late arrivals</li>
          <li>Provide additional training for guards with low performance scores</li>
          <li>Review stay-awake alert settings and guard workload</li>
          <li>Increase patrol frequency at sites with low coverage</li>
          <li>Recognize and reward top-performing guards</li>
          <li>Consider shift reassignments based on performance patterns</li>
        </ul>
      </div>
    </div>

    <div class="footer">
      <p><strong>Unified Security Solutions</strong> - Excellence in Security Performance</p>
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
      guards_analyzed: guardPerformance.length,
      sites_analyzed: siteActivity.length
    });
  } catch (error) {
    console.error('Error generating guard performance report:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});