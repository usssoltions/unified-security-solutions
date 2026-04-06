import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate the user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Use service role to get all users
    const users = await base44.asServiceRole.entities.User.list();

    return Response.json({ users });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});