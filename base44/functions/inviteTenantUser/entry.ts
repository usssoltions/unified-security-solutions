import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * inviteTenantUser — securely invite a tenant-scoped user (Reseller Admin,
 * Customer Admin, or regular user) and bind them to the correct reseller /
 * customer scope WITHOUT granting the platform `admin` role.
 *
 * Security model:
 *  - Platform `role: admin` is reserved for USS Platform Admins. Invited
 *    users always receive platform role "user" and a non-platform role_type.
 *  - Reseller Admin creation is PLATFORM-ONLY.
 *  - Reseller Admins may invite Customer Admins / users only within their own
 *    reseller, and only for customers that belong to that reseller.
 *  - Every invite is recorded in PlatformAuditLog.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, email, role_type, reseller_id, customer_id, display_name, phone, status } = body;

    if (action !== 'invite') {
      return Response.json({ error: 'Only action "invite" is supported' }, { status: 400 });
    }
    if (!email || !role_type) {
      return Response.json({ error: 'email and role_type are required' }, { status: 400 });
    }

    const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin';
    const isResellerAdmin = caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller';

    if (!isPlatformAdmin && !isResellerAdmin) {
      return Response.json({ error: 'Forbidden: insufficient permissions to invite users' }, { status: 403 });
    }

    // Reseller Admin creation is platform-only.
    if (role_type === 'reseller_admin' && !isPlatformAdmin) {
      return Response.json({ error: 'Forbidden: only Platform Admin can create Reseller Administrators' }, { status: 403 });
    }
    // Nobody but platform can create platform admins.
    if (role_type === 'platform_admin' && !isPlatformAdmin) {
      return Response.json({ error: 'Forbidden: cannot create Platform Admins' }, { status: 403 });
    }

    // Reseller Admins: may only act within their own reseller.
    if (isResellerAdmin && !isPlatformAdmin) {
      if (!caller.reseller_id || reseller_id !== caller.reseller_id) {
        return Response.json({ error: 'Forbidden: can only create users within your own reseller' }, { status: 403 });
      }
      if (role_type === 'reseller_admin') {
        return Response.json({ error: 'Forbidden: cannot create Reseller Administrators' }, { status: 403 });
      }
    }

    // Determine admin_level from role_type.
    let admin_level = 'customer';
    if (role_type === 'reseller_admin') admin_level = 'reseller';
    else if (role_type === 'platform_admin') admin_level = 'platform';

    // Validate customer belongs to the resolved reseller (when customer given).
    let customer;
    if (customer_id) {
      const custs = await base44.asServiceRole.entities.Customer.filter({ id: customer_id });
      customer = custs[0];
      if (!customer) return Response.json({ error: 'Customer not found' }, { status: 404 });
      const customerReseller = customer.reseller_id || null;
      if (isResellerAdmin && !isPlatformAdmin) {
        if (!customerReseller || customerReseller !== caller.reseller_id) {
          return Response.json({ error: 'Forbidden: customer does not belong to your reseller' }, { status: 403 });
        }
      }
      if (reseller_id && customerReseller && customerReseller !== reseller_id) {
        return Response.json({ error: 'Customer does not belong to the selected reseller' }, { status: 400 });
      }
    }
    const effectiveReseller = reseller_id || (customer ? customer.reseller_id : null) || null;

    // Invite with platform role "user" — NEVER "admin".
    const invited = await base44.users.inviteUser(email, 'user');
    let newUserId = invited?.id || invited?.user?.id || invited?._id || invited?.user_id;
    if (!newUserId) {
      const found = await base44.asServiceRole.entities.User.filter({ email });
      newUserId = found[0]?.id;
    }
    if (!newUserId) {
      return Response.json({ error: 'Invitation sent but user record could not be scoped. Ask the invitee to accept the email, then set reseller_id/role_type manually.' }, { status: 202 });
    }

    const updates = {
      role_type,
      admin_level,
      reseller_id: effectiveReseller,
      customer_id: customer_id || null,
    };
    if (display_name) updates.display_name = display_name;
    if (phone) updates.phone = phone;
    const clean = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined && v !== null) clean[k] = v;
      else if (k === 'customer_id') clean.customer_id = null;
    }

    await base44.asServiceRole.entities.User.update(newUserId, clean);

    await base44.asServiceRole.entities.PlatformAuditLog.create({
      event_type: 'user.created',
      user_id: caller.id,
      user_name: caller.display_name || caller.full_name || caller.email,
      customer_id: customer_id || undefined,
      reseller_id: effectiveReseller || undefined,
      entity_name: 'User',
      entity_id: newUserId,
      action: 'invite_tenant_user',
      new_values: JSON.stringify({ email, role_type, admin_level, reseller_id: effectiveReseller, customer_id: customer_id || null, status: status || 'active' }),
      notes: `Invited ${email} as ${role_type}`
    });

    return Response.json({ success: true, user_id: newUserId });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}