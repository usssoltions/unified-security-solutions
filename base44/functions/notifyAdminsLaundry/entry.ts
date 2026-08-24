import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const COMPANY_LOGO = 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';
const BRAND_COLOR = '#C41E3A';
const BRAND_SECONDARY = '#1a1a1a';

/**
 * notifyAdminsLaundry
 *
 * Sends a branded laundry-pickup request alert (email + in-app notification)
 * to all admin / estate_manager users whenever a resident schedules a laundry
 * pickup, so the request is actioned and not lost.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — only a logged-in user may trigger admin alerts.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      requestId, residentName, unitNumber, pickupDate, pickupSlot,
      vendorName, itemCount, instructions,
    } = await req.json();

    // Tenant-scoped recipients — a laundry request never alerts the wrong estate.
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    const recipients = allUsers.filter((u) =>
      u.role_type === 'admin' || u.role_type === 'estate_manager' || u.role_type === 'dispatcher'
    );
    if (recipients.length === 0) {
      return Response.json({ success: false, message: 'No admin/estate manager found' });
    }

    const subject = `👕 New Laundry Request — ${residentName} (Unit ${unitNumber || '—'})`;
    const emailBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:200px;height:auto;margin-bottom:20px;border-radius:10px;"/>
    <h1 style="color:white;margin:0;font-size:26px;font-weight:bold;">👕 NEW LAUNDRY REQUEST</h1>
    <p style="color:rgba(255,255,255,0.95);margin:10px 0 0;font-size:15px;">Action Required</p>
  </div>

  <div style="padding:30px;background:#f8f9fa;border-bottom:3px solid ${BRAND_COLOR};">
    <h2 style="color:#0c4a6e;margin:0 0 12px;font-size:20px;">Laundry Pickup Scheduled</h2>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Resident:</strong> ${residentName || 'N/A'}${unitNumber ? ` (Unit ${unitNumber})` : ''}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📅 <strong>Pickup Date:</strong> ${pickupDate || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🕐 <strong>Pickup Slot:</strong> ${pickupSlot || 'N/A'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🏷️ <strong>Vendor:</strong> ${vendorName || 'Unassigned — please assign'}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📦 <strong>Items:</strong> ${itemCount || 0} item(s)</p>
  </div>

  <div style="padding:30px;">
    <div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:25px;">
      <h3 style="color:${BRAND_SECONDARY};margin:0 0 12px;font-size:18px;border-bottom:2px solid ${BRAND_COLOR};padding-bottom:10px;">Special Instructions</h3>
      <p style="color:#1e293b;line-height:1.6;">${instructions || 'None provided.'}</p>
    </div>
  </div>

  <div style="background:${BRAND_SECONDARY};padding:25px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:15px;opacity:0.8;"/>
    <p style="color:#94a3b8;margin:0 0 10px;font-size:13px;">Automated laundry request alert from Unified Security Solutions</p>
    <p style="color:${BRAND_COLOR};margin:10px 0 0;font-size:11px;font-weight:bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
  </div>
</div></body></html>`;

    const notificationPromises = recipients.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'laundry_request',
        priority: 'normal',
        title: `👕 Laundry Request — ${residentName}`,
        message: `${residentName} (Unit ${unitNumber || '—'}) scheduled a laundry pickup for ${pickupDate} ${pickupSlot}.`,
        read: false,
        related_entity: 'laundry_request',
        related_id: requestId,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((a) => a.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'Unified Security Solutions — Laundry',
          to: admin.email,
          subject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notificationPromises, ...emailPromises]);

    return Response.json({ success: true, notificationsSent: recipients.length });
  } catch (error) {
    console.error('Error in notifyAdminsLaundry:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});