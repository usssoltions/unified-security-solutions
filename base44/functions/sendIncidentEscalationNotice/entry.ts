/**
 * sendIncidentEscalationNotice — SERVER-AUTHORITATIVE dispatch for the
 * incident escalation monitor's correspondence (escalation + automatic
 * reassignment). Replaces the previous client-composed emails in
 * IncidentEscalationMonitor.jsx, whose branding was resolved from CLIENT
 * session state (forbidden — branding is resolved from the record's tenant
 * here, server-side).
 *
 * SECURITY CONTRACT:
 *  - The Incident is re-resolved by id from the database — never trusted
 *    from the caller. Branding, tenant scope and recipients follow the
 *    INCIDENT's customer/reseller, not the caller's session.
 *  - TENANT VALIDATION: a non-platform caller may only dispatch notices for
 *    incidents belonging to their OWN customer. Unscoped legacy incidents
 *    are platform-admin-only (fail closed).
 *  - Recipients: incident-tenant management roles only; Control Room
 *    Operators are narrowed fail-closed to their assigned active rooms
 *    covering the incident's site; recipient notification PREFERENCES are
 *    honoured; suspended/inactive users are excluded.
 *  - Every email attempt is delivery-audited via the shared audited-email
 *    helper (event_type, reference, tenant, recipient, branding source).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildBrandedEmail, resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';
import { applyNotificationPreferences } from '../../shared/notificationPreferences.ts';

const MANAGEMENT_ROLES = ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'];
// The monitor itself only runs for these roles (plus the platform sender
// roles), so the dispatch function accepts exactly the same set.
const MONITOR_ROLES = [...MANAGEMENT_ROLES, 'platform_admin'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!MONITOR_ROLES.includes(user.role_type)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { kind, incident_id, reason, original_guard_name, new_guard_name } = await req.json();
    if (!incident_id || !['escalation', 'reassignment'].includes(kind)) {
      return Response.json({ error: 'Bad request — kind must be escalation|reassignment and incident_id is required' }, { status: 400 });
    }

    // AUTHORITATIVE incident — every fact below comes from this record.
    const incident = await base44.asServiceRole.entities.Incident.get(String(incident_id)).catch(() => null);
    if (!incident) {
      return Response.json({ error: 'Incident not found' }, { status: 404 });
    }

    // TENANT VALIDATION (fail closed).
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.role_type === 'admin' || user.admin_level === 'platform';
    if (incident.customer_id) {
      if (!isPlatformSender && user.customer_id !== incident.customer_id) {
        return Response.json({ error: 'Forbidden — incident belongs to another tenant' }, { status: 403 });
      }
    } else if (!isPlatformSender) {
      // Legacy unscoped incidents are platform-admin-only (same visibility
      // class as every other pre-tenant-scoping record).
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // RECIPIENT RESOLUTION — always scoped to the INCIDENT's tenant. A
    // platform sender dispatching on a legacy unscoped incident resolves to
    // PLATFORM ADMINISTRATORS only (never a cross-tenant broadcast).
    let userQuery: any;
    if (incident.customer_id) {
      userQuery = { customer_id: incident.customer_id };
    } else {
      userQuery = {};
    }
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    let recipients = (allUsers || []).filter((u: any) => {
      const roleOk = incident.customer_id
        ? MANAGEMENT_ROLES.includes(u.role_type)
        : (u.role_type === 'platform_admin' || u.role_type === 'admin' || u.admin_level === 'platform');
      const activeOk = !u.status || (u.status !== 'suspended' && u.status !== 'inactive');
      return roleOk && activeOk && !!u.email;
    });
    // Escalation parity with the previous behaviour: the assigned guard is
    // not an escalation recipient.
    if (kind === 'escalation' && incident.guard_id) {
      recipients = recipients.filter((u: any) => u.id !== incident.guard_id);
    }
    // CONTROL ROOM narrowing (fail closed) + recipient preferences.
    recipients = await applyNotificationPreferences(base44.asServiceRole,
      await narrowControlRoomOperators(base44.asServiceRole, recipients, {
        customer_id: incident.customer_id || null,
        site_id: incident.site_id || null,
      }),
      { pref_field: kind === 'escalation' ? 'incident_critical' : 'status_change' });

    if (!recipients.length) {
      return Response.json({ ok: true, recipients: 0, sent: 0 });
    }

    // BRANDING — resolved from the INCIDENT's tenant (customer → reseller →
    // platform), never from the caller's session.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: incident.customer_id || null,
      reseller_id: incident.reseller_id || null,
    });

    const reportedAt = incident.reported_at ? new Date(incident.reported_at).toLocaleString() : 'N/A';
    let subject: string;
    let content: { html: string; text: string };

    if (kind === 'escalation') {
      const escReason = reason === 'priority'
        ? 'High/Critical Priority Incident'
        : 'Incident unresolved for 30+ minutes';
      subject = `🚨 Escalated Incident: ${incident.title}`;
      content = buildBrandedEmail({
        brand,
        heading: '⚠️ Incident Escalation Alert',
        intro: 'An incident has been escalated and requires immediate attention. It may need reassignment.',
        details: [
          { label: 'Incident Number', value: incident.incident_number || incident.id },
          { label: 'Title', value: incident.title },
          { label: 'Priority', value: String(incident.priority || 'N/A').toUpperCase() },
          { label: 'Status', value: incident.status || 'N/A' },
          { label: 'Site', value: incident.site_name || 'N/A' },
          { label: 'Assigned Guard', value: incident.guard_name || 'N/A' },
          { label: 'Escalation Reason', value: escReason },
          { label: 'Reported', value: reportedAt },
          { label: 'Description', value: incident.description ? String(incident.description).substring(0, 500) : 'N/A' },
        ],
        closing: 'Log into the app to review and take action.',
      });
    } else {
      subject = `Incident Reassigned: ${incident.title}`;
      content = buildBrandedEmail({
        brand,
        heading: 'Incident Automatically Reassigned',
        intro: 'The incident below has been reassigned due to workload optimization.',
        details: [
          { label: 'Incident', value: incident.title },
          { label: 'Original Guard', value: `${original_guard_name || incident.guard_name || 'N/A'} (Overloaded)` },
          { label: 'New Guard', value: new_guard_name || 'N/A' },
          { label: 'Site', value: incident.site_name || 'N/A' },
        ],
        closing: 'Log into the app to review the new assignment.',
      });
    }

    // DELIVERY AUDITED branded dispatch — the helper never rejects; failures
    // are recorded in the NotificationDelivery audit trail.
    const results = await Promise.allSettled(recipients.map((r: any) =>
      sendAuditedEmail(base44.asServiceRole, {
        to: r.email,
        subject,
        html: content.html,
        text: content.text,
        from_name: brand.brand_name,
        brand,
        customer_id: incident.customer_id || null,
        reseller_id: incident.reseller_id || null,
        recipient_id: r.id,
        recipient_name: r.display_name || r.full_name || null,
        event_type: kind === 'escalation' ? 'incident_escalation' : 'incident_reassignment',
        reference_id: String(incident.id),
      })
    ));

    const sent = results.filter(r => r.status === 'fulfilled' && (r as any).value?.ok).length;
    return Response.json({ ok: true, recipients: recipients.length, sent });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
});