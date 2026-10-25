/**
 * suspensionGateSelfTest — verification harness for the customer suspension
 * gate (enforceTenantActive in shared/tenantGateway).
 *
 * Calls the REAL gate function against the REAL Customer record (resolved
 * server-side) for synthetic tenant callers shaped exactly like the platform
 * resolves them:
 *   - customer_admin caller  { admin_level: 'customer', customer_id }
 *   - attendance_staff caller { role_type: 'attendance_staff', customer_id }
 * and the exempt administrator shapes (platform / reseller).
 *
 * Expected: suspended customer → 403 with code 'customer_suspended' and the
 * suspension reason; active/reactivated customer → null (allowed); platform
 * and reseller callers → always null (oversight preserved).
 *
 * Read-only apart from one PlatformAuditLog entry. Never touches real
 * customers — the caller passes the id of an isolated test fixture.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { enforceTenantActive } from '../../shared/tenantGateway.ts';

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

  const { customer_id } = await req.json().catch(() => ({}));
  if (!customer_id) return bad('customer_id of the test fixture customer is required.', 'missing_customer_id');

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