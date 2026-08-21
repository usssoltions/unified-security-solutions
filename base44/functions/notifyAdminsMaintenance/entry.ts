import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

/**
 * notifyAdminsMaintenance
 *
 * Sends a branded maintenance-request alert email (matching the Start of Shift
 * report layout) to all admin/dispatcher/supervisor users, plus in-app
 * notifications. Includes the guard's live location with a Google Maps button
 * when available.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only a logged-in user may trigger admin alerts.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { maintenanceId, guardName, maintenanceType, siteName, details, location } = await req.json();

    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const admins = allUsers.filter((u) =>
      u.role_type === 'admin' || u.role_type === 'dispatcher' || u.role_type === 'supervisor'
    );

    if (admins.length === 0) {
      return Response.json({ success: false, message: 'No admins found' });
    }

    const hasLocation = location && location.lat != null && location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;
    const reportedAt = new Date().toLocaleString('en-ZA');

    const subject = `🔧 Maintenance Request — ${maintenanceType} at ${siteName || 'site'}`;
    const emailBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:200px;height:auto;margin-bottom:20px;border-radius:10px;"/>
    <h1 style="color:white;margin:0;font-size:28px;font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,0.3);">🔧 MAINTENANCE REQUEST</h1>
    <p style="color:rgba(255,255,255,0.95);margin:10px 0 0;font-size:16px;">Review & Action Required</p>
  </div>

  <div style="padding:30px;background:#f8f9fa;border-bottom:3px solid ${BRAND_COLOR};">
    <h2 style="color:#0c4a6e;margin:0 0 12px;font-size:22px;">${maintenanceType || 'Maintenance'}</h2>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📍 <strong>Site:</strong> ${siteName || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Guard:</strong> ${guardName || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📅 <strong>Reported:</strong> ${reportedAt}</p>
  </div>

  <div style="padding:30px;">
    <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:25px;margin-bottom:20px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 20px;font-size:18px;border-bottom:2px solid ${BRAND_COLOR};padding-bottom:10px;">📋 Maintenance Details</h3>
      <p style="color:#1e293b;line-height:1.6;">${details || 'No details provided.'}</p>
    </div>

    ${hasLocation ? `
    <div style="background:linear-gradient(135deg,#fff5f5 0%,#ffe0e0 100%);border:2px solid ${BRAND_COLOR};border-radius:12px;padding:25px;margin-bottom:20px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 15px;font-size:18px;">📍 Live Location of Report</h3>
      <p style="color:#475569;margin:0 0 15px;">Where the maintenance request was logged:</p>
      <p style="margin:5px 0;color:#1e293b;"><strong>Latitude:</strong> ${location.lat}</p>
      <p style="margin:5px 0 15px;color:#1e293b;"><strong>Longitude:</strong> ${location.lng}</p>
      <div style="text-align:center;">
        <a href="${googleMapsUrl}" style="display:inline-block;background:${BRAND_COLOR};color:white;padding:12px 25px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;box-shadow:0 4px 6px rgba(196,30,58,0.3);">📍 View on Google Maps</a>
      </div>
    </div>` : ''}
  </div>

  <div style="background:${BRAND_SECONDARY};padding:25px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:15px;opacity:0.8;"/>
    <p style="color:#94a3b8;margin:0 0 10px;font-size:13px;">Automated maintenance alert from Unified Security Solutions</p>
    <p style="color:${BRAND_COLOR};margin:10px 0 0;font-size:11px;font-weight:bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
  </div>
</div></body></html>`;

    const notificationPromises = admins.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'maintenance_reported',
        priority: 'high',
        title: `🔧 Maintenance Request — ${maintenanceType}`,
        message: `${guardName} submitted: ${maintenanceType} at ${siteName}. Review required.`,
        read: false,
        related_entity: 'maintenance',
        related_id: maintenanceId,
        action_url: googleMapsUrl,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = admins
      .filter((a) => a.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'Unified Security Solutions — Maintenance',
          to: admin.email,
          subject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notificationPromises, ...emailPromises]);

    return Response.json({ success: true, notificationsSent: admins.length });
  } catch (error) {
    console.error('Error in notifyAdminsMaintenance:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});