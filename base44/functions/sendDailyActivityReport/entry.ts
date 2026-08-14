import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@2.5.2';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

// Haversine distance in metres between two {lat,lng} points.
function distanceMetres(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

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

    // Respect the global "Daily Activity Report" toggle.
    try {
      const _s = await base44.asServiceRole.entities.AutomationSetting.list();
      if (_s?.[0] && _s[0].report_daily_activity === false) {
        return Response.json({ success: true, skipped: true, reason: 'daily report disabled' });
      }
    } catch (_) {}

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(23, 59, 59, 999);

    // Fetch all activity from yesterday (plus LocationTracking for movement
    // history and Sites for checkpoint GPS verification) in parallel.
    const [incidents, maintenance, patrols, shifts, alerts, sites, tracking] = await Promise.all([
      base44.asServiceRole.entities.Incident.filter({}),
      base44.asServiceRole.entities.MaintenanceRequest.filter({}),
      base44.asServiceRole.entities.PatrolLog.filter({}),
      base44.asServiceRole.entities.Shift.filter({}),
      base44.asServiceRole.entities.Alert.filter({}),
      base44.asServiceRole.entities.Site.filter({ status: 'active' }),
      base44.asServiceRole.entities.LocationTracking.filter({}),
    ]);

    const inRange = (dateStr) => {
      const d = new Date(dateStr);
      return d >= yesterday && d <= endOfYesterday;
    };

    const yesterdayIncidents = (incidents || []).filter((i) => inRange(i.reported_at || i.created_date));
    const yesterdayMaintenance = (maintenance || []).filter((m) => inRange(m.reported_at || m.created_date));
    const yesterdayPatrols = (patrols || []).filter((p) => inRange(p.timestamp || p.created_date));
    const yesterdayShifts = (shifts || []).filter((s) => inRange(s.start_time));
    const yesterdayTracking = (tracking || []).filter((t) => inRange(t.timestamp || t.created_date));

    const hasActivity = yesterdayIncidents.length > 0 || yesterdayMaintenance.length > 0 ||
      yesterdayPatrols.length > 0 || yesterdayShifts.length > 0 || yesterdayTracking.length > 0;

    // Build a checkpoint coordinate map for GPS verification: site_id -> { checkpoint_id/name -> {lat,lng} }.
    const checkpointCoords = {};
    for (const site of sites || []) {
      const map = {};
      for (const cp of (site.checkpoints || [])) {
        if (cp.location && cp.location.lat != null) {
          if (cp.id) map[String(cp.id)] = cp.location;
          if (cp.name) map[String(cp.name).toLowerCase()] = cp.location;
        }
      }
      checkpointCoords[site.id] = map;
    }

    // Checkpoint scan rows: name, time, date, location, Google Maps link, GPS-verified flag.
    const checkpointRows = yesterdayPatrols.map((p) => {
      const cpMap = checkpointCoords[p.site_id] || {};
      const expected = cpMap[String(p.checkpoint_id)] || cpMap[String(p.checkpoint_name || '').toLowerCase()];
      const dist = expected ? distanceMetres(p.location, expected) : null;
      // 100 m tolerance — anything beyond is flagged as not GPS-verified (guards
      // can't just photograph a checkpoint QR from one spot without walking the route).
      const gpsVerified = expected ? (dist != null && dist <= 100) : !!p.verified;
      return {
        checkpoint: p.checkpoint_name || 'Unknown',
        time: new Date(p.timestamp).toLocaleTimeString('en-ZA'),
        date: new Date(p.timestamp).toLocaleDateString('en-ZA'),
        lat: p.location?.lat,
        lng: p.location?.lng,
        maps: p.location?.lat != null ? `https://www.google.com/maps?q=${p.location.lat},${p.location.lng}` : null,
        verified: gpsVerified,
        distance: dist,
      };
    });

    // Guard movement history: group tracking points by guard, sorted by time.
    const movementByGuard = {};
    for (const t of yesterdayTracking) {
      const key = t.guard_id || t.guard_name || 'Unknown';
      if (!movementByGuard[key]) movementByGuard[key] = { name: t.guard_name || 'Unknown', points: [] };
      movementByGuard[key].points.push({
        time: new Date(t.timestamp).toLocaleString('en-ZA'),
        lat: t.location?.lat,
        lng: t.location?.lng,
        maps: t.location?.lat != null ? `https://www.google.com/maps?q=${t.location.lat},${t.location.lng}` : null,
        battery: t.battery_level,
      });
    }
    const movementSections = Object.values(movementByGuard).map((g) => ({ name: g.name, points: g.points.sort((a, b) => a.time.localeCompare(b.time)) }));

    const criticalIncidents = yesterdayIncidents.filter((i) => i.priority === 'critical' || i.priority === 'high');
    const openIncidents = yesterdayIncidents.filter((i) => i.status !== 'resolved' && i.status !== 'closed');
    const pendingMaintenance = yesterdayMaintenance.filter((m) => m.status !== 'completed');

    const aiSummary = [
      `Daily summary for ${yesterday.toLocaleDateString('en-ZA')}:`,
      `• ${yesterdayShifts.length} shift(s) active, ${yesterdayIncidents.length} incident(s) reported — ${criticalIncidents.length} critical/high, ${openIncidents.length} still open.`,
      `• ${yesterdayMaintenance.length} maintenance request(s) — ${pendingMaintenance.length} still pending.`,
      `• ${yesterdayPatrols.length} checkpoint scan(s) logged.`,
      criticalIncidents.length > 0
        ? `⚠️ Critical items require follow-up: ${criticalIncidents.map((i) => i.title).join(', ')}.`
        : '✅ No critical incidents reported.',
    ].join('\n');

    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = allUsers.filter((u) =>
      (u.role_type === 'admin' || u.role_type === 'dispatcher' || u.role_type === 'supervisor' || u.role_type === 'management') &&
      u.email
    );

    if (recipients.length === 0) {
      return Response.json({ success: true, reportsSent: 0, reason: 'No recipients' });
    }

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

    // ── Checkpoint scan table HTML ──
    const checkpointTableHtml = checkpointRows.length > 0 ? `
      <div style="background:#ffffff;border:2px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px;color:${BRAND_SECONDARY};border-bottom:2px solid ${BRAND_COLOR};padding-bottom:10px;">🛡️ Checkpoint Scans (${checkpointRows.length})</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Checkpoint</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Date</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Time</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">GPS</th>
              <th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Location</th>
            </tr>
          </thead>
          <tbody>
            ${checkpointRows.map((r) => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px;font-weight:bold;">${r.checkpoint}</td>
                <td style="padding:8px;">${r.date}</td>
                <td style="padding:8px;">${r.time}</td>
                <td style="padding:8px;">${r.verified
                  ? '<span style="color:#16a34a;font-weight:bold;">✓ Verified</span>'
                  : '<span style="color:#dc2626;font-weight:bold;">✗ Not verified</span>'}${r.distance != null ? `<br/><span style="font-size:11px;color:#64748b;">${r.distance} m from checkpoint</span>` : ''}</td>
                <td style="padding:8px;">${r.maps
                  ? `<a href="${r.maps}" target="_blank" style="color:${BRAND_COLOR};text-decoration:none;">📍 View on Maps</a>`
                  : '<span style="color:#94a3b8;">—</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

    // ── Guard movement tracking HTML ──
    const movementHtml = movementSections.length > 0 ? `
      <div style="background:#ffffff;border:2px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:20px;">
        <h3 style="margin:0 0 12px;color:${BRAND_SECONDARY};border-bottom:2px solid #0ea5e9;padding-bottom:10px;">📍 Guard Movement Tracking</h3>
        ${movementSections.map((g) => `
          <div style="margin-bottom:14px;">
            <p style="margin:0 0 6px;font-weight:bold;color:#0c4a6e;">👤 ${g.name} — ${g.points.length} location update(s)</p>
            <div style="background:#f8fafc;border-radius:6px;padding:10px;border-left:3px solid #0ea5e9;">
              ${g.points.map((pt) => `
                <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:12px;border-bottom:1px dashed #e2e8f0;">
                  <span style="color:#475569;">${pt.time}${pt.battery != null ? ` · 🔋 ${pt.battery}%` : ''}</span>
                  ${pt.maps ? `<a href="${pt.maps}" target="_blank" style="color:${BRAND_COLOR};text-decoration:none;">📍 ${pt.lat?.toFixed(5)}, ${pt.lng?.toFixed(5)}</a>` : '<span style="color:#94a3b8;">—</span>'}
                </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>` : '';

    const pdfButtonHtml = pdfDownloadUrl
      ? `<div style="text-align:center;margin:20px 0;"><a href="${pdfDownloadUrl}" target="_blank" style="background:${BRAND_COLOR};color:white;padding:12px 28px;border-radius:8px;font-weight:bold;text-decoration:none;">📄 Download PDF Report</a></div>`
      : '';
    const noActivityNote = !hasActivity
      ? `<p style="color:#64748b;font-style:italic;">No activity was recorded yesterday. This is an all-clear report.</p>`
      : '';

    await Promise.all(recipients.map((recipient) =>
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
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid ${BRAND_COLOR};"><p style="color:#64748b;margin:0 0 4px;font-size:12px;">INCIDENTS</p><p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayIncidents.length}</p></div>
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid #0ea5e9;"><p style="color:#64748b;margin:0 0 4px;font-size:12px;">MAINTENANCE</p><p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayMaintenance.length}</p></div>
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid #10b981;"><p style="color:#64748b;margin:0 0 4px;font-size:12px;">CHECKPOINT SCANS</p><p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayPatrols.length}</p></div>
      <div style="background:#f8f9fa;padding:18px;border-radius:8px;border-left:4px solid #f59e0b;"><p style="color:#64748b;margin:0 0 4px;font-size:12px;">SHIFTS</p><p style="color:${BRAND_SECONDARY};margin:0;font-size:26px;font-weight:bold;">${yesterdayShifts.length}</p></div>
    </div>
    <div style="background:#f8fafc;border-radius:8px;padding:20px;margin-bottom:20px;border-left:4px solid ${BRAND_COLOR};">
      <h3 style="margin:0 0 12px;color:${BRAND_SECONDARY};">Operational Summary</h3>
      <p style="color:#475569;line-height:1.6;white-space:pre-line;">${aiSummary}</p>
    </div>
    ${criticalIncidents.length > 0 ? `
    <div style="background:#fff5f5;border:2px solid ${BRAND_COLOR};border-radius:8px;padding:20px;margin-bottom:20px;">
      <h3 style="margin:0 0 12px;color:${BRAND_SECONDARY};">⚠️ Critical Incidents</h3>
      ${criticalIncidents.map((i) => `
        <div style="background:white;padding:12px;border-radius:6px;margin-bottom:8px;border-left:4px solid ${BRAND_COLOR};">
          <p style="margin:0 0 4px;font-weight:bold;">${i.title}</p>
          <p style="margin:0;color:#64748b;font-size:13px;">Site: ${i.site_name || 'N/A'} | Priority: ${i.priority} | Status: ${i.status}</p>
        </div>`).join('')}
    </div>` : ''}
    ${checkpointTableHtml}
    ${movementHtml}
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
      }).catch((err) => console.error(`Email failed to ${recipient.email}:`, err.message))
    ));

    return Response.json({
      success: true,
      reportsSent: recipients.length,
      date: yesterday.toLocaleDateString('en-ZA'),
      checkpointScans: checkpointRows.length,
      movementTracked: movementSections.length,
    });
  } catch (error) {
    console.error('Error generating daily activity report:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});