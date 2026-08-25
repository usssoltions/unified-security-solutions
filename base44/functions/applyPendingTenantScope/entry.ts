import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * applyPendingTenantScope — triggered by a User entity "create" automation.
 *
 * Base44 creates the User record only when an invitee accepts their invitation
 * (or signs up). At invite time the User does not exist yet, so tenant scoping
 * cannot be applied then; instead inviteTenantUser writes a PendingTenantScope
 * record keyed by email. When the User record is created, this function runs,
 * looks up any pending scope for the new user's email, and applies the stored
 * reseller_id / customer_id / role_type / admin_level / display_name / phone to
 * the new User via the service role — never granting platform `role: admin`.
 *
 * Runs as a service role (the automation is platform-owned), so RLS is
 * bypassed; the business logic itself is the only gate.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json().catch(() => ({}));
    // Entity-create automation payload shape: { event, data, old_data }
    const newUser = payload?.data || payload?.user || payload;
    const email = newUser?.email;
    const newUserId = newUser?.id;
    if (!email || !newUserId) {
      return Response.json({ ok: true, skipped: 'no user/email in payload' });
    }

    const pendingRows = await base44.asServiceRole.entities.PendingTenantScope.filter({
      email, status: 'pending',
    });

    if (!pendingRows || pendingRows.length === 0) {
      // Normal signup with no queued scope — nothing to do.
      return Response.json({ ok: true, skipped: 'no pending scope' });
    }

    const scope = pendingRows[0];
    const updates = {};
    if (scope.role_type) updates.role_type = scope.role_type;
    if (scope.admin_level) updates.admin_level = scope.admin_level;
    if (scope.reseller_id) updates.reseller_id = scope.reseller_id;
    if (scope.customer_id !== undefined && scope.customer_id !== null) updates.customer_id = scope.customer_id;
    if (scope.display_name) updates.display_name = scope.display_name;
    if (scope.phone) updates.phone = scope.phone;

    if (Object.keys(updates).length === 0) {
      return Response.json({ ok: true, skipped: 'empty scope' });
    }

    await base44.asServiceRole.entities.User.update(newUserId, updates);

    await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, {
      status: 'applied',
      applied_user_id: newUserId,
      applied_at: new Date().toISOString(),
    });

    try {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'user.scoped',
        user_id: scope.invited_by || newUserId,
        user_name: scope.invited_by_name || undefined,
        customer_id: scope.customer_id || undefined,
        reseller_id: scope.reseller_id || undefined,
        entity_name: 'User',
        entity_id: newUserId,
        action: 'apply_pending_tenant_scope',
        new_values: JSON.stringify(updates),
        notes: `Applied queued tenant scope to ${email} (${scope.role_type})`,
      });
    } catch (_) { /* best-effort audit */ }

    return Response.json({ ok: true, applied: true, user_id: newUserId });
  } catch (error) {
    console.log('[applyPendingTenantScope] fatal', String(error?.message || error));
    // Do not throw — the user should still be able to sign up even if scoping fails.
    return Response.json({ ok: false, error: 'scope apply failed' }, { status: 200 });
  }
}