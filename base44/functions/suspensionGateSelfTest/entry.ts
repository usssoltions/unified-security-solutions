/**
 * suspensionGateSelfTest — verification harness for the customer suspension
 * enforcement (shared/tenantGateway).
 *
 * MODES (payload { customer_id, mode }):
 *  - (default) 'gate': calls the REAL gate function (enforceTenantActive)
 *    against the REAL Customer record for synthetic tenant callers shaped
 *    exactly like the platform resolves them (customer_admin /
 *    attendance_staff / guard) and the exempt administrator shapes
 *    (platform / reseller). Suspended → 403 'customer_suspended' with the
 *    suspension reason; active/reactivated → allowed; admins → always allowed.
 *  - 'stamp_check': verifies the DIRECT-ENTITY-ACCESS suspension marker —
 *    lists the tenant's users and reports the distribution of their
 *    server-stamped User.tenant_suspended markers (suspended tenant → the
 *    customer id; active/reactivated → null/missing).
 *  - 'reseller_scope': verifies reseller-scope isolation in
 *    resolveCustomerScope — a reseller admin may only resolve customers
 *    belonging to THEIR OWN reseller (cross-reseller → 403), simulated with
 *    the shape used by every tenantGateway-based gateway.
 *
 * Read-only apart from one PlatformAuditLog entry. Never touches real
 * customers — the caller passes the id of an isolated test fixture (except
 * 'reseller_scope', which only READS customer records to find reseller
 * examples and never writes).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { enforceTenantActive, resolveCustomerScope } from '../../shared/tenantGateway.ts';

function ok(p) { return Response.json({ success: true, ...p }); }
function bad(msg, code, status = 400) {
  return Response.json({ error: msg, code }, { status });
}

export default async function main(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const caller = await base44.auth.me().catch(() => null);
  if (!caller) return bad('Unauthorized', 'unauthorized', 401);
  const svc = base44.asServiceRole;

  const isPlatformAdmin =
    caller.role === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
  if (!isPlatformAdmin) return bad('Platform administration only.', 'forbidden', 403);

  const { customer_id, mode } = await req.json().catch(() => ({}));
  if (!customer_id) return bad('customer_id of the test fixture customer is required.', 'missing_customer_id');

  // ── STAMP CHECK: direct-entity-access marker verification ──
  if (mode === 'stamp_check') {
    const users = await svc.entities.User.filter({ customer_id: String(customer_id) }).catch(() => []);
    const distribution = {};
    for (const u of (users || [])) {
      const v = u.tenant_suspended === undefined || u.tenant_suspended === null ? 'null_or_missing' : String(u.tenant_suspended);
      distribution[v] = (distribution[v] || 0) + 1;
    }
    return ok({
      mode,
      customer_id: String(customer_id),
      user_count: (users || []).length,
      tenant_suspended_distribution: distribution,
      interpretation: Object.keys(distribution).includes(String(customer_id))
        ? 'STAMPED_SUSPENDED'
        : (Object.keys(distribution).every(k => k === 'null_or_missing') ? 'CLEARED' : 'MIXED'),
    });
  }

  // ── RESELLER SCOPE ISOLATION: cross-reseller customer resolution must 403 ──
  if (mode === 'reseller_scope') {
    const customers = await svc.entities.Customer.list().catch(() => []);
    const rows = (customers && customers.items) || customers || [];
    const withReseller = rows.filter((c: any) => c.reseller_id);
    if (withReseller.length < 2) {
      return ok({
        mode,
        skipped: true,
        note: 'Fewer than two reseller-scoped customers exist — cross-reseller isolation needs two customers under DIFFERENT resellers.',
      });
    }
    const custA = withReseller[0];
    const custB = withReseller.find((c: any) => c.reseller_id !== custA.reseller_id);
    const tests: any[] = [];
    // Same-reseller customer: resolveCustomerScope must allow it.
    {
      const ra: any = { id: 'selftest-ra', full_name: 'Selftest Reseller Admin', email: 'selftest-ra@example.invalid', role: 'user', admin_level: 'reseller', role_type: 'reseller_admin', reseller_id: custA.reseller_id, customer_id: null };
      const scope = await resolveCustomerScope(svc, ra, { customer_id: custA.id });
      tests.push({ name: 'same_reseller_allowed', customer: custA.name, allowed: !!scope && !scope.error, scope_customer_id: scope && scope.customer_id || null });
    }
    // Cross-reseller customer: resolveCustomerScope must reject it (403).
    {
      const ra: any = { id: 'selftest-ra', full_name: 'Selftest Reseller Admin', email: 'selftest-ra@example.invalid', role: 'user', admin_level: 'reseller', role_type: 'reseller_admin', reseller_id: custA.reseller_id, customer_id: null };
      const scope = await resolveCustomerScope(svc, ra, { customer_id: custB.id });
      const denied = !scope || !!scope.error;
      tests.push({ name: 'cross_reseller_denied', customer: custB.name, reseller_of_target: custB.reseller_id, caller_reseller: custA.reseller_id, denied, http_status: (scope && scope.error && scope.error.status) || null });
    }
    return ok({ mode, tests });
  }

  // ── DEFAULT: the suspension gate itself (enforceTenantActive) ──
  const cust = await svc.entities.Customer.get(String(customer_id)).catch(() => null);
  if (!cust) return bad('Fixture customer not found.', 'not_found', 404);

  const tenantCallers = {
    customer_admin: { id: 'selftest-ca', full_name: 'Selftest Customer Admin', email: 'selftest-ca@example.invalid', role: 'user', admin_level: 'customer', role_type: 'customer_admin', customer_id: String(customer_id) },
    attendance_staff: { id: 'selftest-as', full_name: 'Selftest Attendance Staff', email: 'selftest-as@example.invalid', role: 'user', role_type: 'attendance_staff', customer_id: String(customer_id) },
    guard: { id: 'selftest-guard', full_name: 'Selftest Guard', email: 'selftest-guard@example.invalid', role: 'user', role_type: 'security_guard', customer_id: String(customer_id) },
  };
  const adminCallers = {
    platform_admin: { id: 'selftest-pa', full_name: 'Selftest Platform Admin', email: 'selftest-pa@example.invalid', role: 'admin', role_type: 'platform_admin', admin_level: 'platform' },
    reseller_admin: { id: 'selftest-ra', full_name: 'Selftest Reseller Admin', email: 'selftest-ra@example.invalid', role: 'user', admin_level: 'reseller', role_type: 'reseller_admin', reseller_id: cust.reseller_id || 'selftest-reseller' },
  };

  const results = {};
  for (const [name, c] of Object.entries({ ...tenantCallers, ...adminCallers })) {
    const denied = await enforceTenantActive(svc, c);
    if (!denied) {
      results[name] = { blocked: false };
      continue;
    }
    let body = null;
    try { body = await denied.json(); } catch { /* noop */ }
    results[name] = {
      blocked: denied.status === 403,
      http_status: denied.status,
      code: body && body.code,
      reason: (body && body.suspension && body.suspension.reason) || null,
    };
  }

  // Audit the verification run (failures never break it).
  svc.entities.PlatformAuditLog.create({
    event_type: 'suspension_gate_selftest',
    user_id: caller.id,
    user_name: caller.full_name || caller.email,
    customer_id: String(customer_id),
    entity_name: 'Customer',
    entity_id: String(customer_id),
    action: 'suspension_gate_selftest',
    notes: `Fixture status='${cust.status}': ` +
      Object.entries(results).map(([k, v]) => `${k}=${v.blocked ? 'blocked' : 'allowed'}`).join(', '),
  }).catch(() => null);

  return ok({
    fixture: { id: cust.id, name: cust.name, status: cust.status, suspension_reason: cust.suspension_reason || null },
    results,
  });
}