/**
 * notifyAdminsIncident
 *
 * Called from IncidentForm.jsx immediately after a guard creates an Incident.
 * Uses asServiceRole to bypass User RLS (a guard's User.list() only returns
 * themselves — the previous inline approach silently sent zero notifications).
 *
 * Creates in-app Notification records AND fully tenant-branded emails for all
 * admin / dispatcher / supervisor / management users, rendered through the ONE
 * shared branded email renderer (customer → reseller → USS platform).
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
      incidentId, incidentNumber, guardName, badgeNumber,
      incidentType, category, priority, siteName,
      incidentTime, description, location, mediaCount
    } = await req.json();

    // Tenant-scoped management recipients. Platform admins (explicit capability)
    // notify across all tenants; everyone else only reaches users in their own
    // customer/reseller scope so incident alerts never leak across tenants.
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    // MODERN recipient resolution: customer_admin + control_room_operator
    // join the legacy management roles — a customer whose managers hold the
    // post-split roles previously resolved ZERO recipients (same confirmed
    // defect class as the Start of Shift notification). Suspended/inactive
    // users are excluded.
    const roleRecipients = (allUsers || []).filter((u) =>
      ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'].includes(u.role_type) &&
      (!u.status || (u.status !== 'suspended' && u.status !== 'inactive'))
    );
    // CONTROL ROOM narrowing — an operator receives an incident alert only
    // when assigned to an ACTIVE Control Room covering the incident's site
    // (role membership alone is never sufficient). The site is resolved from
    // the Incident record itself — authoritative, never client-supplied.
    let incidentSiteId = null;
    try {
      if (incidentId) {
        const incRows = await base44.asServiceRole.entities.Incident.filter({ id: String(incidentId) });
        incidentSiteId = (incRows && incRows[0] && incRows[0].site_id) || null;
      }
    } catch (_) { /* narrowing failure never blocks the alert */ }
    const recipients = await narrowControlRoomOperators(base44.asServiceRole, roleRecipients, {
      customer_id: user.customer_id || null, site_id: incidentSiteId });

    if (recipients.length === 0) {
      return Response.json({ success: false, message: 'No admin users found' });
    }

    const reportedAt = new Date(incidentTime || Date.now()).toLocaleString('en-ZA');
    const hasLocation = location && location.lat != null && location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;

    // TENANT BRANDING — resolved from the reporting user's authoritative
    // tenant record (customer → reseller → USS platform default). The ENTIRE
    // visible email renders through the ONE shared branded renderer.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: user?.customer_id || null, reseller_id: user?.reseller_id || null });
    const brandDetails = [
      { label: 'Reference', value: incidentNumber || 'N/A' },
      { label: 'Category', value: (category || 'N/A').toUpperCase() },
      { label: 'Priority', value: (priority || 'medium').toUpperCase() },
      { label: 'Site', value: siteName || 'N/A' },
      { label: 'Guard', value: `${guardName || 'N/A'}${badgeNumber ? ` (Badge: ${badgeNumber})` : ''}` },
      { label: 'Reported', value: reportedAt },
      hasLocation ? { label: 'Location', value: googleMapsUrl } : null,
      mediaCount ? { label: 'Attachments', value: `${mediaCount} media attachment(s)` } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: `New Incident — ${(incidentType || category || 'Incident').toUpperCase()}`,
      greeting: 'Hello,',
      intro: 'A new incident has been reported and requires review. Immediate attention is required.',
      details: brandDetails,
      closing: `Description: ${description || 'No description provided.'}`,
      ctaUrl: googleMapsUrl || undefined,
      ctaLabel: googleMapsUrl ? 'View on Google Maps' : undefined,
    });

    const subject = `🚨 New Incident — ${(incidentType || category || 'N/A').toUpperCase()} at ${siteName || 'site'}`;
    const notifTitle = subject;
    const notifMsg = `${guardName || 'Guard'} reported: ${incidentType || category || 'incident'} at ${siteName || 'site'}. Priority: ${priority || 'medium'}.${description ? ` ${description.substring(0, 120)}` : ''}`;

    const notifPromises = recipients.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'incident_reported',
        priority: priority === 'critical' ? 'critical' : 'high',
        title: notifTitle,
        message: notifMsg,
        read: false,
        related_entity: 'incident',
        related_id: incidentId,
        action_url: '/AdminIncidents',
        customer_id: user?.customer_id || undefined,
        reseller_id: user?.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter((u) => u.email)
      .map((admin) =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: brand.brand_name + ' — Incident Alerts',
          to: admin.email,
          subject,
          body: brandTpl.html,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    // NATIVE PUSH — shared platform service (delivered with the app closed).
    // Only SERIOUS incidents push (critical/high); minor reports stay
    // in-app + email only. Deterministic event key — retries never double-push.
    if (priority === 'critical' || priority === 'high') {
      for (const admin of recipients) {
        await sendNativePush(base44.asServiceRole, {
          user_id: admin.id,
          title: notifTitle,
          body: notifMsg,
          priority: priority === 'critical' ? 'critical' : 'high',
          action_label: 'Open Incidents', action_url: '/AdminIncidents',
          event_key: 'incident_new:' + incidentId,
          customer_id: user.customer_id || null,
          reseller_id: user.reseller_id || null,
        }).catch(() => {});
      }
    }

    // TELEGRAM — automatic operational channel on NEW INCIDENT submission.
    // Recipients are already tenant-scoped above (server-side resolution);
    // channel failure-isolated from in-app/email/push; deterministic per-
    // recipient event key dedupes shared chats and retries. Content renders
    // through the ONE shared branded Telegram renderer.
    for (const admin of recipients) {
      if (!admin.telegram_connected || admin.telegram_notifications_enabled === false || !admin.telegram_chat_id) continue;
      await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
        'incident_created:' + incidentId + ':' + admin.id,
        admin.telegram_chat_id,
        buildBrandedTelegram({
          brand,
          heading: `New Incident — ${(incidentType || category || 'Incident').toUpperCase()}`,
          details: brandDetails,
          closing: 'Immediate attention required — review & assign response.',
        }))
        .catch(() => {});
    }

    // Mark incident as notified (service role bypasses RLS)
    await base44.asServiceRole.entities.Incident.update(incidentId, {
      notification_sent: true,
    }).catch(() => {});

    return Response.json({ success: true, notificationsSent: recipients.length });
  } catch (error) {
    console.error('notifyAdminsIncident error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});