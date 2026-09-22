import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';
import { resolveShiftReportRecipients } from '../../shared/shiftReportRecipients.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';
import {
  resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram, escHtml,
  formatSastDate, formatSastTime, formatSastDateTime,
} from '../../shared/brandedCommunication.ts';

/**
 * END OF SHIFT (SHIFT HANDOVER) REPORT NOTIFICATION — full proof-of-duty
 * parity with the Start of Shift report: In-App + Email + Telegram + native
 * push to the handover's OWN customer's operational management, branded
 * through the ONE shared resolver (Customer → Reseller → USS platform).
 *
 * The complete available evidence travels in ONE notification:
 *   customer branding, guard, incoming guard, site, shift date, scheduled
 *   end, actual clock-out (+ verified flag), submission timestamp, GPS +
 *   Google Maps link, geofence-relevant distance where computable, site
 *   status checklist answers, key activities, incidents reported during the
 *   shift, maintenance issues, outstanding tasks, weather, notes, photos and
 *   video links, and signature timestamps.
 *
 * Recipients: modern role resolution (customer_admin / control_room_operator
 * join the legacy management roles) + CONTROL ROOM narrowing — an operator
 * receives the report only when assigned to an ACTIVE Control Room covering
 * the shift's site. The outgoing guard is excluded (they authored the report).
 * Every channel is failure-isolated; deterministic event keys dedupe retries.
 * The manual WhatsApp deep-link workflow is NOT touched by this function.
 */
// Recipient resolution (modern roles + tenant scope + CONTROL ROOM
// narrowing) is shared with the Start of Shift report path — see
// shared/shiftReportRecipients.ts.

Deno.serve(async (req) => {
  const diag = { event: 'end_of_shift_report', tenant: null, recipients: [], in_app: 0, email: 0, telegram: 0, push: 0, failures: [] };
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { handover_id } = await req.json().catch(() => ({}));
    if (!handover_id) return Response.json({ error: 'handover_id is required' }, { status: 400 });

    // ── AUTHORITATIVE RECORD — the ShiftHandover owns the facts ──────────
    let handover = null;
    try {
      const rows = await base44.asServiceRole.entities.ShiftHandover.filter({ id: String(handover_id) });
      handover = (rows && rows[0]) || null;
    } catch (e) { diag.failures.push('handover_resolve:' + String(e?.message || e)); }
    if (!handover) return Response.json({ error: 'Handover report not found' }, { status: 404 });

    // CALLER-TENANT VALIDATION — a caller may only dispatch End of Shift
    // correspondence for a handover belonging to their OWN tenant (platform
    // admins excepted). Without this, a cross-tenant handover_id would let a
    // foreign user trigger another tenant's notifications from the service
    // role.
    const isPlatformCaller = user.role_type === 'admin' || user.role_type === 'platform_admin'
      || user.admin_level === 'platform';
    if (!isPlatformCaller && handover.customer_id && user.customer_id
        && String(handover.customer_id) !== String(user.customer_id)) {
      return Response.json({ error: 'Handover report not found' }, { status: 404 });
    }

    const tenantCustomerId = handover.customer_id || user.customer_id || null;
    const tenantResellerId = handover.reseller_id || user.reseller_id || null;
    diag.tenant = { customer_id: tenantCustomerId, reseller_id: tenantResellerId };

    // SHIFT — scheduled end + actual clock-out evidence.
    let shift = null;
    if (handover.shift_id) {
      try {
        const rows = await base44.asServiceRole.entities.Shift.filter({ id: String(handover.shift_id) });
        shift = (rows && rows[0]) || null;
      } catch (e) { diag.failures.push('shift_resolve:' + String(e?.message || e)); }
    }
    // SITE — for name/GPS context.
    const siteId = (shift && shift.site_id) || handover.site_id || null;
    let site = null;
    if (siteId) {
      try {
        const rows = await base44.asServiceRole.entities.Site.filter({ id: String(siteId) });
        site = (rows && rows[0]) || null;
      } catch (e) { diag.failures.push('site_resolve:' + String(e?.message || e)); }
    }

    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: tenantCustomerId, reseller_id: tenantResellerId });

    // ── Evidence facts ────────────────────────────────────────────────────
    const guardName = handover.outgoing_guard_name || user.display_name || user.full_name || 'Guard';
    const incomingName = handover.incoming_guard_name || 'Not yet assigned';
    const siteName = handover.site_name || (site && site.name) || 'Unknown';
    const scheduledEnd = (shift && shift.end_time) || null;
    const clockOut = (shift && shift.clock_out) || null;
    const submittedAt = handover.handover_time || handover.signed_at || new Date().toISOString();
    const clockOutGps = (clockOut && clockOut.location && Number.isFinite(clockOut.location.lat) && Number.isFinite(clockOut.location.lng))
      ? clockOut.location : null;
    const mapsUrl = clockOutGps ? `https://www.google.com/maps?q=${clockOutGps.lat},${clockOutGps.lng}` : null;

    const ss = handover.site_status || {};
    const checklist = [
      `All secure: ${ss.all_secure === true ? 'YES' : 'NO'}`,
      `Gates locked: ${ss.gates_locked === true ? 'YES' : ss.gates_locked === false ? 'NO' : '—'}`,
      `Alarms armed: ${ss.alarms_armed === true ? 'YES' : ss.alarms_armed === false ? 'NO' : '—'}`,
      `Lights functional: ${ss.lights_functional === true ? 'YES' : ss.lights_functional === false ? 'NO' : '—'}`,
      `Cameras operational: ${ss.cameras_operational === true ? 'YES' : ss.cameras_operational === false ? 'NO' : '—'}`,
      `Perimeter secure: ${ss.perimeter_secure === true ? 'YES' : ss.perimeter_secure === false ? 'NO' : '—'}`,
    ].join(' | ');

    const incidents = (handover.incidents_during_shift || []).filter(Boolean);
    const maintenance = (handover.maintenance_issues || []).filter(Boolean);
    const activities = (handover.key_activities || []).filter(Boolean);
    const outstanding = (handover.outstanding_tasks || []).filter(Boolean);
    const media = (handover.media_attachments || []).filter((m) => m && m.url);
    const photos = media.filter((m) => m.type === 'photo');
    const videos = media.filter((m) => m.type === 'video');
    const audios = media.filter((m) => m.type === 'audio');

    const eventKey = 'eos_report:' + handover.id;
    const heading = `🏁 End of Shift — ${guardName} @ ${siteName}`;
    const message = `${guardName} submitted the End of Shift (handover) report for ${siteName}` +
      `${clockOut && clockOut.timestamp ? ` — clocked out ${formatSastDateTime(clockOut.timestamp)}` : ''}.` +
      `${incidents.length ? ` ${incidents.length} incident(s) during shift.` : ''}`;

    const details = [
      { label: 'Guard', value: guardName },
      { label: 'Incoming Guard', value: incomingName },
      { label: 'Site', value: siteName },
      { label: 'Shift Date', value: formatSastDate(scheduledEnd || submittedAt) },
      { label: 'Scheduled End', value: scheduledEnd ? formatSastTime(scheduledEnd) : '—' },
      { label: 'Actual Clock-Out', value: (clockOut && clockOut.timestamp) ? `${formatSastDateTime(clockOut.timestamp)}${clockOut.verified === true ? ' (verified)' : ''}` : 'Not clocked out yet' },
      { label: 'Report Submitted', value: formatSastDateTime(submittedAt) },
      { label: 'GPS', value: clockOutGps ? `${clockOutGps.lat}, ${clockOutGps.lng}` : 'Not captured' },
      { label: 'Site Status', value: checklist },
      { label: 'Incidents During Shift', value: incidents.length ? incidents.map((i) => i.summary || i.incident_id).join('; ') : 'None reported' },
      { label: 'Maintenance Issues', value: maintenance.length ? maintenance.map((m) => m.issue).join('; ') : 'None reported' },
      { label: 'Key Activities', value: activities.length ? activities.join('; ') : '—' },
      { label: 'Outstanding Tasks', value: outstanding.length ? outstanding.map((t) => `${t.task}${t.priority ? ' (' + t.priority + ')' : ''}`).join('; ') : 'None' },
      { label: 'Weather', value: handover.weather_conditions || '—' },
      { label: 'Evidence', value: [photos.length ? `${photos.length} photo(s)` : null, videos.length ? `${videos.length} video(s)` : null, audios.length ? `${audios.length} audio(s)` : null].filter(Boolean).join(', ') || 'None captured' },
    ].filter(Boolean);

    // ── SHARED recipient resolution (Start-of-Shift parity) ──────────────
    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = await resolveShiftReportRecipients(base44.asServiceRole, allUsers, {
      customer_id: tenantCustomerId, site_id: siteId, exclude_id: handover.outgoing_guard_id });
    diag.recipients = recipients.map((r) => r.id);
    if (!recipients.length) diag.failures.push('no_recipients_resolved');

    // ── Shared rich EMAIL body (branded, full evidence incl. photos) ─────
    const photosHtml = photos.map((m) => `
      <div style="margin: 10px 0;">
        <img src="${escHtml(m.url)}" alt="Photo evidence" style="max-width: 100%; height: auto; border-radius: 8px; border: 2px solid #e2e8f0;" />
      </div>`).join('');
    const mediaLinks = [
      videos.length ? `<p style="font-size:13px;color:#334155;">Video evidence: ${videos.map((m) => `<a href="${escHtml(m.url)}">view</a>`).join(' &bull; ')}</p>` : '',
      audios.length ? `<p style="font-size:13px;color:#334155;">Audio evidence: ${audios.map((m) => `<a href="${escHtml(m.url)}">listen</a>`).join(' &bull; ')}</p>` : '',
    ].join('');
    const mapsHtml = mapsUrl ? `<p style="font-size:13px;color:#334155;"><a href="${escHtml(mapsUrl)}">Clock-out GPS location on Google Maps</a></p>` : '';

    // Rich body = branded template with the photo/video/GPS evidence
    // embedded after the structured details (closing is rendered verbatim).
    const closingHtml = [
      handover.special_instructions ? `<p style="font-size:13px;color:#334155;"><b>Special instructions:</b> ${escHtml(handover.special_instructions)}</p>` : '',
      handover.notes ? `<p style="font-size:13px;color:#334155;"><b>Notes:</b> ${escHtml(handover.notes)}</p>` : '',
      photosHtml, mediaLinks, mapsHtml,
    ].join('');
    const brandTpl = buildBrandedEmail({
      brand,
      heading,
      greeting: 'Hello,',
      intro: `${guardName} submitted the End of Shift (handover) report for ${siteName}. The complete proof-of-duty evidence is below.`,
      details,
      closing: closingHtml,
    });
    const richHtml = brandTpl.html;
    const telegramText = buildBrandedTelegram({
      brand,
      heading,
      details,
      closing: mapsUrl ? `GPS: ${mapsUrl}` : 'Review the full report in the app.',
    });

    for (const r of recipients) {
      // IN-APP
      await base44.asServiceRole.entities.Notification.create({
        recipient_id: r.id,
        recipient_name: r.display_name || r.full_name,
        type: 'shift_handover',
        priority: incidents.length ? 'high' : 'normal',
        title: heading, message, read: false,
        related_entity: 'ShiftHandover', related_id: handover.id,
        action_url: '/StartOfShiftHistory',
        sent_via: ['in_app', 'email', 'telegram', 'push'],
        customer_id: tenantCustomerId || undefined,
        reseller_id: tenantResellerId || undefined,
      }).catch(() => {}) && diag.in_app++;

      // EMAIL (branded + evidence)
      if (r.email) {
        await sendAuditedEmail(base44.asServiceRole, {
          to: r.email, subject: heading, html: richHtml, text: brandTpl.text,
          brand,
          recipient_id: r.id || undefined,
          recipient_name: r.display_name || r.full_name || undefined,
          event_type: 'shift_handover', template_name: 'shift_handover',
        }).catch(() => { diag.failures.push('email:' + r.id); }) && diag.email++;
      }

      // TELEGRAM
      if (r.telegram_connected && r.telegram_notifications_enabled !== false && r.telegram_chat_id) {
        await sendTaskTelegramDeduped(base44.asServiceRole, secrets, eventKey,
          r.telegram_chat_id, telegramText).then(() => { diag.telegram++; }, () => { diag.failures.push('telegram:' + r.id); });
      }

      // NATIVE PUSH
      await sendNativePush(base44.asServiceRole, {
        user_id: r.id, title: heading, body: message,
        priority: incidents.length ? 'high' : 'normal',
        action_label: 'Open Report', action_url: '/StartOfShiftHistory',
        event_key: eventKey,
        customer_id: tenantCustomerId || null, reseller_id: tenantResellerId || null,
      }).then(() => { diag.push++; }, () => { diag.failures.push('push:' + r.id); });
    }

    return Response.json({ success: true, ...diag });
  } catch (error) {
    diag.failures.push('fatal:' + String(error?.message || error));
    return Response.json({ error: error?.message || 'End of Shift notification failed', ...diag }, { status: 500 });
  }
});