/**
 * Panic/emergency alert email — WRAPPER ONLY around the ONE central
 * transactional renderer (base44/shared/transactionalEmail.ts). The legacy
 * hard-coded red/black hero template (gradient banner, emoji-only severity,
 * 28px headline, no plain-text mirror) is retired. Semantic emergency
 * severity remains (chip: CRITICAL/EMERGENCY) but the tenant identity is
 * never overridden: header, footer, logo and contact details come from the
 * caller-resolved authoritative brand (customer → reseller → platform).
 *
 * Used by: activatePanic (activation + escalation), managePanic (lifecycle
 * resolve/cancel). While the remaining direct-send callers are migrated to
 * the guarded audited sender, the LEGACY string-returning API
 * (buildPanicEmail / buildPanicEmailAsync / esc) is preserved verbatim so
 * deployed callers keep rendering correctly; the *Full variants expose the
 * HTML + plain-text pair the central renderer produces.
 */
import { buildTransactionalEmail, friendlyLabel, fmtDateTime, escHtml } from './transactionalEmail.ts';
import { resolveCommunicationBrand } from './brandedCommunication.ts';

export function esc(s: string): string {
  return escHtml(s);
}

export interface PanicEmailParams {
  userName: string;
  userRole?: string;
  badgeNumber?: string;
  siteName?: string;
  customerName?: string;
  /** Resolved tenant brand (customer → reseller → platform). */
  brand?: any;
  /** Legacy brand-name-only fallback when no full brand is available. */
  brandName?: string;
  panicNumber: string;
  activatedAt: string;
  location?: { lat: number; lng: number } | null;
  gpsAccuracy?: number | null;
  notes?: string;
  status?: string;
  isEscalation?: boolean;
  lifecycleAction?: 'resolve' | 'cancel';
  responderName?: string;
  lifecycleAt?: string;
}

function panicContent(p: PanicEmailParams) {
  const brand = p.brand || {
    brand_name: p.brandName || 'Unified Security Solutions',
    primary_color: '#b91c1c',
  };

  const title = p.lifecycleAction === 'resolve'
    ? 'Panic Alert Resolved — Emergency Closed'
    : p.lifecycleAction === 'cancel'
    ? 'Panic Alert Cancelled — Emergency Withdrawn'
    : p.isEscalation
    ? 'Unacknowledged Panic Alert — Escalation'
    : 'Panic Alert — Immediate Response Required';

  const severity = p.lifecycleAction === 'resolve'
    ? 'resolved'
    : p.lifecycleAction === 'cancel'
    ? 'info'
    : p.isEscalation
    ? 'emergency'
    : 'critical';

  const intro = p.lifecycleAction === 'resolve'
    ? `The panic alert ${p.panicNumber} has been resolved${p.responderName ? ' by ' + p.responderName : ''}.`
    : p.lifecycleAction === 'cancel'
    ? `The panic alert ${p.panicNumber} was withdrawn by the sender. No response is required.`
    : p.isEscalation
    ? `Panic alert ${p.panicNumber} remains UNACKNOWLEDGED and has been escalated to higher authority. Immediate response is required.`
    : `A panic alert has been activated by ${p.userName || 'a staff member'}. Immediate response is required.`;

  const hasLocation = p.location && p.location.lat != null && p.location.lng != null;
  const mapsUrl = hasLocation
    ? `https://www.google.com/maps?q=${p.location!.lat},${p.location!.lng}` : null;

  const details = [
    { label: 'Panic Number', value: p.panicNumber },
    { label: 'Person', value: p.userName || '—' },
    p.userRole ? { label: 'Role', value: friendlyLabel(p.userRole) } : null,
    p.badgeNumber ? { label: 'Badge', value: p.badgeNumber } : null,
    p.siteName ? { label: 'Site', value: p.siteName } : null,
    p.customerName ? { label: 'Customer', value: p.customerName } : null,
    { label: 'Activated', value: fmtDateTime(p.activatedAt) },
    p.status ? { label: 'Status', value: friendlyLabel(p.status) } : null,
    p.lifecycleAt ? { label: 'Closed', value: fmtDateTime(p.lifecycleAt) } : null,
    p.responderName && p.lifecycleAction === 'resolve'
      ? { label: 'Resolved By', value: p.responderName } : null,
    hasLocation ? { label: 'GPS', value: `${p.location!.lat.toFixed(6)}, ${p.location!.lng.toFixed(6)}` } : null,
    hasLocation && p.gpsAccuracy ? { label: 'GPS Accuracy', value: '±' + Math.round(p.gpsAccuracy) + 'm' } : null,
    p.notes ? { label: 'Notes', value: p.notes } : null,
  ].filter(Boolean);

  return buildTransactionalEmail({
    brand,
    title,
    severity,
    preheader: title,
    intro,
    details,
    bodyLines: [
      !hasLocation && !p.lifecycleAction
        ? 'Location is being captured — see the live panic queue for updates.' : null,
    ],
    cta: hasLocation ? { label: 'View Location in Google Maps', url: mapsUrl! } : null,
  });
}

/** HTML + plain-text pair from the central renderer. */
export function buildPanicEmailFull(params: PanicEmailParams): { html: string; text: string } {
  return panicContent(params);
}

/** LEGACY contract (returns the rendered HTML string) — kept until every
 *  caller is migrated to sendAuditedEmail + buildPanicEmailFull. */
export function buildPanicEmail(params: PanicEmailParams): string {
  return panicContent(params).html;
}

/** Resolves the authoritative tenant brand server-side, then renders. */
export async function buildPanicEmailAsyncFull(
  svc: any,
  opts: PanicEmailParams & { customer_id?: string | null; reseller_id?: string | null },
): Promise<{ html: string; text: string }> {
  let brand = opts.brand || null;
  if (!brand) {
    try {
      brand = await resolveCommunicationBrand(svc, {
        customer_id: opts.customer_id || null, reseller_id: opts.reseller_id || null });
    } catch (_) { brand = null; }
  }
  return panicContent({ ...opts, brand: brand || undefined });
}

/** LEGACY contract (returns the rendered HTML string) — kept until every
 *  caller is migrated to sendAuditedEmail + buildPanicEmailAsyncFull. */
export async function buildPanicEmailAsync(
  svc: any,
  opts: PanicEmailParams & { customer_id?: string | null; reseller_id?: string | null },
): Promise<string> {
  return (await buildPanicEmailAsyncFull(svc, opts)).html;
}