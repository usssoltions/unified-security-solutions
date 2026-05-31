import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@2.5.2';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

async function generateMonthlyPDF(currentMonthLabel, prevMonthLabel, stats, siteComparison, aiAnalysis) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 18;
  const contentW = pageW - margin * 2;

  // Header
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

  // Metric cards
  doc.setTextColor(26, 26, 26);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Key Metrics', margin, y);
  y += 6;

  const metrics = [
    { label: 'Incidents', current: stats.currentIncidents, prev: stats.prevIncidents, change: stats.incidentChange },
    { label: 'Critical', current: stats.currentCritical, prev: stats.prevCritical, change: null },
    { label: 'Maintenance', current: stats.currentMaintenance, prev: stats.prevMaintenance, change: stats.maintenanceChange },
    { label: 'Patrols', current: stats.currentPatrols, prev: stats.prevPatrols, change: stats.patrolChange },
  ];
  const boxW = contentW / 4 - 3;
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

  // Bar chart comparison
  doc.setTextColor(26, 26, 26);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Activity Comparison', margin, y);
  y += 6;

  const barMetrics = [
    { label: 'Incidents', current: stats.currentIncidents, prev: stats.prevIncidents },
    { label: 'Maintenance', current: stats.currentMaintenance, prev: stats.prevMaintenance },
    { label: 'Patrol Stops', current: stats.currentPatrols, prev: stats.prevPatrols },
    { label: 'Shifts', current: stats.currentShifts, prev: stats.prevShifts },
  ];
  const maxVal = Math.max(...barMetrics.flatMap(m => [m.current, m.prev]), 1);
  const barMaxW = contentW - 50;
  barMetrics.forEach(bm => {
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(bm.label, margin, y + 4);

    // Current bar
    const cW = Math.max((bm.current / maxVal) * barMaxW, 2);
    doc.setFillColor(196, 30, 58);
    doc.roundedRect(margin + 30, y, cW, 5, 1, 1, 'F');
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(8);
    doc.text(String(bm.current), margin + 30 + cW + 2, y + 4);

    // Prev bar
    const pW = Math.max((bm.prev / maxVal) * barMaxW, 2);
    doc.setFillColor(148, 163, 184);
    doc.roundedRect(margin + 30, y + 7, pW, 4, 1, 1, 'F');
    doc.setTextColor(100, 116, 139);
    doc.text(String(bm.prev), margin + 30 + pW + 2, y + 10);

    y += 18;
  });
  // Legend
  doc.setFillColor(196, 30, 58);
  doc.rect(margin, y, 8, 4, 'F');
  doc.setFillColor(148, 163, 184);
  doc.rect(margin + 30, y, 8, 4, 'F');
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(8);
  doc.text('Current Month', margin + 10, y + 3.5);
  doc.text('Previous Month', margin + 40, y + 3.5);
  y += 10;

  // Site comparison table
  if (siteComparison.length > 0) {
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Site Performance', margin, y);
    y += 6;

    // Table header
    doc.setFillColor(196, 30, 58);
    doc.rect(margin, y, contentW, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    const cols = [0, 55, 85, 115, 140, 165];
    const headers = ['Site', 'Curr Inc.', 'Prev Inc.', 'Change', 'Curr Maint.', 'Prev Maint.'];
    headers.forEach((h, i) => doc.text(h, margin + cols[i], y + 5.5));
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

  // Analysis box
  if (y < 240) {
    doc.setFillColor(240, 253, 244);
    const analysisLines = doc.splitTextToSize(aiAnalysis.replace(/[▲▼●⚠️✅]/g, ''), contentW - 8);
    const boxH = Math.min(analysisLines.length * 4.5 + 12, 285 - y - 16);
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
    y += boxH + 4;
  }

  // Footer
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

    // Build month-over-month analysis without LLM credits
    const currentCritical = currentIncidents.filter(i => i.priority === 'critical').length;
    const prevCritical = prevIncidents.filter(i => i.priority === 'critical').length;
    const incidentTrend = incidentChange > 0 ? `▲ up ${incidentChange}% — monitor closely` : incidentChange < 0 ? `▼ down ${Math.abs(incidentChange)}% — improving` : 'no change';
    const maintenanceTrend = maintenanceChange > 0 ? `▲ up ${maintenanceChange}%` : maintenanceChange < 0 ? `▼ down ${Math.abs(maintenanceChange)}%` : 'no change';

    const aiAnalysis = [
      `MONTH-OVER-MONTH SUMMARY`,
      `Incidents: ${currentIncidents.length} vs ${prevIncidents.length} last month (${incidentTrend})`,
      `Critical incidents: ${currentCritical} vs ${prevCritical} last month`,
      `Maintenance requests: ${currentMaintenance.length} vs ${prevMaintenance.length} (${maintenanceTrend})`,
      `Patrol stops: ${currentPatrols.length} vs ${prevPatrols.length}`,
      `Shifts worked: ${currentShifts.length} vs ${prevShifts.length}`,
      `Alerts triggered: ${currentAlerts.length} vs ${prevAlerts.length}`,
      ``,
      `SITE OBSERVATIONS`,
      ...siteComparison.slice(0, 5).map(s =>
        `• ${s.name}: ${s.currentIncidents} incidents this month vs ${s.prevIncidents} last month (${s.incidentChange > 0 ? '▲' : s.incidentChange < 0 ? '▼' : '●'} ${Math.abs(s.incidentChange)}%)`
      ),
      ``,
      currentCritical > prevCritical ? `⚠️ Critical incidents increased — immediate review recommended.` : `✅ Critical incident count stable or improved.`,
      currentIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length > 0
        ? `⚠️ ${currentIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed').length} incident(s) still unresolved from this month.`
        : `✅ All incidents resolved.`,
    ].join('\n');

    // Get recipients — app users + custom WhatsApp contacts with email
    const [allUsers, waContacts] = await Promise.all([
      base44.asServiceRole.entities.User.filter({}),
      base44.asServiceRole.entities.WhatsAppContact.filter({ active: true }),
    ]);

    const recipients = allUsers.filter(u =>
      u.role_type === 'admin' ||
      u.role_type === 'management' ||
      u.role_type === 'supervisor'
    );

    const customEmailContacts = waContacts
      .filter(c => c.email && c.email.includes('@'))
      .map(c => ({ email: c.email, full_name: c.name }));

    const allEmailSet = new Set(recipients.map(r => r.email));
    const extraRecipients = customEmailContacts.filter(c => !allEmailSet.has(c.email));
    const allRecipients = [...recipients, ...extraRecipients];

    // WhatsApp summary for WA-only contacts
    const waSummary = `📊 *MONTHLY REPORT — ${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })} vs ${prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}*\n\n${aiAnalysis}\n\n📱 Full report sent to your email.`;
    const waNumber = (raw) => { let d = String(raw).replace(/\D/g, ''); if (d.startsWith('0')) d = '27' + d.slice(1); return d; };

    // Generate and upload the PDF
    let pdfDownloadUrl = null;
    try {
      const pdfBuffer = await generateMonthlyPDF(
        currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }),
        prevMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }),
        {
          currentIncidents: currentIncidents.length,
          prevIncidents: prevIncidents.length,
          currentCritical,
          prevCritical,
          currentMaintenance: currentMaintenance.length,
          prevMaintenance: prevMaintenance.length,
          currentPatrols: currentPatrols.length,
          prevPatrols: prevPatrols.length,
          currentShifts: currentShifts.length,
          prevShifts: prevShifts.length,
          incidentChange,
          maintenanceChange,
          patrolChange,
        },
        siteComparison,
        aiAnalysis
      );
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: blob });
      pdfDownloadUrl = uploadResult.file_url;
    } catch (pdfErr) {
      console.error('PDF generation failed:', pdfErr.message);
    }

    const pdfButtonHtml = pdfDownloadUrl
      ? `<div style="text-align:center; margin: 20px 0;">
           <a href="${pdfDownloadUrl}" target="_blank" style="display:inline-block; background:${BRAND_COLOR}; color:white; padding:14px 32px; border-radius:8px; font-size:15px; font-weight:bold; text-decoration:none;">
             📄 Download PDF Report
           </a>
         </div>`
      : '';

    // Send email report
    const emailPromises = allRecipients.map(recipient =>
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
        <h3>📋 Month-over-Month Analysis</h3>
        <p style="white-space: pre-wrap; font-size: 14px; line-height: 1.7;">${aiAnalysis}</p>
      </div>

      ${pdfButtonHtml}
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

    // WA-only contacts — send tap-to-send links to first admin
    const waOnlyContacts = waContacts.filter(c => c.number && (!c.email || !c.email.includes('@')));
    if (waOnlyContacts.length > 0 && recipients.length > 0) {
      const waLinks = waOnlyContacts.map(c =>
        `• ${c.name} (${c.number}): https://wa.me/${waNumber(c.number)}?text=${encodeURIComponent(waSummary)}`
      ).join('\n');
      const firstAdmin = recipients[0];
      if (firstAdmin?.email) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'SecureGuard Monthly Analytics',
          to: firstAdmin.email,
          subject: `📲 WhatsApp Monthly Report Links — ${currentMonthStart.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}`,
          body: `Tap the links below to send the monthly comparison report to WhatsApp-only contacts:\n\n${waLinks}`,
        }).catch(() => {});
      }
    }

    return Response.json({
      success: true,
      reportsSent: allRecipients.length,
      waContactsNotified: waContacts.length,
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