import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';

/**
 * customerAccess — AUTHORITATIVE customer lifecycle gateway.
 *
 *  • create          — creates a customer. COMPULSORY Allowed Devices
 *                      (device_limit): integer, minimum 1, server-side
 *                      validated — customer creation FAILS without it
 *                      (client-side validation is UX only). Authorized for
 *                      platform admins (any reseller or direct) and reseller
 *                      administrators (their own reseller only — forced
 *                      server-side, never client-supplied).
 *  • set_device_limit — the SINGLE authority for changing a customer's
 *                      licensed device allowance. PLATFORM-LEVEL ONLY: a
 *                      customer (or reseller) can never increase its own
 *                      purchased allowance. Integer, minimum 1; a limit below
 *                      the current ACTIVE device count is BLOCKED with a
 *                      controlled message (devices are never randomly
 *                      deactivated by a limit change). Audited:
 *                      customer.device_limit_changed.
 *
 * All other customer field edits keep their existing path (direct entity
 * update under Customer RLS — platform/reseller administrators only); this
 * gateway owns creation and the device-limit authority.
 *
 * AUDIT EVENTS: customer.created, customer.device_limit_changed.
 */

const isPlatformAdmin = (u: any) =>
  u?.role_type === 'platform_admin' || u?.admin_level === 'platform' || u?.role === 'admin';
const isResellerAdmin = (u: any) =>
  u?.role_type === 'reseller_admin' || u?.admin_level === 'reseller';

/** Valid device limit: a true integer >= 1 (no decimals, no strings, no blanks). */
function parseDeviceLimit(raw: any): { ok: true; value: number } | { ok: false; code: string; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return { ok: false, code: 'missing_device_limit', error: 'Allowed Devices is required. Enter the number of licensed device installations for this customer (minimum 1).' };
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { ok: false, code: 'invalid_device_limit', error: 'Allowed Devices must be a whole number (no decimals or text).' };
  }
  if (num < 1) {
    return { ok: false, code: 'invalid_device_limit', error: 'Allowed Devices must be at least 1.' };
  }
  return { ok: true, value: num };
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const callerName = caller.display_name || caller.full_name || caller.email;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    /* ── CREATE ────────────────────────────────────────────────────────── */
    if (action === 'create') {
      const name = String(body?.name || '').trim();
      const customer_type = String(body?.customer_type || '').trim();
      if (!name) return Response.json({ error: 'Customer Name is required', code: 'missing_name' }, { status: 400 });
      if (!customer_type) return Response.json({ error: 'Customer Type is required', code: 'missing_customer_type' }, { status: 400 });

      // COMPULSORY Allowed Devices — fail closed, server-side.
      const limitCheck = parseDeviceLimit(body?.device_limit);
      if (!limitCheck.ok) return Response.json({ error: limitCheck.error, code: limitCheck.code }, { status: 400 });

      // Authorization + reseller scope (mirrors Customer RLS):
      // platform admin → any reseller or direct; reseller admin → own reseller
      // only (forced server-side, client value ignored).
      let resellerId: string | null = null;
      if (isPlatformAdmin(caller)) {
        resellerId = body?.reseller_id ? String(body.reseller_id) : null;
      } else if (isResellerAdmin(caller)) {
        if (!caller.reseller_id) {
          return Response.json({ error: 'Your account has no reseller scope', code: 'permission_denied' }, { status: 403 });
        }
        resellerId = caller.reseller_id;
      } else {
        return Response.json({ error: 'You do not have permission to create customers', code: 'permission_denied' }, { status: 403 });
      }

      const created = await svc.entities.Customer.create({
        name,
        legal_name: String(body?.legal_name || '').trim() || undefined,
        customer_type,
        device_limit: limitCheck.value,
        reseller_id: resellerId || undefined,
        address: String(body?.address || '').trim() || undefined,
        phone: String(body?.phone || '').trim() || undefined,
        email: String(body?.email || '').trim() || undefined,
        website: String(body?.website || '').trim() || undefined,
        status: String(body?.status || 'active'),
        notes: String(body?.notes || '').trim() || undefined,
      });
      await svc.entities.PlatformAuditLog.create({
        event_type: 'customer.created',
        user_id: caller.id, user_name: callerName,
        reseller_id: resellerId || undefined,
        entity_name: 'Customer', entity_id: created.id, action: 'customer_create',
        new_values: JSON.stringify({ name, customer_type, device_limit: limitCheck.value, reseller_id: resellerId }),
        notes: `Customer created with device allowance ${limitCheck.value}`,
      }).catch(() => {});
      return Response.json({ success: true, customer: created });
    }

    /* ── SET DEVICE LIMIT (platform-level only, single authority) ──────── */
    if (action === 'set_device_limit') {
      if (!isPlatformAdmin(caller)) {
        return Response.json({
          error: 'Only a Platform Administrator can change a customer\'s licensed device allowance.',
          code: 'permission_denied',
        }, { status: 403 });
      }
      const customerId = String(body?.customer_id || '');
      if (!customerId) return Response.json({ error: 'customer_id required', code: 'missing_customer' }, { status: 400 });
      const custRows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
      const cust = custRows?.[0];
      if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });

      const limitCheck = parseDeviceLimit(body?.device_limit);
      if (!limitCheck.ok) return Response.json({ error: limitCheck.error, code: limitCheck.code }, { status: 400 });

      // Controlled limit reduction: never silently strand or auto-deactivate
      // devices — a limit below the ACTIVE device count is blocked with an
      // actionable message.
      const activeRows = await svc.entities.DeviceRegistration
        .filter({ customer_id: customerId, status: 'active' }).catch(() => []);
      const activeCount = (activeRows || []).length;
      if (limitCheck.value < activeCount) {
        return Response.json({
          error: `${activeCount} device${activeCount === 1 ? ' is' : 's are'} currently active. Deactivate ${activeCount - limitCheck.value} device${activeCount - limitCheck.value === 1 ? '' : 's'} first, or choose an allowance of at least ${activeCount}.`,
          code: 'limit_below_active_devices',
          active_count: activeCount,
        }, { status: 409 });
      }

      const oldLimit = cust.device_limit ?? null;
      const updated = await svc.entities.Customer.update(customerId, { device_limit: limitCheck.value });
      await svc.entities.PlatformAuditLog.create({
        event_type: 'customer.device_limit_changed',
        customer_id: customerId, reseller_id: cust.reseller_id || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'Customer', entity_id: customerId, action: 'set_device_limit',
        old_values: JSON.stringify({ device_limit: oldLimit }),
        new_values: JSON.stringify({ device_limit: limitCheck.value }),
        notes: `Device allowance changed ${oldLimit ?? 'not configured'} → ${limitCheck.value} (${activeCount} active devices)`,
      }).catch(() => {});
      return Response.json({ success: true, customer: updated, active_count: activeCount });
    }

    return Response.json({ error: 'Unknown action. Use create or set_device_limit', code: 'bad_action' }, { status: 400 });
  } catch (error) {
    const msg = String((error as any)?.message || error);
    console.log('[customerAccess] fatal', msg);
    if (/^Error in field /i.test(msg)) {
      return Response.json({ error: `The customer could not be saved: ${msg}`, code: 'validation_error' }, { status: 500 });
    }
    return Response.json({ error: 'Customer operation failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}