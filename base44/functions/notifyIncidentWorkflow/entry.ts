/**
 * notifyIncidentWorkflow — SERVER-AUTHORITATIVE post-creation incident
 * workflow notifications (assigned / reassigned / accepted / declined /
 * resolved / reopen / close).
 *
 * SECURITY CONTRACT (rewritten 2026-09-22 — the previous version trusted
 * actor-supplied title, category, priority, site, guard, assignee, recipient
 * lists and branding, all of which are now derived server-side):
 *   • Accepted inputs: action + incidentId ONLY (plus optional client hints
 *     which are IGNORED). All content is reloaded from the Incident record
 *     with the service role.
 *   • Caller identity is resolved from the authoritative User RECORD
 *     (resolveTenantCaller) — session claims never win.
 *   • Tenant isolation: a caller may only act within the incident's own
 *     customer (platform administration and matching reseller admins
 *     excepted). Customer A can never cause notifications about Customer
 *     B's incidents, and recipients are always resolved from the INCIDENT's
 *     tenant — never the caller's.
 *   • Role + relationship state machine: assignment/close/reopen are
 *     management-only; accept/decline require being the assigned guard (or
 *     management); resolve requires the assigned/reporting guard (or
 *     management). The incident's CURRENT status must match the action's
 *     destination state and the incident's last activity-log entry must be
 *     the same action — replayed, stale or forged transitions are rejected.
 *   • Dedupe: the transition id is the incident's last activity-log
 *     timestamp (unique per real transition) — a replayed call suppresses
 *     duplicate in-app records, push, Telegram and audited email; a NEW
 *     transition notifies again.
 *   • One Notification per recipient; audited branded email (customer →
 *     reseller → platform branding resolved from the incident's tenant).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';
import { applyNotificationPreferences } from '../../shared/notificationPreferences.ts';
import { secrets } from 'base44:runtime';

const MANAGEMENT_ROLES = ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'];
const isPlatformUser = (u) =>
  u?.role_type === 'admin' || u?.role_type === 'platform_admin' || u?.admin_level === 'platform';
const isManagement = (u) => isPlatformUser(u) || MANAGEMENT_ROLES.includes(u?.role_type);

// Destination statuses each action must find on the freshly transitioned
// incident (the client performs the entity transition first, then notifies).
const DESTINATION_STATUS = {
  assigned: ['assigned', 'reassigned'],
  reassigned: ['reassigned', 'assigned'],
  accepted: ['accepted', 'in_progress'],
  declined: ['declined'],
  resolved: ['resolved'],
  reopen: ['reported', 'open', 'in_progress'],
  close: ['closed'],
};

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const incidentId = body?.incidentId ? String(body.incidentId) : '';

    if (!action || !incidentId) {
      return Response.json({ error: 'Missing action or incidentId' }, { status: 400 });
    }
    if (!DESTINATION_STATUS[action]) {
      return Response.json({ error: 'Unknown action' }, { status: 400 });
    }

    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // ── AUTHORITATIVE RELOAD — browser-supplied content is never read ──
    const rows = await svc.entities.Incident.filter({ id: incidentId });
    const incident = rows?.[0];
    if (!incident) return Response.json({ error: 'INCIDENT_NOT_FOUND' }, { status: 404 });

    // ── TENANT ISOLATION ──
    if (!isPlatformUser(caller)) {
      const sameCustomer = caller.customer_id && incident.customer_id &&
        caller.customer_id === incident.customer_id;
      const resellerAdmin = caller.admin_level === 'reseller' && caller.reseller_id &&
        incident.reseller_id === caller.reseller_id;
      if (!sameCustomer && !resellerAdmin) {
        return Response.json({ error: 'Forbidden — incident belongs to another tenant' }, { status: 403 });
      }
    }

    // ── STATE MACHINE: destination status must match the action ──
    if (!DESTINATION_STATUS[action].includes(incident.status)) {
      return Response.json({
        error: 'INVALID_STATE', action, current_status: incident.status,
      }, { status: 409 });
    }
    const activity = Array.isArray(incident.activity_log) ? incident.activity_log : [];
    const lastActivity = activity[activity.length - 1] || null;
    // The incident's own activity log must record this very transition —
    // a replay of an old action against a newly transitioned incident (or a
    // forged action name) is rejected.
    const lastActionOk = !lastActivity || lastActivity.action === action;
    if (!lastActionOk) {
      return Response.json({ error: 'INVALID_TRANSITION', action, recorded: lastActivity.action }, { status: 409 });
    }

    // ── ROLE + RELATIONSHIP VALIDATION ──
    const isAssignedGuard = incident.assigned_to && caller.id === incident.assigned_to;
    const isReporter = incident.guard_id && caller.id === incident.guard_id;
    if (['assigned', 'reassigned', 'close', 'reopen'].includes(action)) {
      if (!isManagement(caller)) return Response.json({ error: 'Forbidden — management only' }, { status: 403 });
      if ((action === 'assigned' || action === 'reassigned') && !incident.assigned_to) {
        return Response.json({ error: 'INVALID_TRANSITION — no assignee on record' }, { status: 409 });
      }
    } else if (action === 'accepted' || action === 'declined') {
      if (!isAssignedGuard && !isManagement(caller)) {
        return Response.json({ error: 'Forbidden — only the assigned guard or management' }, { status: 403 });
      }
    } else if (action === 'resolved') {
      if (!isAssignedGuard && !isReporter && !isManagement(caller)) {
        return Response.json({ error: 'Forbidden — only the assigned/reporting guard or management' }, { status: 403 });
      }
    }

    // ── TRANSITION ID (dedupe key) — the incident's own last activity
    //    timestamp, unique per real transition; replay suppresses duplicates. ──
    const transitionId = lastActivity?.timestamp || incident.updated_date || String(Date.now());
    const ref = incident.incident_number || incidentId.slice(-8);
    const actorName = lastActivity?.by_user_name || caller.display_name || caller.full_name || 'User';

    // ── RECIPIENTS — always resolved from the INCIDENT's tenant ──
    const allUsers = await svc.entities.User.list().catch(() => []);
    let recipients = [];
    let notifType, notifPriority, notifTitle, notifMsg, emailSubject;

    const labelMap = {
      assigned: 'INCIDENT ASSIGNED', reassigned: 'INCIDENT REASSIGNED',
      accepted: 'INCIDENT ACCEPTED', declined: 'INCIDENT DECLINED',
      resolved: 'INCIDENT RESOLVED', reopen: 'INCIDENT REOPENED', close: 'INCIDENT CLOSED',
    };
    const label = labelMap[action];

    const resolveIncidentManagement = async () => {
      const candidates = (allUsers || []).filter((u) =>
        MANAGEMENT_ROLES.includes(u.role_type) &&
        (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) &&
        (isPlatformUser(u) || (incident.customer_id ? u.customer_id === incident.customer_id : false)));
      const narrowed = await narrowControlRoomOperators(svc, candidates, {
        customer_id: incident.customer_id || null, site_id: incident.site_id || null });
      return applyNotificationPreferences(svc, narrowed, { pref_field: 'status_change' });
    };

    if (action === 'assigned' || action === 'reassigned') {
      const assignee = (allUsers || []).find((u) => u.id === incident.assigned_to);
      if (!assignee) return Response.json({ error: 'ASSIGNEE_NOT_FOUND' }, { status: 409 });
      recipients = [assignee];
      notifType = 'incident_assigned'; notifPriority = 'high';
      notifTitle = `🔔 Incident Assigned to You — ${incident.category} at ${incident.site_name || 'site'}`;
      notifMsg = `Assigned by ${incident.assigned_by_name || actorName}. Ref: ${ref}. ${incident.title || ''}. Priority: ${incident.priority || 'medium'}. Check details and accept/decline.`;
      emailSubject = `${label} — ${incident.category} at ${incident.site_name || 'site'}`;
    } else if (action === 'accepted') {
      recipients = await resolveIncidentManagement();
      notifType = 'incident_accepted'; notifPriority = 'high';
      notifTitle = `✅ Incident Accepted — ${incident.category} at ${incident.site_name || 'site'}`;
      notifMsg = `${incident.accepted_by_name || actorName} accepted incident ${ref}. Status: ${String(incident.status).toUpperCase().replace('_', ' ')}. Site: ${incident.site_name || 'N/A'}.`;
      emailSubject = notifTitle.replace('✅ ', '');
    } else if (action === 'declined') {
      recipients = await resolveIncidentManagement();
      notifType = 'incident_declined'; notifPriority = 'high';
      notifTitle = `❌ Incident Declined — ${incident.category} at ${incident.site_name || 'site'}`;
      notifMsg = `${incident.declined_by_name || actorName} declined incident ${ref}. Reason: ${incident.decline_reason || 'Not specified'}. Reassignment required.`;
      emailSubject = notifTitle.replace('❌ ', '');
    } else if (action === 'resolved') {
      recipients = await resolveIncidentManagement();
      // Also notify the original reporting guard (if a real user)
      const reporter = (allUsers || []).find((u) => u.id === incident.guard_id);
      if (reporter && !recipients.some((r) => r.id === reporter.id)) recipients.push(reporter);
      notifType = 'incident_resolved'; notifPriority = 'medium';
      notifTitle = `✅ Incident Resolved — ${incident.category} at ${incident.site_name || 'site'}`;
      notifMsg = `${incident.resolved_by_name || actorName} resolved incident ${ref}. Site: ${incident.site_name || 'N/A'}. Resolution: ${(incident.resolution_notes || '').substring(0, 150)}`;
      emailSubject = notifTitle.replace('✅ ', '');
    } else if (action === 'reopen' || action === 'close') {
      recipients = await resolveIncidentManagement();
      notifType = 'status_change'; notifPriority = action === 'reopen' ? 'high' : 'medium';
      notifTitle = `${action === 'reopen' ? '↩️ Incident Reopened' : '🔒 Incident Closed'} — ${incident.category} at ${incident.site_name || 'site'}`;
      notifMsg = `${actorName} ${action === 'reopen' ? 'reopened' : 'closed'} incident ${ref}. Status: ${String(incident.status).toUpperCase().replace('_', ' ')}.`;
      emailSubject = notifTitle.replace(/^[^ ]+ /, '');
    }

    if (!recipients.length) {
      return Response.json({ success: true, action, notificationsSent: 0, message: 'No recipients for this action' });
    }

    // ── BRAND + EMAIL — from the INCIDENT's authoritative tenant ──
    const brand = await resolveCommunicationBrand(svc, {
      customer_id: incident.customer_id || null, reseller_id: incident.reseller_id || null });
    const hasLocation = incident.location && incident.location.lat != null && incident.location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${incident.location.lat},${incident.location.lng}` : null;
    const brandDetails = [
      { label: 'Reference', value: ref },
      { label: 'Category', value: (incident.category || 'N/A').toUpperCase() },
      { label: 'Priority', value: (incident.priority || 'medium').toUpperCase() },
      { label: 'Site', value: incident.site_name || 'N/A' },
      { label: 'Guard', value: incident.guard_name || 'N/A' },
      { label: 'Status', value: String(incident.status).toUpperCase().replace('_', ' ') },
      (action === 'assigned' || action === 'reassigned') ? { label: 'Assigned to', value: incident.assigned_to_name || 'N/A' } : null,
      (action === 'assigned' || action === 'reassigned') ? { label: 'Assigned by', value: incident.assigned_by_name || 'N/A' } : null,
      action === 'accepted' ? { label: 'Accepted by', value: incident.accepted_by_name || actorName } : null,
      action === 'declined' ? { label: 'Declined by', value: incident.declined_by_name || actorName } : null,
      action === 'declined' ? { label: 'Reason', value: incident.decline_reason || 'Not specified' } : null,
      action === 'resolved' ? { label: 'Resolved by', value: incident.resolved_by_name || actorName } : null,
      hasLocation ? { label: 'Location', value: googleMapsUrl } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: `${label} — ${incident.category || 'Incident'}`,
      greeting: 'Hello,',
      intro: incident.title || `Incident workflow update at ${incident.site_name || 'your site'}.`,
      details: brandDetails,
      closing: [action === 'resolved' && incident.resolution_notes ? `Resolution notes: ${incident.resolution_notes}` : null,
        'Please review this incident in the app.'].filter(Boolean).join(' '),
      ctaUrl: googleMapsUrl || undefined,
      ctaLabel: googleMapsUrl ? 'View on Google Maps' : undefined,
    });

    // ── DELIVERY — one Notification per recipient; every channel deduped
    //    on the unique transition id so replays never duplicate. ──
    let sent = 0;
    for (const r of recipients) {
      // IN-APP (dedupe: same recipient + type + incident + title = replay)
      const priorInApp = await svc.entities.Notification.filter({
        recipient_id: r.id, type: notifType, related_id: incidentId,
      }).catch(() => []);
      if (!(priorInApp || []).some((n) => n.title === notifTitle)) {
        await svc.entities.Notification.create({
          recipient_id: r.id,
          recipient_name: r.display_name || r.full_name,
          type: notifType, priority: notifPriority,
          title: notifTitle, message: notifMsg, read: false,
          related_entity: 'incident', related_id: incidentId,
          action_url: (action === 'assigned' || action === 'reassigned') ? '/GuardIncidents' : '/AdminIncidents',
          customer_id: incident.customer_id || undefined,
          reseller_id: incident.reseller_id || undefined,
          sent_via: ['in_app', 'email'],
        }).catch(() => {});
        sent++;
      }
      // AUDITED EMAIL — idempotent on the transition id
      if (r.email) {
        await sendAuditedEmail(svc, {
          to: r.email, subject: emailSubject, html: brandTpl.html,
          brand,
          customer_id: incident.customer_id || null,
          reseller_id: incident.reseller_id || null,
          recipient_id: r.id, recipient_name: r.display_name || r.full_name || null,
          event_type: 'incident_workflow_' + action,
          reference_id: `${incidentId}:${transitionId}`,
          idempotency_key: `incident_workflow:${action}:${incidentId}:${transitionId}:email:${r.email}`,
        }).catch(() => {});
      }
      // NATIVE PUSH — action-required events only (same policy as before)
      if (action === 'assigned' || action === 'reassigned' || action === 'declined' || action === 'reopen') {
        await sendNativePush(svc, {
          user_id: r.id, title: notifTitle, body: notifMsg, priority: notifPriority,
          action_label: (action === 'assigned' || action === 'reassigned') ? 'Open Incidents' : 'Open Admin Incidents',
          action_url: (action === 'assigned' || action === 'reassigned') ? '/GuardIncidents' : '/AdminIncidents',
          event_key: `incident_${action}:${incidentId}:${transitionId}:${r.id}`,
          customer_id: incident.customer_id || undefined,
          reseller_id: incident.reseller_id || undefined,
        }).catch(() => {});
      }
      // TELEGRAM — verified per-user mapping, deduped on the transition id
      if (r.telegram_connected && r.telegram_notifications_enabled !== false && r.telegram_chat_id) {
        await sendTaskTelegramDeduped(svc, secrets,
          `incident_${action}:${incidentId}:${transitionId}:${r.id}`,
          r.telegram_chat_id,
          buildBrandedTelegram({ brand, heading: notifTitle, details: brandDetails, closing: notifMsg }))
          .catch(() => {});
      }
    }

    return Response.json({ success: true, action, notificationsSent: sent, transition_id: transitionId });
  } catch (error) {
    console.error('notifyIncidentWorkflow error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});