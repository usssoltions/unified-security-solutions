/**
 * resolveTenantCaller — SHARED server-side caller resolution for
 * tenant-scoped gateways (getTenantUsers, siteAccess, and future gateways).
 *
 * WHY: session claims for custom User fields (role_type / admin_level /
 * customer_id / reseller_id) can be stale or incomplete — a long-lived
 * token minted before the user's tenant scope was applied resolves as
 * "no tenant", and the gateway then returns a silently-wrong scoped list
 * (the platform-wide empty-selector defect). The authenticated User RECORD
 * is the authoritative source of scope, so this helper always re-reads it
 * with the service role and lets the record win for every field it carries.
 *
 * It never broadens permissions: the record defines exactly what the
 * gateway is allowed to resolve for that caller, exactly as before.
 */
export async function resolveTenantCaller(base44: any): Promise<any | null> {
  const token = await base44.auth.me();
  if (!token) return null;

  let record: any = null;
  try {
    const rows = await base44.asServiceRole.entities.User.filter({ id: token.id });
    record = (rows && rows[0]) || null;
  } catch (_) {
    record = null;
  }
  if (!record) return token; // fail-safe: token-only resolution, as before

  // DB record wins for every field it actually carries; session-only
  // fields (token metadata) survive untouched.
  const merged: any = { ...token };
  for (const [k, v] of Object.entries(record)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}