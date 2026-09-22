/**
 * Shared AUDITED EMAIL dispatch for application-controlled correspondence.
 *
 * STANDARD (2026-09-22 final cleanup): every important application-controlled
 * email goes through this helper so every attempt is recorded in the
 * NotificationDelivery audit trail with:
 *   event_type, reference/event id, customer_id, recipient (id/name/address),
 *   branding source (customer / reseller / platform), channel = email,
 *   attempted + success/failure, timestamp and a SAFE failure reason.
 *
 * NEVER recorded here (by construction — these fields are simply not
 * accepted): authentication tokens, passwords, invitation tokens, full
 * sensitive message bodies or protected media contents. The provider
 * response is the truncated exception message only.
 *
 * Idempotency: when an idempotency_key (or event key + address) was already
 * SENT on the email channel, the send is skipped. Scheduled reruns MUST pass
 * a run-unique reference_id (e.g. `<id>:<date>`) so legitimate repeat reports
 * are never suppressed.
 */
import { resolveCommunicationBrand } from './brandedCommunication.ts';

function brandingSourceOf(brand: any): string {
  if (brand && brand.customer_id) return 'customer';
  if (brand && brand.reseller_id) return 'reseller';
  return 'platform';
}

export async function sendAuditedEmail(
  svc: any,
  p: {
    to: string;
    subject: string;
    body?: string;
    html?: string;
    text?: string;
    from_name?: string;
    brand?: any;
    customer_id?: string | null;
    reseller_id?: string | null;
    recipient_id?: string | null;
    recipient_name?: string | null;
    event_type: string;
    reference_id?: string | null;
    idempotency_key?: string | null;
  },
): Promise<{ ok: boolean; skipped?: boolean; error?: string | null }> {
  const to = String(p.to || '').trim();
  if (!to) return { ok: false, error: 'NO_EMAIL' };

  let brand = p.brand;
  if (!brand) {
    try {
      brand = await resolveCommunicationBrand(svc, {
        customer_id: p.customer_id || null, reseller_id: p.reseller_id || null });
    } catch (_) { brand = null; }
  }
  const eventKey = p.event_type + (p.reference_id ? ':' + String(p.reference_id) : '');
  const idemKey = p.idempotency_key || `${eventKey}:email:${to}`;

  // Idempotency — an identical key already SENT means this exact email went
  // out; skip. Reruns use fresh reference ids, so repeats are never lost.
  try {
    const prior = await svc.entities.NotificationDelivery
      .filter({ idempotency_key: idemKey, channel: 'email', status: 'sent' });
    if (prior && prior.length) return { ok: true, skipped: true };
  } catch (_) { /* audit store unavailable — proceed with the send */ }

  let ok = true;
  let provider: string | undefined;
  try {
    await svc.integrations.Core.SendEmail({
      from_name: p.from_name || (brand && brand.brand_name) || undefined,
      to,
      subject: p.subject,
      ...(p.html ? { html: p.html } : {}),
      ...(p.text ? { text: p.text } : {}),
      ...(p.body ? { body: p.body } : {}),
    });
  } catch (e: any) {
    ok = false;
    // SAFE failure reason only — truncated provider exception, no payload.
    provider = String(e?.message || e).slice(0, 300);
  }

  // Delivery audit — a failed audit write must never break the send path.
  try {
    await svc.entities.NotificationDelivery.create({
      event_key: eventKey,
      channel: 'email',
      status: ok ? 'sent' : 'failed',
      send_time: new Date().toISOString(),
      customer_id: (p.customer_id || (brand && brand.customer_id)) || undefined,
      reseller_id: (p.reseller_id || (brand && brand.reseller_id)) || undefined,
      recipient_id: p.recipient_id || undefined,
      recipient_name: p.recipient_name || undefined,
      recipient_address: to,
      provider_response: provider || undefined,
      idempotency_key: idemKey,
      event_type: p.event_type,
      reference_id: p.reference_id ? String(p.reference_id) : undefined,
      branding_source: brandingSourceOf(brand),
      retries: 0,
    });
  } catch (_) { /* audit write failure is non-fatal */ }

  return ok ? { ok: true } : { ok: false, error: provider || 'SEND_FAILED' };
}