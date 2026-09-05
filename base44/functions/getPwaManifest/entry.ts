import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/**
 * getPwaManifest — PUBLIC (unauthenticated), customer-specific PWA install
 * manifest. Serves RAW manifest JSON (application/manifest+json, never
 * wrapped in {data:...}) because Chrome fetches the manifest URL directly,
 * without an app session.
 *
 *   GET /functions/getPwaManifest?slug=<pwa_slug>
 *
 * COSMETIC ONLY: the returned branding never grants tenant access.
 * Authentication and server-side tenant scoping remain authoritative — a
 * user visiting ?brand=<slug> of a customer they don't belong to sees at
 * most this public cosmetic shell, never that customer's data.
 *
 * Public-safe data ONLY (no internal customer ids, users, emails, roles,
 * membership, licensing or settings):
 *   - PWA app name / short name (with Customer → Reseller → Platform fallbacks)
 *   - PWA icon / logo URLs
 *   - theme colour (customer primary) and background colour
 *
 * Fallbacks:
 *   - missing/invalid slug          → generic USS Platform manifest
 *   - unknown slug or inactive customer → generic USS Platform manifest
 *     (never leaks whether a customer exists)
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

const PLATFORM_NAME = 'USS Platform';
const PLATFORM_SHORT_NAME = 'USS';
const PLATFORM_THEME = '#0ea5e9';
const PLATFORM_BACKGROUND = '#09111D';
// Generic platform icon (public asset).
const PLATFORM_ICON = 'https://media.base44.com/images/public/690fd37d10984f1f26cedab8/1f03ecb8e_generated_image.png';

const MANIFEST_HEADERS = {
  'Content-Type': 'application/manifest+json',
  'Cache-Control': 'public, max-age=300',
};

function genericManifest(): Response {
  const manifest = {
    id: '/',
    name: PLATFORM_NAME,
    short_name: PLATFORM_SHORT_NAME,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: PLATFORM_THEME,
    background_color: PLATFORM_BACKGROUND,
    icons: [
      { src: PLATFORM_ICON, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: PLATFORM_ICON, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
  return new Response(JSON.stringify(manifest), { status: 200, headers: MANIFEST_HEADERS });
}

// Practical Android/Chrome launcher limit for short names.
function deriveShortName(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || PLATFORM_SHORT_NAME;
  return first.slice(0, 12) || PLATFORM_SHORT_NAME;
}

function validHex(v: any): string | null {
  return typeof v === 'string' && HEX_RE.test(v) ? v : null;
}

export default async function(req: Request): Promise<Response> {
  try {
    // Slug from the query string (Chrome manifest fetch); body fallback is
    // only for direct testing — manifest requests carry no body.
    let slug = '';
    try {
      slug = (new URL(req.url).searchParams.get('slug') || '').toLowerCase().trim();
    } catch (_) {
      slug = '';
    }
    if (!slug) {
      const body: any = await req.json().catch(() => ({} as any));
      slug = String(body?.slug || '').toLowerCase().trim();
    }
    if (!slug || !SLUG_RE.test(slug)) return genericManifest();

    const base44 = createClientFromRequest(req);
    const customers = await base44.asServiceRole.entities.Customer
      .filter({ pwa_slug: slug }, 'created_date', 5)
      .catch(() => []);
    const customer: any = (customers || [])[0];

    // Unknown slug, or suspended/inactive customer: generic fallback —
    // an inactive customer's manifest must not keep advertising an active
    // install experience, and no customer existence information is leaked.
    if (!customer || customer.status !== 'active') return genericManifest();

    // Standard branding hierarchy fallbacks: Customer → Reseller → Platform.
    let reseller: any = null;
    if (customer.reseller_id) {
      reseller = await base44.asServiceRole.entities.Reseller
        .get(customer.reseller_id)
        .catch(() => null);
    }

    const name = String(
      customer.pwa_app_name || customer.app_name || reseller?.app_name ||
      customer.name || PLATFORM_NAME
    ).trim();
    const shortName = String(customer.pwa_short_name || deriveShortName(name)).trim();
    const theme = validHex(customer.primary_color) ||
      validHex(reseller?.primary_color) || PLATFORM_THEME;
    const background = validHex(customer.pwa_background_color) || PLATFORM_BACKGROUND;
    const icon192 = customer.pwa_icon_192_url || customer.pwa_icon_512_url ||
      customer.logo_url || reseller?.logo_url || PLATFORM_ICON;
    const icon512 = customer.pwa_icon_512_url || customer.logo_url ||
      reseller?.logo_url || PLATFORM_ICON;

    const manifest = {
      id: `/?brand=${slug}`,
      name,
      short_name: shortName,
      start_url: `/?brand=${slug}`,
      scope: '/',
      display: 'standalone',
      theme_color: theme,
      background_color: background,
      icons: [
        { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    };
    return new Response(JSON.stringify(manifest), { status: 200, headers: MANIFEST_HEADERS });
  } catch (error: any) {
    // Never break installability: serve the generic platform manifest.
    return genericManifest();
  }
}