import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@2.5.2';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

async function generateMonthlyPDF(currentMonthLabel, prevMonthLabel, stats, siteComparison, analysis) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 18;
  const contentW = pageW - margin * 2;

  doc.setFillColor(196, 30, 58);
  doc.rect(0, 0, pageW, 48, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('MONTHLY COMPARISON REPORT', pageW / 2, 18, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`${currentMonthLabel} vs ${prevMonthLabel}`, pageW / 2, 30, { align: 'center' });
  doc.text('Unified Security Solutions', pageW / 2, 41, { align: 'center' });

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
    doc.setFillColor(196, 30, 58);
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
    doc.setFillColor(196, 30, 58);
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

  doc.setFillColor(26, 26, 26);
  doc.rect(0, 285, pageW, 12, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Automated Monthly Report — Unified Security Solutions', pageW / 2, 292, { align: 'center' });

  return doc.output('arraybuffer');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

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

    const inRange = (dateStr, start, end) => { const d = new Date(dateStr); return d >= start && d <= end; };

    const currentIncidents = incidents.filter(i => inRange(i.reported_at || i.created_date, currentMonthStart, currentMonthEnd));
    const currentMaintenance = maintenance.filter(m => inRange(m.reported_at || m.created_date, currentMonthStart, currentMonthEnd));
    const currentPatrols = patrols.filter(p => inRange(p.timestamp || p.created_date, currentMonthStart, currentMonthEnd));
    const currentShifts = shifts.filter(s => inRange(s.start_time, currentMonthStart, currentMonthEnd));
    const currentAlerts = alerts.filter(a => inRange(a.created_date, currentMonthStart, currentMonthEnd));

    const prevIncidents = incidents.filter(i => inRange(i.reported_at || i.created_date, prevMonthStart, prevMonthEnd));
    const prevMaintenance = maintenance.filter(m => inRange(m.reported_at || m.created_date, prevMonthStart, prevMonthEnd));
    const prevPatrols = patrols.filter(p => inRange(p.timestamp || p.created_date, prevMonthStart, prevMonthEnd));
    const prevShifts = shifts.filter(s => inRange(s.start_time, prevMonthStart, prevMonthEnd));
    const prevAlerts = alerts.filter(a => inRange(a.created_date, prevMonthStart, prevMonthEnd));

    const calculateChange = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous * 100).toFixed(1);
    };

    const incidentChange = calculateChange(currentIncidents.length, prevIncidents.length);
    const maintenanceChange = calculateChange(currentMaintenance.length, prevMaintenance.length);
    const patrolChange = calculateChange(currentPatrols.length, prevPatrols.length);

    const siteComparison = sites.map(site => {
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

    // Email-only recipients — no WhatsApp integration calls
    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = allUsers.filter(u =>
      (u.role_type === 'admin' || u.role_type === 'management' || u.role_type === 'supervisor') && u.email
    );

    if (recipients.length === 0) {
      return Response.json({ success: true, reportsSent: 0, reason: 'No recipients' });
    }

    // Upload PDF once — 1 credit regardless of recipient count
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
        analysis
      );
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const pdfFile = new File([blob], `monthly_report_${currentMonthStart.toISOString().split('T')[0]}.pdf`, { type: 'application/pdf' });
      const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: pdfFile });
      pdfDownloadUrl = uploadResult.file_url;
    } catch (pdfErr) {
      console.error('PDF generation failed:', pdfErr.message);
    }

    const pdfButtonHtml = pdfDownloadUrl
      ? `<div style="text-align:center;margin:20px 0;"><a href="${pdfDownloadUrl}" target="_blank" style="background:${BRAND_COLOR};color:white;padding:12px 28px;border-radius:8px;font-weight:bold;text-decoration:none;">📄 Download PDF Report</a></div>`
      : '';

    await Promise.all(recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard Monthly Analytics',
        to: recipient.email,
        subject: `Monthly Comparison Report — ${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
        body: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
<div style="max-width:700px;margin:20px auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#0ea5e9 0%,#1e40af 100%);padding:30px;text-align:center;color:white;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:12px;border-radius:6px;"/>
    <h1 style="margin:0;font-size:26px;">Monthly Comparison Report</h1>
    <p style="margin:6px 0 0;opacity:0.9;">${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}</p>
  </div>
  <div style="padding:28px;">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:24px;">
      <div style="background:#f8fafc;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">
        <p style="color:#64748b;margin:0 0 4px;font-size:11px;text-transform:uppercase;">Incidents</p>
        <p style="margin:0;font-size:24px;font-weight:bold;color:#1e293b;">${currentIncidents.length}</p>
        <p style="margin:4px 0 0;font-size:12px;color:${incidentChange > 0 ? '#dc2626' : '#16a34a'};">${incidentChange > 0 ? '▲' : '▼'} ${Math.abs(incidentChange)}%</p>
      </div>
      <div style="background:#f8fafc;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">
        <p style="color:#64748b;margin:0 0 4px;font-size:11px;text-transform:uppercase;">Critical</p>
        <p style="margin:0;font-size:24px;font-weight:bold;color:#1e293b;">${currentCritical}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Prev: ${prevCritical}</p>
      </div>
      <div style="background:#f8fafc;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">
        <p style="color:#64748b;margin:0 0 4px;font-size:11px;text-transform:uppercase;">Maintenance</p>
        <p style="margin:0;font-size:24px;font-weight:bold;color:#1e293b;">${currentMaintenance.length}</p>
        <p style="margin:4px 0 0;font-size:12px;color:${maintenanceChange > 0 ? '#dc2626' : '#16a34a'};">${maintenanceChange > 0 ? '▲' : '▼'} ${Math.abs(maintenanceChange)}%</p>
      </div>
      <div style="background:#f8fafc;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">
        <p style="color:#64748b;margin:0 0 4px;font-size:11px;text-transform:uppercase;">Patrols</p>
        <p style="margin:0;font-size:24px;font-weight:bold;color:#1e293b;">${currentPatrols.length}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Prev: ${prevPatrols.length}</p>
      </div>
    </div>
    <h3 style="color:#1e293b;border-bottom:2px solid #0ea5e9;padding-bottom:8px;">Site Performance</h3>
    <table border="1" cellpadding="10" style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#0ea5e9;color:white;"><th>Site</th><th>Current Inc.</th><th>Prev Inc.</th><th>Change</th><th>Maintenance</th></tr>
      ${siteComparison.slice(0, 6).map(s => `<tr><td>${s.name}</td><td>${s.currentIncidents}</td><td>${s.prevIncidents}</td><td style="color:${s.incidentChange > 0 ? '#dc2626' : '#16a34a'};">${s.incidentChange > 0 ? '▲' : '▼'} ${Math.abs(s.incidentChange)}%</td><td>${s.currentMaintenance}</td></tr>`).join('')}
    </table>
    <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:20px;border-radius:8px;margin-top:20px;">
      <h3 style="margin:0 0 12px;color:#166534;">Month-over-Month Analysis</h3>
      <pre style="font-family:Arial,sans-serif;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#166534;margin:0;">${analysis}</pre>
    </div>
    ${pdfButtonHtml}
  </div>
  <div style="background:#1e293b;padding:16px;text-align:center;">
    <p style="color:#94a3b8;margin:0;font-size:12px;">Automated Monthly Report — Unified Security Solutions</p>
  </div>
</div></body></html>`
      }).catch(err => console.error(`Email failed to ${recipient.email}:`, err.message))
    ));

    return Response.json({
      success: true,
      reportsSent: recipients.length,
      period: `${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`
    });
  } catch (error) {
    console.error('Error generating monthly comparison report:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});