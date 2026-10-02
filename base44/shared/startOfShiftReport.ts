/**
 * startOfShiftReport — THE production Start of Shift report builder.
 *
 * Single source of truth for the Start of Shift email/Telegram rendering:
 *  - sendStartOfShiftNotification (the live dispatch path) renders through
 *    this builder, and
 *  - the Report & Notification Showcase renders the SAME builder with demo
 *    data + the DEMONSTRATION labels (inert; never dispatches).
 *
 * The operational content (officer, shift & clock-in, start-of-shift details,
 * observations, location & geofence, evidence, signature) is composed here
 * exactly as production; only the demo labelling (preheader/footerNote) is
 * supplied by the showcase caller.
 */
import {
  escHtml,
  formatSastDate, formatSastTime, formatSastDateTime,
} from './brandedCommunication.ts';
import { renderTransactionalShell } from './transactionalEmail.ts';

/** Distance between two lat/lng points, in whole metres. */
export function haversineMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}

export interface StartOfShiftEmailFacts {
  brand: any;
  siteName: string;
  site?: any | null;                 // Site record (address used when present)
  guardName: string;
  badgeNumber?: string | null;
  clientName: string;
  shift?: any | null;                // Shift record (start_time, clock_in)
  reportData?: any;                  // shift_post, special_instructions, post_items_received,
                                     // relieving_officer, additional_notes, observations[], signature
  location?: any | null;             // guard GPS at submission
  media?: any[];                     // [{ type: 'photo' | 'video' | 'audio', url }]
  submittedAt: string;               // ISO instant
  distanceMetres?: number | null;
  withinFence?: boolean | null;
  geofenceRadius?: number | null;
  siteGpsValid?: boolean;
  reportLink: string;                // CTA link (StartOfShiftHistory)
  firstName?: string | null;         // per-recipient greeting (live path)
  preheader?: string | null;         // demo labelling only
  footerNote?: string | null;        // demo labelling only
}

/**
 * Builds the complete Start of Shift report email (transactional shell +
 * operational body), the plain-text version, the subject and the Telegram
 * text. Byte-identical to the pre-extraction production output; the optional
 * preheader/footerNote/demo labels are additive demo adaptations.
 */
export function buildStartOfShiftReportEmail(facts: StartOfShiftEmailFacts) {
  const brand = facts.brand;
  const site = facts.site || null;
  const guardName = facts.guardName;
  const clientName = facts.clientName;
  const reportData = facts.reportData || {};
  const media = facts.media || [];
  const submittedAt = facts.submittedAt;

  const scheduledStart = (facts.shift && facts.shift.start_time) || null;
  const clockIn = (facts.shift && facts.shift.clock_in) || null;
  const shiftDateStr = scheduledStart ? formatSastDate(scheduledStart) : formatSastDate(submittedAt);
  const scheduledStartStr = scheduledStart ? formatSastTime(scheduledStart) : '—';
  const clockInStr = (clockIn && clockIn.timestamp) ? formatSastDateTime(clockIn.timestamp) : '—';
  const submittedStr = formatSastDateTime(submittedAt);
  const guardGps = (facts.location && Number.isFinite(facts.location.lat) && Number.isFinite(facts.location.lng)) ? facts.location : null;
  const locationStr = guardGps ? `${guardGps.lat}, ${guardGps.lng}` : 'Not captured';
  const distanceStr = facts.distanceMetres != null
    ? `${facts.distanceMetres} m from site${facts.geofenceRadius ? ' (geofence radius ' + facts.geofenceRadius + ' m)' : ''}` +
      (facts.withinFence === true ? ' — WITHIN GEOFENCE' : facts.withinFence === false ? ' — OUTSIDE GEOFENCE' : '')
    : (facts.siteGpsValid ? 'Guard GPS not captured' : 'Site GPS not configured');
  const googleMapsUrl = guardGps ? `https://www.google.com/maps?q=${guardGps.lat},${guardGps.lng}` : null;

  const photos = (media || []).filter((m: any) => m && m.type === 'photo' && m.url);
  const videos = (media || []).filter((m: any) => m && m.type === 'video' && m.url);
  const audios = (media || []).filter((m: any) => m && m.type === 'audio' && m.url);

  const photosHtml = photos.map((m: any) => `
      <div style="margin: 10px 0;">
        <img src="${escHtml(m.url)}" alt="Photo evidence" style="max-width: 100%; height: auto; border-radius: 8px; border: 2px solid #e2e8f0;" />
      </div>`).join('');
  const videosHtml = videos.map((m: any) => `
      <div style="margin: 10px 0;">
        <video controls style="max-width: 100%; border-radius: 8px; border: 2px solid #e2e8f0;">
          <source src="${escHtml(m.url)}" type="video/mp4">
        </video>
        <p style="text-align: center; margin: 5px 0;"><a href="${escHtml(m.url)}" target="_blank" style="color: #0ea5e9;">📹 Open Video</a></p>
      </div>`).join('');
  const audiosHtml = audios.map((m: any) => `
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
            <p style="color: #64748b; margin: 5px 0; font-size: 14px;">📍 <strong>Site:</strong> ${escHtml(facts.siteName)}</p>
            ${site && site.address ? `<p style="color: #64748b; margin: 5px 0; font-size: 14px;">🗺️ <strong>Address:</strong> ${escHtml(site.address)}</p>` : ''}
            <p style="color: #64748b; margin: 5px 0; font-size: 14px;">📅 <strong>Shift date:</strong> ${escHtml(shiftDateStr)}</p>
            ${facts.badgeNumber ? `<p style="color: #64748b; margin: 5px 0; font-size: 14px;">🪪 <strong>Badge:</strong> ${escHtml(facts.badgeNumber)}</p>` : ''}
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
              ${reportData.observations.map((obs: any, i: number) => `
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
    cta: { label: 'Open Report History', url: facts.reportLink },
    ...(facts.preheader ? { preheader: facts.preheader } : {}),
    ...(facts.footerNote ? { footerNote: facts.footerNote } : {}),
  });
  // Per-recipient greeting — injected in exactly the same position as the
  // original live-path implementation (before the Officer heading).
  const GREETING_H2 = '<h2 style="color: #0c4a6e; margin: 0 0 10px 0; font-size: 22px;">Officer: ';
  const withGreeting = facts.firstName
    ? emailHtml.replace(GREETING_H2, `<p style="color:#334155;font-size:15px;margin:0 0 10px;">Hello ${escHtml(facts.firstName)},</p>` + GREETING_H2)
    : emailHtml;

  const subject = `🛡️ Start of Shift Report — ${guardName} @ ${facts.siteName} (${shiftDateStr})`;
  const text = `START OF SHIFT REPORT\n\nOfficer: ${guardName}\nClient: ${clientName}\nSite: ${facts.siteName}\nShift date: ${shiftDateStr}\nScheduled start: ${scheduledStartStr}\nClock-in: ${clockInStr}\nSubmitted: ${submittedStr}\nLocation: ${locationStr}\nGeofence: ${distanceStr}\n\nFull report: ${facts.reportLink}`;

  const telegramText = [
    `🛡️ ${brand.brand_name}`,
    `START OF SHIFT REPORT`,
    ``,
    `Officer: ${guardName}`,
    `Client: ${clientName}`,
    `Site: ${facts.siteName}`,
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
  ].filter((l: any) => l !== null).join('\n');

  return { emailHtml: withGreeting, subject, text, telegramText, facts: { locationStr, distanceStr, shiftDateStr, submittedStr, clockInStr, googleMapsUrl } };
}