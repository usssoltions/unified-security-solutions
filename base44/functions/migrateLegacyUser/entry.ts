import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * migrateLegacyUser — Platform Admin tool to migrate an unmigrated user
 * (no customer_id / reseller_id) into a tenant and grant the tenant the
 * requested commercial modules in a single atomic, audited operation.
 *
 * Steps:
 *   1. Verify the caller is a Platform Admin (explicit).
 *   2. Fetch the target user (service role).
 *   3. Update the user: customer_id, reseller_id, module_context.
 *   4. Ensure each requested module_key has an active ModuleEntitlement for
 *      the customer (create if missing; never disable an existing one).
 *   5. Audit the whole operation to PlatformAuditLog.
 *
 * This unblocks users stuck on the SetupRequired page after a multi-tenant
 * upgrade — assigning the tenant alone is not enough; the tenant must also
 * hold the modules the user's role home requires.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Explicit Platform Admin authority — never inferred from missing tenant.
    const isPlatformAdmin =
      caller.role_type === 'platform_admin' || caller.admin_level === 'platform' || caller.role === 'admin';
    if (!isPlatformAdmin) {
      return Response.json({ error: 'Forbidden: platform admin only' }, { status: 403 });
    }

    const body = await req.json();
    const { target_user_id, customer_id, reseller_id, module_keys = [], module_context } = body;

    if (!target_user_id || !customer_id) {
      return Response.json({ error: 'target_user_id and customer_id are required' }, { status: 400 });
    }

    // Look up the customer to derive reseller + module_context deterministically.
    const customers = await base44.asServiceRole.entities.Customer.filter({ id: customer_id });
    const customer = customers[0];
    if (!customer) {
      return Response.json({ error: 'Customer not found' }, { status: 404 });
    }

    const derivedResellerId = reseller_id || reseller_id === null ? reseller_id : customer.reseller_id;
    const derivedModuleContext = module_context || deriveModuleContext(customer.customer_type);

    // Fetch the target user (service role bypasses RLS for the cross-user lookup).
    const targetUsers = await base44.asServiceRole.entities.User.filter({ id: target_user_id });
    const targetUser = targetUsers[0];
    if (!targetUser) {
      return Response.json({ error: 'Target user not found' }, { status: 404 });
    }

    const callerName = caller.display_name || caller.full_name;

    // 1. Assign the user to the tenant.
    const userUpdate = {
      customer_id,
      reseller_id: derivedResellerId || null,
      module_context: derivedModuleContext,
    };
    await base44.asServiceRole.entities.User.update(target_user_id, userUpdate);

    // 2. Ensure the customer holds each requested module entitlement.
    const grantedModules: string[] = [];
    if (Array.isArray(module_keys) && module_keys.length > 0) {
      // Fetch existing entitlements for this customer once.
      const existing = await base44.asServiceRole.entities.ModuleEntitlement.filter({ customer_id });
      const existingKeys = new Set(existing.map((e: any) => e.module_key));

      for (const key of module_keys) {
        if (existingKeys.has(key)) {
          // Already entitled — leave it as-is (do not downgrade an existing licence).
          continue;
        }
        await base44.asServiceRole.entities.ModuleEntitlement.create({
          customer_id,
          reseller_id: derivedResellerId || null,
          module_key: key,
          enabled: true,
          status: 'active',
        });
        grantedModules.push(key);
      }
    }

    // 3. Audit the migration.
    await base44.asServiceRole.entities.PlatformAuditLog.create({
      event_type: 'user.migrated',
      user_id: caller.id,
      user_name: callerName,
      customer_id: caller.customer_id,
      reseller_id: caller.reseller_id,
      entity_name: 'User',
      entity_id: target_user_id,
      action: 'migrate_legacy_user',
      old_values: JSON.stringify({
        customer_id: targetUser.customer_id,
        reseller_id: targetUser.reseller_id,
        module_context: targetUser.module_context,
      }),
      new_values: JSON.stringify({
        ...userUpdate,
        granted_modules: grantedModules,
      }),
      notes: `Legacy user ${targetUser.email} migrated to tenant ${customer.name} by ${callerName}. Granted modules: ${grantedModules.join(', ') || 'none (existing)'}.`,
    });

    return Response.json({
      success: true,
      user_id: target_user_id,
      customer_id,
      reseller_id: derivedResellerId || null,
      module_context: derivedModuleContext,
      granted_modules: grantedModules,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function deriveModuleContext(customerType: string | undefined): string {
  if (!customerType) return 'security';
  if (customerType === 'estate') return 'estate';
  if (customerType === 'medical') return 'medical';
  return 'security';
}