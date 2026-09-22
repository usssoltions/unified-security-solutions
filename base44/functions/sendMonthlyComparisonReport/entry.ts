import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@2.5.2';
import { resolveCommunicationBrand, hexToRgb, escHtml } from '../../shared/brandedCommunication.ts';
import { renderTransactionalShell } from '../../shared/transactionalEmail.ts';

async function generateMonthlyPDF(currentMonthLabel, prevMonthLabel, stats, siteComparison, analysis, brand) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 18;
  const contentW = pageW - margin * 2;
  const brandPrimary = hexToRgb(brand.primary_color);
  const brandAccent = hexToRgb(brand.accent_color);

  doc.setFillColor(...brandPrimary);
  doc.rect(0, 0, pageW, 48, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('MONTHLY COMPARISON REPORT', pageW / 2, 18, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`${currentMonthLabel} vs ${prevMonthLabel}`, pageW / 2, 30, { align: 'center' });
  doc.text(String(brand.brand_name), pageW / 2, 41, { align: 'center' });

  let y = 58;

  const metrics = [
    { label: 'Incidents', current: stats.currentIncidents, prev: stats.prevIncidents, change: stats.incidentChange },
    { label: 'Critical', current: stats.currentCritical, prev: stats.prevCritical, change: null },
    { label: 'Maintenance', current: stats.currentMaintenance, prev: stats.prevMaintenance, change: stats.maintenanceChange },
    { label: 'Patrols', current: stats.currentPatrols, prev: stats.prevPatrols, change: stats.patrolChange },
  ];
  const boxW = contentW / 4 - 3;
  doc.setTextColor(26, 26, 26);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Key Metrics', margin, y);
  y += 6;
  metrics.forEach((m, i) => {
    const bx = margin + i * (boxW + 4);
    doc.setFillColor(248, 249, 250);
    doc.roundedRect(bx, y, boxW, 28, 3, 3, 'F');
    doc.setFillColor(...brandPrimary);
    doc.rect(bx, y, 3, 28, 'F');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(m.label, bx + 6, y + 7);
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(String(m.current), bx + 6, y + 17);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    if (m.change !== null) {
      const chg = parseFloat(m.change);
      doc.setTextColor(chg > 0 ? 220 : chg < 0 ? 22 : 100, chg > 0 ? 38 : chg < 0 ? 163 : 116, chg > 0 ? 38 : chg < 0 ? 74 : 139);
      doc.text(`${chg > 0 ? '▲' : chg < 0 ? '▼' : '●'} ${Math.abs(chg)}%`, bx + 6, y + 25);
    } else {
      doc.setTextColor(100, 116, 139);
      doc.text(`Prev: ${m.prev}`, bx + 6, y + 25);
    }
  });
  y += 36;

  if (siteComparison.length > 0) {
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Site Performance', margin, y);
    y += 6;
    doc.setFillColor(...brandPrimary);
    doc.rect(margin, y, contentW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const cols = [0, 55, 85, 115, 140, 165];
    ['Site', 'Curr Inc.', 'Prev Inc.', 'Change', 'Curr Maint.', 'Prev Maint.'].forEach((h, i) => doc.text(h, margin + cols[i], y + 5.5));
    y += 10;
    doc.setFont('helvetica', 'normal');
    siteComparison.slice(0, 6).forEach((s, idx) => {
      if (idx % 2 === 0) { doc.setFillColor(248, 249, 250); doc.rect(margin, y - 2, contentW, 8, 'F'); }
      doc.setTextColor(26, 26, 26);
      doc.setFontSize(9);
      doc.text(s.name.substring(0, 18), margin + cols[0], y + 4);
      doc.text(String(s.currentIncidents), margin + cols[1], y + 4);
      doc.text(String(s.prevIncidents), margin + cols[2], y + 4);
      const chg = parseFloat(s.incidentChange);
      doc.setTextColor(chg > 0 ? 220 : chg < 0 ? 22 : 100, chg > 0 ? 38 : chg < 0 ? 163 : 116, chg > 0 ? 38 : chg < 0 ? 74 : 139);
      doc.text(`${chg > 0 ? '▲' : chg < 0 ? '▼' : '●'} ${Math.abs(chg)}%`, margin + cols[3], y + 4);
      doc.setTextColor(26, 26, 26);
      doc.text(String(s.currentMaintenance), margin + cols[4], y + 4);
      doc.text(String(s.prevMaintenance), margin + cols[5], y + 4);
      y += 8;
    });
    y += 4;
  }

  if (y < 240) {
    const analysisLines = doc.splitTextToSize(analysis.replace(/[▲▼●⚠️✅]/g, ''), contentW - 8);
    const boxH = Math.min(analysisLines.length * 4.5 + 12, 285 - y - 16);
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(margin, y, contentW, boxH, 3, 3, 'F');
    doc.setFillColor(22, 163, 74);
    doc.rect(margin, y, 3, boxH, 'F');
    doc.setTextColor(22, 101, 52);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Month-over-Month Analysis', margin + 6, y + 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(analysisLines.slice(0, Math.floor((boxH - 14) / 4.5)), margin + 6, y + 14);
  }

  doc.setFillColor(...brandAccent);
  doc.rect(0, 285, pageW, 12, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Automated Monthly Report — ${String(brand.brand_name)}`, pageW / 2, 292, { align: 'center' });

  return doc.output('arraybuffer');
}

import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate — monthly comparison reports are an admin-only operation.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role_type !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Respect the global "Monthly Comparison" report toggle.
    try {
      const _s = await base44.asServiceRole.entities.AutomationSetting.list();
      if (_s?.[0] && _s[0].report_monthly_comparison === false) {
        return Response.json({ success: true, skipped: true, reason: 'monthly report disabled' });
      }
    } catch (_) {}

    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [incidents, maintenance, patrols, shifts, alerts, sites] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({}),
      base44.asServiceRole.entities.Site.filter({}),
    ]);

    // TENANT GROUPING — this scheduled job runs with NO customer
    // administrator logged in, so each recipient receives ONLY their OWN
    // tenant's comparison, with a PDF and email identity resolved from the
    // tenant that OWNS the data (Customer → Reseller → platform). No session
    // state, no cross-tenant data, no foreign branding.
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    // MODERN role resolution — customer_admin joins the management roles (a
    // customer whose administrator holds the post-split role previously
    // received ZERO comparison reports). Operators are deliberately excluded
    // (management-level report).
    const recipients = allUsers.filter(u =>
      (u.role_type === 'admin' || u.role_type === 'customer_admin' || u.role_type === 'management' || u.role_type === 'supervisor') &&
      (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) && u.email
    );

    if (recipients.length === 0) {
      return Response.json({ success: true, reportsSent: 0, reason: 'No recipients' });
    }

    // Group recipients per owning customer; staff without a customer scope
    // form one legacy-scope group that sees only unscoped (legacy) records.
    const groups = new Map();
    for (const u of recipients) {
      const key = u.customer_id || '_platform';
      if (!groups.has(key)) groups.set(key, { customer_id: u.customer_id || null, users: [] });
      groups.get(key).users.push(u);
    }

    const inRange = (dateStr, start, end) => { const d = new Date(dateStr); return d >= start && d <= end; };
    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous * 100).toFixed(1);
    };

    let reportsSent = 0;

    for (const group of groups.values()) {
      const scopeMatch = (rec) =>
        group.customer_id
          ? rec.customer_id === group.customer_id
          : (!rec.customer_id && !rec.reseller_id);

      const tIncidents = incidents.filter(scopeMatch);
      const tMaintenance = maintenance.filter(scopeMatch);
      const tPatrols = patrols.filter(scopeMatch);
      const tShifts = shifts.filter(scopeMatch);
      const tAlerts = alerts.filter(scopeMatch);
      const tSites = sites.filter(scopeMatch);

      const currentIncidents = tIncidents.filter(i => inRange(i.reported_at || i.created_date, currentMonthStart, currentMonthEnd));
      const currentMaintenance = tMaintenance.filter(m => inRange(m.reported_at || m.created_date, currentMonthStart, currentMonthEnd));
      const currentPatrols = tPatrols.filter(p => inRange(p.timestamp || p.created_date, currentMonthStart, currentMonthEnd));
      const currentShifts = tShifts.filter(s => inRange(s.start_time, currentMonthStart, currentMonthEnd));
      const currentAlerts = tAlerts.filter(a => inRange(a.created_date, currentMonthStart, currentMonthEnd));

      const prevIncidents = tIncidents.filter(i => inRange(i.reported_at || i.created_date, prevMonthStart, prevMonthEnd));
      const prevMaintenance = tMaintenance.filter(m => inRange(m.reported_at || m.created_date, prevMonthStart, prevMonthEnd));
      const prevPatrols = tPatrols.filter(p => inRange(p.timestamp || p.created_date, prevMonthStart, prevMonthEnd));
      const prevShifts = tShifts.filter(s => inRange(s.start_time, prevMonthStart, prevMonthEnd));
      const prevAlerts = tAlerts.filter(a => inRange(a.created_date, prevMonthStart, prevMonthEnd));

      const incidentChange = calculateChange(currentIncidents.length, prevIncidents.length);
      const maintenanceChange = calculateChange(currentMaintenance.length, prevMaintenance.length);
      const patrolChange = calculateChange(currentPatrols.length, prevPatrols.length);

      const siteComparison = tSites.map(site => {
        const ci = currentIncidents.filter(i => i.site_id === site.id).length;
        const pi = prevIncidents.filter(i => i.site_id === site.id).length;
        return {
          name: site.name,
          currentIncidents: ci,
          prevIncidents: pi,
          incidentChange: calculateChange(ci, pi),
          currentMaintenance: currentMaintenance.filter(m => m.site_id === site.id).length,
          prevMaintenance: prevMaintenance.filter(m => m.site_id === site.id).length,
        };
      }).sort((a, b) => b.currentIncidents - a.currentIncidents);

      const currentCritical = currentIncidents.filter(i => i.priority === 'critical').length;
      const prevCritical = prevIncidents.filter(i => i.priority === 'critical').length;

      const analysis = [
        `MONTH-OVER-MONTH SUMMARY`,
        `Incidents: ${currentIncidents.length} vs ${prevIncidents.length} last month (${incidentChange > 0 ? '▲' : '▼'} ${Math.abs(incidentChange)}%)`,
        `Critical: ${currentCritical} vs ${prevCritical} last month`,
        `Maintenance: ${currentMaintenance.length} vs ${prevMaintenance.length}`,
        `Patrol stops: ${currentPatrols.length} vs ${prevPatrols.length}`,
        `Shifts: ${currentShifts.length} vs ${prevShifts.length}`,
        `Alerts: ${currentAlerts.length} vs ${prevAlerts.length}`,
        ``,
        `SITE OBSERVATIONS`,
        ...siteComparison.slice(0, 5).map(s =>
          `• ${s.name}: ${s.currentIncidents} incidents this month vs ${s.prevIncidents} last month`
        ),
        ``,
        currentCritical > prevCritical ? `⚠️ Critical incidents increased — immediate review recommended.` : `✅ Critical incident count stable or improved.`,
      ].join('\n');

      // Effective brand for THIS tenant (Customer → Reseller → platform).
      const brand = await resolveCommunicationBrand(base44.asServiceRole, {
        customer_id: group.customer_id,
      });

      // One PDF per tenant scope, branded with that tenant's identity.
      let pdfDownloadUrl = null;
      try {
        const pdfBuffer = await generateMonthlyPDF(
          currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }),
          prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }),
          {
            currentIncidents: currentIncidents.length, prevIncidents: prevIncidents.length,
            currentCritical, prevCritical,
            currentMaintenance: currentMaintenance.length, prevMaintenance: prevMaintenance.length,
            currentPatrols: currentPatrols.length, prevPatrols: prevPatrols.length,
            currentShifts: currentShifts.length, prevShifts: prevShifts.length,
            incidentChange, maintenanceChange, patrolChange,
          },
          siteComparison,
          analysis,
          brand
        );
        const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
        const pdfFile = new File([blob], `monthly_report_${currentMonthStart.toISOString().split('T')[0]}.pdf`, { type: 'application/pdf' });
        const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: pdfFile });
        pdfDownloadUrl = uploadResult.file_url;
      } catch (pdfErr) {
        console.error('PDF generation failed:', pdfErr.message);
      }

      const pdfButtonHtml = pdfDownloadUrl
        ? `<div style="text-align:center;margin:20px 0;"><a href="${pdfDownloadUrl}" target="_blank" style="background:${escHtml(brand.primary_color)};color:white;padding:12px 28px;border-radius:8px;font-weight:bold;text-decoration:none;">📄 Download PDF Report</a></div>`
        : '';

      const footerContact = [
        brand.support_email ? escHtml(String(brand.support_email)) : null,
        brand.website ? escHtml(String(brand.website)) : null,
      ].filter(Boolean).join(' &bull; ');

      await Promise.all(group.users.map(recipient =>
        sendAuditedEmail(base44.asServiceRole, {
          from_name: brand.brand_name,
          to: recipient.email,
          subject: `Monthly Comparison Report — ${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
          // DELIVERY AUDIT — standard application-controlled email auditing.
          brand,
          customer_id: group.customer_id || null,
          recipient_id: recipient.id || undefined,
          recipient_name: recipient.display_name || recipient.full_name || undefined,
          event_type: 'monthly_comparison_report',
          reference_id: `${group.customer_id}:${currentMonthStart.toISOString().slice(0, 7)}`,
          html: renderTransactionalShell({
            brand,
            title: 'Monthly Comparison Report',
            bodyHtml: `
              <p style="margin:0 0 12px;color:#334155;font-size:14px;">${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</p>
              <table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 16px">
                ${[
                  ['Incidents', `${currentIncidents.length} (${incidentChange > 0 ? '+' : ''}${incidentChange}% vs previous)`],
                  ['Critical', `${currentCritical} (prev: ${prevCritical})`],
                  ['Maintenance', `${currentMaintenance.length} (${maintenanceChange > 0 ? '+' : ''}${maintenanceChange}% vs previous)`],
                  ['Patrols', `${currentPatrols.length} (prev: ${prevPatrols.length})`],
                ].map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;white-space:nowrap;width:1%">${escHtml(String(k))}</td><td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:700">${escHtml(String(v))}</td></tr>`).join('')}
              </table>
              <h3 style="margin:0 0 8px;color:#1e293b;font-size:16px;">Site Performance</h3>
              <table border="1" cellpadding="10" style="border-collapse:collapse;width:100%;font-size:13px;">
                <tr style="background:#1e293b;color:white;"><th>Site</th><th>Current Inc.</th><th>Prev Inc.</th><th>Change</th><th>Maintenance</th></tr>
                ${siteComparison.slice(0, 6).map(s => `<tr><td>${escHtml(s.name)}</td><td>${s.currentIncidents}</td><td>${s.prevIncidents}</td><td>${s.incidentChange > 0 ? '+' : ''}${s.incidentChange}%</td><td>${s.currentMaintenance}</td></tr>`).join('')}
              </table>
              <h3 style="margin:16px 0 8px;color:#1e293b;font-size:16px;">Month-over-Month Analysis</h3>
              <pre style="font-family:Arial,sans-serif;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#334155;margin:0;">${escHtml(analysis)}</pre>`,
            cta: pdfDownloadUrl ? { label: 'Download PDF Report', url: pdfDownloadUrl } : null,
          }),
          text: [
            `MONTHLY COMPARISON REPORT — ${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
            `Incidents: ${currentIncidents.length} (${incidentChange > 0 ? '+' : ''}${incidentChange}%)`,
            `Critical: ${currentCritical} (prev: ${prevCritical})`,
            `Maintenance: ${currentMaintenance.length} (${maintenanceChange > 0 ? '+' : ''}${maintenanceChange}%)`,
            `Patrols: ${currentPatrols.length} (prev: ${prevPatrols.length})`,
            analysis || '',
            pdfDownloadUrl ? `PDF report: ${pdfDownloadUrl}` : '',
          ].filter(Boolean).join('\n\n')
        }).catch(err => console.error(`Email failed to ${recipient.email}:`, err.message))
      ));
      reportsSent += group.users.length;
    }

    return Response.json({
      success: true,
      reportsSent,
      period: `${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`
    });
  } catch (error) {
    console.error('Error generating monthly comparison report:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});