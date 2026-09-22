/**
 * notifyAdminsIncident
 *
 * Called from IncidentForm.jsx immediately after a guard creates an Incident.
 *
 * SECURITY (server-enforced):
 *  - AUTHORITATIVE RELOAD: the Incident record is reloaded from the database
 *    by id — request-supplied incident content, tenant and site fields are
 *    IGNORED entirely (only incidentId is read).
 *  - Recipients are scoped to the INCIDENT's own tenant (platform oversight
 *    excepted; an unscoped legacy incident alerts platform oversight only —
 *    fail closed, never every tenant).
 *  - Tenant branding is resolved from the incident's own tenant scope
 *    (customer → reseller → platform).
 *  - Delivery is retry-safe: in-app notifications are deduplicated per
 *    recipient + incident, emails go through the shared audited email helper
 *    (idempotent per incident + recipient), push uses a deterministic event
 *    key, and Telegram is deduped per chat. Channel failures are truthfully
 *    audited and never block the other legs.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';
import { applyNotificationPreferences } from '../../shared/notificationPreferences.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ONLY incidentId is read — every content/tenant field in the body is
    // ignored; the record is reloaded below.
    const { incidentId } = await req.json();
    if (!incidentId) {
      return Response.json({ error: 'Missing incidentId' }, { status: 400 });
    }

    // AUTHORITATIVE RELOAD — never trust the request payload. A missing
    // record fails closed (no notifications from crafted content).
    const incRows = await svc.entities.Incident.filter({ id: String(incidentId) }).catch(() => []);
    const incident = (incRows && incRows[0]) || null;
    if (!incident) {
      return Response.json({ error: 'Incident not found' }, { status: 404 });
    }

    const priority = incident.priority || 'medium';
    const category = incident.category;
    const description = incident.description || '';
    const siteName = incident.site_name || 'N/A';
    const guardName = incident.guard_name || 'Unknown Guard';
    const badgeNumber = incident.badge_number || '';
    const incidentNumber = incident.incident_number || String(incident.id).slice(-8);
    const reportedAt = new Date(incident.reported_at || incident.created_date).toLocaleString('en-ZA');
    const location = incident.location && incident.location.lat != null ? incident.location : null;
    const mediaCount = (incident.media || []).length;
    const hasLocation = !!location;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;

    // TENANT-SCOPED recipients from the INCIDENT's authoritative customer
    // scope — platform oversight excepted, every other customer excluded.
    // An unscoped legacy incident alerts PLATFORM oversight only.
    const isPlatformUser = (u) => u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform';
    const allUsers = await svc.entities.User.filter({}).catch(() => []);
    const roleRecipients = (allUsers || []).filter((u) =>
      ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'].includes(u.role_type) &&
      (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) &&
      (isPlatformUser(u) || (!!incident.customer_id && u.customer_id === incident.customer_id))
    );
    // CONTROL ROOM narrowing — an operator is notified only when assigned to
    // an ACTIVE Control Room covering the incident's (authoritative) site.
    const recipients = await applyNotificationPreferences(svc,
      await narrowControlRoomOperators(svc, roleRecipients, {
        customer_id: incident.customer_id || null, site_id: incident.site_id || null }),
      { pref_field: (priority === 'high' || priority === 'critical')
        ? 'incident_critical' : 'incident_assigned' });

    if (recipients.length === 0) {
      return Response.json({ success: false, message: 'No admin users found' });
    }

    // TENANT BRANDING — from the INCIDENT's own tenant scope.
    const brand = await resolveCommunicationBrand(svc, {
      customer_id: incident.customer_id || null, reseller_id: incident.reseller_id || null });
    const brandDetails = [
      { label: 'Reference', value: incidentNumber },
      { label: 'Category', value: (category || 'N/A').toUpperCase() },
      { label: 'Priority', value: priority.toUpperCase() },
      { label: 'Site', value: siteName },
      { label: 'Guard', value: `${guardName}${badgeNumber ? ` (Badge: ${badgeNumber})` : ''}` },
      { label: 'Reported', value: reportedAt },
      hasLocation ? { label: 'Location', value: googleMapsUrl } : null,
      mediaCount ? { label: 'Attachments', value: `${mediaCount} media attachment(s)` } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: `New Incident — ${(category || 'Incident').toUpperCase()}`,
      greeting: 'Hello,',
      intro: 'A new incident has been reported and requires review. Immediate attention is required.',
      details: brandDetails,
      closing: `Description: ${description || 'No description provided.'}`,
      ctaUrl: googleMapsUrl || undefined,
      ctaLabel: googleMapsUrl ? 'View on Google Maps' : undefined,
    });

    const subject = `🚨 New Incident — ${(category || 'N/A').toUpperCase()} at ${siteName}`;
    const notifTitle = subject;
    const notifMsg = `${guardName} reported: ${category || 'incident'} at ${siteName}. Priority: ${priority}.${description ? ` ${description.substring(0, 120)}` : ''}`;

    // IN-APP — one record per recipient, deduplicated per recipient+incident
    // so a retry never leaves duplicate bell entries.
    for (const admin of recipients) {
      const existing = await svc.entities.Notification
        .filter({ recipient_id: admin.id, related_entity: 'incident', related_id: incident.id, type: 'incident_reported' })
        .catch(() => []);
      if (existing && existing.length) continue;
      await svc.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'incident_reported',
        priority: priority === 'critical' ? 'critical' : 'high',
        title: notifTitle,
        message: notifMsg,
        read: false,
        related_entity: 'incident',
        related_id: incident.id,
        action_url: '/AdminIncidents',
        customer_id: incident.customer_id || undefined,
        reseller_id: incident.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {});
    }

    // EMAIL — shared audited helper: idempotent per incident + recipient,
    // failures recorded in the delivery audit trail.
    for (const admin of recipients) {
      if (!admin.email) continue;
      await sendAuditedEmail(svc, {
        to: admin.email,
        subject,
        html: brandTpl.html,
        text: brandTpl.text,
        from_name: brand.brand_name + ' — Incident Alerts',
        customer_id: incident.customer_id || null,
        reseller_id: incident.reseller_id || null,
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        event_type: 'incident_reported',
        reference_id: incident.id,
        idempotency_key: `incident_new:${incident.id}:email:${admin.id}`,
      });
    }

    // NATIVE PUSH — shared platform service. Only SERIOUS incidents push;
    // the deterministic event key makes retries impossible to double-push.
    if (priority === 'critical' || priority === 'high') {
      for (const admin of recipients) {
        await sendNativePush(svc, {
          user_id: admin.id,
          title: notifTitle,
          body: notifMsg,
          priority: priority === 'critical' ? 'critical' : 'high',
          action_label: 'Open Incidents', action_url: '/AdminIncidents',
          event_key: 'incident_new:' + incident.id,
          customer_id: incident.customer_id || null,
          reseller_id: incident.reseller_id || null,
        }).catch(() => {});
      }
    }

    // TELEGRAM — deduped per incident + recipient chat; channel-isolated.
    for (const admin of recipients) {
      if (!admin.telegram_connected || admin.telegram_notifications_enabled === false || !admin.telegram_chat_id) continue;
      await sendTaskTelegramDeduped(svc, secrets,
        'incident_created:' + incident.id + ':' + admin.id,
        admin.telegram_chat_id,
        buildBrandedTelegram({
          brand,
          heading: `New Incident — ${(category || 'Incident').toUpperCase()}`,
          details: brandDetails,
          closing: 'Immediate attention required — review & assign response.',
        }))
        .catch(() => {});
    }

    // Mark incident as notified (service role bypasses RLS)
    await svc.entities.Incident.update(incident.id, {
      notification_sent: true,
    }).catch(() => {});

    return Response.json({ success: true, notificationsSent: recipients.length });
  } catch (error) {
    console.error('notifyAdminsIncident error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});