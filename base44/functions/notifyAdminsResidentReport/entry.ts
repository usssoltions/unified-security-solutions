import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

/**
 * notifyAdminsResidentReport
 *
 * Sends a branded real-time alert (email + in-app notification) to all
 * admin / estate_manager / dispatcher users whenever a resident submits an
 * incident report OR a maintenance request. This is the single backend
 * endpoint used by both resident report flows so branding and delivery stay
 * consistent with every other report in the system.
 *
 * Body:
 *  reportType  – "incident" | "maintenance"
 *  reportId    – created entity record id
 *  residentName, unitNumber, estateName, contactPhone, address
 *  category, priority (incident), urgency (maintenance)
 *  title, description, reason, reportedAt
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const {
      reportType, reportId, residentName, unitNumber, estateName,
      contactPhone, address, category, priority, urgency,
      title, description, reason, reportedAt,
    } = await req.json();

    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const recipients = allUsers.filter((u) =>
      u.role_type === 'admin' || u.role_type === 'estate_manager' || u.role_type === 'dispatcher'
    );
    if (recipients.length === 0) {
      return Response.json({ success: false, message: 'No admin/estate manager found' });
    }

    const isMaintenance = reportType === 'maintenance';
    const severity = isMaintenance ? (urgency || 'medium') : (priority || 'medium');
    const heading = isMaintenance ? '🔧 NEW MAINTENANCE REQUEST' : '🔴 NEW RESIDENT INCIDENT';
    const subject = isMaintenance
      ? `🔧 Maintenance Request — ${residentName} (Unit ${unitNumber || '—'})`
      : `🔴 Resident Incident — ${residentName} (Unit ${unitNumber || '—'})`;

    const when = reportedAt ? new Date(reportedAt).toLocaleString('en-ZA') : new Date().toLocaleString('en-ZA');

    const detailRows = isMaintenance
      ? `
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🏷️ <strong>Category:</strong> ${category || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">⚡ <strong>Urgency:</strong> ${severity}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🔧 <strong>Issue:</strong> ${title || 'N/A'}</p>`
      : `
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🏷️ <strong>Category:</strong> ${category || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">⚠️ <strong>Priority:</strong> ${severity}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📋 <strong>Title:</strong> ${title || 'N/A'}</p>`;

    const emailBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:200px;height:auto;margin-bottom:20px;border-radius:10px;"/>
    <h1 style="color:white;margin:0;font-size:26px;font-weight:bold;">${heading}</h1>
    <p style="color:rgba(255,255,255,0.95);margin:10px 0 0;font-size:15px;">Action Required — Submitted by a Resident</p>
  </div>

  <div style="padding:30px;background:#f8f9fa;border-bottom:3px solid ${BRAND_COLOR};">
    <h2 style="color:#0c4a6e;margin:0 0 12px;font-size:20px;">${isMaintenance ? 'Maintenance Request Details' : 'Incident Report Details'}</h2>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Resident:</strong> ${residentName || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🏠 <strong>Unit:</strong> ${unitNumber || '—'}${estateName ? ` &nbsp;|&nbsp; <strong>Estate:</strong> ${estateName}` : ''}</p>
    ${address ? `<p style="color:#64748b;margin:5px 0;font-size:14px;">📍 <strong>Address:</strong> ${address}</p>` : ''}
    ${contactPhone ? `<p style="color:#64748b;margin:5px 0;font-size:14px;">📞 <strong>Contact:</strong> ${contactPhone}</p>` : ''}
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🕐 <strong>Reported:</strong> ${when}</p>
    ${detailRows}
  </div>

  <div style="padding:30px;">
    <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:25px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 12px;font-size:18px;border-bottom:2px solid ${BRAND_COLOR};padding-bottom:10px;">${isMaintenance ? 'Reason / Description' : 'Description'}</h3>
      <p style="color:#1e293b;line-height:1.6;white-space:pre-wrap;">${(isMaintenance ? (reason || description) : description) || 'None provided.'}</p>
    </div>
  </div>

  <div style="background:${BRAND_SECONDARY};padding:25px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:15px;opacity:0.8;"/>
    <p style="color:#94a3b8;margin:0 0 10px;font-size:13px;">Automated ${isMaintenance ? 'maintenance request' : 'incident'} alert from Unified Security Solutions</p>
    <p style="color:${BRAND_COLOR};margin:10px 0 0;font-size:11px;font-weight:bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
  </div>
</div></body></html>`;

    const notifTitle = isMaintenance
      ? `🔧 Maintenance Request — ${residentName} (Unit ${unitNumber || '—'})`
      : `🔴 Resident Incident — ${residentName} (Unit ${unitNumber || '—'})`;
    const notifMsg = isMaintenance
      ? `${residentName} (Unit ${unitNumber || '—'}) reported a ${category} maintenance request (${severity}). ${title ? title + '.' : ''}`
      : `${residentName} (Unit ${unitNumber || '—'}) reported a ${category} incident (${severity}). ${title ? title + '.' : ''}`;

    const notificationPromises = recipients.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: isMaintenance ? 'maintenance_assigned' : 'incident_critical',
        priority: severity === 'critical' ? 'critical' : 'high',
        title: notifTitle,
        message: notifMsg,
        read: false,
        related_entity: isMaintenance ? 'maintenance' : 'incident',
        related_id: reportId,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((a) => a.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: isMaintenance ? 'Unified Security Solutions — Maintenance' : 'Unified Security Solutions — Security',
          to: admin.email,
          subject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notificationPromises, ...emailPromises]);

    return Response.json({ success: true, notificationsSent: recipients.length });
  } catch (error) {
    console.error('Error in notifyAdminsResidentReport:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});