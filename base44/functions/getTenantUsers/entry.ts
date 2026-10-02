import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { emailsNearMatch, normaliseEmail } from '../../shared/scopeDiagnostics.ts';

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

    // INCOMPLETE PROVISIONING DIAGNOSTICS — an authenticated account that is
    // fully unscoped/roleless is exactly the "Account Setup Incomplete"
    // state. It can NEVER appear in the tenant users list (it carries no
    // customer_id), so administrators previously could not see it at all.
    // Only accounts attributable to THIS admin's own invitation history are
    // surfaced: the account's email exactly matches, or is a conservative
    // near-match of (the mistyped-address class), one of the admin's OWN
    // PendingTenantScope emails. Never a blanket cross-tenant dump, and the
    // account is never auto-scoped — the admin decides and the canonical
    // repair (invite that exact email → existing-user rescope) stays manual.
    let incomplete_accounts: any[] = [];
    if (isPlatformAdmin || isResellerAdmin || isCustomerAdmin) {
      try {
        const unscoped = await base44.asServiceRole.entities.User
          .filter({ customer_id: null, reseller_id: null, role_type: null }, '-created_date', 500)
          .catch(() => []);
        if ((unscoped || []).length > 0) {
          const scopeQuery = (isPlatformAdmin && !customer_id && !reseller_id)
            ? {}
            : (isResellerAdmin && !(customer_id && isPlatformAdmin))
              ? { reseller_id: caller.reseller_id }
              : { customer_id: (customer_id && (isPlatformAdmin || isResellerAdmin)) ? customer_id : caller.customer_id };
          const myScopes = await base44.asServiceRole.entities.PendingTenantScope
            .filter(scopeQuery, '-created_date', 500)
            .catch(() => []);
          incomplete_accounts = (unscoped || []).map((u: any) => {
            if (!u.email) return null;
            const exact = (myScopes || []).find((s: any) => normaliseEmail(s.email) === normaliseEmail(u.email));
            if (exact) {
              return {
                user_id: u.id, email: u.email, full_name: u.full_name || u.display_name || null,
                created_date: u.created_date, match_type: 'exact',
                matched_invitation: { scope_id: exact.id, email: exact.email, role_type: exact.role_type, customer_id: exact.customer_id, site_id: exact.site_id || null },
              };
            }
            const near = (myScopes || []).find((s: any) => emailsNearMatch(u.email, s.email));
            if (near) {
              return {
                user_id: u.id, email: u.email, full_name: u.full_name || u.display_name || null,
                created_date: u.created_date, match_type: 'near_match',
                matched_invitation: { scope_id: near.id, email: near.email, role_type: near.role_type, customer_id: near.customer_id, site_id: near.site_id || null },
              };
            }
            return null;
          }).filter(Boolean);
        }
      } catch (_) { incomplete_accounts = []; }
    }
    return Response.json({ users: users || [], pending_invitations, incomplete_accounts });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}