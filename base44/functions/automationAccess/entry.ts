import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { loadCustomerById, isPlatformAdmin, isResellerAdmin } from '../../shared/deviceLicensing.ts';
import { AUTOMATION_DEFAULTS, AUTOMATION_TOGGLE_KEYS } from '../../shared/automationSettings.ts';

/**
 * automationAccess — AUTHORITATIVE per-tenant automation-settings gateway.
 *
 * The ONE tenant-scoped management surface for AutomationSetting (monitor
 * switches and automated-report switches). Every switch is PER CUSTOMER:
 *  • Platform admin   → any customer (or the platform-managed legacy pool
 *                       when no customer_id is supplied)
 *  • Reseller admin   → customers of their OWN reseller only
 *  • Customer admin   → their OWN customer only (forced server-side)
 * A customer administrator can NEVER read or change another tenant's
 * automation settings, and a tenant with no settings row starts from the
 * schema defaults (monitors OFF) — never from another customer's values.
 *
 * Actions: get | toggle | list (platform only)
 * AUDIT: automation.settings.toggled per change.
 */

const KEY_SET = new Set(AUTOMATION_TOGGLE_KEYS);

async function getOrCreateSettings(svc: any, customerId: string | null, resellerId: string | null, updatedBy: string | null) {
  const q: any = customerId ? { customer_id: customerId } : { customer_id: null };
  const rows = (await svc.entities.AutomationSetting.filter(q).catch(() => [])) || [];
  const rec = rows[0] || null;
  if (rec) return rec;
  // First touch for this tenant — the record starts from the schema
  // defaults (all monitors OFF), never from another tenant's row.
  return await svc.entities.AutomationSetting.create({
    customer_id: customerId || null,
    reseller_id: resellerId || null,
    ...AUTOMATION_DEFAULTS,
    updated_at: new Date().toISOString(),
    updated_by_name: updatedBy || null,
  });
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized', code: 'auth_required' }, { status: 401 });
    const callerName = caller.display_name || caller.full_name || caller.email;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    // ── Tenant scope resolution (server-side, fail closed) ──────────────
    let level: 'platform' | 'reseller' | 'customer' | null = null;
    if (isPlatformAdmin(caller)) level = 'platform';
    else if (isResellerAdmin(caller)) level = 'reseller';
    else if (
      caller.customer_id &&
      (caller.admin_level === 'customer' ||
        ['customer_admin', 'practice_admin', 'estate_manager'].includes(String(caller.role_type || '')))
    ) level = 'customer';
    if (!level) {
      return Response.json({ error: 'You do not have permission to manage automation settings.', code: 'permission_denied' }, { status: 403 });
    }

    let customerId: string | null = null;
    let resellerId: string | null = null;
    if (level === 'platform') {
      customerId = String(body?.customer_id || '') || null;
      resellerId = null;
      if (customerId) {
        const cust = await loadCustomerById(svc, customerId);
        if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });
        resellerId = cust.reseller_id || null;
      }
    } else if (level === 'reseller') {
      customerId = String(body?.customer_id || '') || String(caller.customer_id || '') || null;
      resellerId = String(caller.reseller_id || '') || null;
      if (customerId) {
        const cust = await loadCustomerById(svc, customerId);
        if (!cust || String(cust.reseller_id || '') !== String(resellerId)) {
          return Response.json({ error: 'Forbidden', code: 'permission_denied' }, { status: 403 });
        }
        resellerId = cust.reseller_id || null;
      }
    } else {
      if (body?.customer_id && String(body.customer_id) !== String(caller.customer_id)) {
        return Response.json({ error: 'You can only manage automation settings for your own organisation.', code: 'permission_denied' }, { status: 403 });
      }
      customerId = String(caller.customer_id);
      resellerId = caller.reseller_id || null;
    }

    /* ── GET (get-or-create the tenant's own settings row) ────────────── */
    if (action === 'get') {
      const rec = await getOrCreateSettings(svc, customerId, resellerId, callerName);
      return Response.json({
        success: true,
        scope: { level, customer_id: customerId },
        settings_id: rec.id,
        settings: { ...AUTOMATION_DEFAULTS, ...(rec || {}) },
      });
    }

    /* ── TOGGLE (one switch, validated key, audit-logged) ─────────────── */
    if (action === 'toggle') {
      const key = String(body?.key || '');
      if (!KEY_SET.has(key)) {
        return Response.json({ error: 'Unknown automation setting', code: 'bad_key' }, { status: 400 });
      }
      const value = body?.value === true;
      const rec = await getOrCreateSettings(svc, customerId, resellerId, callerName);
      const updated = await svc.entities.AutomationSetting.update(rec.id, {
        [key]: value,
        updated_at: new Date().toISOString(),
        updated_by_name: callerName,
      });
      await svc.entities.PlatformAuditLog.create({
        event_type: 'automation.settings.toggled',
        customer_id: customerId, reseller_id: resellerId,
        user_id: caller.id, user_name: callerName,
        entity_name: 'AutomationSetting', entity_id: rec.id, action: 'automation_toggle',
        new_values: JSON.stringify({ [key]: value }),
        notes: `Automation switch "${key}" set to ${value ? 'ON' : 'OFF'}${customerId ? ` for customer ${customerId}` : ' (platform pool)'}`,
      }).catch(() => {});
      return Response.json({
        success: true,
        scope: { level, customer_id: customerId },
        settings_id: rec.id,
        settings: { ...AUTOMATION_DEFAULTS, ...(updated || rec) },
      });
    }

    /* ── LIST (platform oversight only) ────────────────────────────────── */
    if (action === 'list') {
      if (level !== 'platform') {
        return Response.json({ error: 'Forbidden', code: 'permission_denied' }, { status: 403 });
      }
      const recs = (await svc.entities.AutomationSetting.list().catch(() => [])) || [];
      const customers = (await svc.entities.Customer.list().catch(() => [])) || [];
      const nameById = new Map(customers.map((c: any) => [c.id, c.name]));
      return Response.json({
        success: true,
        settings: recs.map((r: any) => ({
          id: r.id,
          customer_id: r.customer_id || null,
          customer_name: r.customer_id ? (nameById.get(r.customer_id) || null) : null,
          ...AUTOMATION_DEFAULTS,
          ...r,
        })),
      });
    }

    return Response.json({ error: 'Unknown action. Use get, toggle or list', code: 'bad_action' }, { status: 400 });
  } catch (error) {
    const msg = String((error as any)?.message || error);
    console.log('[automationAccess] fatal', msg);
    return Response.json({ error: 'Automation settings operation failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}