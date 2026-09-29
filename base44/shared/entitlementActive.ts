/**
 * Central, AUTHORITATIVE entitlement validity helper — shared by every module
 * gateway so there is exactly ONE implementation of "is this licence valid
 * right now?" (never slightly different rules per page/function).
 *
 * A licence is valid only when ALL of the following hold:
 *   - enabled flag is true
 *   - status is active (or absent on legacy records) — suspended/expired/
 *     pending/disabled entitlements NEVER grant access
 *   - licence_start, when set, is NOT in the future (a future licence does
 *     not grant access before its start)
 *   - licence_end, when set, is NOT in the past (an expired licence does not
 *     grant access after its end)
 *
 * Tenant correctness (the entitlement belongs to the caller's customer/
 * reseller) is enforced by the CALLER, which must query the entitlements by
 * the SERVER-RESOLVED customer id — never by a browser-supplied one.
 */

export function entitlementIsActiveNow(ent: any): boolean {
  if (!ent || ent.enabled !== true) return false;
  if (ent.status && ent.status !== 'active') return false;
  const now = Date.now();
  if (ent.licence_start) {
    const t = Date.parse(ent.licence_start);
    if (!isNaN(t) && t > now) return false;
  }
  if (ent.licence_end) {
    const t = Date.parse(ent.licence_end);
    if (!isNaN(t) && t < now) return false;
  }
  return true;
}

/**
 * True when the given customer currently holds an ACTIVE, in-window licence
 * for ANY of the given module keys. Resolves entitlements server-side from
 * the customer id (which gateways resolve from the authenticated caller).
 */
export async function customerModuleLicensed(svc: any, customerId: string | null, moduleKeys: string[]): Promise<boolean> {
  if (!customerId || !moduleKeys || !moduleKeys.length) return false;
  const ents = await svc.entities.ModuleEntitlement.filter({ customer_id: customerId }).catch(() => []);
  return (ents || []).some((e) => moduleKeys.indexOf(e.module_key) !== -1 && entitlementIsActiveNow(e));
}