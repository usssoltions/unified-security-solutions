/**
 * monitorHighPriorityIncidents
 *
 * Triggered as an entity automation on Incident create/update. Fires only for
 * critical-priority incidents that haven't been notified yet, and respects the
 * global "Incident Alerts" report toggle.
 *
 * The email renders through the ONE shared tenant-branded renderer, resolved
 * from the incident's own tenant scope (customer → reseller → USS platform).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { resolveCommunicationBrand, buildBrandedEmail } from '../../shared/brandedCommunication.ts';
import { sendNativePush } from '../../shared/nativePush.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate — blocks unauthenticated external invocations.
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role_type !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

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

    // TENANT BRANDING — resolved from the incident's own tenant scope
    // (customer → reseller → USS platform default).
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: incident.customer_id || null, reseller_id: incident.reseller_id || null });
    const brandDetails = [
      { label: 'Category', value: (incident.category || 'N/A').toUpperCase() },
      { label: 'Priority', value: (incident.priority || 'critical').toUpperCase() },
      { label: 'Site', value: incident.site_name || 'N/A' },
      { label: 'Guard', value: incident.guard_name || 'N/A' },
      { label: 'Status', value: incident.status || 'N/A' },
      { label: 'Reported', value: reportedAt },
      hasLocation ? { label: 'Location', value: googleMapsUrl } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: '🚨 Critical Incident Alert',
      greeting: 'Hello,',
      intro: `${incident.title || 'A critical incident'} — immediate response required.`,
      details: brandDetails,
      closing: `Incident details: ${incident.description || 'No description provided.'}`,
      ctaUrl: googleMapsUrl || undefined,
      ctaLabel: googleMapsUrl ? 'View on Google Maps' : undefined,
    });

    const subject = `🚨 CRITICAL INCIDENT — ${(incident.category || '').toUpperCase()} at ${incident.site_name || 'site'}`;

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
        customer_id: incident.customer_id || undefined,
        reseller_id: incident.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((u) => u.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name + ' — Critical Alerts',
          to: admin.email,
          subject,
          body: brandTpl.html,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    // NATIVE PUSH — shared platform service. A CRITICAL incident must reach
    // management with the app closed (CRITICAL policy priority). Deterministic
    // event key + the notification_sent gate make retries impossible to
    // double-send on any channel.
    for (const admin of recipients) {
      await sendNativePush(base44.asServiceRole, {
        user_id: admin.id,
        title: `Critical Incident: ${incident.title}`,
        body: `${incident.category}: ${incident.title} at ${incident.site_name} — ${incident.guard_name}`,
        priority: 'critical',
        action_label: 'Open Incidents', action_url: '/AdminIncidents',
        event_key: 'incident_critical:' + incident.id,
        customer_id: incident.customer_id || null,
        reseller_id: incident.reseller_id || null,
      }).catch(() => {});
    }

    await base44.asServiceRole.entities.Incident.update(incident.id, {
      notification_sent: true,
    });

    return Response.json({ success: true, notified: recipients.length });
  } catch (error) {
    console.error('monitorHighPriorityIncidents error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});