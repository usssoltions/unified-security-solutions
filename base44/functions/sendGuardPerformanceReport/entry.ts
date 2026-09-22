import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@2.5.2';
import { resolveCommunicationBrand, hexToRgb, escHtml } from '../../shared/brandedCommunication.ts';
import { renderTransactionalShell } from '../../shared/transactionalEmail.ts';

import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only admins may generate & dispatch board reports.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role_type !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // TENANT SCOPE — the report AND its branding belong to the CALLING
    // admin's organisation (Customer → Reseller → platform). Data and
    // recipients are filtered to that tenant; a caller without a customer
    // scope (platform admin) sees only legacy unscoped records.
    const tenantScope = user.customer_id
      ? { customer_id: user.customer_id }
      : user.reseller_id
        ? { reseller_id: user.reseller_id }
        : null;
    const matchesScope = (rec) => {
      if (!tenantScope) return !rec.customer_id && !rec.reseller_id;
      if (tenantScope.customer_id) return rec.customer_id === tenantScope.customer_id;
      return rec.reseller_id === tenantScope.reseller_id;
    };
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: tenantScope?.customer_id || null,
      reseller_id: tenantScope?.reseller_id || null,
    });

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
      return date >= currentMonthStart && date <= currentMonthEnd && matchesScope(s);
    });

    const currentStayAwake = stayAwakeLogs.filter(s => {
      const date = new Date(s.alert_time);
      return date >= currentMonthStart && date <= currentMonthEnd && matchesScope(s);
    });

    const currentPatrols = patrolLogs.filter(p => {
      const date = new Date(p.timestamp);
      return date >= currentMonthStart && date <= currentMonthEnd && matchesScope(p);
    });

    // Calculate guard performance
    const guardPerformance = guards.filter(matchesScope).map(guard => {
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
    const siteActivity = sites.filter(matchesScope).map(site => {
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
    // Recipients are scoped to the caller's OWN tenant — Customer A's board
    // report is never emailed to Customer B's administrators.
    // MODERN role resolution — customer_admin joins the management roles (a
    // customer whose administrator holds the post-split role previously
    // received ZERO board reports). Control room operators are deliberately
    // excluded: this is a management-level report.
    const recipients = allUsers.filter(u =>
      u.role_type === 'admin' ||
      u.role_type === 'customer_admin' ||
      u.role_type === 'management' ||
      u.role_type === 'supervisor'
    ).filter(u => u.email && (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) && matchesScope(u));

    // Generate Enhanced PDF Report
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    let yPos = 20;

    // BRANDED HEADER
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setFillColor(...hexToRgb(brand.primary_color));
    doc.rect(0, 40, pageWidth, 6, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.text(String(brand.brand_name).toUpperCase(), pageWidth / 2, 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text(brand.website || '', pageWidth / 2, 23, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('GUARD PERFORMANCE & OPERATIONS ANALYSIS', pageWidth / 2, 35, { align: 'center' });

    yPos = 55;

    // Report Title
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Report Period: ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, 15, yPos);
    yPos += 15;

    // Executive Summary
    doc.setFillColor(241, 245, 249);
    doc.rect(15, yPos, pageWidth - 30, 25, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('EXECUTIVE SUMMARY', 20, yPos + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Active Guards: ${guardPerformance.length} | Total Shifts: ${currentShifts.length} | Late Clock-Ins: ${guardPerformance.reduce((sum, g) => sum + g.late_clock_ins, 0)} | Missed Stay-Awake: ${guardPerformance.reduce((sum, g) => sum + g.stay_awake_missed, 0)}`, 20, yPos + 18);
    yPos += 35;

    // Guard Performance Table
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('GUARD PERFORMANCE ANALYSIS', 15, yPos);
    yPos += 10;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Guard', 15, yPos);
    doc.text('Shifts', 65, yPos);
    doc.text('Completion', 90, yPos);
    doc.text('Punctuality', 120, yPos);
    doc.text('Late', 150, yPos);
    doc.text('Overall', 170, yPos);
    yPos += 5;

    doc.setDrawColor(...hexToRgb(brand.primary_color));
    doc.line(15, yPos, pageWidth - 15, yPos);
    yPos += 5;

    doc.setFont('helvetica', 'normal');
    guardPerformance.forEach(guard => {
      if (yPos > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      }

      const overallScore = (
        parseFloat(guard.completion_rate) * 0.3 +
        parseFloat(guard.punctuality_rate) * 0.3 +
        parseFloat(guard.stay_awake_response_rate) * 0.2 +
        parseFloat(guard.patrol_verification_rate) * 0.2
      ).toFixed(1);

      doc.text(guard.guard_name.substring(0, 20), 15, yPos);
      doc.text(`${guard.completed_shifts}/${guard.total_shifts}`, 65, yPos);
      doc.text(`${guard.completion_rate}%`, 90, yPos);
      doc.text(`${guard.punctuality_rate}%`, 120, yPos);
      doc.text(guard.late_clock_ins.toString(), 150, yPos);
      doc.text(`${overallScore}%`, 170, yPos);
      yPos += 6;
    });
    yPos += 10;

    // Late Clock-In Details
    const lateGuards = guardPerformance.filter(g => g.late_clock_ins > 0);
    if (lateGuards.length > 0) {
      if (yPos > pageHeight - 60) {
        doc.addPage();
        yPos = 20;
      }

      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text('LATE CLOCK-IN DETAILS', 15, yPos);
      yPos += 10;

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      lateGuards.forEach(guard => {
        doc.setFont('helvetica', 'bold');
        doc.text(`${guard.guard_name} - ${guard.late_clock_ins} occurrence(s)`, 15, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'normal');
        guard.late_clock_in_details.forEach(detail => {
          doc.text(`  ${detail.date} at ${detail.site}: ${detail.delay_minutes} min late`, 20, yPos);
          yPos += 4;
        });
        yPos += 3;
      });
      yPos += 5;
    }

    // Site Activity Summary
    doc.addPage();
    yPos = 20;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('SITE ACTIVITY SUMMARY', 15, yPos);
    yPos += 10;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Site Name', 15, yPos);
    doc.text('Shifts', 90, yPos);
    doc.text('Completed', 120, yPos);
    doc.text('Coverage %', 150, yPos);
    doc.text('Guards', 180, yPos);
    yPos += 5;

    doc.setDrawColor(...hexToRgb(brand.primary_color));
    doc.line(15, yPos, pageWidth - 15, yPos);
    yPos += 5;

    doc.setFont('helvetica', 'normal');
    siteActivity.forEach(site => {
      if (yPos > pageHeight - 20) {
        doc.addPage();
        yPos = 20;
      }

      doc.text(site.site_name.substring(0, 30), 15, yPos);
      doc.text(site.total_shifts.toString(), 90, yPos);
      doc.text(site.completed_shifts.toString(), 120, yPos);
      doc.text(`${site.coverage_rate}%`, 150, yPos);
      doc.text(site.unique_guards.toString(), 180, yPos);
      yPos += 6;
    });
    yPos += 10;

    // Recommendations
    doc.addPage();
    yPos = 20;
    doc.setFillColor(254, 242, 242);
    doc.rect(15, yPos - 5, pageWidth - 30, 70, 'F');
    doc.setTextColor(153, 27, 27);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('RECOMMENDATIONS', 20, yPos);
    yPos += 10;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const recommendations = [
      'Implement progressive discipline for repeated late arrivals',
      'Provide additional training for guards with low performance scores',
      'Review stay-awake alert settings and guard workload',
      'Increase patrol frequency at sites with low coverage',
      'Recognize and reward top-performing guards',
      'Consider shift reassignments based on performance patterns'
    ];

    recommendations.forEach(rec => {
      doc.text(`• ${rec}`, 20, yPos);
      yPos += 6;
    });

    // Footer
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(8);
    doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, pageHeight - 10, { align: 'center' });

    const pdfBytes = doc.output('arraybuffer');
    const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
    const pdfFile = new File([pdfBlob], `Guard_Performance_Report_${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).replace(' ', '_')}.pdf`);
    const { file_url: pdfUrl } = await base44.asServiceRole.integrations.Core.UploadFile({ file: pdfFile });

    const emailPromises = recipients.map(recipient =>
      sendAuditedEmail(base44.asServiceRole, {
        from_name: brand.brand_name,
        to: recipient.email,
        subject: `Board Report: Guard Performance & Site Activity - ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        // DELIVERY AUDIT — standard application-controlled email auditing.
        brand,
        customer_id: brand.customer_id || null,
        reseller_id: brand.reseller_id || null,
        recipient_id: recipient.id || undefined,
        recipient_name: recipient.display_name || recipient.full_name || undefined,
        event_type: 'guard_performance_report',
        reference_id: `${brand.customer_id || 'platform'}:${currentMonthStart.toISOString().slice(0, 7)}`,
        html: renderTransactionalShell({
          brand,
          title: 'Guard Performance & Site Activity',
          bodyHtml: `
<p style="margin:0 0 12px;color:#334155;font-size:14px;">Dear Board Member,</p>
<p style="margin:0 0 12px;color:#334155;font-size:14px;">Please find attached the <strong>Guard Performance &amp; Site Activity Report</strong> for ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}.</p>
<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 16px">
  ${[
    ['Active Guards Analyzed', guardPerformance.length],
    ['Total Shifts Completed', currentShifts.length],
    ['Late Clock-Ins', guardPerformance.reduce((sum, g) => sum + g.late_clock_ins, 0)],
    ['Missed Stay-Awake Alerts', guardPerformance.reduce((sum, g) => sum + g.stay_awake_missed, 0)],
    ['Sites Monitored', siteActivity.length],
  ].map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;white-space:nowrap;width:1%">${escHtml(String(k))}</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:700">${escHtml(String(v))}</td></tr>`).join('')}
</table>
<p style="margin:0 0 12px;color:#334155;font-size:14px;">The attached PDF contains comprehensive guard performance metrics, punctuality analysis, site activity summaries, and strategic recommendations for optimizing security operations.</p>`,
          cta: pdfUrl ? { label: 'Download Report PDF', url: pdfUrl } : null,
        }),
        text: [
          `GUARD PERFORMANCE & SITE ACTIVITY — ${currentMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
          `Active guards analyzed: ${guardPerformance.length}`,
          `Total shifts completed: ${currentShifts.length}`,
          `Late clock-ins: ${guardPerformance.reduce((sum, g) => sum + g.late_clock_ins, 0)}`,
          `Missed stay-awake alerts: ${guardPerformance.reduce((sum, g) => sum + g.stay_awake_missed, 0)}`,
          `Sites monitored: ${siteActivity.length}`,
          pdfUrl ? `Download report: ${pdfUrl}` : '',
        ].filter(Boolean).join('\n\n')
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