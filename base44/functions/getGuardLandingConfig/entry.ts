import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { entitlementIsActiveNow } from '../../shared/entitlementActive.ts';

/**
 * getGuardLandingConfig — authoritative, CALLER-SCOPED resolution of the
 * guard default landing module + the caller's own module entitlements.
 *
 * Why this exists: the Access Control-only shell and guard landing previously
 * read the Customer record (and ModuleEntitlement records) DIRECTLY from the
 * client. Those reads are RLS-gated on {{user.data.customer_id}}, which the
 * platform resolves from the session token — and guard session tokens do not
 * carry custom User fields (empirically verified: see diagnoseResellerRls and
 * the comment in AuthContext). On real guard devices those reads therefore
 * silently returned nothing, so guards fell back to the generic Guard UI
 * (My Shift + notification prompt + bottom tabs) instead of the customer's
 * Access Control-only shell — while the builder preview (platform admin) worked.
 *
 * Security posture (NOT broadened): the tenant scope is derived SERVER-SIDE
 * from the authenticated caller — never from a client-supplied id — and the
 * response contains ONLY the caller's own tenant's landing flag and licensed
 * module keys. No other customer data, no PII, no new permissions. This is the
 * same server-side tenant resolution pattern as getWhiteLabelBranding.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) {
      return Response.json({ resolved: false, guard_default_landing: null, access_control_enabled: false, module_keys: [] }, { status: 401 });
    }

    const out = {
      resolved: false,
      guard_default_landing: null,
      access_control_enabled: false,
      module_keys: [],
      customer_id: caller.customer_id || null,
      role_type: caller.role_type || null,
    };
    // Platform admins / legacy unscoped accounts: nothing tenant-scoped to
    // resolve — the client keeps its existing (non-guard) behaviour.
    if (!caller.customer_id) return Response.json(out);

    const service = base44.asServiceRole;
    try {
      const customer = await service.entities.Customer.get(caller.customer_id);
      if (customer) {
        out.resolved = true;
        out.guard_default_landing = customer.guard_default_landing || null;
      }
    } catch (_) { /* landing stays null → client keeps existing behaviour */ }
    try {
      // ONE central entitlement-validity implementation (enabled + active
      // status + licence_start/licence_end window) — same rule every gateway.
      const ents = await service.entities.ModuleEntitlement.filter({ customer_id: caller.customer_id, enabled: true });
      out.module_keys = (ents || [])
        .filter((e) => entitlementIsActiveNow(e))
        .map((e) => e.module_key);
      out.access_control_enabled = out.module_keys.includes('ACCESS');
    } catch (_) { /* entitlements stay empty → client fail-closed */ }

    return Response.json(out);
  } catch (error) {
    return Response.json({ resolved: false, error: String((error as any)?.message || error) }, { status: 500 });
  }
}