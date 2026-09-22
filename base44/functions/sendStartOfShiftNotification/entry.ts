import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { resolveShiftReportRecipients } from '../../shared/shiftReportRecipients.ts';
import {
  resolveCommunicationBrand, escHtml,
  formatSastDate, formatSastTime, formatSastDateTime,
} from '../../shared/brandedCommunication.ts';
import { renderTransactionalShell } from '../../shared/transactionalEmail.ts';

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

function haversineMetres(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

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

    // ── Formatted operational facts ──
    const shiftDateStr = scheduledStart ? formatSastDate(scheduledStart) : formatSastDate(submittedAt);
    const scheduledStartStr = scheduledStart ? formatSastTime(scheduledStart) : '—';
    const clockInStr = (clockIn && clockIn.timestamp) ? formatSastDateTime(clockIn.timestamp) : '—';
    const submittedStr = formatSastDateTime(submittedAt);
    const locationStr = guardGps ? `${guardGps.lat}, ${guardGps.lng}` : 'Not captured';
    const distanceStr = distanceMetres !== null
      ? `${distanceMetres} m from site${geofenceRadius ? ' (geofence radius ' + geofenceRadius + ' m)' : ''}` +
        (withinFence === true ? ' — WITHIN GEOFENCE' : withinFence === false ? ' — OUTSIDE GEOFENCE' : '')
      : (siteGpsValid ? 'Guard GPS not captured' : 'Site GPS not configured');

    const photos = (media || []).filter(m => m && m.type === 'photo' && m.url);
    const videos = (media || []).filter(m => m && m.type === 'video' && m.url);
    const audios = (media || []).filter(m => m && m.type === 'audio' && m.url);

    const eventKey = 'sos_report:' + (handoverId || (user.id + ':' + submittedAt.slice(0, 16)));
    const heading = `🛡️ Start of Shift — ${guardName} @ ${siteName}`;

    // ── Shared rich EMAIL body (branded, full operational report) ──
    const photosHtml = photos.map(m => `
      <div style="margin: 10px 0;">
        <img src="${escHtml(m.url)}" alt="Photo evidence" style="max-width: 100%; height: auto; border-radius: 8px; border: 2px solid #e2e8f0;" />
      </div>`).join('');
    const videosHtml = videos.map(m => `
      <div style="margin: 10px 0;">
        <video controls style="max-width: 100%; border-radius: 8px; border: 2px solid #e2e8f0;">
          <source src="${escHtml(m.url)}" type="video/mp4">
        </video>
        <p style="text-align: center; margin: 5px 0;"><a href="${escHtml(m.url)}" target="_blank" style="color: #0ea5e9;">📹 Open Video</a></p>
      </div>`).join('');
    const audiosHtml = audios.map(m => `
      <div style="margin: 10px 0; background: #f1f5f9; padding: 15px; border-radius: 8px;">
        <p style="margin: 0 0 10px 0; font-weight: bold;">🎤 Voice Note:</p>
        <audio controls style="width: 100%;">
          <source src="${escHtml(m.url)}" type="audio/webm">
        </audio>
      </div>`).join('');

    // CENTRAL RENDERER — the document shell (logo, header, branding, footer,
    // CTA, contact details) comes from the ONE transactional renderer; only
    // the operational report content is composed here.
    const emailBodyHtml = `
          <div style="padding: 30px; background: #f8f9fa; border-bottom: 3px solid ${escHtml(brand.primary_color)};">
            <h2 style="color: #0c4a6e; margin: 0 0 10px 0; font-size: 22px;">Officer: ${escHtml(guardName)}</h2>
            <p style="color: #64748b; margin: 5px 0; font-size: 14px;">🏢 <strong>Client:</strong> ${escHtml(clientName)}</p>
            <p style="color: #64748b; margin: 5px 0; font-size: 14px;">📍 <strong>Site:</strong> ${escHtml(siteName)}</p>
            ${site && site.address ? `<p style="color: #64748b; margin: 5px 0; font-size: 14px;">🗺️ <strong>Address:</strong> ${escHtml(site.address)}</p>` : ''}
            <p style="color: #64748b; margin: 5px 0; font-size: 14px;">📅 <strong>Shift date:</strong> ${escHtml(shiftDateStr)}</p>
            ${user.badge_number ? `<p style="color: #64748b; margin: 5px 0; font-size: 14px;">🪪 <strong>Badge:</strong> ${escHtml(user.badge_number)}</p>` : ''}
          </div>

          <div style="padding: 30px;">
            <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
              <h3 style="color: ${escHtml(brand.primary_color)}; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid ${escHtml(brand.primary_color)}; padding-bottom: 10px;">⏱️ Shift &amp; Clock-In</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding:6px 0;color:#64748b;font-weight:bold;width:190px;font-size:13px;">Scheduled start:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;">${escHtml(scheduledStartStr)}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-weight:bold;font-size:13px;">Actual clock-in:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;">${escHtml(clockInStr)}${clockIn && clockIn.verified ? ' (GPS verified)' : ''}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-weight:bold;font-size:13px;">Report submitted:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;">${escHtml(submittedStr)}</td></tr>
              </table>
            </div>

            <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
              <h3 style="color: ${escHtml(brand.primary_color)}; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid ${escHtml(brand.primary_color)}; padding-bottom: 10px;">📋 Start of Shift Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding:6px 0;color:#64748b;font-weight:bold;width:190px;font-size:13px;">SHIFT/POST:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;">${escHtml(reportData.shift_post || 'N/A')}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-weight:bold;font-size:13px;">SPECIAL INSTRUCTIONS:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;">${escHtml(reportData.special_instructions || 'None')}</td></tr>
                <tr><td style="padding:6px 0;color:#64748b;font-weight:bold;font-size:13px;">POST ITEMS RECEIVED:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;">${escHtml(reportData.post_items_received || 'N/A')}</td></tr>
                ${reportData.relieving_officer ? `<tr><td style="padding:6px 0;color:#64748b;font-weight:bold;font-size:13px;">RELIEVING OFFICER:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;">${escHtml(reportData.relieving_officer)}</td></tr>` : ''}
                ${reportData.additional_notes ? `<tr><td style="padding:6px 0;color:#64748b;font-weight:bold;font-size:13px;">ADDITIONAL NOTES:</td><td style="padding:6px 0;color:#1e293b;font-size:15px;white-space:pre-wrap;">${escHtml(reportData.additional_notes)}</td></tr>` : ''}
              </table>
            </div>

            ${reportData.observations && reportData.observations.length > 0 ? `
            <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
              <h3 style="color: #0c4a6e; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">👁️ Observations</h3>
              ${reportData.observations.map((obs, i) => `
                <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 4px solid #0ea5e9;">
                  <p style="color: #0c4a6e; margin: 0 0 10px 0; font-weight: bold;">Observation #${i + 1}</p>
                  <p style="margin: 5px 0;"><strong>Type:</strong> ${escHtml(obs.type || 'N/A')}</p>
                  <p style="margin: 5px 0;"><strong>Time:</strong> ${escHtml(obs.time || 'N/A')}</p>
                  <p style="margin: 5px 0;"><strong>Comments:</strong> ${escHtml(obs.comments || 'None')}</p>
                </div>`).join('')}
            </div>` : ''}

            <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 2px solid ${escHtml(brand.primary_color)}; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
              <h3 style="color: ${escHtml(brand.primary_color)}; margin: 0 0 15px 0; font-size: 18px;">📍 Location &amp; Geofence</h3>
              <p style="margin: 5px 0; color: #1e293b;"><strong>GPS at submission:</strong> ${escHtml(locationStr)}</p>
              <p style="margin: 5px 0 15px 0; color: #1e293b;"><strong>Geofence:</strong> ${escHtml(distanceStr)}</p>
              ${googleMapsUrl ? `<div style="text-align: center;">
                <a href="${escHtml(googleMapsUrl)}" style="display: inline-block; background: ${escHtml(brand.primary_color)}; color: white; padding: 12px 25px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px;">📍 View on Google Maps</a>
              </div>` : ''}
            </div>

            ${media.length > 0 ? `
            <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
              <h3 style="color: #0c4a6e; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">📎 Evidence (${media.length})</h3>
              ${photosHtml}${videosHtml}${audiosHtml}
            </div>` : ''}

            ${reportData.signature ? `
            <div style="background: #ffffff; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 20px;">
              <h3 style="color: #0c4a6e; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">✍️ Digital Signature</h3>
              <div style="background: white; padding: 15px; border: 2px solid #e2e8f0; border-radius: 8px; text-align: center;">
                <img src="${escHtml(reportData.signature)}" alt="Signature" style="max-width: 300px; height: auto;" />
              </div>
            </div>` : ''}

          </div>`;
    const emailHtml = renderTransactionalShell({
      brand,
      title: 'Start of Shift Report',
      bodyHtml: emailBodyHtml,
      cta: { label: 'Open Report History', url: REPORT_LINK },
    });
    const emailSubject = `🛡️ Start of Shift Report — ${guardName} @ ${siteName} (${shiftDateStr})`;

    // ── Shared TELEGRAM text (branded, operational summary + evidence links) ──
    const telegramText = [
      `🛡️ ${brand.brand_name}`,
      `START OF SHIFT REPORT`,
      ``,
      `Officer: ${guardName}`,
      `Client: ${clientName}`,
      `Site: ${siteName}`,
      site && site.address ? `Address: ${site.address}` : null,
      `Shift date: ${shiftDateStr}`,
      `Scheduled start: ${scheduledStartStr}`,
      `Clock-in: ${clockInStr}`,
      `Submitted: ${submittedStr}`,
      `Location: ${locationStr}`,
      `Geofence: ${distanceStr}`,
      `Shift/Post: ${reportData.shift_post || 'N/A'}`,
      reportData.relieving_officer ? `Relieving officer: ${reportData.relieving_officer}` : null,
      reportData.additional_notes ? `Notes: ${String(reportData.additional_notes).slice(0, 300)}` : null,
      (reportData.observations || []).length ? `Observations: ${reportData.observations.length}` : null,
      photos.length ? `📷 Photo evidence: ${photos[0].url}${photos.length > 1 ? ` (+${photos.length - 1} more)` : ''}` : null,
      videos.length ? `🎬 Video evidence: ${videos[0].url}${videos.length > 1 ? ` (+${videos.length - 1} more)` : ''}` : null,
      ``,
      `Open the report history for the full evidence:`,
    ].filter(l => l !== null).join('\n');

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
            html: firstName ? emailHtml.replace('<h2 style="color: #0c4a6e; margin: 0 0 10px 0; font-size: 22px;">Officer: ', `<p style="color:#334155;font-size:15px;margin:0 0 10px;">Hello ${firstName},</p><h2 style="color: #0c4a6e; margin: 0 0 10px 0; font-size: 22px;">Officer: `) : emailHtml,
            text: `START OF SHIFT REPORT\n\nOfficer: ${guardName}\nClient: ${clientName}\nSite: ${siteName}\nShift date: ${shiftDateStr}\nScheduled start: ${scheduledStartStr}\nClock-in: ${clockInStr}\nSubmitted: ${submittedStr}\nLocation: ${locationStr}\nGeofence: ${distanceStr}\n\nFull report: ${REPORT_LINK}`,
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