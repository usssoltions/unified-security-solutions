import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@2.5.2';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

async function generateDailyPDF(date, stats, incidents, maintenance) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 210;
  const margin = 18;
  const contentW = pageW - margin * 2;

  doc.setFillColor(196, 30, 58);
  doc.rect(0, 0, pageW, 45, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('DAILY ACTIVITY REPORT', pageW / 2, 20, { align: 'center' });
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(date, pageW / 2, 32, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Unified Security Solutions', pageW / 2, 40, { align: 'center' });

  let y = 58;

  doc.setTextColor(26, 26, 26);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('Summary Statistics', margin, y);
  y += 6;

  const statBoxes = [
    { label: 'Incidents', value: stats.incidents, color: [196, 30, 58] },
    { label: 'Maintenance', value: stats.maintenance, color: [14, 165, 233] },
    { label: 'Patrol Stops', value: stats.patrols, color: [16, 185, 129] },
    { label: 'Shifts', value: stats.shifts, color: [245, 158, 11] },
  ];
  const boxW = contentW / 4 - 3;
  statBoxes.forEach((box, i) => {
    const bx = margin + i * (boxW + 4);
    doc.setFillColor(248, 249, 250);
    doc.roundedRect(bx, y, boxW, 22, 3, 3, 'F');
    doc.setFillColor(...box.color);
    doc.rect(bx, y, 3, 22, 'F');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(box.label, bx + 6, y + 8);
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(String(box.value), bx + 6, y + 18);
  });
  y += 30;

  doc.setTextColor(26, 26, 26);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Operational Summary', margin, y + 8);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  const summaryLines = doc.splitTextToSize(stats.summary, contentW);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 5 + 8;

  const critical = incidents.filter(i => i.priority === 'critical' || i.priority === 'high');
  if (critical.length > 0) {
    doc.setFillColor(255, 245, 245);
    doc.roundedRect(margin, y, contentW, 8 + critical.length * 16, 3, 3, 'F');
    doc.setFillColor(196, 30, 58);
    doc.rect(margin, y, 3, 8 + critical.length * 16, 'F');
    doc.setTextColor(26, 26, 26);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Critical / High Priority Incidents', margin + 6, y + 7);
    y += 12;
    critical.forEach(inc => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(196, 30, 58);
      doc.text(`• ${inc.title}`, margin + 6, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(9);
      doc.text(`Site: ${inc.site_name || 'N/A'}  |  Status: ${inc.status}  |  Priority: ${inc.priority}`, margin + 10, y + 5);
      y += 14;
    });
    y += 4;
  }

  doc.setFillColor(240, 253, 244);
  doc.roundedRect(margin, y, contentW, 24, 3, 3, 'F');
  doc.setTextColor(22, 101, 52);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Pending Items', margin + 4, y + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Open Incidents: ${stats.openIncidents}`, margin + 4, y + 16);
  doc.text(`Pending Maintenance: ${stats.pendingMaintenance}`, margin + 60, y + 16);
  y += 30;

  doc.setFillColor(26, 26, 26);
  doc.rect(0, 285, pageW, 12, 'F');
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Automated Daily Report — Unified Security Solutions', pageW / 2, 292, { align: 'center' });

  return doc.output('arraybuffer');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Fetch all activity from yesterday in parallel
    const [incidents, maintenance, patrols, shifts, alerts, sites] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({}),
      base44.asServiceRole.entities.Site.filter({ status: 'active' }),
    ]);

    const inRange = (dateStr) => {
      const d = new Date(dateStr);
      return d >= yesterday && d <= endOfYesterday;
    };

    const yesterdayIncidents = incidents.filter(i => inRange(i.reported_at || i.created_date));
    const yesterdayMaintenance = maintenance.filter(m => inRange(m.reported_at || m.created_date));
    const yesterdayPatrols = patrols.filter(p => inRange(p.timestamp || p.created_date));
    const yesterdayShifts = shifts.filter(s => inRange(s.start_time));

    // If no activity yesterday at all, skip sending — save UploadFile + email credits
    const hasActivity = yesterdayIncidents.length > 0 || yesterdayMaintenance.length > 0 ||
      yesterdayPatrols.length > 0 || yesterdayShifts.length > 0;

    // Build summary text (no LLM call)
    const criticalIncidents = yesterdayIncidents.filter(i => i.priority === 'critical' || i.priority === 'high');
    const openIncidents = yesterdayIncidents.filter(i => i.status !== 'resolved' && i.status !== 'closed');
    const pendingMaintenance = yesterdayMaintenance.filter(m => m.status !== 'completed');

    const aiSummary = [
      `Daily summary for ${yesterday.toLocaleDateString('en-ZA')}:`,
      `• ${yesterdayShifts.length} shift(s) active, ${yesterdayIncidents.length} incident(s) reported — ${criticalIncidents.length} critical/high, ${openIncidents.length} still open.`,
      `• ${yesterdayMaintenance.length} maintenance request(s) — ${pendingMaintenance.length} still pending.`,
      `• ${yesterdayPatrols.length} patrol stop(s) logged.`,
      criticalIncidents.length > 0
        ? `⚠️ Critical items require follow-up: ${criticalIncidents.map(i => i.title).join(', ')}.`
        : '✅ No critical incidents reported.',
    ].join('\n');

    // Get admin/management recipients only — email only, no WhatsApp integration calls
    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = allUsers.filter(u =>
      (u.role_type === 'admin' || u.role_type === 'dispatcher' || u.role_type === 'supervisor' || u.role_type === 'management') &&
      u.email
    );

    if (recipients.length === 0) {
      return Response.json({ success: true, reportsSent: 0, reason: 'No recipients' });
    }

    // Generate and upload PDF (1 upload credit regardless of recipient count)
    let pdfDownloadUrl = null;
    if (hasActivity) {
      try {
        const pdfBuffer = await generateDailyPDF(
          yesterday.toLocaleDateString('en-ZA'),
          {
            incidents: yesterdayIncidents.length,
            maintenance: yesterdayMaintenance.length,
            patrols: yesterdayPatrols.length,
            shifts: yesterdayShifts.length,
            openIncidents: openIncidents.length,
            pendingMaintenance: pendingMaintenance.length,
            summary: aiSummary,
          },
          yesterdayIncidents,
          yesterdayMaintenance
        );
        const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
        const pdfFile = new File([blob], `daily_activity_report_${yesterday.toISOString().split('T')[0]}.pdf`, { type: 'application/pdf' });
        const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: pdfFile });
        pdfDownloadUrl = uploadResult.file_url;
      } catch (pdfErr) {
        console.error('PDF generation failed:', pdfErr.message);
      }
    }

    const pdfButtonHtml = pdfDownloadUrl
      ? `<div style="text-align:center;margin:20px 0;"><a href="${pdfDownloadUrl}" target="_blank" style="background:${BRAND_COLOR};color:white;padding:12px 28px;border-radius:8px;font-weight:bold;text-decoration:none;">📄 Download PDF Report</a></div>`
      : '';

    const noActivityNote = !hasActivity
      ? `<p style="color:#64748b;font-style:italic;">No activity was recorded yesterday. This is an all-clear report.</p>`
      : '';

    // Send ONE email per recipient (no WhatsApp integration credits)
    await Promise.all(recipients.map(recipient =>
      base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard System',
        to: recipient.email,
        subject: `Daily Activity Report — ${yesterday.toLocaleDateString('en-ZA')}`,
        body: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f8fafc;margin:0;padding:0;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:160px;height:auto;margin-bottom:16px;border-radius:8px;"/>
    <h1 style="color:white;margin:0;font-size:26px;">📊 DAILY ACTIVITY REPORT</h1>
    <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:15px;">${yesterday.toLocaleDateString('en-ZA')}</p>
  </div>
  <div style="padding:28px;">
    ${noActivityNote}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid ${BRAND_COLOR};">
        <p style="color:#64748b;margin:0 0 4px;font-size:12px;">INCIDENTS</p>
        <p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayIncidents.length}</p>
      </div>
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid #0ea5e9;">
        <p style="color:#64748b;margin:0 0 4px;font-size:12px;">MAINTENANCE</p>
        <p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayMaintenance.length}</p>
      </div>
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid #10b981;">
        <p style="color:#64748b;margin:0 0 4px;font-size:12px;">PATROL STOPS</p>
        <p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayPatrols.length}</p>
      </div>
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid #f59e0b;">
        <p style="color:#64748b;margin:0 0 4px;font-size:12px;">SHIFTS</p>
        <p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayShifts.length}</p>
      </div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:20px;border-left:4px solid ${BRAND_COLOR};">
      <h3 style="margin:0 0 12px;color:${BRAND_SECONDARY};">Operational Summary</h3>
      <p style="color:#475569;line-height:1.6;white-space:pre-line;">${aiSummary}</p>
    </div>
    ${criticalIncidents.length > 0 ? `
    <div style="background:#fff5f5;border:2px solid ${BRAND_COLOR};border-radius:8px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:${BRAND_SECONDARY};">⚠️ Critical Incidents</h3>
      ${criticalIncidents.map(i => `
        <div style="background:white;padding:12px;border-radius:6px;margin-bottom:8px;border-left:4px solid ${BRAND_COLOR};">
          <p style="margin:0 0 4px;font-weight:bold;">${i.title}</p>
          <p style="margin:0;color:#64748b;font-size:13px;">Site: ${i.site_name} | Priority: ${i.priority} | Status: ${i.status}</p>
        </div>`).join('')}
    </div>` : ''}
    <div style="background:#f0f9ff;border:2px solid #0ea5e9;border-radius:8px;padding:20px;">
      <h3 style="margin:0 0 12px;color:${BRAND_SECONDARY};">📋 Pending Items</h3>
      <p style="margin:0;color:#475569;">Open Incidents: <strong>${openIncidents.length}</strong> &nbsp;|&nbsp; Pending Maintenance: <strong>${pendingMaintenance.length}</strong></p>
    </div>
    ${pdfButtonHtml}
  </div>
  <div style="background:${BRAND_SECONDARY};padding:20px;text-align:center;">
    <p style="color:#94a3b8;margin:0;font-size:12px;">Automated Daily Report — Unified Security Solutions</p>
  </div>
</div></body></html>`
      }).catch(err => console.error(`Email failed to ${recipient.email}:`, err.message))
    ));

    return Response.json({ success: true, reportsSent: recipients.length, date: yesterday.toLocaleDateString('en-ZA') });
  } catch (error) {
    console.error('Error generating daily activity report:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});