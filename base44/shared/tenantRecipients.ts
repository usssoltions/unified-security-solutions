/**
 * tenantRecipients — SHARED per-tenant ADDITIONAL EMAIL RECIPIENT resolution.
 *
 * The "Additional Email Recipients" list configured by a tenant administrator
 * in Reporting → Automated Report Settings is stored ON the tenant's OWN
 * AutomationSetting row (additional_email_recipients) and changed ONLY through
 * the automationAccess gateway (server-resolved tenant, admin-only writes,
 * audit-logged). Every email sender that calls in here adds these addresses as
 * EMAIL-ONLY recipients of the SAME tenant's notifications — in-app, native
 * push, Telegram and WhatsApp channels are never sent to them, and one
 * customer's list can never reach another customer's notifications because
 * the list is resolved from the notification's OWN tenant row (fail-closed:
 * unresolvable tenant → no additional recipients).
 */
import { tenantAutomationSettings } from './automationSettings.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_ADDITIONAL_EMAILS = 25;
export const ADDITIONAL_RECIPIENT_NAME = 'Additional recipient (configured)';

/** Validates + normalises a saved list. Returns null when ANY entry is not a
 *  valid email address (fail closed — the caller refuses the save). */
export function normalizeAdditionalEmails(input: any): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const e = String(item ?? '').trim();
    if (!e) continue;
    if (!EMAIL_RE.test(e) || e.length > 254) return null;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= MAX_ADDITIONAL_EMAILS) break;
  }
  return out;
}

/** Emails resolved from an ALREADY-LOADED effective settings object (used by
 *  scheduled sweeps that process many tenants in one run). */
export function additionalEmailsFromSettings(settings: Record<string, any> | null | undefined): string[] {
  if (!settings) return [];
  return normalizeAdditionalEmails(settings.additional_email_recipients) || [];
}

/** Emails resolved for ONE tenant (single small settings lookup, per send). */
export async function additionalEmailsFor(
  svc: any,
  customerId: string | null | undefined,
): Promise<string[]> {
  try {
    const { settings } = await tenantAutomationSettings(svc, customerId ?? null);
    return additionalEmailsFromSettings(settings);
  } catch (_) {
    return [];
  }
}