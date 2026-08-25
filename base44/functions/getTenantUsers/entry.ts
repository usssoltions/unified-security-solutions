import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getTenantUsers — tenant-scoped user listing for the Reseller / Customer
 * console. The built-in User entity only allows platform admins to list
 * users, so reseller & customer admins reach their own users through this
 * server-side, RLS-equivalent function.
 *
 *  - Platform Admin: may pass reseller_id / customer_id to scope, or omit for all.
 *  - Reseller Admin: always scoped to their own reseller_id (param ignored if mismatched).
 *  - Customer Admin / practice admin / estate manager: scoped to their customer_id.
 *  - Everyone else: only their own record.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { reseller_id, customer_id } = body || {};

    const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin';
    const isResellerAdmin = caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller';
    const isCustomerAdmin =
      caller.admin_level === 'customer' ||
      ['admin', 'practice_admin', 'estate_manager'].includes(caller.role_type);

    let query;
    if (isPlatformAdmin) {
      if (customer_id) query = { customer_id };
      else if (reseller_id) query = { reseller_id };
      else query = {};
    } else if (isResellerAdmin) {
      if (reseller_id && reseller_id !== caller.reseller_id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      query = { reseller_id: caller.reseller_id };
    } else if (isCustomerAdmin) {
      if (customer_id && customer_id !== caller.customer_id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      query = { customer_id: caller.customer_id };
    } else {
      query = { id: caller.id };
    }

    const users = await base44.asServiceRole.entities.User.filter(query, '-created_date', 500);
    return Response.json({ users: users || [] });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}