import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate the user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins / dispatchers may list all user accounts.
    if (!['admin', 'dispatcher'].includes(user.role_type)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Use service role to get all users (caller is authorized as admin/dispatcher)
    const users = await base44.asServiceRole.entities.User.list();

    return Response.json({ users });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});