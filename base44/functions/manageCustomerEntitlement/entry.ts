import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * manageCustomerEntitlement — grant / update / remove a customer's module
 * entitlement, with SERVER-SIDE enforcement that the module is licensed to
 * the customer's reseller (ResellerEntitlement).
 *
 * A reseller can never allocate a module USS has not authorised for it: the
 * ResellerEntitlement check below blocks the write before the
 * ModuleEntitlement record is created/updated, regardless of what the UI
 * offered.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin';
    const isResellerAdmin = caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller';
    if (!isPlatformAdmin && !isResellerAdmin) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const { action, customer_id, reseller_id, module_key, enabled, status,
            licence_start, licence_end, licence_limit, configuration } = body;

    if (!action || !['set', 'remove'].includes(action)) {
      return Response.json({ error: 'action must be "set" or "remove"' }, { status: 400 });
    }
    if (!customer_id || !module_key) {
      return Response.json({ error: 'customer_id and module_key are required' }, { status: 400 });
    }

    const custs = await base44.asServiceRole.entities.Customer.filter({ id: customer_id });
    const customer = custs[0];
    if (!customer) return Response.json({ error: 'Customer not found' }, { status: 404 });
    const effectiveReseller = reseller_id || customer.reseller_id || null;

    if (!isPlatformAdmin) {
      if (!effectiveReseller || effectiveReseller !== caller.reseller_id) {
        return Response.json({ error: 'Forbidden: customer does not belong to your reseller' }, { status: 403 });
      }
    }

    // Enforce reseller-licence boundary.
    if (action === 'set') {
      const resellerEnts = await base44.asServiceRole.entities.ResellerEntitlement.filter({
        reseller_id: effectiveReseller, module_key
      });
      const allowed = (resellerEnts || []).some(
        (e) => e.enabled && (!e.status || e.status === 'active')
      );
      if (!allowed) {
        return Response.json(
          { error: `Module '${module_key}' is not licensed for this reseller` },
          { status: 403 }
        );
      }
    }

    const audit = (a, oldV, newV, notes) =>
      base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'module.licensed',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        customer_id,
        reseller_id: effectiveReseller || undefined,
        module_key,
        entity_name: 'ModuleEntitlement',
        entity_id: customer_id,
        action: a,
        old_values: oldV ? JSON.stringify(oldV) : undefined,
        new_values: newV ? JSON.stringify(newV) : undefined,
        notes,
      });

    if (action === 'set') {
      const existing = await base44.asServiceRole.entities.ModuleEntitlement.filter({
        customer_id, module_key,
      });
      let result;
      if (existing.length > 0) {
        const ent = existing[0];
        const upd = {
          enabled: enabled !== undefined ? enabled : ent.enabled,
          status: status || ent.status || 'active',
          reseller_id: effectiveReseller,
        };
        if (licence_start !== undefined) upd.licence_start = licence_start;
        if (licence_end !== undefined) upd.licence_end = licence_end;
        if (licence_limit !== undefined) upd.licence_limit = licence_limit;
        if (configuration !== undefined) upd.configuration = configuration;
        result = await base44.asServiceRole.entities.ModuleEntitlement.update(ent.id, upd);
        await audit('update', ent, result, `Module ${module_key} updated for customer`);
      } else {
        result = await base44.asServiceRole.entities.ModuleEntitlement.create({
          customer_id,
          reseller_id: effectiveReseller,
          module_key,
          enabled: enabled !== undefined ? enabled : true,
          status: status || 'active',
          licence_start: licence_start || undefined,
          licence_end: licence_end || undefined,
          licence_limit: licence_limit || undefined,
          configuration: configuration || undefined,
        });
        await audit('create', null, result, `Module ${module_key} granted to customer`);
      }
      return Response.json({ success: true, entitlement: result });
    }

    if (action === 'remove') {
      const existing = await base44.asServiceRole.entities.ModuleEntitlement.filter({
        customer_id, module_key,
      });
      if (existing.length > 0) {
        await base44.asServiceRole.entities.ModuleEntitlement.delete(existing[0].id);
        await audit('delete', existing[0], null, `Module ${module_key} removed from customer`);
      }
      return Response.json({ success: true, removed: true });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}