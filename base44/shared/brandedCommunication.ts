/**
 * SHARED PLATFORM SERVICE — authoritative communication brand resolution and
 * the ONE shared branded renderer for outgoing tenant communications (email,
 * Telegram). Every automatic tenant-related email/Telegram message in every
 * module resolves its brand through resolveCommunicationBrand and renders
 * through buildBrandedEmail / buildBrandedTelegram — no per-module templates,
 * no hard-coded tenant identities.
 *
 * BRANDING HIERARCHY (strict order):
 *   1. Customer branding, if configured (app_name/name, logo_url, colours,
 *      email, phone, website, address)
 *   2. Reseller branding, filling any field the Customer does not define
 *      (app_name/name, logo_url, colours, support_email/support_phone,
 *      website, address)
 *   3. USS platform defaults (Unified Security Solutions identity)
 *
 * TENANT SAFETY: brand context is resolved SERVER-SIDE from the authoritative
 * Customer/Reseller records — never from frontend input. When tenant
 * ownership cannot be determined, the resolver falls back to the PLATFORM
 * brand only — never to another customer's brand (fail-closed branding).
 *
 * DYNAMIC BY DESIGN: no hard-coded customer lists, no duplicated templates
 * per customer, no deployment needed for a new/re-branded reseller or
 * customer. The cache below lives only for the lifetime of one function
 * invocation (fresh isolate per call), so branding changes take effect on
 * the very next communication.
 */

const PLATFORM_LOGO_URL =
  'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690fd37d10984f1f26cedab8/e4c38b0ba_ubsnew.png';

export const PLATFORM_COMMUNICATION_BRAND: any = {
  brand_name: 'Unified Security Solutions',
  logo_url: PLATFORM_LOGO_URL,
  primary_color: '#C41E3A',
  accent_color: '#1a1a1a',
  support_email: null,
  support_phone: null,
  website: null,
  address: null,
};

export function escHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── Human-readable SAST date/time (operational timezone) ─────────────── */

export function formatSastDateTime(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
  } catch (_) {
    return String(iso);
  }
}

export function formatSastDate(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-ZA', {
      timeZone: 'Africa/Johannesburg', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch (_) {
    return String(iso);
  }
}

export function formatSastTime(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-ZA', {
      timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit',
    });
  } catch (_) {
    return String(iso);
  }
}

/* ── Brand resolution (Customer → Reseller → USS platform) ────────────── */

const brandCache = new Map<string, any>();

function pick(...vals: any[]) {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

export async function resolveCommunicationBrand(
  svc: any,
  opts: { customer_id?: string | null; reseller_id?: string | null } = {},
): Promise<any> {
  const customerId = opts.customer_id || null;
  const resellerIdIn = opts.reseller_id || null;
  const cacheKey = String(customerId) + '|' + String(resellerIdIn);
  if (brandCache.has(cacheKey)) return brandCache.get(cacheKey);

  let customer: any = null;
  let reseller: any = null;
  if (customerId) {
    try {
      const rows = await svc.entities.Customer.filter({ id: String(customerId) });
      customer = (rows && rows[0]) || null;
    } catch (_) { /* resolution failure falls back safely below */ }
  }
  const resellerId = (customer && customer.reseller_id) || resellerIdIn;
  if (resellerId) {
    try {
      const rows = await svc.entities.Reseller.filter({ id: String(resellerId) });
      reseller = (rows && rows[0]) || null;
    } catch (_) { /* resolution failure falls back safely below */ }
  }

  const brand: any = {
    brand_name: pick(customer?.app_name, customer?.name, reseller?.app_name, reseller?.name,
      PLATFORM_COMMUNICATION_BRAND.brand_name),
    logo_url: pick(customer?.logo_url, reseller?.logo_url, PLATFORM_COMMUNICATION_BRAND.logo_url),
    primary_color: pick(customer?.primary_color, reseller?.primary_color,
      PLATFORM_COMMUNICATION_BRAND.primary_color),
    accent_color: pick(customer?.accent_color, reseller?.accent_color,
      PLATFORM_COMMUNICATION_BRAND.accent_color),
    support_email: pick(customer?.email, reseller?.support_email),
    support_phone: pick(customer?.phone, reseller?.support_phone),
    website: pick(customer?.website, reseller?.website),
    address: pick(customer?.address, reseller?.address),
    customer_name: (customer && customer.name) || null,
    reseller_name: (reseller && reseller.name) || null,
    customer_id: (customer && customer.id) || customerId,
    reseller_id: resellerId,
  };
  brandCache.set(cacheKey, brand);
  return brand;
}

/* ── ONE shared branded EMAIL renderer ─────────────────────────────────── */

export function buildBrandedEmail(p: {
  brand: any;
  heading: string;
  greeting?: string;
  intro?: string;
  details?: Array<{ label: string; value: string } | null>;
  closing?: string;
  ctaUrl?: string;
  ctaLabel?: string;
}): { html: string; text: string } {
  const brand = p.brand || PLATFORM_COMMUNICATION_BRAND;
  const primary = escHtml(brand.primary_color || PLATFORM_COMMUNICATION_BRAND.primary_color);
  const accent = escHtml(brand.accent_color || PLATFORM_COMMUNICATION_BRAND.accent_color);
  const brandName = escHtml(brand.brand_name || PLATFORM_COMMUNICATION_BRAND.brand_name);
  const logo = brand.logo_url || null;

  const details = (p.details || []).filter(Boolean) as Array<{ label: string; value: string }>;
  const detailRows = details
    .map((d) => `<tr>
        <td style="padding:8px 0;color:#64748b;font-weight:bold;width:130px;font-size:14px;">${escHtml(d.label)}</td>
        <td style="padding:8px 0;color:#1e293b;font-size:15px;">${escHtml(String(d.value ?? ''))}</td>
      </tr>`)
    .join('');

  const footerContact = [
    brand.support_email ? escHtml(String(brand.support_email)) : null,
    brand.support_phone ? escHtml(String(brand.support_phone)) : null,
    brand.website ? escHtml(String(brand.website)) : null,
  ].filter(Boolean).join(' &bull; ');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:650px;margin:0 auto;background:#ffffff;">
    <div style="background:linear-gradient(135deg,${primary} 0%,${accent} 100%);padding:32px 24px;text-align:center;">
      ${logo ? `<img src="${escHtml(String(logo))}" alt="${brandName}" style="max-width:180px;height:auto;margin-bottom:14px;border-radius:10px;"/>` : ''}
      <h1 style="color:#ffffff;margin:0;font-size:24px;">${escHtml(p.heading)}</h1>
    </div>
    <div style="padding:28px;">
      ${p.greeting ? `<p style="color:#334155;font-size:15px;margin:0 0 14px;">${escHtml(p.greeting)}</p>` : ''}
      ${p.intro ? `<p style="color:#334155;font-size:15px;line-height:1.6;margin:0 0 18px;">${escHtml(p.intro)}</p>` : ''}
      ${details.length ? `<div style="background:#f8f9fa;border-left:4px solid ${primary};border-radius:8px;padding:18px 22px;margin-bottom:18px;">
        <table style="width:100%;border-collapse:collapse;">${detailRows}</table>
      </div>` : ''}
      ${p.closing ? `<p style="color:#475569;font-size:14px;line-height:1.6;margin:0 0 18px;">${escHtml(p.closing)}</p>` : ''}
      ${p.ctaUrl && p.ctaLabel ? `<div style="text-align:center;margin:20px 0;">
        <a href="${escHtml(p.ctaUrl)}" style="display:inline-block;background:${primary};color:#ffffff;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px;text-decoration:none;">${escHtml(p.ctaLabel)}</a>
      </div>` : ''}
    </div>
    <div style="background:${accent};padding:20px 24px;text-align:center;">
      <p style="color:#ffffff;margin:0;font-size:14px;font-weight:bold;">${brandName}</p>
      ${footerContact ? `<p style="color:#94a3b8;margin:6px 0 0;font-size:12px;">${footerContact}</p>` : ''}
      <p style="color:#64748b;margin:8px 0 0;font-size:11px;">This is an automated message — please do not reply directly.</p>
    </div>
  </div>
</body>
</html>`;

  const textLines = [
    p.heading,
    '',
    p.greeting || '',
    p.intro || '',
    ...details.map((d) => `${d.label}: ${d.value}`),
    p.closing || '',
    p.ctaUrl && p.ctaLabel ? `${p.ctaLabel}: ${p.ctaUrl}` : '',
    '',
    brand.brand_name || PLATFORM_COMMUNICATION_BRAND.brand_name,
    footerContact,
  ].filter((l) => l !== '');
  const text = textLines.join('\n');
  return { html, text };
}

/* ── ONE shared branded TELEGRAM renderer ──────────────────────────────── */

export function buildBrandedTelegram(p: {
  brand: any;
  heading: string;
  greeting?: string;
  details?: Array<{ label: string; value: string } | null>;
  closing?: string;
}): string {
  const brand = p.brand || PLATFORM_COMMUNICATION_BRAND;
  const brandName = brand.brand_name || PLATFORM_COMMUNICATION_BRAND.brand_name;
  const details = (p.details || []).filter(Boolean) as Array<{ label: string; value: string }>;
  const footer = [brand.website, brand.support_email].filter(Boolean).join(' | ');
  return [
    `🛡️ ${brandName}`,
    p.heading,
    '',
    p.greeting || '',
    ...details.map((d) => `${d.label}: ${d.value}`),
    '',
    p.closing || '',
    footer,
  ].filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== '')).join('\n');
}