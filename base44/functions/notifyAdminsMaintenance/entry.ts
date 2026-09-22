import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';
import { applyNotificationPreferences } from '../../shared/notificationPreferences.ts';

/**
 * notifyAdminsMaintenance
 *
 * Sends a fully tenant-branded maintenance-request alert email (rendered
 * through the ONE shared branded renderer) to all admin/dispatcher/supervisor
 * users, plus in-app notifications. Includes the guard's live location with a
 * Google Maps button when available.
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

    // Tenant-scoped management recipients (see notifyAdminsIncident rationale).
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const allUsers = await base44.asServiceRole.entities.User.filter(userQuery);
    // MODERN recipient resolution: management + customer_admin +
    // control_room_operator (post-split roles) — legacy-only filters
    // previously resolved ZERO recipients for customers whose managers hold
    // the modern roles. Suspended/inactive users are excluded.
    const roleAdmins = (allUsers || []).filter((u) =>
      ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'].includes(u.role_type) &&
      (!u.status || (u.status !== 'suspended' && u.status !== 'inactive'))
    );
    // CONTROL ROOM narrowing — an operator receives a maintenance alert only
    // when assigned to an ACTIVE Control Room covering the request's site.
    // The site is resolved from the MaintenanceRequest record itself.
    let maintenanceSiteId = null;
    try {
      if (maintenanceId) {
        const mRows = await base44.asServiceRole.entities.MaintenanceRequest.filter({ id: String(maintenanceId) });
        maintenanceSiteId = (mRows && mRows[0] && mRows[0].site_id) || null;
      }
    } catch (_) { /* narrowing failure never blocks the alert */ }
    // RECIPIENT PREFERENCES — a user who disabled maintenance notifications
    // is dropped from the routine automatic recipient list (opt-OUT system:
    // recipients without a preference record are always kept).
    const admins = await applyNotificationPreferences(base44.asServiceRole,
      await narrowControlRoomOperators(base44.asServiceRole, roleAdmins, {
        customer_id: user.customer_id || null, site_id: maintenanceSiteId }),
      { pref_field: 'maintenance_assigned' });

    if (admins.length === 0) {
      return Response.json({ success: false, message: 'No admins found' });
    }

    const hasLocation = location && location.lat != null && location.lng != null;
    const googleMapsUrl = hasLocation
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;
    const reportedAt = new Date().toLocaleString('en-ZA');

    // TENANT BRANDING — resolved from the reporting user's authoritative
    // tenant record (customer → reseller → USS platform default). The ENTIRE
    // visible email renders through the ONE shared branded renderer.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: user?.customer_id || null, reseller_id: user?.reseller_id || null });
    const brandDetails = [
      { label: 'Type', value: maintenanceType || 'Maintenance' },
      { label: 'Site', value: siteName || 'N/A' },
      { label: 'Guard', value: guardName || 'N/A' },
      { label: 'Reported', value: reportedAt },
      hasLocation ? { label: 'Location', value: googleMapsUrl } : null,
    ].filter(Boolean);
    const brandTpl = buildBrandedEmail({
      brand,
      heading: 'Maintenance Request',
      greeting: 'Hello,',
      intro: 'A new maintenance request has been submitted. Review & action required.',
      details: brandDetails,
      closing: `Details: ${details || 'No details provided.'}`,
      ctaUrl: googleMapsUrl || undefined,
      ctaLabel: googleMapsUrl ? 'View on Google Maps' : undefined,
    });

    const notifTitle = `🔧 Maintenance Request — ${maintenanceType}`;
    const notifMsg = `${guardName} submitted: ${maintenanceType} at ${siteName}. Review required.`;

    const notificationPromises = admins.map((admin) =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'maintenance_reported',
        priority: 'high',
        title: notifTitle,
        message: notifMsg,
        read: false,
        related_entity: 'maintenance',
        related_id: maintenanceId,
        action_url: googleMapsUrl,
        customer_id: user?.customer_id || undefined,
        reseller_id: user?.reseller_id || undefined,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = admins
      .filter((a) => a.email)
      .map((admin) =>
        sendAuditedEmail(base44.asServiceRole, {
          to: admin.email,
          subject: `Maintenance Request — ${maintenanceType} at ${siteName || 'site'}`,
          html: brandTpl.html, text: brandTpl.text,
          brand,
          recipient_id: admin.id || undefined,
          recipient_name: admin.display_name || admin.full_name || undefined,
          event_type: 'maintenance_request', template_name: 'maintenance_request',
        }).catch(() => {})
      );

    await Promise.all([...notificationPromises, ...emailPromises]);

    // NATIVE PUSH — shared platform service. A NEW maintenance fault report
    // requires review/action even with the app closed. Routine metadata
    // changes never route through here.
    for (const admin of admins) {
      await sendNativePush(base44.asServiceRole, {
        user_id: admin.id,
        title: notifTitle,
        body: notifMsg,
        priority: 'high',
        action_label: 'Open Maintenance', action_url: '/AdminMaintenance',
        event_key: 'maintenance_new:' + maintenanceId,
        customer_id: user.customer_id || null,
        reseller_id: user.reseller_id || null,
      }).catch(() => {});
    }

    // TELEGRAM — automatic operational channel on NEW maintenance-request
    // submission. Recipients are already tenant-scoped above (server-side
    // resolution); channel failure-isolated; deterministic per-recipient
    // event key dedupes shared chats and retries. Content renders through
    // the ONE shared branded Telegram renderer.
    for (const admin of admins) {
      if (!admin.telegram_connected || admin.telegram_notifications_enabled === false || !admin.telegram_chat_id) continue;
      await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
        'maintenance_created:' + maintenanceId + ':' + admin.id,
        admin.telegram_chat_id,
        buildBrandedTelegram({
          brand,
          heading: 'Maintenance Request',
          details: brandDetails,
          closing: 'Review & action required.',
        }))
        .catch(() => {});
    }

    return Response.json({ success: true, notificationsSent: admins.length });
  } catch (error) {
    console.error('Error in notifyAdminsMaintenance:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});