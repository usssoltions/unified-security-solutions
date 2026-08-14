/**
 * monitorHighPriorityIncidents
 *
 * Triggered as an entity automation on Incident create/update. Fires only for
 * critical-priority incidents that haven't been notified yet, and respects the
 * global "Incident Alerts" report toggle.
 *
 * The email is now fully branded to match the Start of Shift report layout
 * (red→black gradient header, logo, incident details, live location with a
 * Google Maps button) instead of the old plain-text body.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    const incident = body.data;
    if (!incident) {
      return Response.json({ skipped: true, reason: 'No incident data' });
    }
    if (incident.priority !== 'critical') {
      return Response.json({ skipped: true, reason: 'Not critical priority' });
    }
    if (incident.notification_sent === true) {
      return Response.json({ skipped: true, reason: 'Notification already sent' });
    }

    // Respect the global "Incident Alerts" toggle.
    try {
      const settings = await base44.asServiceRole.entities.AutomationSetting.list();
      if (settings?.[0] && settings[0].report_incident_alerts === false) {
        return Response.json({ skipped: true, reason: 'incident alerts disabled' });
      }
    } catch (_) {}

    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = allUsers.filter((u) =>
      u.role_type === 'admin' || u.role_type === 'dispatcher' || u.role_type === 'supervisor'
    );
    if (recipients.length === 0) {
      return Response.json({ skipped: true, reason: 'No admins/dispatchers found' });
    }

    const reportedAt = new Date(incident.reported_at || incident.created_date).toLocaleString('en-ZA');
    const hasLocation = incident.location && incident.location.lat != null && incident.location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${incident.location.lat},${incident.location.lng}`
      : null;

    const subject = `🚨 CRITICAL INCIDENT — ${(incident.category || '').toUpperCase()} at ${incident.site_name || 'site'}`;

    const emailBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:200px;height:auto;margin-bottom:20px;border-radius:10px;"/>
    <h1 style="color:white;margin:0;font-size:28px;font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,0.3);">🚨 CRITICAL INCIDENT ALERT</h1>
    <p style="color:rgba(255,255,255,0.95);margin:10px 0 0 0;font-size:16px;">Immediate Response Required</p>
  </div>

  <div style="padding:30px;background:#f8f9fa;border-bottom:3px solid ${BRAND_COLOR};">
    <h2 style="color:#0c4a6e;margin:0 0 12px;font-size:22px;">${incident.title}</h2>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📂 <strong>Category:</strong> ${(incident.category || 'N/A').toUpperCase()}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🔴 <strong>Priority:</strong> ${incident.priority}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📍 <strong>Site:</strong> ${incident.site_name || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Guard:</strong> ${incident.guard_name || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🚦 <strong>Status:</strong> ${incident.status}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📅 <strong>Reported:</strong> ${reportedAt}</p>
  </div>

  <div style="padding:30px;">
    <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:25px;margin-bottom:20px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 20px;font-size:18px;border-bottom:2px solid ${BRAND_COLOR};padding-bottom:10px;">📋 Incident Details</h3>
      <p style="color:#1e293b;line-height:1.6;">${incident.description || 'No description provided.'}</p>
    </div>

    ${hasLocation ? `
    <div style="background:linear-gradient(135deg,#fff5f5 0%,#ffe0e0 100%);border:2px solid ${BRAND_COLOR};border-radius:12px;padding:25px;margin-bottom:20px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 15px;font-size:18px;">📍 Live Incident Location</h3>
      <p style="color:#475569;margin:0 0 15px;">Location where the incident was logged:</p>
      <p style="margin:5px 0;color:#1e293b;"><strong>Latitude:</strong> ${incident.location.lat}</p>
      <p style="margin:5px 0 15px;color:#1e293b;"><strong>Longitude:</strong> ${incident.location.lng}</p>
      <div style="text-align:center;">
        <a href="${googleMapsUrl}" style="display:inline-block;background:${BRAND_COLOR};color:white;padding:12px 25px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;box-shadow:0 4px 6px rgba(196,30,58,0.3);">📍 View on Google Maps</a>
      </div>
    </div>` : ''}

    <div style="background:linear-gradient(135deg,#7f1d1d 0%,#450a0a 100%);padding:20px;border-radius:12px;text-align:center;">
      <p style="color:white;font-weight:bold;margin:0;font-size:18px;text-transform:uppercase;letter-spacing:1px;">⚠️ Immediate Action Required</p>
      <p style="color:#fef2f2;margin:10px 0 0;font-size:14px;">Dispatch response • Contact guard • Verify situation</p>
    </div>
  </div>

  <div style="background:${BRAND_SECONDARY};padding:25px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:15px;opacity:0.8;"/>
    <p style="color:#94a3b8;margin:0 0 10px;font-size:13px;">Automated critical incident alert from Unified Security Solutions</p>
    <p style="color:${BRAND_COLOR};margin:10px 0 0;font-size:11px;font-weight:bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
  </div>
</div></body></html>`;

    const notifPromises = recipients.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'incident_critical',
        priority: 'critical',
        title: `🚨 Critical Incident: ${incident.title}`,
        message: `${incident.category}: ${incident.title} at ${incident.site_name} — ${incident.guard_name}`,
        read: false,
        related_entity: 'incident',
        related_id: incident.id,
        action_url: googleMapsUrl,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((u) => u.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'Unified Security Solutions — Critical Alerts',
          to: admin.email,
          subject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    await base44.asServiceRole.entities.Incident.update(incident.id, {
      notification_sent: true,
    });

    return Response.json({ success: true, notified: recipients.length });
  } catch (error) {
    console.error('monitorHighPriorityIncidents error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});