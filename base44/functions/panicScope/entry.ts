/**
 * panicScope — READ-ONLY server-side PANIC QUEUE scope resolution.
 *
 * Resolves, entirely from server-side tenant data, WHICH panics the caller is
 * authorised to RESPOND to in the shared Panic Management/Queue page. The
 * page's entity reads stay RLS-scoped (tenant isolation); this gateway adds
 * the within-tenant narrowing for the Control Room Operator role:
 *
 *   control_room_operator → EXPLICITLY assigned control rooms only
 *     (ControlRoom.operator_user_ids contains the caller). Her visible
 *     panics are those of the sites/service areas linked to HER rooms; a
 *     panic whose site is linked only to a room she is NOT assigned to
 *     (e.g. CR2) is out of scope. STRICT ATTRIBUTION: an operator sees a
 *     panic ONLY when it is authoritatively attributable to one of her
 *     assigned rooms — via panic.site_id linked to one of her rooms'
 *     service-area sites, or via panic.control_room_id (stored at
 *     activation for operator-originated panics) matching one of her
 *     assigned rooms. A panic with NEITHER valid site scope NOR valid
 *     control-room scope is NOT exposed to customer operators at large —
 *     it remains with explicitly authorised configured responders /
 *     customer emergency oversight only. Tenant isolation itself is NEVER
 *     derived here — cross-tenant access is blocked by PanicAlert RLS and
 *     the managePanic server-side authorization.
 *
 *   every other role → tenant scope (the page keeps its existing view).
 *
 * Also returns the caller's OWN tenant site id→name display map, used to
 * resolve a valid site_id to its real Site name when a panic record carries
 * no site_name snapshot (live trace 2026-09-11: guard panic with valid
 * site_id but empty site_name displayed "Unknown").
 *
 * This function performs NO writes — it can never create, modify or delete
 * any PanicAlert, notification or audit record.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const customerId = caller.customer_id || null;

    // Site display names — the caller's OWN tenant only. Cross-tenant site
    // names never leave the gateway.
    let siteNames = {};
    if (customerId) {
      const sites = (await svc.entities.Site
        .filter({ customer_id: customerId }).catch(() => [])) || [];
      for (const s of sites) siteNames[s.id] = s.name || '';
    }

    // Control Room Operator — explicitly assigned control rooms only.
    if (caller.role_type === 'control_room_operator' && customerId) {
      const rooms = (await svc.entities.ControlRoom
        .filter({ customer_id: customerId, status: 'active' }).catch(() => [])) || [];
      const mine = rooms.filter((r) => (r.operator_user_ids || []).includes(caller.id));

      const mySet = new Set();
      const mySiteIds = [];
      for (const r of mine) {
        for (const sid of (r.linked_site_ids || [])) {
          if (!mySet.has(sid)) { mySet.add(sid); mySiteIds.push(sid); }
        }
      }
      const otherSet = new Set();
      const otherSiteIds = [];
      for (const r of rooms) {
        if (mine.indexOf(r) !== -1) continue;
        for (const sid of (r.linked_site_ids || [])) {
          if (!mySet.has(sid) && !otherSet.has(sid)) { otherSet.add(sid); otherSiteIds.push(sid); }
        }
      }
      return Response.json({
        scope: 'control_room',
        control_room_ids: mine.map((r) => r.id),
        control_room_names: mine.map((r) => r.name || ''),
        site_ids: mySiteIds,
        other_linked_site_ids: otherSiteIds,
        site_names: siteNames,
      });
    }

    // Every other role keeps the existing tenant-wide queue view.
    return Response.json({
      scope: 'tenant',
      control_room_ids: [],
      control_room_names: [],
      site_ids: [],
      other_linked_site_ids: [],
      site_names: siteNames,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}