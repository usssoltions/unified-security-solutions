/**
 * Shared AUDITED + GUARDED EMAIL dispatch — the ONLY path by which
 * application-controlled email leaves the system. Every email-producing
 * function sends through sendAuditedEmail; direct Core.SendEmail calls
 * elsewhere are prohibited (they bypass the delivery guard).
 *
 * DELIVERY SAFETY MODE (primary guard — server-controlled, never
 * browser-supplied, never inferred from record names alone):
 *   DELIVERY_MODE secret — STRICTLY one of 'production' | 'test' | 'preview'.
 *     - production: normal delivery, except synthetic/audit/test records
 *       (is_test_record flag, or AUDIT-/TEST-/FIXTURE- reference ids) FAIL
 *       CLOSED and are never delivered to real recipients.
 *     - test: EVERY recipient is rewritten server-side to the TEST_MAILBOX
 *       allowlist and every subject starts with '[TEST]'. No CC, BCC,
 *       escalation, retry or secondary workflow can bypass the rewrite —
 *       they all pass through this function.
 *     - preview: renders but never sends (audited as skipped).
 *   Any other value (including a missing secret) blocks delivery entirely
 *   (fail closed, audited as BLOCKED_INVALID_DELIVERY_MODE).
 *
 * AUDIT: every attempt is recorded in NotificationDelivery with event_type,
 * reference id, tenant ids, intended recipient, EFFECTIVE recipient, delivery
 * mode, template name, branding source, status and a SAFE failure reason.
 * Never recorded: tokens, passwords, invitation links, message bodies.
 *
 * Idempotency: keyed on the INTENDED recipient (test-mode rewriting never
 * collapses two different intended recipients into one suppression).
 */
import { secrets } from 'base44:runtime';
import { resolveCommunicationBrand } from './brandedCommunication.ts';

const VALID_MODES = ['production', 'test', 'preview'];

function brandingSourceOf(brand: any): string {
  if (brand && brand.customer_id) return 'customer';
  if (brand && brand.reseller_id) return 'reseller';
  return 'platform';
}

function isSyntheticReference(...vals: any[]): boolean {
  return vals.some((v) => /\b(AUDIT|TEST|FIXTURE|SAMPLE|DEMO)[-_]/i.test(String(v || '')));
}

export function currentDeliveryMode(): string | null {
  const mode = String(secrets?.DELIVERY_MODE || '').trim().toLowerCase();
  return VALID_MODES.includes(mode) ? mode : null;
}

export function testMailboxAllowlist(): string[] {
  return String(secrets?.TEST_MAILBOX || '')
    .split(',')
    .map((s: string) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** PURE delivery guard — deterministic, unit-testable, no side effects. */
export function applyDeliveryGuard(p: {
  mode: string | null;
  testMailboxes: string[];
  to: string;
  subject: string;
  isTestRecord?: boolean;
  referenceId?: string | null;
  eventKey?: string | null;
}): { deliver: boolean; to: string; subject: string; reason: string | null; mode: string | null } {
  const mode = p.mode;
  const to = String(p.to || '').trim();
  const subject = String(p.subject || '');
  const synthetic = !!p.isTestRecord ||
    isSyntheticReference(p.referenceId, p.eventKey, subject.replace(/^\[TEST\]\s*/i, ''));

  if (!mode) return { deliver: false, to, subject, reason: 'BLOCKED_INVALID_DELIVERY_MODE', mode: null };

  if (mode === 'preview') {
    return { deliver: false, to, subject, reason: 'PREVIEW_MODE', mode };
  }
  if (mode === 'test') {
    const mailbox = p.testMailboxes[0];
    if (!mailbox) {
      return { deliver: false, to, subject, reason: 'TEST_MODE_NO_ALLOWLISTED_MAILBOX', mode };
    }
    const prefixed = /^\[TEST\]/i.test(subject) ? subject : `[TEST] ${subject}`;
    return { deliver: !!to, to: mailbox, subject: prefixed, reason: null, mode };
  }
  // production
  if (synthetic) {
    return { deliver: false, to, subject, reason: 'TEST_RECORD_BLOCKED_IN_PRODUCTION', mode };
  }
  return { deliver: !!to, to, subject, reason: null, mode };
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
    template_name?: string | null;
    is_test_record?: boolean;
  },
): Promise<{ ok: boolean; skipped?: boolean; error?: string | null; mode?: string | null }> {
  const intendedTo = String(p.to || '').trim();
  if (!intendedTo) return { ok: false, error: 'NO_EMAIL' };

  let brand = p.brand;
  if (!brand) {
    try {
      brand = await resolveCommunicationBrand(svc, {
        customer_id: p.customer_id || null, reseller_id: p.reseller_id || null });
    } catch (_) { brand = null; }
  }
  const eventKey = p.event_type + (p.reference_id ? ':' + String(p.reference_id) : '');
  // Idempotency key is computed from the INTENDED recipient — test-mode
  // rewriting can never collapse distinct intended recipients together.
  const idemKey = p.idempotency_key || `${eventKey}:email:${intendedTo}`;

  // ── DELIVERY GUARD — the primary, server-controlled protection ──────────
  const guard = applyDeliveryGuard({
    mode: currentDeliveryMode(),
    testMailboxes: testMailboxAllowlist(),
    to: intendedTo,
    subject: p.subject,
    isTestRecord: p.is_test_record,
    referenceId: p.reference_id,
    eventKey,
  });

  const auditBase: any = {
    event_key: eventKey,
    channel: 'email',
    send_time: new Date().toISOString(),
    customer_id: (p.customer_id || (brand && brand.customer_id)) || undefined,
    reseller_id: (p.reseller_id || (brand && brand.reseller_id)) || undefined,
    recipient_id: p.recipient_id || undefined,
    recipient_name: p.recipient_name || undefined,
    idempotency_key: idemKey,
    event_type: p.event_type,
    reference_id: p.reference_id ? String(p.reference_id) : undefined,
    branding_source: brandingSourceOf(brand),
    template_name: p.template_name || undefined,
    delivery_mode: guard.mode || undefined,
    intended_recipient_address: intendedTo !== guard.to ? intendedTo : undefined,
    retries: 0,
  };

  if (!guard.deliver) {
    // Fail closed — a skipped/blocked attempt is truthfully audited.
    try {
      await svc.entities.NotificationDelivery.create({
        ...auditBase, status: 'skipped',
        recipient_address: guard.to || intendedTo,
        skip_reason: guard.reason || 'BLOCKED',
      });
    } catch (_) { /* audit write failure is non-fatal */ }
    return { ok: false, skipped: true, error: guard.reason || 'BLOCKED', mode: guard.mode };
  }

  // Idempotency — an identical key already SENT means this exact email went
  // out; skip. Reruns use fresh reference ids, so repeats are never lost.
  try {
    const prior = await svc.entities.NotificationDelivery
      .filter({ idempotency_key: idemKey, channel: 'email', status: 'sent' });
    if (prior && prior.length) return { ok: true, skipped: true, mode: guard.mode };
  } catch (_) { /* audit store unavailable — proceed with the send */ }

  let ok = true;
  let provider: string | undefined;
  try {
    await svc.integrations.Core.SendEmail({
      from_name: p.from_name || (brand && brand.brand_name) || undefined,
      to: guard.to, // the GUARDED recipient (rewritten in test mode)
      subject: guard.subject, // '[TEST] ' prefixed in test mode
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
      ...auditBase,
      status: ok ? 'sent' : 'failed',
      recipient_address: guard.to, // the EFFECTIVE recipient actually sent to
      provider_response: provider || undefined,
    });
  } catch (_) { /* audit write failure is non-fatal */ }

  return ok ? { ok: true, mode: guard.mode } : { ok: false, error: provider || 'SEND_FAILED', mode: guard.mode };
}