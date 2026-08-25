import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * diagnoseResellerRls — empirical RLS verification for the calling user.
 *
 * Runs the EXACT operations ResellerConsole/ResellerCustomers/ResellerSites use,
 * under the caller's own auth context (RLS applies), and reports what the RLS
 * engine actually returned for each. Used to confirm that {{user.data.reseller_id}}
 * resolves and that Reseller/Customer/Site isolation enforces correctly for a
 * reseller admin. Discovery of "other/uss-direct" test IDs uses asServiceRole
 * (bypasses RLS) only to find candidate IDs; the actual access tests use the
 * plain client (caller RLS).
 */
export default async function(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  let caller: any;
  try {
    caller = await base44.auth.me();
  } catch (e) {
    return Response.json({ error: 'not authenticated', detail: String((e as any)?.message || e) });
  }
  if (!caller) return Response.json({ error: 'not authenticated' });

  const out: any = {
    caller: {
      id: caller.id,
      email: caller.email,
      role: caller.role,
      role_type: caller.role_type,
      admin_level: caller.admin_level,
      reseller_id: caller.reseller_id,
      customer_id: caller.customer_id,
    },
    reseller_get_own: null,
    reseller_get_other: null,
    reseller_list: null,
    customer_filter_own_reseller: null,
    customer_get_own: null,
    customer_get_uss_direct: null,
    customer_get_other_reseller: null,
    site_filter_own_reseller: null,
    site_get_unrelated: null,
  };

  // --- Reseller tests ---
  if (caller.reseller_id) {
    try {
      const r = await base44.entities.Reseller.get(caller.reseller_id);
      out.reseller_get_own = r
        ? { ok: true, id: r.id, name: r.name, status: r.status }
        : { ok: false, result: 'null (RLS filtered or not found)' };
    } catch (e: any) {
      out.reseller_get_own = { ok: false, error: String(e?.message || e), status: e?.status };
    }
  } else {
    out.reseller_get_own = { skipped: 'caller has no reseller_id' };
  }

  let otherResellerId: string | null = null;
  try {
    const all: any[] = await base44.asServiceRole.entities.Reseller.list();
    const other = all.find((x: any) => x.id !== caller.reseller_id);
    otherResellerId = other?.id || null;
  } catch (_) {}
  if (otherResellerId) {
    try {
      const r = await base44.entities.Reseller.get(otherResellerId);
      out.reseller_get_other = r
        ? { ok: true, LEAK: true, id: r.id, name: r.name }
        : { ok: false, result: 'null (correctly denied)' };
    } catch (e: any) {
      out.reseller_get_other = { ok: false, error: String(e?.message || e), status: e?.status };
    }
  } else {
    out.reseller_get_other = { skipped: 'no other reseller exists to test against' };
  }

  try {
    const list: any[] = await base44.entities.Reseller.list();
    out.reseller_list = {
      count: list.length,
      ids: list.map((x) => x.id),
      names: list.map((x) => x.name),
    };
  } catch (e: any) {
    out.reseller_list = { error: String(e?.message || e), status: e?.status };
  }

  // --- Customer tests ---
  if (caller.reseller_id) {
    try {
      const c: any[] = await base44.entities.Customer.filter({ reseller_id: caller.reseller_id });
      out.customer_filter_own_reseller = {
        count: c.length,
        names: c.map((x) => x.name),
      };
    } catch (e: any) {
      out.customer_filter_own_reseller = { error: String(e?.message || e), status: e?.status };
    }
  }

  if (caller.customer_id) {
    try {
      const c = await base44.entities.Customer.get(caller.customer_id);
      out.customer_get_own = c
        ? { ok: true, id: c.id, name: c.name }
        : { ok: false, result: 'null' };
    } catch (e: any) {
      out.customer_get_own = { error: String(e?.message || e), status: e?.status };
    }
  } else {
    out.customer_get_own = { skipped: 'caller has no customer_id' };
  }

  try {
    const allC: any[] = await base44.asServiceRole.entities.Customer.list();
    const ussDirect = allC.find((x: any) => !x.reseller_id);
    const otherResC = allC.find((x: any) => x.reseller_id && x.reseller_id !== caller.reseller_id);
    if (ussDirect) {
      try {
        const c = await base44.entities.Customer.get(ussDirect.id);
        out.customer_get_uss_direct = c
          ? { ok: true, LEAK: true, id: c.id, name: c.name, reseller_id: c.reseller_id }
          : { ok: false, result: 'null (correctly denied)' };
      } catch (e: any) {
        out.customer_get_uss_direct = { ok: false, error: String(e?.message || e), status: e?.status };
      }
    } else {
      out.customer_get_uss_direct = { skipped: 'no USS direct (reseller_id=null) customer exists' };
    }
    if (otherResC) {
      try {
        const c = await base44.entities.Customer.get(otherResC.id);
        out.customer_get_other_reseller = c
          ? { ok: true, LEAK: true, id: c.id, name: c.name, reseller_id: c.reseller_id }
          : { ok: false, result: 'null (correctly denied)' };
      } catch (e: any) {
        out.customer_get_other_reseller = { ok: false, error: String(e?.message || e), status: e?.status };
      }
    } else {
      out.customer_get_other_reseller = { skipped: 'no other-reseller customer exists' };
    }
  } catch (e: any) {
    out.customer_get_uss_direct = { error: 'discover failed: ' + String(e?.message || e) };
  }

  // --- Site tests ---
  if (caller.reseller_id) {
    try {
      const s: any[] = await base44.entities.Site.filter({ reseller_id: caller.reseller_id });
      out.site_filter_own_reseller = {
        count: s.length,
        names: s.map((x) => x.name),
      };
    } catch (e: any) {
      out.site_filter_own_reseller = { error: String(e?.message || e), status: e?.status };
    }
  }

  try {
    const allS: any[] = await base44.asServiceRole.entities.Site.list();
    const unrelated = allS.find((x: any) => x.reseller_id !== caller.reseller_id);
    if (unrelated) {
      try {
        const s = await base44.entities.Site.get(unrelated.id);
        out.site_get_unrelated = s
          ? { ok: true, LEAK: true, id: s.id, name: s.name, reseller_id: s.reseller_id }
          : { ok: false, result: 'null (correctly denied)' };
      } catch (e: any) {
        out.site_get_unrelated = { ok: false, error: String(e?.message || e), status: e?.status };
      }
    } else {
      out.site_get_unrelated = { skipped: 'no unrelated site exists' };
    }
  } catch (e: any) {
    out.site_get_unrelated = { error: 'discover failed: ' + String(e?.message || e) };
  }

  return Response.json(out);
}