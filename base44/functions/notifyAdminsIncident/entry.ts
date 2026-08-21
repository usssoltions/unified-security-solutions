/**
 * notifyAdminsIncident
 *
 * Called from IncidentForm.jsx immediately after a guard creates an Incident.
 * Uses asServiceRole to bypass User RLS (a guard's User.list() only returns
 * themselves — the previous inline approach silently sent zero notifications).
 *
 * Creates branded in-app Notification records AND branded HTML emails for all
 * admin / dispatcher / supervisor / management users.  The email layout matches
 * the Start-of-Shift and Critical-Incident report branding (red→black gradient
 * header, logo, location with Google Maps button).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      incidentId, incidentNumber, guardName, badgeNumber,
      incidentType, category, priority, siteName,
      incidentTime, description, location, mediaCount
    } = await req.json();

    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = (allUsers || []).filter((u) =>
      u.role_type === 'admin' || u.role_type === 'dispatcher' || u.role_type === 'supervisor' || u.role_type === 'management'
    );

    if (recipients.length === 0) {
      return Response.json({ success: false, message: 'No admin users found' });
    }

    const reportedAt = new Date(incidentTime || Date.now()).toLocaleString('en-ZA');
    const hasLocation = location && location.lat != null && location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;

    const subject = `🚨 New Incident — ${(incidentType || category || 'N/A').toUpperCase()} at ${siteName || 'site'}`;
    const emailBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:200px;height:auto;margin-bottom:20px;border-radius:10px;"/>
    <h1 style="color:white;margin:0;font-size:28px;font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,0.3);">🚨 NEW INCIDENT REPORT</h1>
    <p style="color:rgba(255,255,255,0.95);margin:10px 0 0;font-size:16px;">Immediate Attention Required</p>
  </div>

  <div style="padding:30px;background:#f8f9fa;border-bottom:3px solid ${BRAND_COLOR};">
    <h2 style="color:#0c4a6e;margin:0 0 12px;font-size:22px;">${esc(incidentType || 'Incident')}</h2>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📋 <strong>Ref:</strong> ${esc(incidentNumber || 'N/A')}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📂 <strong>Category:</strong> ${esc((category || 'N/A').toUpperCase())}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🔴 <strong>Priority:</strong> ${esc((priority || 'medium').toUpperCase())}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📍 <strong>Site:</strong> ${esc(siteName || 'N/A')}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Guard:</strong> ${esc(guardName || 'N/A')}${badgeNumber ? ` (Badge: ${esc(badgeNumber)})` : ''}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📅 <strong>Reported:</strong> ${esc(reportedAt)}</p>
  </div>

  <div style="padding:30px;">
    <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:25px;margin-bottom:20px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 20px;font-size:18px;border-bottom:2px solid ${BRAND_COLOR};padding-bottom:10px;">📋 Incident Details</h3>
      <p style="color:#1e293b;line-height:1.6;">${esc(description || 'No description provided.')}</p>
      ${mediaCount ? `<p style="color:#64748b;font-size:14px;margin-top:15px;">📎 ${esc(mediaCount)} media attachment(s)</p>` : ''}
    </div>

    ${hasLocation ? `
    <div style="background:linear-gradient(135deg,#fff5f5 0%,#ffe0e0 100%);border:2px solid ${BRAND_COLOR};border-radius:12px;padding:25px;margin-bottom:20px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 15px;font-size:18px;">📍 Incident Location</h3>
      <p style="margin:5px 0;color:#1e293b;"><strong>Latitude:</strong> ${location.lat}</p>
      <p style="margin:5px 0 15px;color:#1e293b;"><strong>Longitude:</strong> ${location.lng}</p>
      <div style="text-align:center;">
        <a href="${googleMapsUrl}" style="display:inline-block;background:${BRAND_COLOR};color:white;padding:12px 25px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;box-shadow:0 4px 6px rgba(196,30,58,0.3);">📍 View on Google Maps</a>
      </div>
    </div>` : ''}

    <div style="background:linear-gradient(135deg,#7f1d1d 0%,#450a0a 100%);padding:20px;border-radius:12px;text-align:center;">
      <p style="color:white;font-weight:bold;margin:0;font-size:18px;text-transform:uppercase;letter-spacing:1px;">⚠️ Immediate Action Required</p>
      <p style="color:#fef2f2;margin:10px 0 0;font-size:14px;">Review & assign response • Verify situation</p>
    </div>
  </div>

  <div style="background:${BRAND_SECONDARY};padding:25px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:15px;opacity:0.8;"/>
    <p style="color:#94a3b8;margin:0 0 10px;font-size:13px;">Automated incident alert from Unified Security Solutions</p>
    <p style="color:${BRAND_COLOR};margin:10px 0 0;font-size:11px;font-weight:bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
  </div>
</div></body></html>`;

    const notifTitle = `🚨 New Incident — ${incidentType || category || 'N/A'} at ${siteName || 'site'}`;
    const notifMsg = `${guardName || 'Guard'} reported: ${incidentType || category || 'incident'} at ${siteName || 'site'}. Priority: ${priority || 'medium'}.${description ? ` ${description.substring(0, 120)}` : ''}`;

    const notifPromises = recipients.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'incident_reported',
        priority: priority === 'critical' ? 'critical' : 'high',
        title: notifTitle,
        message: notifMsg,
        read: false,
        related_entity: 'incident',
        related_id: incidentId,
        action_url: '/AdminIncidents',
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((u) => u.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'Unified Security Solutions — Incident Alerts',
          to: admin.email,
          subject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    // Mark incident as notified (service role bypasses RLS)
    await base44.asServiceRole.entities.Incident.update(incidentId, {
      notification_sent: true,
    }).catch(() => {});

    return Response.json({ success: true, notificationsSent: recipients.length });
  } catch (error) {
    console.error('notifyAdminsIncident error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});