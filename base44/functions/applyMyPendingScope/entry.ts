import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * applyMyPendingScope — self-service, server-side application of a queued
 * PendingTenantScope to the CALLING user's own record.
 *
 * Why this exists: Base44 creates the User record only when an invitee accepts
 * the invitation, so tenant scoping cannot be applied at invite time.
 * inviteTenantUser instead writes a PendingTenantScope keyed by email. On the
 * invitee's first login, this function applies that scope to their own User
 * record (reseller_id / customer_id / role_type / admin_level), so they land
 * in their reseller console — never granting platform `role: admin`.
 *
 * Security: the caller can ONLY receive a scope an admin already queued for
 * THEIR email. PendingTenantScope records can only be created by admins
 * (RLS), so a user cannot escalate themselves — they merely consume a scope
 * intended for their email. Idempotent (marks the scope "applied").
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ applied: false });
    // Safe normalisation: match the pending record by a normalised email so
    // case/whitespace differences between the invitation and the signup email
    // never prevent the scope from applying. The caller can only consume a
    // scope queued for THEIR email — no cross-user application.
    const email = (caller.email || '').trim().toLowerCase();
    if (!email) return Response.json({ applied: false });

    const pending = await base44.asServiceRole.entities.PendingTenantScope.filter({
      email, status: 'pending',
    });
    if (!pending || pending.length === 0) {
      return Response.json({ applied: false });
    }
    const scope = pending[0];

    const updates = {};
    if (scope.role_type) updates.role_type = scope.role_type;
    if (scope.admin_level) updates.admin_level = scope.admin_level;
    if (scope.reseller_id) updates.reseller_id = scope.reseller_id;
    if (scope.customer_id !== undefined && scope.customer_id !== null) updates.customer_id = scope.customer_id;
    if (scope.display_name) updates.display_name = scope.display_name;
    if (scope.phone) updates.phone = scope.phone;

    if (Object.keys(updates).length === 0) {
      return Response.json({ applied: false });
    }

    await base44.asServiceRole.entities.User.update(caller.id, updates);

    await base44.asServiceRole.entities.PendingTenantScope.update(scope.id, {
      status: 'applied',
      applied_user_id: caller.id,
      applied_at: new Date().toISOString(),
    });

    try {
      await base44.asServiceRole.entities.PlatformAuditLog.create({
        event_type: 'user.scoped',
        user_id: caller.id,
        user_name: caller.display_name || caller.full_name || caller.email,
        customer_id: scope.customer_id || undefined,
        reseller_id: scope.reseller_id || undefined,
        entity_name: 'User',
        entity_id: caller.id,
        action: 'apply_pending_tenant_scope',
        new_values: JSON.stringify(updates),
        notes: `Applied queued tenant scope to ${email} (${scope.role_type})`,
      });
    } catch (_) { /* best-effort audit */ }

    return Response.json({ applied: true, role_type: scope.role_type, reseller_id: scope.reseller_id });
  } catch (error) {
    console.log('[applyMyPendingScope] fatal', String(error?.message || error));
    return Response.json({ applied: false });
  }
}