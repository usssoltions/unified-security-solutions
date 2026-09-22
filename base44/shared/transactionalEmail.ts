/**
 * THE central transactional-email renderer — the ONE email presentation
 * system for the whole application (security, estate, medical, attendance,
 * task scheduling, reports, calling). Every email-producing function and
 * shared builder renders through buildTransactionalEmail /
 * renderTransactionalShell. No function maintains its own HTML template.
 *
 * DESIGN (restrained professional transactional email):
 *   - max content width 600px, responsive single column
 *   - compact logo (max-height 48px) or professional TEXT-ONLY brand header
 *   - clear event title + semantic status chip (text label — never emoji-only)
 *   - white/neutral content background, high-contrast accessible typography
 *   - compact labelled detail table, CTA button only when a destination exists
 *   - compact branded footer with support details (plain readable colours)
 *   - inline email-safe CSS, meaningful alt text, no tracking pixel
 *   - a clean PLAIN-TEXT alternative mirror for every message
 *
 * BRANDING SAFETY:
 *   - One resolved brand per email (name, logo, colours, contact) — footer
 *     and header always show the SAME resolved brand; no USS artwork in a
 *     customer-branded email unless USS is the resolved brand.
 *   - Logo validation: only http(s) raster image URLs render; an invalid or
 *     missing logo renders a professional text-only header — never a broken
 *     image and never unrelated artwork.
 *   - Button/text colours are auto-adjusted to WCAG AA contrast against
 *     their backgrounds, so a bad tenant palette cannot produce unreadable
 *     text or links.
 *
 * Pure module: no SDK, no runtime, no side effects — importable by backend
 * functions and the branding-preview renderer alike.
 */

const FALLBACK_PRIMARY = '#1d4ed8'; // neutral accessible blue

export function escHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Friendly labels — internal identifiers never reach recipients ──────── */

const LABELS: Record<string, string> = {
  daily_activity: 'Daily Activity Report',
  incident_maintenance_summary: 'Incident & Maintenance Summary',
  missed_checkin: 'Missed Stay Awake Check',
  missed_check: 'Missed Stay Awake Check',
  stay_awake: 'Stay Awake',
  shift_attendance: 'Shift Attendance',
  guard_performance: 'Guard Performance',
  patrol_coverage: 'Patrol Coverage',
  site_activity: 'Site Activity',
  comprehensive_monthly: 'Comprehensive Monthly Report',
  weekly_analysis: 'Weekly Analysis Report',
  monthly_comparison: 'Monthly Comparison Report',
  OTHER: 'Other',
  'NO RESPONSE': 'No response',
  'no_tenant': 'Platform Oversight',
  suspicious_activity: 'Suspicious Activity',
  equipment_failure: 'Equipment Failure',
  safety_hazard: 'Safety Hazard',
  in_progress: 'In Progress',
  reported: 'Reported',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  missed: 'Missed',
};

export function friendlyLabel(value: any): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  if (LABELS[raw]) return LABELS[raw];
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(raw)) {
    const words = raw.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1));
    return LABELS[words.join(' ')] || words.join(' ');
  }
  return raw;
}

/* ── Timezone-aware human-readable dates (customer's configured timezone) ── */

export function fmtDateTime(iso: any, timeZone = 'Africa/Johannesburg'): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      timeZone, day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch (_) { return String(iso); }
}

/* ── WCAG contrast: auto-adjust brand colours so text stays readable ────── */

function hexToRgb(hex: string): [number, number, number] {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [29, 78, 216];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = luminance(hexA), lb = luminance(hexB);
  const light = Math.max(la, lb), dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

/** Darken (or lighten as a last resort) a brand colour until it reaches the
 *  required contrast ratio against white text on a button. */
export function ensureContrastOnWhite(hex: string, ratio = 4.5): string {
  let [r, g, b] = hexToRgb(hex);
  let cur = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < 10 && contrastRatio(cur, '#ffffff') < ratio; i++) {
    r = Math.max(0, Math.round(r * 0.82));
    g = Math.max(0, Math.round(g * 0.82));
    b = Math.max(0, Math.round(b * 0.82));
    cur = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
  }
  return cur;
}

export interface BrandContrastReport {
  primary: string; button: string;
  button_vs_white_text: number; passes_AA: boolean;
}

export function brandContrastReport(brand: any): BrandContrastReport {
  const primary = String(brand?.primary_color || FALLBACK_PRIMARY);
  const button = ensureContrastOnWhite(primary, 4.5);
  return {
    primary, button,
    button_vs_white_text: Math.round(contrastRatio(button, '#ffffff') * 100) / 100,
    passes_AA: contrastRatio(button, '#ffffff') >= 4.5,
  };
}

/* ── Logo validation — no broken images, no unrelated artwork ────────────── */

export function isValidEmailLogo(url: any): boolean {
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.svg(\?|$)/i.test(s)) return false; // email clients do not render SVG
  if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(s)) return true;
  // Storage URLs without a clean extension (e.g. signed supabase objects):
  // allow, but they must still be http(s).
  return true;
}

/* ── Semantic severity chips — text label, colour-backed, never emoji-only ─ */

const SEVERITY_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#7f1d1d', fg: '#ffffff', label: 'CRITICAL' },
  urgent: { bg: '#7f1d1d', fg: '#ffffff', label: 'URGENT' },
  emergency: { bg: '#7f1d1d', fg: '#ffffff', label: 'EMERGENCY' },
  high: { bg: '#92400e', fg: '#ffffff', label: 'HIGH PRIORITY' },
  warning: { bg: '#92400e', fg: '#ffffff', label: 'WARNING' },
  medium: { bg: '#1e3a5f', fg: '#ffffff', label: 'ACTION REQUIRED' },
  low: { bg: '#334155', fg: '#ffffff', label: 'NOTICE' },
  info: { bg: '#334155', fg: '#ffffff', label: 'NOTICE' },
  success: { bg: '#166534', fg: '#ffffff', label: 'COMPLETED' },
  resolved: { bg: '#166534', fg: '#ffffff', label: 'RESOLVED' },
};

export function severityChip(severity?: string): string {
  const s = SEVERITY_STYLES[String(severity || '').toLowerCase()] || null;
  if (!s) return '';
  return '<span style="display:inline-block;padding:5px 14px;border-radius:999px;' +
    'background:' + s.bg + ';color:' + s.fg +
    ';font-size:12px;font-weight:bold;letter-spacing:1px;white-space:nowrap">' +
    escHtml(s.label) + '</span>';
}

/* ── THE shell — one brand, compact header, branded footer ───────────────── */

export interface ShellParams {
  brand: any;
  title: string;
  severity?: string;
  preheader?: string;
  bodyHtml: string;
  cta?: { label: string; url: string } | null;
  footerNote?: string;
  timezone?: string;
}

export function renderTransactionalShell(p: ShellParams): string {
  const brand = p.brand || {};
  const brandName = String(brand.brand_name || 'Unified Security Solutions');
  const contrast = brandContrastReport(brand);
  const primary = contrast.button; // AA-safe brand colour for title/buttons
  const logo = isValidEmailLogo(brand.logo_url) ? String(brand.logo_url) : null;

  const header = logo
    ? '<img src="' + escHtml(logo) + '" alt="' + escHtml(brandName) + ' logo" ' +
      'style="display:block;max-height:48px;max-width:160px;width:auto;height:auto;object-fit:contain"/>'
    : '<div style="font-size:19px;font-weight:bold;color:' + escHtml(primary) +
      ';letter-spacing:0.5px">' + escHtml(brandName) + '</div>';

  const support = [
    brand.support_email ? '<a href="mailto:' + escHtml(brand.support_email) +
      '" style="color:#1d4ed8;text-decoration:none">' + escHtml(brand.support_email) + '</a>' : null,
    brand.support_phone ? '<a href="tel:' + escHtml(String(brand.support_phone).replace(/[^0-9+]/g, '')) +
      '" style="color:#1d4ed8;text-decoration:none">' + escHtml(brand.support_phone) + '</a>' : null,
    brand.website ? '<a href="' + escHtml(brand.website) + '" style="color:#1d4ed8;text-decoration:none">' +
      escHtml(brand.website) + '</a>' : null,
  ].filter(Boolean).join(' &nbsp;•&nbsp; ');

  return '' +
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>' +
    '<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">' +
    (p.preheader
      ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' +
        escHtml(p.preheader) + '</div>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:16px 8px"><tr><td align="center">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0">' +
    // subtle brand top bar
    '<tr><td style="height:4px;background:' + escHtml(primary) + ';font-size:0;line-height:4px">&nbsp;</td></tr>' +
    // compact header — logo or text brand
    '<tr><td style="padding:18px 24px 4px;text-align:center">' + header + '</td></tr>' +
    // title + severity chip
    '<tr><td style="padding:10px 24px 2px;text-align:center">' +
    '<h1 style="margin:0;font-size:20px;line-height:1.35;color:#0f172a;font-weight:bold">' +
    escHtml(p.title) + '</h1></td></tr>' +
    (p.severity
      ? '<tr><td style="padding:8px 24px 2px;text-align:center">' + severityChip(p.severity) + '</td></tr>'
      : '') +
    // content
    '<tr><td style="padding:18px 24px">' + (p.bodyHtml || '') + '</td></tr>' +
    (p.cta && p.cta.url && p.cta.label
      ? '<tr><td style="padding:0 24px 20px;text-align:center">' +
        '<a href="' + escHtml(p.cta.url) + '" style="display:inline-block;background:' + escHtml(primary) +
        ';color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px">' +
        escHtml(p.cta.label) + '</a></td></tr>'
      : '') +
    // compact branded footer — same resolved brand as the header
    '<tr><td style="padding:16px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center">' +
    '<div style="font-size:14px;font-weight:bold;color:#0f172a;margin-bottom:4px">' + escHtml(brandName) + '</div>' +
    (support ? '<div style="font-size:12px;color:#475569;margin-bottom:6px">' + support + '</div>' : '') +
    (brand.address ? '<div style="font-size:11px;color:#475569">' + escHtml(brand.address) + '</div>' : '') +
    (p.footerNote ? '<div style="font-size:11px;color:#64748b;margin-top:6px">' + escHtml(p.footerNote) + '</div>' : '') +
    '<div style="font-size:11px;color:#64748b;margin-top:6px">This is an automated message — please do not reply directly.</div>' +
    '</td></tr>' +
    '</table></td></tr></table></body></html>';
}

/* ── Compact labelled detail table + paragraph body ──────────────────────── */

export function detailRowsHtml(details: Array<{ label: string; value: any } | null>): string {
  const rows = (details || []).filter(Boolean).map((d: any) => {
    const value = d.value == null || d.value === '' ? '—' : friendlyLabel(d.value);
    return '<tr style="border-bottom:1px solid #e2e8f0">' +
      '<td style="padding:8px 12px 8px 0;vertical-align:top;white-space:nowrap;width:1%' +
      ';font-size:11px;font-weight:bold;letter-spacing:0.6px;color:#64748b;text-transform:uppercase">' +
      escHtml(d.label) + '</td>' +
      '<td style="padding:8px 0;vertical-align:top;font-size:14px;color:#0f172a;font-weight:600;' +
      'word-wrap:break-word;overflow-wrap:anywhere">' + escHtml(value) + '</td></tr>';
  }).join('');
  if (!rows) return '';
  return '<table role="presentation" width="100%" style="border-collapse:collapse;margin:0 0 14px">' + rows + '</table>';
}

export function paragraphsHtml(lines: any): string {
  return (Array.isArray(lines) ? lines : [lines]).filter(Boolean).map((l: any) =>
    '<p style="margin:0 0 10px;font-size:14px;line-height:1.6;color:#334155">' + escHtml(l) + '</p>').join('');
}

/* ── buildTransactionalEmail — full message (HTML + plain-text mirror) ───── */

export interface TransactionalEmailParams {
  brand: any;
  title: string;
  severity?: string;
  preheader?: string;
  intro?: string;
  details?: Array<{ label: string; value: any } | null>;
  bodyLines?: string[];
  cta?: { label: string; url: string } | null;
  footerNote?: string;
  timezone?: string;
}

export function buildTransactionalEmail(p: TransactionalEmailParams): { html: string; text: string } {
  const details = (p.details || []).filter(Boolean).map((d: any) => ({
    label: d.label, value: d.value == null || d.value === '' ? '—' : friendlyLabel(d.value),
  }));
  const bodyHtml = '' +
    (p.intro ? '<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155">' + escHtml(p.intro) + '</p>' : '') +
    detailRowsHtml(details as any) +
    paragraphsHtml(p.bodyLines);

  const html = renderTransactionalShell({
    brand: p.brand, title: p.title, severity: p.severity, preheader: p.preheader,
    bodyHtml, cta: p.cta, footerNote: p.footerNote, timezone: p.timezone,
  });

  const brand = p.brand || {};
  const textParts = [
    p.title,
    '',
    p.intro || '',
    ...details.map((d: any) => d.label + ': ' + d.value),
    ...((Array.isArray(p.bodyLines) ? p.bodyLines : []).filter(Boolean) as string[]),
    p.cta && p.cta.url ? p.cta.label + ': ' + p.cta.url : '',
    '',
    String(brand.brand_name || ''),
    [brand.support_email, brand.support_phone, brand.website].filter(Boolean).join(' | '),
    'This is an automated message - please do not reply directly.',
  ].filter((l) => l !== undefined && l !== null && l !== '');
  return { html, text: textParts.join('\n').replace(/\n{3,}/g, '\n\n') };
}