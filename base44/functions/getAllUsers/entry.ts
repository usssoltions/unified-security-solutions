import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate the user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins / dispatchers may list user accounts.
    if (!['admin', 'dispatcher'].includes(user.role_type)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Tenant-scoped: Platform Admins (explicit) see all tenants; everyone else
    // only sees users in their own customer/reseller scope.
    const isPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const userQuery = isPlatformSender
      ? {}
      : (user.customer_id
          ? { customer_id: user.customer_id }
          : (user.reseller_id ? { reseller_id: user.reseller_id } : { id: user.id }));
    const users = await base44.asServiceRole.entities.User.filter(userQuery);

    return Response.json({ users });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});