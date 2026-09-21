import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';

/**
 * getTenantUsers — tenant-scoped user AND pending-invitation listing for the
 * Reseller / Customer console. The built-in User entity only allows platform
 * admins to list users, so reseller & customer admins reach their own users
 * through this server-side, RLS-equivalent function.
 *
 * Returns { users, pending_invitations }:
 *  - users: active User records in scope.
 *  - pending_invitations: PendingTenantScope records with status "pending"
 *    (not cancelled/applied/expired) for the SAME scope, so the Users tab can
 *    display awaiting-acceptance invitations (full name, email, mobile, role,
 *    delivery status) without requiring a User entity to exist yet.
 *
 *  - Platform Admin: may pass reseller_id / customer_id to scope, or omit for all.
 *  - Reseller Admin: always scoped to their own reseller_id (param ignored if mismatched);
 *    a customer_id param only NARROWS the pending display within their own reseller.
 *  - Customer Admin / practice admin / estate manager: scoped to their customer_id.
 *  - Everyone else: only their own user record, no invitations.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    // AUTHORITATIVE CALLER RESOLUTION — the caller's User record (re-read
    // server-side via the shared resolver) wins over possibly-stale session
    // claims for tenant-scope fields. A claim-only resolution made customer
    // administrators with incomplete tokens resolve as "no tenant" and fall
    // into the self-only branch, returning no tenant guards at all.
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { reseller_id, customer_id } = body || {};

    const isPlatformAdmin = caller.role === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
    const isResellerAdmin = caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller';
    // 'customer_admin' is the modern Customer Administrator role_type — it
    // was MISSING from this list, so a customer_admin whose record/claims
    // lacked admin_level resolved as a plain user (self-only, no guards).
    const isCustomerAdmin =
      caller.admin_level === 'customer' ||
      ['admin', 'customer_admin', 'practice_admin', 'estate_manager'].includes(caller.role_type);

    let query;
    let pendingQuery;
    if (isPlatformAdmin) {
      if (customer_id) {
        query = { customer_id };
        pendingQuery = { customer_id, status: 'pending' };
      } else if (reseller_id) {
        query = { reseller_id };
        pendingQuery = { reseller_id, status: 'pending' };
      } else {
        query = {};
        pendingQuery = { status: 'pending' };
      }
    } else if (isResellerAdmin) {
      if (reseller_id && reseller_id !== caller.reseller_id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      query = { reseller_id: caller.reseller_id };
      // Always keep the reseller scope; a customer_id only narrows the display.
      pendingQuery = { reseller_id: caller.reseller_id, status: 'pending' };
      if (customer_id) pendingQuery.customer_id = customer_id;
    } else if (isCustomerAdmin) {
      if (customer_id && customer_id !== caller.customer_id) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      query = { customer_id: caller.customer_id };
      pendingQuery = { customer_id: caller.customer_id, status: 'pending' };
    } else if (body.colleagues && caller.customer_id) {
      // CHAT / operational contact discovery: a non-admin tenant user may
      // list users of their OWN customer only (never reseller-wide, never
      // platform-wide, never invitations). Previously the chat UI called
      // User.list() directly, which the platform only permits to platform
      // admins — guards got an empty selector and admins got cross-tenant
      // user discovery.
      query = { customer_id: caller.customer_id };
      pendingQuery = null;
    } else {
      query = { id: caller.id };
      pendingQuery = null; // non-admins manage no invitations
    }

    const users = await base44.asServiceRole.entities.User.filter(query, '-created_date', 500);
    let pending_invitations = [];
    if (pendingQuery) {
      const pend = await base44.asServiceRole.entities.PendingTenantScope
        .filter(pendingQuery, '-created_date', 100)
        .catch(() => []);
      pending_invitations = (pend || []).filter((p) => !p.cancelled_at);
    }
    return Response.json({ users: users || [], pending_invitations });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}