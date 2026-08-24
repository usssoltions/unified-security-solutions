/**
 * notifyIncidentWorkflow
 *
 * Handles all post-creation Incident workflow notifications:
 *   - assigned  → notify the assigned person
 *   - accepted  → notify admins / dispatchers / supervisors / the assigner
 *   - declined → notify admins / dispatchers / supervisors
 *   - resolved  → notify admins / dispatchers / supervisors + original reporter
 *   - reassigned → notify the new assignee + admins
 *
 * Called from AdminIncidents.jsx (assignment) and GuardIncidents.jsx
 * (accept / decline / resolve). Uses asServiceRole throughout.
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
      action, incidentId, incidentNumber,
      performedByUserId, performedByName,
      assigneeId, assigneeName, declineReason, resolutionNotes,
      incidentTitle, incidentType, category, priority, siteName, location
    } = await req.json();

    if (!action || !incidentId) {
      return Response.json({ error: 'Missing action or incidentId' }, { status: 400 });
    }

    // Tenant-scoped user fetch. Platform admins (explicit) see all tenants;
    // everyone else only sees users in their own customer/reseller scope so
    // incident workflow notifications never leak across tenants.
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    const managementRoles = ['admin', 'dispatcher', 'supervisor', 'management'];
    const management = (allUsers || []).filter((u) => managementRoles.includes(u.role_type));

    const hasLocation = location && location.lat != null && location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;

    const labelMap = {
      assigned: 'INCIDENT ASSIGNED',
      accepted: 'INCIDENT ACCEPTED',
      declined: 'INCIDENT DECLINED',
      resolved: 'INCIDENT RESOLVED',
      reassigned: 'INCIDENT REASSIGNED',
    };
    const label = labelMap[action] || 'INCIDENT UPDATE';
    const ref = incidentNumber || incidentId?.slice(-8) || 'N/A';

    // Determine recipients and message per action
    let recipients = [];
    let notifType = 'status_change';
    let notifPriority = 'high';
    let notifTitle = `${label}: ${incidentTitle || incidentType || 'Incident'}`;
    let notifMsg = '';
    let emailSubject = `${label} — ${incidentType || 'Incident'} at ${siteName || 'site'}`;

    if (action === 'assigned' || action === 'reassigned') {
      // Notify the assignee
      const assignee = (allUsers || []).find((u) => u.id === assigneeId);
      if (assignee) recipients = [assignee];
      notifType = 'incident_assigned';
      notifPriority = 'high';
      notifTitle = `🔔 Incident Assigned to You — ${incidentType || 'Incident'} at ${siteName || 'site'}`;
      notifMsg = `Assigned by ${performedByName}. Ref: ${ref}. ${incidentTitle || ''}. Priority: ${priority || 'medium'}. Check details and accept/decline.`;
    } else if (action === 'accepted') {
      // Notify management + the person who assigned (if not already in management)
      recipients = [...management];
      notifType = 'incident_accepted';
      notifPriority = 'high';
      notifTitle = `✅ Incident Accepted — ${incidentType || 'Incident'} at ${siteName || 'site'}`;
      notifMsg = `${performedByName} accepted incident ${ref}. Status: IN PROGRESS. Site: ${siteName || 'N/A'}.`;
    } else if (action === 'declined') {
      recipients = [...management];
      notifType = 'incident_declined';
      notifPriority = 'high';
      notifTitle = `❌ Incident Declined — ${incidentType || 'Incident'} at ${siteName || 'site'}`;
      notifMsg = `${performedByName} declined incident ${ref}. Reason: ${declineReason || 'Not specified'}. Reassignment required.`;
    } else if (action === 'resolved') {
      recipients = [...management];
      // Also notify the original reporting guard
      const originalGuard = (allUsers || []).find((u) => u.id === performedByUserId);
      notifType = 'incident_resolved';
      notifPriority = 'medium';
      notifTitle = `✅ Incident Resolved — ${incidentType || 'Incident'} at ${siteName || 'site'}`;
      notifMsg = `${performedByName} resolved incident ${ref}. Site: ${siteName || 'N/A'}. Resolution: ${(resolutionNotes || '').substring(0, 150)}`;
    }

    if (recipients.length === 0) {
      return Response.json({ success: true, message: 'No recipients for this action', action });
    }

    // Build branded email
    const emailBody = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f8fafc;">
<div style="max-width:650px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,${BRAND_COLOR} 0%,${BRAND_SECONDARY} 100%);padding:40px 30px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Unified Security Solutions" style="max-width:200px;height:auto;margin-bottom:20px;border-radius:10px;"/>
    <h1 style="color:white;margin:0;font-size:26px;font-weight:bold;text-shadow:2px 2px 4px rgba(0,0,0,0.3);">${esc(label)}</h1>
    <p style="color:rgba(255,255,255,0.95);margin:10px 0 0;font-size:16px;">${esc(incidentType || 'Incident')} — ${esc(siteName || 'site')}</p>
  </div>
  <div style="padding:30px;background:#f8f9fa;border-bottom:3px solid ${BRAND_COLOR};">
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📋 <strong>Ref:</strong> ${esc(ref)}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📂 <strong>Category:</strong> ${esc((category || 'N/A').toUpperCase())}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">🔴 <strong>Priority:</strong> ${esc((priority || 'medium').toUpperCase())}</p>
    <p style="color:#64748b;margin:5px 0;font-size:14px;">📍 <strong>Site:</strong> ${esc(siteName || 'N/A')}</p>
    ${action === 'assigned' || action === 'reassigned' ? `<p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Assigned to:</strong> ${esc(assigneeName || 'N/A')}</p><p style="color:#64748b;margin:5px 0;font-size:14px;">📝 <strong>Assigned by:</strong> ${esc(performedByName)}</p>` : ''}
    ${action === 'accepted' ? `<p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Accepted by:</strong> ${esc(performedByName)}</p><p style="color:#64748b;margin:5px 0;font-size:14px;">📊 <strong>Status:</strong> IN PROGRESS</p>` : ''}
    ${action === 'declined' ? `<p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Declined by:</strong> ${esc(performedByName)}</p><p style="color:#64748b;margin:5px 0;font-size:14px;">📝 <strong>Reason:</strong> ${esc(declineReason || 'Not specified')}</p>` : ''}
    ${action === 'resolved' ? `<p style="color:#64748b;margin:5px 0;font-size:14px;">👤 <strong>Resolved by:</strong> ${esc(performedByName)}</p>` : ''}
  </div>
  <div style="padding:30px;">
    ${incidentTitle ? `<div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:25px;margin-bottom:20px;"><h3 style="color:${BRAND_SECONDARY};margin:0 0 10px;font-size:18px;">${esc(incidentTitle)}</h3></div>` : ''}
    ${resolutionNotes ? `<div style="background:white;border:2px solid #e2e8f0;border-radius:12px;padding:25px;margin-bottom:20px;"><h3 style="color:${BRAND_SECONDARY};margin:0 0 15px;font-size:18px;border-bottom:2px solid ${BRAND_COLOR};padding-bottom:10px;">Resolution Notes</h3><p style="color:#1e293b;line-height:1.6;">${esc(resolutionNotes)}</p></div>` : ''}
    ${declineReason ? `<div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:25px;margin-bottom:20px;"><h3 style="color:#991b1b;margin:0 0 15px;font-size:18px;">Decline Reason</h3><p style="color:#1e293b;line-height:1.6;">${esc(declineReason)}</p></div>` : ''}
    ${hasLocation ? `<div style="background:linear-gradient(135deg,#fff5f5 0%,#ffe0e0 100%);border:2px solid ${BRAND_COLOR};border-radius:12px;padding:25px;margin-bottom:20px;"><h3 style="color:${BRAND_SECONDARY};margin:0 0 15px;font-size:18px;">📍 Location</h3><div style="text-align:center;"><a href="${googleMapsUrl}" style="display:inline-block;background:${BRAND_COLOR};color:white;padding:12px 25px;text-decoration:none;border-radius:8px;font-weight:bold;font-size:15px;">📍 View on Google Maps</a></div></div>` : ''}
  </div>
  <div style="background:${BRAND_SECONDARY};padding:25px;text-align:center;">
    <img src="${COMPANY_LOGO}" alt="Logo" style="max-width:120px;height:auto;margin-bottom:15px;opacity:0.8;"/>
    <p style="color:#94a3b8;margin:0 0 10px;font-size:13px;">Automated incident workflow notification — Unified Security Solutions</p>
    <p style="color:${BRAND_COLOR};margin:10px 0 0;font-size:11px;font-weight:bold;">PROFESSIONAL • RELIABLE • TRUSTED</p>
  </div>
</div></body></html>`;

    const notifPromises = recipients.map((r) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: r.id,
        recipient_name: r.full_name,
        type: notifType,
        priority: notifPriority,
        title: notifTitle,
        message: notifMsg,
        read: false,
        related_entity: 'incident',
        related_id: incidentId,
        action_url: action === 'assigned' || action === 'reassigned' ? '/GuardIncidents' : '/AdminIncidents',
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((r) => r.email)
      .map((r) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'Unified Security Solutions — Incident Workflow',
          to: r.email,
          subject: emailSubject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    return Response.json({ success: true, action, notificationsSent: recipients.length });
  } catch (error) {
    console.error('notifyIncidentWorkflow error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});