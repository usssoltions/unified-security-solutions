/**
 * Task Scheduling — THE ONE shared branded email template.
 *
 * Every Task Scheduling email (assigned, reassigned, reminder, reason
 * required, completed, completed late, completion report, reopened, and any
 * future module notification) renders through renderTaskEmail() — a single,
 * tenant-branded, mobile-responsive HTML shell. Branding is resolved by the
 * caller via resolveTenantBrand (customer → reseller → platform default) and
 * passed in; nothing here is per-tenant hardcoded.
 *
 * Mobile-first design constraints (emails are primarily read on phones):
 *   - max-width 600px container, everything stacks vertically
 *   - font sizes 13px+ body / 11-12px labels+footer (never smaller)
 *   - summary cards use inline-block + min-width so they wrap on narrow screens
 *   - CTA button 14px 28px padding (touch friendly), 15px bold label
 *   - long values wrap (word-wrap/overflow-wrap, no nowrap on values)
 *   - logo scales (max-height 56px, max-width 180px, object-fit contain)
 *   - light surfaces only — stays readable in both light and dark clients
 *
 * Pure functions: no SDK access, no side effects.
 */

const DEFAULT_PRIMARY = '#0ea5e9';

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

/** Coloured pill badge — COMPLETED ON TIME / COMPLETED LATE / OVERDUE / ... */
export function statusBadge(text, kind) {
  const palette = {
    success: ['#dcfce7', '#166534', '#86efac'],
    warning: ['#fef3c7', '#92400e', '#fcd34d'],
    danger: ['#fee2e2', '#991b1b', '#fecaca'],
    info: ['#e0f2fe', '#075985', '#7dd3fc'],
    neutral: ['#f1f5f9', '#334155', '#cbd5e1'],
  };
  const c = palette[kind] || palette.info;
  return '<span style="display:inline-block;padding:4px 12px;border-radius:999px;background:' + c[0] +
    ';color:' + c[1] + ';border:1px solid ' + c[2] +
    ';font-size:12px;font-weight:bold;letter-spacing:0.5px;white-space:nowrap">' + escHtml(text) + '</span>';
}

/** Label/value rows — labels nowrap, values wrap (mobile safe). */
export function infoTable(rows) {
  const trs = (rows || []).map((kv) =>
    '<tr>' +
    '<td style="padding:6px 12px 6px 0;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap;width:1%">' + escHtml(kv[0]) + '</td>' +
    '<td style="padding:6px 0;color:#0f172a;font-size:13px;font-weight:600;word-wrap:break-word;overflow-wrap:anywhere">' + escHtml(kv[1]) + '</td>' +
    '</tr>').join('');
  return '<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 16px">' + trs + '</table>';
}

/** White card with a coloured left accent — task / sign-off / summary sections. */
export function sectionCard(innerHtml, accent) {
  return '<div style="border:1px solid #e2e8f0;border-left:4px solid ' + (accent || '#cbd5e1') +
    ';border-radius:8px;padding:14px 16px;margin:0 0 12px;background:#ffffff">' + innerHtml + '</div>';
}

/** Small uppercase card heading (TASK / SIGN-OFF 1 / LATE REASON). */
export function cardLabel(text, color) {
  return '<p style="margin:0 0 6px;color:' + (color || '#64748b') +
    ';font-size:11px;font-weight:bold;letter-spacing:0.8px;text-transform:uppercase">' + escHtml(text) + '</p>';
}

/** One "Label: Value" line inside a card (value wraps). */
export function cardLine(label, value) {
  return '<p style="margin:0 0 4px;font-size:13px;color:#334155"><span style="color:#64748b">' + escHtml(label) +
    ':</span> <b style="color:#0f172a">' + escHtml(value) + '</b></p>';
}

/** Summary stat cards — inline-block + min-width so they wrap/stack on phones. */
export function summaryCards(cards) {
  const items = (cards || []).map((c) =>
    '<div style="display:inline-block;vertical-align:top;width:30%;min-width:150px;max-width:180px;margin:0 8px 8px 0;' +
    'border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;text-align:center">' +
    '<div style="font-size:22px;font-weight:bold;color:' + (c.color || '#0f172a') + '">' + escHtml(c.value) + '</div>' +
    '<div style="font-size:11px;color:#64748b;margin-top:2px">' + escHtml(c.label) + '</div>' +
    '</div>').join('');
  return '<div style="margin:0 0 16px">' + items + '</div>';
}

/** THE shared Task Scheduling email shell — logo, heading, badge, body, CTA,
 * branded footer with support contact. All module emails use only this. */
export function renderTaskEmail({ brand, brandName, heading, badgeHtml, introHtml, bodyHtml, ctaLabel, ctaUrl, footerNote }) {
  const primary = (brand && brand.primary_color) || DEFAULT_PRIMARY;
  const support = [];
  if (brand && brand.support_email) support.push(escHtml(brand.support_email));
  if (brand && brand.website) support.push(escHtml(brand.website));
  return ''
    + '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff">'
    + ((brand && brand.logo_url)
      ? '<div style="padding:20px;text-align:center;background:#f8fafc"><img src="' + escHtml(brand.logo_url) + '" alt="' + escHtml(brandName || '') + '" style="max-height:56px;max-width:180px;object-fit:contain"/></div>'
      : '')
    + '<div style="padding:24px 20px">'
    + '<h2 style="color:' + escHtml(primary) + ';margin:0 0 10px;font-size:20px">' + escHtml(heading) + '</h2>'
    + (badgeHtml ? '<div style="margin:0 0 14px">' + badgeHtml + '</div>' : '')
    + (introHtml || '')
    + (bodyHtml || '')
    + ((ctaLabel && ctaUrl)
      ? '<a href="' + escHtml(ctaUrl) + '" style="background:' + escHtml(primary) + ';color:#ffffff;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold;font-size:15px">' + escHtml(ctaLabel) + '</a>'
      : '')
    + '</div>'
    + '<div style="padding:16px 20px;background:#f8fafc;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0">'
    + (brandName ? '<div style="margin-bottom:4px">' + escHtml(brandName) + '</div>' : '')
    + (support.length ? '<div>Questions? Contact ' + support.join(' · ') + '.</div>' : '')
    + (footerNote ? '<div>' + escHtml(footerNote) + '</div>' : '')
    + '</div>'
    + '</div>';
}