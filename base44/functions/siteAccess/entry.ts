/**
 * siteAccess — the SOLE tenant-access gateway for Site records (site
 * management, site dropdowns, guard shift/checkpoint flows). The Site
 * entity's RLS restricts direct client access to platform admins only;
 * every tenant read/write resolves scope SERVER-SIDE from the caller's
 * User record:
 *   - tenant users → their own customer's sites only (guards/reception read-only)
 *   - tenant manage roles (customer_admin, admin, dispatcher) → create/edit/
 *     delete within their own customer only — client-supplied customer_id /
 *     reseller_id are NEVER trusted as scope authority
 *   - reseller admins → sites within their reseller scope (per-customer lists
 *     are validated to belong to their reseller)
 *   - platform admins → legitimate all-tenant oversight, incl. tenant-migration
 *     scope assignment (the only role allowed to change customer_id/reseller_id)
 * Cross-tenant get/update/delete/checkpoint mutation fails closed with 403.
 * All mutations are audit-logged (PlatformAuditLog); rejected cross-tenant
 * attempts are logged as site.access_denied — never as successful mutations.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

const TENANT_READ_ROLES = ['guard', 'dispatcher', 'admin', 'customer_admin', 'client', 'estate_manager', 'reception', 'management', 'supervisor'];
const TENANT_MANAGE_ROLES = ['customer_admin', 'admin', 'dispatcher'];

function isPlatformAdmin(u) {
  // Mirrors the proven gateways (attendanceAccess / getTenantUsers): the
  // built-in role 'admin' is the USS Platform Admin alongside explicit
  // platform_admin role_type / admin_level. Without it, platform oversight
  // (and the app owner's own access) failed closed with forbidden_role.
  return !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
}
function isResellerAdmin(u) {
  return !!u && !isPlatformAdmin(u) && (u.role_type === 'reseller_admin' || u.admin_level === 'reseller');
}

import { resolveTenantCaller } from '../../shared/tenantCaller.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    // AUTHORITATIVE CALLER RESOLUTION — the caller's User record (re-read
    // server-side via the shared resolver) wins over possibly-stale session
    // claims for customer_id/reseller_id, so an incomplete token can never
    // turn a tenant reader into a silent 403/empty site list.
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({})) || {};
    const action = String(body.action || 'list');
    const svc = base44.asServiceRole;

    const platformAdmin = isPlatformAdmin(caller);
    const resellerAdmin = isResellerAdmin(caller);
    const roleType = caller.role_type;
    const tenantReader = !platformAdmin && !resellerAdmin
      && TENANT_READ_ROLES.indexOf(roleType) !== -1 && !!caller.customer_id;
    const tenantManager = !platformAdmin && !resellerAdmin
      && TENANT_MANAGE_ROLES.indexOf(roleType) !== -1 && !!caller.customer_id;
    const canManage = platformAdmin || resellerAdmin || tenantManager;
    const canRead = platformAdmin || resellerAdmin || tenantReader;

    const callerName = caller.display_name || caller.full_name || caller.email;

    const audit = async (event_type, site, details) => {
      await svc.entities.PlatformAuditLog.create({
        event_type: event_type,
        user_id: caller.id,
        user_name: callerName,
        customer_id: site ? (site.customer_id || null) : (caller.customer_id || null),
        reseller_id: site ? (site.reseller_id || null) : (caller.reseller_id || null),
        entity_name: 'Site',
        entity_id: site ? site.id : null,
        action: event_type,
        notes: details || null,
      }).catch(() => {});
    };

    if (!canRead) {
      // Rejected role access is evidence-logged with the exact server-side
      // resolution — a 403 must never silently look like "0 sites".
      await audit('site.access_denied', null,
        'forbidden_role action=' + action +
        ' role=' + caller.role +
        ' role_type=' + roleType +
        ' admin_level=' + (caller.admin_level || 'none') +
        ' customer_id=' + (caller.customer_id || 'none') +
        ' reseller_id=' + (caller.reseller_id || 'none'));
      return Response.json({ error: 'Your role cannot access site data', code: 'forbidden_role' }, { status: 403 });
    }

    const findSite = async (id) => {
      if (!id) return null;
      const rows = await svc.entities.Site.filter({ id: String(id) }).catch(() => []);
      return (rows && rows[0]) ? rows[0] : null;
    };

    /* Scope assertion for an existing site. Legacy sites without customer_id
       remain readable within their own reseller family. */
    const siteInScope = (site) => {
      if (platformAdmin) return true;
      if (resellerAdmin) return site.reseller_id === caller.reseller_id;
      if (!site.customer_id) return site.reseller_id === caller.reseller_id;
      return site.customer_id === caller.customer_id;
    };

    const denied = (site) => {
      audit('site.access_denied', site, 'denied ' + action + ' on site ' + (site ? site.id : '(missing)') + ' by role ' + roleType);
      return Response.json({ error: 'You do not have access to that site', code: 'forbidden_site' }, { status: 403 });
    };

    if (action === 'list') {
      let sites = [];
      const statusFilter = body.status ? { status: String(body.status) } : {};
      let listScope = 'tenant';
      let listQuery = null;
      try {
        if (platformAdmin) {
          listScope = 'platform';
          if (body.customer_id) {
            listQuery = Object.assign({ customer_id: String(body.customer_id) }, statusFilter);
            sites = await svc.entities.Site.filter(listQuery, '-created_date', 500);
          } else {
            sites = await svc.entities.Site.list('-created_date', 500);
          }
        } else if (resellerAdmin) {
          listScope = 'reseller';
          if (body.customer_id) {
            const custs = await svc.entities.Customer.filter({ id: String(body.customer_id) });
            const cust = (custs && custs[0]) ? custs[0] : null;
            if (!cust || cust.reseller_id !== caller.reseller_id) {
              return Response.json({ error: 'That customer does not belong to your reseller', code: 'forbidden_customer' }, { status: 403 });
            }
            listQuery = Object.assign({ customer_id: cust.id }, statusFilter);
            sites = await svc.entities.Site.filter(listQuery, '-created_date', 500);
          } else {
            listQuery = Object.assign({ reseller_id: caller.reseller_id }, statusFilter);
            sites = await svc.entities.Site.filter(listQuery, '-created_date', 500);
          }
        } else {
          listQuery = Object.assign({ customer_id: caller.customer_id }, statusFilter);
          sites = await svc.entities.Site.filter(listQuery, '-created_date', 500);
        }
      } catch (e) {
        // A backend exception must NEVER surface as an empty site list.
        await audit('site.list_error', null, 'scope=' + listScope + ' query=' + JSON.stringify(listQuery) + ' error=' + ((e && e.message) || String(e)));
        return Response.json({ error: 'The site query failed on the server', code: 'list_failed' }, { status: 500 });
      }
      // End-to-end evidence capture: an EMPTY list is audit-logged with the
      // exact server-side resolution (me() identity, branch, query) so any
      // live "0 sites" report is traceable from Johan's real request.
      if (!(sites || []).length) {
        await audit('site.list_empty', null,
          'scope=' + listScope +
          ' query=' + JSON.stringify(listQuery) +
          ' role=' + caller.role +
          ' role_type=' + roleType +
          ' admin_level=' + (caller.admin_level || 'none') +
          ' caller_customer_id=' + (caller.customer_id || 'none') +
          ' caller_reseller_id=' + (caller.reseller_id || 'none') +
          ' caller_id=' + caller.id);
      }
      return Response.json({ sites: sites || [], can_manage: canManage });
    }

    /* Authoritative customer options for the Site form — always resolved
       server-side so the dropdown can never contain another tenant's
       customers (frontend filtering alone is never trusted). */
    if (action === 'listCustomers') {
      if (!canManage) return Response.json({ error: 'Your role cannot access customer options', code: 'forbidden_action' }, { status: 403 });
      let customers = [];
      let locked = false;
      let locked_customer_id = null;
      if (platformAdmin) {
        customers = await svc.entities.Customer.list('-created_date', 500).catch(() => []);
      } else if (resellerAdmin) {
        customers = await svc.entities.Customer.filter({ reseller_id: caller.reseller_id }, '-created_date', 500).catch(() => []);
      } else {
        // Tenant manage role — own customer only, auto-locked.
        locked = true;
        locked_customer_id = caller.customer_id;
        customers = await svc.entities.Customer.filter({ id: caller.customer_id }).catch(() => []);
      }
      return Response.json({ customers: customers || [], locked: locked, locked_customer_id: locked_customer_id });
    }

    if (action === 'get') {
      const site = await findSite(body.id);
      if (!site) return Response.json({ error: 'Site not found', code: 'not_found' }, { status: 404 });
      if (!siteInScope(site)) return denied(site);
      return Response.json({ site: site });
    }

    if (action === 'create') {
      if (!canManage) return Response.json({ error: 'Your role cannot create sites', code: 'forbidden_action' }, { status: 403 });
      const name = String(body.name || '').trim();
      const address = String(body.address || '').trim();
      let customerId = null;
      let resellerId = null;
      let cust = null;
      if (tenantManager) {
        // Tenant scope is ALWAYS the caller's own customer — never client input.
        customerId = caller.customer_id;
        const custs = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
        cust = (custs && custs[0]) ? custs[0] : null;
        resellerId = (cust && cust.reseller_id) || caller.reseller_id || null;
      } else if (resellerAdmin) {
        customerId = String(body.customer_id || '');
        const custs = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
        cust = (custs && custs[0]) ? custs[0] : null;
        if (!cust || cust.reseller_id !== caller.reseller_id) {
          return Response.json({ error: 'That customer does not belong to your reseller', code: 'forbidden_customer' }, { status: 403 });
        }
        resellerId = caller.reseller_id;
      } else if (body.customer_id) {
        // Platform admin — explicit customer scope (tenant setup).
        customerId = String(body.customer_id);
        const custs = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
        cust = (custs && custs[0]) ? custs[0] : null;
        resellerId = (cust && cust.reseller_id) || null;
      }
      if (!platformAdmin && !customerId) {
        return Response.json({ error: 'Your account is not assigned to a customer', code: 'no_scope' }, { status: 403 });
      }
      // AUTHORITATIVE CLIENT NAME — always the linked Customer record's own
      // name; manually typed text is never trusted (the legacy unscoped
      // platform-created path is the only remaining free-text fallback).
      const client_name = cust ? cust.name : (platformAdmin ? String(body.client_name || '').trim() : '');
      if (!name || !address || !client_name) {
        return Response.json({ error: 'Site name, address and customer are required' }, { status: 400 });
      }
      const created = await svc.entities.Site.create({
        name: name,
        address: address,
        client_name: client_name,
        customer_id: customerId,
        reseller_id: resellerId,
        location: body.location || undefined,
        geofence_radius: body.geofence_radius !== undefined ? (Number(body.geofence_radius) || 100) : 100,
        status: body.status === 'inactive' ? 'inactive' : 'active',
        checkpoints: Array.isArray(body.checkpoints) ? body.checkpoints : [],
        patrol_config: body.patrol_config || { enabled: false, schedules: [] },
        checklist_templates: Array.isArray(body.checklist_templates) ? body.checklist_templates : [],
      });
      await audit('site.created', created, 'created site "' + name + '"');
      return Response.json({ success: true, site: created });
    }

    if (action === 'update') {
      if (!canManage) return Response.json({ error: 'Your role cannot edit sites', code: 'forbidden_action' }, { status: 403 });
      const site = await findSite(body.id);
      if (!site) return Response.json({ error: 'Site not found', code: 'not_found' }, { status: 404 });
      if (!siteInScope(site)) return denied(site);
      const changes = (body.changes && typeof body.changes === 'object') ? body.changes : {};
      if (!Object.keys(changes).length) return Response.json({ success: true, site: site, unchanged: true });

      // Ownership scope: platform admins may re-scope (tenant migration);
      // reseller admins may set the customer within their OWN reseller only
      // (validated server-side); tenant callers can never change ownership.
      // reseller_id and the displayed client_name are ALWAYS derived from the
      // authoritative Customer record — never from client input.
      if (platformAdmin) {
        if (changes.customer_id !== undefined) {
          changes.customer_id = changes.customer_id || null;
          if (changes.customer_id) {
            const custs = await svc.entities.Customer.filter({ id: String(changes.customer_id) }).catch(() => []);
            const cust = (custs && custs[0]) ? custs[0] : null;
            if (cust) {
              changes.reseller_id = cust.reseller_id || null;
              changes.client_name = cust.name;
            }
          }
        }
      } else if (resellerAdmin && changes.customer_id !== undefined && changes.customer_id) {
        const custs = await svc.entities.Customer.filter({ id: String(changes.customer_id) }).catch(() => []);
        const cust = (custs && custs[0]) ? custs[0] : null;
        if (!cust || cust.reseller_id !== caller.reseller_id) {
          return Response.json({ error: 'That customer does not belong to your reseller', code: 'forbidden_customer' }, { status: 403 });
        }
        changes.reseller_id = caller.reseller_id;
        changes.client_name = cust.name;
      } else {
        delete changes.customer_id;
        delete changes.reseller_id;
      }
      if (!platformAdmin && !resellerAdmin && changes.client_name !== undefined && site.customer_id) {
        // Tenant callers: the display name is derived from the linked customer.
        delete changes.client_name;
      }
      const checkpointChanged = changes.checkpoints !== undefined;
      const updated = await svc.entities.Site.update(site.id, changes);
      await audit('site.updated', updated, 'updated site "' + site.name + '"');
      if (checkpointChanged) {
        await audit('site.checkpoint_changed', updated, 'checkpoints changed for site "' + site.name + '"');
      }
      return Response.json({ success: true, site: updated });
    }

    if (action === 'delete') {
      if (!canManage) return Response.json({ error: 'Your role cannot delete sites', code: 'forbidden_action' }, { status: 403 });
      const site = await findSite(body.id);
      if (!site) return Response.json({ error: 'Site not found', code: 'not_found' }, { status: 404 });
      if (!siteInScope(site)) return denied(site);
      await audit('site.deleted', site, 'deleted site "' + site.name + '"');
      await svc.entities.Site.delete(site.id);
      return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}