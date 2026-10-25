/**
 * tenantGateway — SHARED building blocks for tenant-scoped backend access
 * gateways (estateAccess, medicalAccess, siteAccess, attendanceAccess, ...).
 *
 * These helpers implement the three controls every gateway must enforce:
 *   1. Role resolution  — from the authoritative User record (record wins
 *      over session claims), never from client input.
 *   2. Tenant scope     — platform / reseller / customer modes; client-supplied
 *      tenant ids are validated, never trusted.
 *   3. Module licence   — fail-closed ModuleEntitlement /
 *      ResellerEntitlement checks at API level (not just UI).
 *
 * Plus the common data helpers every gateway uses: tenant query building,
 * manage-scope checks, record lookup and the platform audit log.
 */

/** JSON error response shorthand. */
export function gwErr(message: string, status: number = 400): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Resolve the platform/reseller admin flags from the authoritative caller.
 * Operational role flags (manager / therapist / resident / vendor / ...) are
 * gateway-specific and stay in each gateway.
 */
export function resolveAdminRoles(caller: any) {
  const isPlatform = caller.role === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
  const isReseller = !isPlatform && (caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller');
  return { isPlatform, isReseller };
}

/**
 * Resolve the caller's tenant scope. Returns { scope } on success (scope may
 * be null when the caller has no tenant attachment — the gateway decides
 * whether that is fatal or handled by a role-specific branch) or
 * { error: Response } when a client-supplied tenant id fails validation.
 */
export async function resolveCustomerScope(svc: any, caller: any, p: any, isPlatform: boolean, isReseller: boolean) {
  if (isPlatform) {
    return { scope: { mode: 'platform', customer_id: (p && p.customer_id) || null, reseller_id: (p && p.reseller_id) || null } };
  }
  if (isReseller) {
    const scope: any = { mode: 'reseller', customer_id: caller.customer_id || null, reseller_id: caller.reseller_id };
    if (p && p.customer_id && p.customer_id !== scope.customer_id) {
      const cust = await svc.entities.Customer.get(String(p.customer_id)).catch(() => null);
      if (!cust || cust.reseller_id !== scope.reseller_id) {
        return { error: gwErr('Forbidden', 403) };
      }
      scope.customer_id = String(p.customer_id);
    }
    return { scope };
  }
  if (caller.customer_id) {
    if (p && p.customer_id && p.customer_id !== caller.customer_id) {
      return { error: gwErr('Forbidden', 403) };
    }
    return { scope: { mode: 'customer', customer_id: caller.customer_id, reseller_id: caller.reseller_id || null } };
  }
  return { scope: null };
}

/**
 * Fail-closed module licence check (API level). Customer scope requires an
 * active ModuleEntitlement; a customer-less reseller scope requires an active
 * ResellerEntitlement; anything else is unlicensed.
 */
export async function checkModuleLicense(svc: any, isPlatform: boolean, scope: any, moduleKey: string) {
  if (isPlatform) return { licensed: true, reason: null };
  if (scope && scope.customer_id) {
    const ents = await svc.entities.ModuleEntitlement.filter({ customer_id: scope.customer_id, module_key: moduleKey }).catch(() => []);
    if ((ents || []).some((e: any) => e.enabled && (!e.status || e.status === 'active'))) return { licensed: true, reason: null };
    return { licensed: false, reason: 'This module is not enabled for your organisation.' };
  }
  if (scope && scope.mode === 'reseller' && scope.reseller_id) {
    const lics = await svc.entities.ResellerEntitlement.filter({ reseller_id: scope.reseller_id, module_key: moduleKey }).catch(() => []);
    if ((lics || []).some((l: any) => l.enabled && (!l.status || l.status === 'active'))) return { licensed: true, reason: null };
    return { licensed: false, reason: 'This module is not licensed for your reseller.' };
  }
  return { licensed: false, reason: 'This account has no tenant scope for this module.' };
}

/** Tenant-filtered query for list operations. */
export function tenantQueryOf(scope: any, extra?: any) {
  const q: any = { ...(extra || {}) };
  if (scope.customer_id) q.customer_id = scope.customer_id;
  else if (scope.reseller_id) q.reseller_id = scope.reseller_id;
  return q;
}

/** Record is inside the caller's manage scope. */
export function inScopeOf(scope: any, r: any, isPlatform: boolean, isReseller: boolean) {
  if (!r) return false;
  if (isPlatform) return true;
  if (isReseller) return !!scope.reseller_id && r.reseller_id === scope.reseller_id;
  return !!scope.customer_id && r.customer_id === scope.customer_id;
}

/** Single-record lookup by id (service role). */
export async function findRecord(svc: any, entityName: string, id: any) {
  if (!id) return null;
  const rows = await svc.entities[entityName].filter({ id: String(id) }).catch(() => []);
  return (rows && rows[0]) || null;
}

/** Platform audit log entry. Failures never break the business operation. */
export function auditLog(
  svc: any,
  ctx: { callerId: string; callerName: string; scope: any },
  event_type: string, entity_name: string, entity_id: any, notes: string, rec: any,
) {
  return svc.entities.PlatformAuditLog.create({
    event_type,
    user_id: ctx.callerId,
    user_name: ctx.callerName,
    customer_id: (rec && rec.customer_id) || (ctx.scope && ctx.scope.customer_id) || null,
    reseller_id: (rec && rec.reseller_id) || (ctx.scope && ctx.scope.reseller_id) || null,
    entity_name,
    entity_id: entity_id || null,
    action: event_type,
    notes,
  }).catch(() => null);
}

/**
 * enforceTenantActive — CUSTOMER SUSPENSION gate, shared by tenant data
 * gateways so the check exists in exactly ONE implementation.
 *
 * Blocks a SUSPENDED customer's tenant users from every gateway action
 * (reads, writes, signatures, exports) using the AUTHORITATIVE Customer
 * record resolved server-side from the caller — never a client-supplied
 * status, and regardless of any active module entitlement. Platform and
 * reseller administrators retain legitimate oversight (exempt). Only
 * status 'suspended' blocks; 'inactive' is a separate decision, not part
 * of this defect.
 *
 * Returns a 403 Response (with a machine-readable code 'customer_suspended'
 * and the suspension reason for the Account Blocked screen) when blocked,
 * or null when the caller may proceed.
 */
export async function enforceTenantActive(svc: any, caller: any): Promise<Response | null> {
  const { isPlatform, isReseller } = resolveAdminRoles(caller);
  if (isPlatform || isReseller || !caller || !caller.customer_id) return null;
  const cust = await svc.entities.Customer.get(String(caller.customer_id)).catch(() => null);
  if (!cust || cust.status !== 'suspended') return null;
  return Response.json({
    error: 'Your organisation account is suspended. Please contact your service provider to reactivate.',
    code: 'customer_suspended',
    suspension: {
      status: 'suspended',
      customer_name: cust.name || null,
      reason: cust.suspension_reason || null,
    },
  }, { status: 403 });
}

/**
 * stampTenantSuspension — keeps the tenant's users' User.tenant_suspended
 * marker in sync with the customer's CURRENT suspension state (called by
 * customerAccess set_status on suspend/reactivate). While suspended the
 * marker holds the customer's own id; null otherwise. Entity RLS tenant
 * branches compare data.customer_id against it so a suspended customer's
 * users are blocked from DIRECT entity access (raw SDK reads/writes that
 * bypass the tenant gateways). A missing or null marker never blocks —
 * no one else is ever locked out by the marker.
 */
export async function stampTenantSuspension(svc: any, customerId: string): Promise<void> {
  if (!customerId) return;
  const cust = await svc.entities.Customer.get(String(customerId)).catch(() => null);
  const stamp = cust && cust.status === 'suspended' ? String(customerId) : null;
  await svc.entities.User.updateMany(
    { customer_id: String(customerId) },
    { $set: { tenant_suspended: stamp } },
  ).catch(() => null);
}