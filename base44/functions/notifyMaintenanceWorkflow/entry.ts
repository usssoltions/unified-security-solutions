/**
 * notifyMaintenanceWorkflow
 *
 * Handles all post-creation Maintenance Request workflow notifications:
 *   - assigned  → notify the assigned person
 *   - accepted  → notify admins / dispatchers / supervisors
 *   - declined → notify admins / dispatchers / supervisors
 *   - completed → notify admins / dispatchers / supervisors + original reporter
 *
 * Called from AdminIncidents.jsx (assignment) and GuardMaintenance.jsx
 * (accept / decline / complete). Uses asServiceRole throughout.
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
      action, maintenanceId, requestNumber,
      performedByUserId, performedByName,
      assigneeId, assigneeName, declineReason, completionNotes, recommendations, followUpRequired,
      title, category, urgency, siteName, location
    } = await req.json();

    if (!action || !maintenanceId) {
      return Response.json({ error: 'Missing action or maintenanceId' }, { status: 400 });
    }

    // Tenant-scoped user fetch (see notifyIncidentWorkflow for rationale).
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
    // when assigned to an ACTIVE Control Room covering the request's site.
    let maintenanceSiteId = null;
    try {
      if (maintenanceId) {
        const mRows = await base44.asServiceRole.entities.MaintenanceRequest.filter({ id: String(maintenanceId) });
        maintenanceSiteId = (mRows && mRows[0] && mRows[0].site_id) || null;
      }
    } catch (_) { /* narrowing failure never blocks the alert */ }
    const management = await narrowControlRoomOperators(base44.asServiceRole, roleManagement, {
      customer_id: user.customer_id || null, site_id: maintenanceSiteId });

    const hasLocation = location && location.lat != null && location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;

    const labelMap = {
      assigned: 'MAINTENANCE TASK ASSIGNED',
      accepted: 'MAINTENANCE TASK ACCEPTED',
      declined: 'MAINTENANCE TASK DECLINED',
      completed: 'MAINTENANCE TASK COMPLETED',
    };
    const label = labelMap[action] || 'MAINTENANCE UPDATE';
    const ref = requestNumber || maintenanceId?.slice(-8) || 'N/A';

    let recipients = [];
    let notifType = 'status_change';
    let notifPriority = 'medium';
    let notifTitle = `${label}: ${title || category || 'Maintenance'} at ${siteName || 'site'}`;
    let notifMsg = '';
    let emailSubject = `${label} — ${category || 'Maintenance'} at ${siteName || 'site'}`;

    if (action === 'assigned') {
      const assignee = (allUsers || []).find((u) => u.id === assigneeId);
      if (assignee) recipients = [assignee];
      notifType = 'maintenance_assigned';
      notifPriority = 'high';
      notifTitle = `🔧 Maintenance Task Assigned — ${title || category || 'Task'} at ${siteName || 'site'}`;
      notifMsg = `Assigned by ${performedByName}. Ref: ${ref}. ${title || ''}. Urgency: ${urgency || 'medium'}. Accept or decline this task.`;
    } else if (action === 'accepted') {
      recipients = [...management];
      notifType = 'maintenance_accepted';
      notifPriority = 'high';
      notifTitle = `✅ Maintenance Task Accepted — ${title || category || 'Task'} at ${siteName || 'site'}`;
      notifMsg = `${performedByName} accepted maintenance task ${ref}. Status: IN PROGRESS. Site: ${siteName || 'N/A'}.`;
    } else if (action === 'declined') {
      recipients = [...management];
      notifType = 'maintenance_declined';
      notifPriority = 'high';
      notifTitle = `❌ Maintenance Task Declined — ${title || category || 'Task'} at ${siteName || 'site'}`;
      notifMsg = `${performedByName} declined maintenance task ${ref}. Reason: ${declineReason || 'Not specified'}. Reassignment required.`;
    } else if (action === 'completed') {
      recipients = [...management];
      notifType = 'maintenance_completed';
      notifPriority = 'medium';
      notifTitle = `✅ Maintenance Completed — ${title || category || 'Task'} at ${siteName || 'site'}`;
      notifMsg = `${performedByName} completed maintenance task ${ref}. Site: ${siteName || 'N/A'}.${followUpRequired ? ' Follow-up required.' : ''}`;
    }

    if (recipients.length === 0) {
      return Response.json({ success: true, message: 'No recipients for this action', action });
    }

    // TENANT BRANDING — resolved from the acting user's authoritative tenant
    // record (customer → reseller → USS platform default). The ENTIRE visible
    // email renders through the ONE shared branded renderer.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: user?.customer_id || null, reseller_id: user?.reseller_id || null });
    const brandDetails = [
      { label: 'Reference', value: ref },
      { label: 'Category', value: (category || 'N/A').replace(/_/g, ' ').toUpperCase() },
      { label: 'Urgency', value: (urgency || 'medium').toUpperCase() },
      { label: 'Site', value: siteName || 'N/A' },
      action === 'assigned' ? { label: 'Assigned to', value: assigneeName || 'N/A' } : null,
      action === 'assigned' ? { label: 'Assigned by', value: performedByName || 'N/A' } : null,
      action === 'accepted' ? { label: 'Accepted by', value: performedByName || 'N/A' } : null,
      action === 'declined' ? { label: 'Declined by', value: performedByName || 'N/A' } : null,
      action === 'declined' ? { label: 'Reason', value: declineReason || 'Not specified' } : null,
      action === 'completed' ? { label: 'Completed by', value: performedByName || 'N/A' } : null,
      followUpRequired && action === 'completed' ? { label: 'Follow-up', value: 'Required' } : null,
      hasLocation ? { label: 'Location', value: googleMapsUrl } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: `${label} — ${title || category || 'Maintenance'}`,
      greeting: 'Hello,',
      intro: `Maintenance workflow update at ${siteName || 'your site'}.`,
      details: brandDetails,
      closing: [
        completionNotes ? `Completion notes: ${completionNotes}` : null,
        recommendations ? `Recommendations: ${recommendations}` : null,
        'Please review this maintenance request in the app.',
      ].filter(Boolean).join(' '),
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
        related_entity: 'maintenance',
        related_id: maintenanceId,
        action_url: action === 'assigned' ? '/GuardMaintenance' : '/AdminIncidents',
        customer_id: user?.customer_id || undefined,
        reseller_id: user?.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((r) => r.email)
      .map((r) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name + ' — Maintenance Workflow',
          to: r.email,
          subject: emailSubject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    // NATIVE PUSH — shared platform service. Action-required events only:
    // assigned → the assignee; declined → management (reassignment required).
    // Accepted/completed are informational — deliberately no push.
    if (action === 'assigned') {
      await sendNativePush(base44.asServiceRole, {
        user_id: assigneeId,
        title: notifTitle,
        body: notifMsg,
        priority: 'high',
        action_label: 'Open Maintenance', action_url: '/GuardMaintenance',
        event_key: 'maintenance_assigned:' + maintenanceId + ':' + assigneeId,
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
          action_label: 'Open Maintenance', action_url: '/AdminIncidents',
          event_key: 'maintenance_declined:' + maintenanceId,
          customer_id: user.customer_id || null,
          reseller_id: user.reseller_id || null,
        }).catch(() => {});
      }
    }

    // TELEGRAM — automatic operational channel. Tenant scope already enforced
    // by the recipient resolution above; channel failure-isolated; the
    // deterministic event key per action+request dedupes shared chats and
    // user/scheduler retries.
    for (const r of recipients) {
      if (!r.telegram_connected || r.telegram_notifications_enabled === false || !r.telegram_chat_id) continue;
      await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
        'maintenance_' + action + ':' + maintenanceId,
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
    console.error('notifyMaintenanceWorkflow error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});