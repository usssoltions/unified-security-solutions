import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { isSimulatedRecord } from '../../shared/simulatedRecords.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { resolveShiftReportRecipients } from '../../shared/shiftReportRecipients.ts';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import { buildStartOfShiftReportEmail, haversineMetres } from '../../shared/startOfShiftReport.ts';

/**
 * START OF SHIFT REPORT NOTIFICATION — In-App + Email + Telegram + native
 * push to the reporting guard's OWN customer's operational management.
 *
 * ROOT CAUSE fixed 2026-09-22 (live defect: Start of Shift email/Telegram
 * never received):
 *  1. The recipient filter used the LEGACY role list
 *     (admin/dispatcher/supervisor/management), so a customer whose managers
 *     hold the post-split roles (customer_admin / control_room_operator)
 *     resolved ZERO recipients and the whole function aborted with 404
 *     "No admin users found" — silently dropping email AND in-app.
 *  2. Telegram did not exist on this path at all.
 *
 * Recipients now use the same modern, tenant-scoped resolution as the
 * live-tested shift-acknowledgement path (platform oversight permitted,
 * every other customer/site/control-room excluded). The SHIFT record is the
 * AUTHORITATIVE source for schedule, clock-in and tenant facts — client
 * values are only a fallback. Every channel leg is failure-isolated and
 * diagnosable; a failure on one channel never stops the others.
 */
import { resolveAppUrl, appUrlFor } from '../../shared/appUrl.ts';
const RECIPIENT_ROLES = ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'];
const isPlatformUser = (u) => u.role_type === 'platform_admin' || u.admin_level === 'platform';

Deno.serve(async (req) => {
  // Deployment URL resolved centrally per request (custom-domain ready).
  const REPORT_LINK = appUrlFor(resolveAppUrl(secrets, req), '/StartOfShiftHistory');
  const diag = { event: 'start_of_shift_report', tenant: null, recipients: [], in_app: 0, email: 0, telegram: 0, push: 0, failures: [] };
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { reportData = {}, location, media = [] } = await req.json();

    // ── AUTHORITATIVE FACT RESOLUTION (server-side, never client-trusted) ──
    // The SHIFT record owns the schedule, the clock-in and the tenant scope.
    let shift = null;
    if (reportData.shift_id) {
      try {
        const rows = await base44.asServiceRole.entities.Shift.filter({ id: String(reportData.shift_id) });
        shift = (rows && rows[0]) || null;
      } catch (e) { diag.failures.push('shift_resolve:' + String(e?.message || e)); }
    }
    // SIMULATED-RECORD SUPPRESSION — demo/technical-test shifts never
    // generate Start of Shift correspondence.
    if (shift && await isSimulatedRecord(base44.asServiceRole, shift)) {
      diag.failures.push('SIMULATED_RECORD_SUPPRESSED');
      return Response.json({ ok: false, suppressed: true, reason: 'SIMULATED_RECORD_SUPPRESSED', diag });
    }
    const tenantCustomerId = (shift && shift.customer_id) || user.customer_id || null;
    const tenantResellerId = (shift && shift.reseller_id) || user.reseller_id || null;
    diag.tenant = { customer_id: tenantCustomerId, reseller_id: tenantResellerId };

    let site = null;
    const siteId = (shift && shift.site_id) || reportData.site_id || null;
    if (siteId) {
      try {
        const rows = await base44.asServiceRole.entities.Site.filter({ id: String(siteId) });
        site = (rows && rows[0]) || null;
      } catch (e) { diag.failures.push('site_resolve:' + String(e?.message || e)); }
    }

    // ONE authoritative brand — Customer → Reseller → USS platform default.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: tenantCustomerId, reseller_id: tenantResellerId });

    const guardName = user.display_name || user.full_name || 'Guard';
    const siteName = (site && site.name) || (shift && shift.site_name) || reportData.site_name || 'Unknown';
    const clientName = brand.customer_name || (site && site.client_name) || reportData.client_name || '—';
    const scheduledStart = (shift && shift.start_time) || null;
    const clockIn = (shift && shift.clock_in) || null;
    const submittedAt = new Date().toISOString();
    const handoverId = reportData.incidentId || reportData.handover_id || null;

    // Geofence evidence — only meaningful when the site has VALID configured
    // coordinates ((0,0) is never a valid site location and never activates
    // geofence logic).
    const siteLoc = site && site.location ? site.location : null;
    const siteGpsValid = !!(siteLoc && Number.isFinite(siteLoc.lat) && Number.isFinite(siteLoc.lng) &&
      !(siteLoc.lat === 0 && siteLoc.lng === 0));
    const guardGps = (location && Number.isFinite(location.lat) && Number.isFinite(location.lng)) ? location : null;
    const geofenceRadius = (site && Number.isFinite(Number(site.geofence_radius))) ? Number(site.geofence_radius) : null;
    let distanceMetres = null, withinFence = null;
    if (siteGpsValid && guardGps) {
      distanceMetres = haversineMetres({ lat: siteLoc.lat, lng: siteLoc.lng }, guardGps);
      if (geofenceRadius) withinFence = distanceMetres <= geofenceRadius;
    }
    const googleMapsUrl = guardGps ? `https://www.google.com/maps?q=${guardGps.lat},${guardGps.lng}` : null;

    // ── TENANT-SCOPED RECIPIENTS — modern role resolution + platform oversight ──
    const allUsers = await base44.asServiceRole.entities.User.list();
    // SHARED recipient resolution (modern roles + tenant scope + CONTROL
    // ROOM narrowing) — identical to the End of Shift report path.
    const recipients = await resolveShiftReportRecipients(base44.asServiceRole, allUsers, {
      customer_id: tenantCustomerId, site_id: siteId });
    diag.recipients = recipients.map(r => r.id);
    if (!recipients.length) diag.failures.push('no_recipients_resolved');

    const eventKey = 'sos_report:' + (handoverId || (user.id + ':' + submittedAt.slice(0, 16)));
    const heading = `🛡️ Start of Shift — ${guardName} @ ${siteName}`;

    // ── SHARED PRODUCTION BUILDER — the full Start of Shift email, text and
    // Telegram rendering now lives in shared/startOfShiftReport.ts (the same
    // builder the Report & Notification Showcase renders its examples from).
    const sosReport = buildStartOfShiftReportEmail({
      brand, site, siteName, guardName, badgeNumber: user.badge_number || null,
      clientName, shift, reportData, location: guardGps || location, media,
      submittedAt, distanceMetres, withinFence, geofenceRadius, siteGpsValid,
      reportLink: REPORT_LINK,
    });
    const emailHtml = sosReport.emailHtml;
    const emailSubject = sosReport.subject;
    const telegramText = sosReport.telegramText;
    const { shiftDateStr, submittedStr, distanceStr, clockInStr } = sosReport.facts;

    // ── PER-RECIPIENT DISPATCH — failure-isolated per recipient AND channel ──
    for (const admin of recipients) {
      const firstName = String(admin.display_name || admin.full_name || '').trim().split(/\s+/)[0];

      // IN-APP — real per-recipient record, deep-links to the report history.
      try {
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.display_name || admin.full_name,
          type: 'shift_reminder',
          priority: 'high',
          title: heading,
          message: `${guardName} is on duty at ${siteName} (${shiftDateStr}). Start of Shift submitted ${submittedStr}. Geofence: ${distanceStr}.`,
          read: false,
          related_entity: 'shift_handover',
          related_id: handoverId,
          action_url: '/StartOfShiftHistory',
          customer_id: tenantCustomerId || undefined,
          reseller_id: tenantResellerId || undefined,
          sent_via: ['in_app'],
        });
        diag.in_app++;
      } catch (e) {
        diag.failures.push('in_app:' + admin.id + ':' + String(e?.message || e));
      }

      // EMAIL — branded rich report, one per recipient.
      try {
        if (admin.email) {
          await sendAuditedEmail(base44.asServiceRole, {
            to: admin.email,
            subject: emailSubject,
            html: buildStartOfShiftReportEmail({
              brand, site, siteName, guardName, badgeNumber: user.badge_number || null,
              clientName, shift, reportData, location: guardGps || location, media,
              submittedAt, distanceMetres, withinFence, geofenceRadius, siteGpsValid,
              reportLink: REPORT_LINK, firstName,
            }).emailHtml,
            text: sosReport.text,
            brand,
            recipient_id: admin.id || undefined,
            recipient_name: admin.display_name || admin.full_name || undefined,
            event_type: 'start_of_shift_report', template_name: 'start_of_shift_report',
          });
          diag.email++;
        }
      } catch (e) {
        diag.failures.push('email:' + (admin.email || admin.id) + ':' + String(e?.message || e));
      }

      // TELEGRAM — verified per-user mapping, same-chat dedupe, inline button.
      try {
        if (admin.telegram_connected && admin.telegram_notifications_enabled !== false && admin.telegram_chat_id) {
          const ok = await sendTaskTelegramDeduped(base44.asServiceRole, secrets,
            eventKey, admin.telegram_chat_id, telegramText,
            { text: 'OPEN REPORT HISTORY', url: REPORT_LINK });
          if (ok) diag.telegram++;
        }
      } catch (e) {
        diag.failures.push('telegram:' + admin.id + ':' + String(e?.message || e));
      }
    }

    // NATIVE PUSH — shared platform service (app closed delivery).
    for (const admin of recipients) {
      const pr = await sendNativePush(base44.asServiceRole, {
        user_id: admin.id,
        title: `Start of Shift — ${guardName}`,
        body: `${guardName} is on duty at ${siteName}. Submitted ${submittedStr}.`,
        priority: 'high',
        action_label: 'Open Report History', action_url: '/StartOfShiftHistory',
        event_key: eventKey,
        customer_id: tenantCustomerId || null,
        reseller_id: tenantResellerId || null,
      }).catch(() => ({ status: 'failed' }));
      if (pr && pr.status === 'sent') diag.push++;
    }

    if (diag.failures.length) console.error('[sendStartOfShiftNotification] channel failures:', JSON.stringify(diag.failures));
    console.log('[sendStartOfShiftNotification] dispatched:', JSON.stringify({ tenant: diag.tenant, recipients: recipients.length, in_app: diag.in_app, email: diag.email, telegram: diag.telegram, push: diag.push }));

    return Response.json({
      success: true,
      recipients: recipients.length,
      in_app: diag.in_app,
      email: diag.email,
      telegram: diag.telegram,
      push: diag.push,
      resolved: { guard: guardName, site: siteName, customer_id: tenantCustomerId, scheduled_start: scheduledStart, clock_in: clockInStr, submitted: submittedStr, distance_metres: distanceMetres, within_geofence: withinFence },
      failures: diag.failures,
    });
  } catch (error) {
    console.error('[sendStartOfShiftNotification] fatal:', String(error?.message || error));
    return Response.json({ error: String(error?.message || error), failures: diag.failures }, { status: 500 });
  }
});