/**
 * Shared branded HTML email template for USS Panic alerts.
 * Used by: activatePanic (initial), managePanic (escalation).
 * Matches the red/black USS branding used by Incident and Maintenance emails.
 */

export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface PanicEmailParams {
  userName: string;
  userRole?: string;
  badgeNumber?: string;
  siteName?: string;
  panicNumber: string;
  activatedAt: string;
  location?: { lat: number; lng: number } | null;
  gpsAccuracy?: number | null;
  notes?: string;
  status?: string;
  isEscalation?: boolean;
}

export function buildPanicEmail(params: PanicEmailParams): string {
  const {
    userName, userRole, badgeNumber, siteName, panicNumber,
    activatedAt, location, gpsAccuracy, notes, status, isEscalation
  } = params;

  const googleMapsUrl = location?.lat && location?.lng
    ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
    : null;

  const locationBlock = location?.lat && location?.lng
    ? `
      <div style="background-color: white; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
        <p style="margin: 5px 0; color: #374151; font-family: monospace; font-size: 14px;">
          <strong>GPS:</strong> ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}
        </p>
        <p style="margin: 5px 0; color: #6b7280; font-size: 12px;">
          Accuracy: ${gpsAccuracy ? `±${Math.round(gpsAccuracy)}m` : 'High-precision GPS'}
        </p>
      </div>
      <div style="text-align: center; margin: 20px 0;">
        <a href="${googleMapsUrl}" style="display: inline-block; background: linear-gradient(135deg, #C41E3A 0%, #991b1b 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 18px; box-shadow: 0 6px 12px rgba(196, 30, 58, 0.4);">
          📍 VIEW LOCATION — OPEN IN GOOGLE MAPS
        </a>
      </div>`
    : `
      <div style="background-color: #fef2f2; padding: 15px; border-radius: 8px; text-align: center; border: 1px dashed #dc2626;">
        <p style="margin: 0; color: #7f1d1d; font-size: 14px;">⚠️ Location not yet available — being captured</p>
      </div>`;

  const bannerText = isEscalation
    ? "🚨 PANIC ALERT — UNACKNOWLEDGED ESCALATION"
    : "🚨 PANIC ALERT — IMMEDIATE RESPONSE REQUIRED";

  const escalationNotice = isEscalation
    ? `
      <div style="background: linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%); padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
        <p style="color: #fef2f2; margin: 0; font-size: 14px; font-weight: bold;">
          ⚠️ THIS PANIC REMAINS UNACKNOWLEDGED — ESCALATING TO HIGHER AUTHORITY
        </p>
      </div>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f5f5f5;">
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; background-color: white;">
        <div style="background: linear-gradient(135deg, #C41E3A 0%, #1a1a1a 100%); padding: 24px 20px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 28px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">${esc(bannerText)}</h1>
          <p style="color: #fef2f2; margin: 10px 0 0 0; font-size: 16px; font-weight: bold;">Emergency activated at ${new Date(activatedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</p>
        </div>

        ${escalationNotice}

        <div style="padding: 30px;">
          <div style="background: linear-gradient(to right, #fee2e2, #fef2f2); padding: 25px; border-radius: 12px; border-left: 8px solid #C41E3A; margin-bottom: 25px;">
            <h2 style="color: #7f1d1d; margin: 0 0 20px 0; font-size: 20px; border-bottom: 2px solid #C41E3A; padding-bottom: 10px;">🆘 Emergency Details</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold; width: 120px;">👤 Person:</td>
                <td style="padding: 8px 0; color: #1f2937; font-size: 16px; font-weight: bold;">${esc(userName)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">🎭 Role:</td>
                <td style="padding: 8px 0; color: #1f2937;">${esc(userRole || 'N/A')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">🎫 Badge:</td>
                <td style="padding: 8px 0; color: #1f2937;">${esc(badgeNumber || 'N/A')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">🏢 Site:</td>
                <td style="padding: 8px 0; color: #1f2937;">${esc(siteName || 'Unknown')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">📋 Ref:</td>
                <td style="padding: 8px 0; color: #1f2937; font-family: monospace;">${esc(panicNumber)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">⏰ Time:</td>
                <td style="padding: 8px 0; color: #1f2937;">${new Date(activatedAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">📊 Status:</td>
                <td style="padding: 8px 0; color: #C41E3A; font-weight: bold;">${esc(status || 'ACTIVE')}</td>
              </tr>
              ${notes ? `
              <tr>
                <td colspan="2" style="padding: 15px 0 0 0;">
                  <div style="background-color: #fef2f2; padding: 12px; border-radius: 6px; border-left: 4px solid #C41E3A;">
                    <p style="margin: 0; color: #7f1d1d; font-weight: bold; font-size: 12px;">NOTES:</p>
                    <p style="margin: 5px 0 0 0; color: #1f2937;">${esc(notes)}</p>
                  </div>
                </td>
              </tr>` : ''}
            </table>
          </div>

          <div style="background: linear-gradient(to right, #fee2e2, #fef2f2); padding: 25px; border-radius: 12px; border-left: 8px solid #C41E3A; margin-bottom: 25px;">
            <h3 style="color: #7f1d1d; margin: 0 0 15px 0; font-size: 18px;">📍 Location</h3>
            ${locationBlock}
          </div>

          <div style="background: linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%); padding: 20px; border-radius: 12px; text-align: center;">
            <p style="color: white; font-weight: bold; margin: 0; font-size: 18px; text-transform: uppercase; letter-spacing: 1px;">⚠️ Critical Emergency</p>
            <p style="color: #fef2f2; margin: 10px 0 0 0; font-size: 14px;">Dispatch immediate response • Contact person • Verify situation</p>
          </div>
        </div>

        <div style="background-color: #1a1a1a; padding: 20px; text-align: center;">
          <p style="color: white; margin: 0; font-size: 14px; font-weight: bold;">Unified Security Solutions</p>
          <p style="color: #C41E3A; margin: 5px 0; font-size: 12px;">Professional Security Management • 24/7 Emergency Response</p>
        </div>
      </div>
    </body>
    </html>
  `;
}