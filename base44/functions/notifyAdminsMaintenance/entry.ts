import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { narrowControlRoomOperators } from '../../shared/controlRoomRecipients.ts';
import { applyNotificationPreferences } from '../../shared/notificationPreferences.ts';
import { isSimulatedRecord } from '../../shared/simulatedRecords.ts';
import { tenantAutomationSettings } from '../../shared/automationSettings.ts';
import { resolveAppUrl } from '../../shared/appUrl.ts';
import { buildMaintenanceRequestEmail, humanMaintenanceDescription } from '../../shared/maintenanceEmail.ts';
import { formatSastDateTime } from '../../shared/brandedCommunication.ts';
import { additionalEmailsFor, ADDITIONAL_RECIPIENT_NAME } from '../../shared/tenantRecipients.ts';

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
    let maintRecord: any = null;
    try {
      if (maintenanceId) {
        const mRows = await base44.asServiceRole.entities.MaintenanceRequest.filter({ id: String(maintenanceId) });
        maintenanceSiteId = (mRows && mRows[0] && mRows[0].site_id) || null;
        maintRecord = (mRows && mRows[0]) || null;
      }
    } catch (_) { /* narrowing failure never blocks the alert */ }
    // SIMULATED-RECORD SUPPRESSION — demo/technical-test maintenance records
    // never generate admin alerts.
    if (maintRecord && await isSimulatedRecord(base44.asServiceRole, maintRecord)) {
      return Response.json({ success: true, suppressed: true, reason: 'SIMULATED_RECORD_SUPPRESSED' });
    }
    // PER-TENANT TOGGLE — "Maintenance Alerts" (default ON): the IMMEDIATE
    // real-time alert fires only for the request's OWN tenant when enabled
    // there (resolved server-side from the request's customer, falling back
    // to the reporting user's tenant). OFF suppresses ONLY this alert — the
    // maintenance request itself is always saved normally by the caller, and
    // later workflow status updates (assigned/accepted/completed) are a
    // separate flow (notifyMaintenanceWorkflow) and unaffected.
    const { settings: maintAlertSettings } = await tenantAutomationSettings(
      base44.asServiceRole,
      (maintRecord && maintRecord.customer_id) || user.customer_id || null,
    );
    if (maintAlertSettings.report_maintenance_alerts === false) {
      return Response.json({ success: true, suppressed: true, reason: 'MAINTENANCE_ALERTS_DISABLED' });
    }
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
    // FULL REQUEST DETAILS — reference id, category, urgency, description,
    // reporter, timestamp and a direct link to open the request in the app
    // (enriched from the stored request record when available).
    const requestRef = (maintRecord && maintRecord.request_number) || maintenanceId || 'N/A';
    const urgencyRaw = String((maintRecord && maintRecord.urgency) || 'medium');
    const urgency = urgencyRaw.toUpperCase();
    const reporterName = (maintRecord && maintRecord.guard_name) || guardName || 'N/A';
    const appUrl = resolveAppUrl((secrets as any), req);
    const openRequestUrl = maintenanceId ? `${appUrl}/AdminMaintenance` : undefined;
    // LOCATION / CHECKPOINT — the human-entered details may lead with a
    // "Checkpoint: <name>" line (scanned at a checkpoint); it is presented as
    // its OWN labelled field, and the remaining text is the description.
    const rawDetailsText = String(details || '');
    const storedDescText = String((maintRecord && maintRecord.description) || '');
    const cpMatch = /^[ \t]*Checkpoint:[ \t]*(.+)$/im.exec(rawDetailsText || storedDescText);
    const checkpointName = cpMatch ? cpMatch[1].trim().split(/\r?\n/)[0].trim() : null;
    // CUSTOMER-FACING DESCRIPTION — the human-entered details only. The
    // stored record's internal report template (concatenated labels and
    // technical sections) NEVER renders in the email; the full record stays
    // in the app.
    const humanDescription = humanMaintenanceDescription(
      checkpointName ? rawDetailsText.replace(/^[ \t]*Checkpoint:[ \t]*.*$/im, '').trim() : rawDetailsText,
      storedDescText);
    // GPS + reported timestamp — from the authoritative record when present.
    const recordLocation = (maintRecord && maintRecord.location && maintRecord.location.lat != null)
      ? maintRecord.location
      : (hasLocation ? location : null);
    const locationText = recordLocation ? `${recordLocation.lat}, ${recordLocation.lng}` : null;
    const mapsUrl = recordLocation
      ? `https://www.google.com/maps?q=${recordLocation.lat},${recordLocation.lng}` : googleMapsUrl;
    const reportedAtStr = (maintRecord && maintRecord.reported_at)
      ? formatSastDateTime(maintRecord.reported_at) : reportedAt;
    const brandDetails = [
      { label: 'Request ID', value: String(requestRef) },
      { label: 'Category', value: maintenanceType || 'Maintenance' },
      { label: 'Urgency', value: urgency },
      { label: 'Site', value: siteName || 'N/A' },
      checkpointName ? { label: 'Location / Checkpoint', value: checkpointName } : null,
      locationText ? { label: 'GPS Location', value: locationText } : null,
      { label: 'Reporter', value: reporterName },
      { label: 'Date / Time', value: reportedAtStr },
      humanDescription ? { label: 'Description', value: humanDescription.substring(0, 400) } : null,
    ].filter(Boolean);
    // CLEAN, PROFESSIONAL, MOBILE-SAFE maintenance email (dedicated renderer):
    // labelled fields, restrained brand colours, ONE prominent "Open
    // Maintenance Request" button — no raw concatenated metadata or internal
    // technical fields in the customer-facing body.
    const brandTpl = buildMaintenanceRequestEmail({
      brand,
      requestRef: String(requestRef),
      category: maintenanceType || 'Maintenance',
      urgency: urgencyRaw,
      site: siteName || '—',
      checkpoint: checkpointName,
      locationText,
      reporter: reporterName,
      reportedAt: reportedAtStr,
      description: humanDescription,
      ctaUrl: openRequestUrl || mapsUrl || undefined,
    });

    const notifTitle = `🔧 Maintenance Request — ${maintenanceType}`;
    const notifMsg = `${reporterName} submitted: ${maintenanceType} at ${siteName}. Urgency: ${urgency.toLowerCase()}. Review required.`;

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
        action_url: openRequestUrl || googleMapsUrl,
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

    // ADDITIONAL EMAIL RECIPIENTS — the request's OWN tenant's configured
    // list, EMAIL-ONLY, alongside (never replacing) the user recipients.
    const tenantIdForExtras = (maintRecord && maintRecord.customer_id) || user.customer_id || null;
    const extraMaintEmails = await additionalEmailsFor(base44.asServiceRole, tenantIdForExtras);
    const extraEmailPromises = extraMaintEmails.map((extra) =>
      sendAuditedEmail(base44.asServiceRole, {
        to: extra,
        subject: `Maintenance Request — ${maintenanceType} at ${siteName || 'site'}`,
        html: brandTpl.html, text: brandTpl.text,
        brand,
        customer_id: tenantIdForExtras,
        reseller_id: (maintRecord && maintRecord.reseller_id) || user.reseller_id || null,
        recipient_name: ADDITIONAL_RECIPIENT_NAME,
        event_type: 'maintenance_request', template_name: 'maintenance_request',
      }).catch(() => {})
    );

    await Promise.all([...notificationPromises, ...emailPromises, ...extraEmailPromises]);

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