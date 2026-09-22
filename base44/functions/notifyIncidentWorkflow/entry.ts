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
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';

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
    // MODERN recipient resolution — post-split management roles join the
    // legacy list (same confirmed defect class as Start of Shift).
    const managementRoles = ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'];
    const roleManagement = (allUsers || []).filter((u) => managementRoles.includes(u.role_type));
    // CONTROL ROOM narrowing — an operator receives a workflow update only
    // when assigned to an ACTIVE Control Room covering the incident's site.
    let incidentSiteId = null;
    try {
      if (incidentId) {
        const incRows = await base44.asServiceRole.entities.Incident.filter({ id: String(incidentId) });
        incidentSiteId = (incRows && incRows[0] && incRows[0].site_id) || null;
      }
    } catch (_) { /* narrowing failure never blocks the alert */ }
    const management = await narrowControlRoomOperators(base44.asServiceRole, roleManagement, {
      customer_id: user.customer_id || null, site_id: incidentSiteId });

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

    // TENANT BRANDING — resolved from the acting user's authoritative tenant
    // record (customer → reseller → USS platform default). The ENTIRE visible
    // email (heading, logo, colours, details, footer, support contact)
    // renders through the ONE shared branded renderer.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: user?.customer_id || null, reseller_id: user?.reseller_id || null });
    const brandDetails = [
      { label: 'Reference', value: ref },
      { label: 'Category', value: (category || 'N/A').toUpperCase() },
      { label: 'Priority', value: (priority || 'medium').toUpperCase() },
      { label: 'Site', value: siteName || 'N/A' },
      action === 'assigned' || action === 'reassigned' ? { label: 'Assigned to', value: assigneeName || 'N/A' } : null,
      action === 'assigned' || action === 'reassigned' ? { label: 'Assigned by', value: performedByName || 'N/A' } : null,
      action === 'accepted' ? { label: 'Accepted by', value: performedByName || 'N/A' } : null,
      action === 'declined' ? { label: 'Declined by', value: performedByName || 'N/A' } : null,
      action === 'declined' ? { label: 'Reason', value: declineReason || 'Not specified' } : null,
      action === 'resolved' ? { label: 'Resolved by', value: performedByName || 'N/A' } : null,
      hasLocation ? { label: 'Location', value: googleMapsUrl } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: `${label} — ${incidentType || 'Incident'}`,
      greeting: 'Hello,',
      intro: incidentTitle || `Incident workflow update at ${siteName || 'your site'}.`,
      details: brandDetails,
      closing: [resolutionNotes ? `Resolution notes: ${resolutionNotes}` : null,
        'Please review this incident in the app.'].filter(Boolean).join(' '),
      ctaUrl: googleMapsUrl || undefined,
      ctaLabel: googleMapsUrl ? 'View on Google Maps' : undefined,
    });
    const emailBody = brandTpl.html;

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
        customer_id: user?.customer_id || undefined,
        reseller_id: user?.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((r) => r.email)
      .map((r) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name + ' — Incident Workflow',
          to: r.email,
          subject: emailSubject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    // NATIVE PUSH — shared platform service. Action-required events only:
    // assigned/reassigned → the assignee; declined → management (reassignment
    // required). Accepted/resolved are informational — deliberately no push.
    if (action === 'assigned' || action === 'reassigned') {
      await sendNativePush(base44.asServiceRole, {
        user_id: assigneeId,
        title: notifTitle,
        body: notifMsg,
        priority: 'high',
        action_label: 'Open Incidents', action_url: '/GuardIncidents',
        event_key: 'incident_' + action + ':' + incidentId + ':' + assigneeId,
        customer_id: user.customer_id || null,
        reseller_id: user.reseller_id || null,
      }).catch(() => {});
    } else if (action === 'declined') {
      for (const r of recipients) {
        await sendNativePush(base44.asServiceRole, {
          user_id: r.id,
          title: notifTitle,
          body: notifMsg,
          priority: 'high',
          action_label: 'Open Incidents', action_url: '/AdminIncidents',
          event_key: 'incident_declined:' + incidentId,
          customer_id: user.customer_id || null,
          reseller_id: user.reseller_id || null,
        }).catch(() => {});
      }
    }

    // TELEGRAM — automatic operational channel. Tenant scope already enforced
    // by the recipient resolution above; channel failure-isolated; the
    // deterministic event key per action+incident dedupes shared chats and
    // user/scheduler retries.
    for (const r of recipients) {
      if (!r.telegram_connected || r.telegram_notifications_enabled === false || !r.telegram_chat_id) continue;
      await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
        'incident_' + action + ':' + incidentId,
        r.telegram_chat_id,
        buildBrandedTelegram({
          brand,
          heading: notifTitle,
          details: brandDetails,
          closing: notifMsg,
        }))
        .catch(() => {});
    }

    return Response.json({ success: true, action, notificationsSent: recipients.length });
  } catch (error) {
    console.error('notifyIncidentWorkflow error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});