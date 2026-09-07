/**
 * siteApi — scoped client API for Site records.
 *
 * SECURITY: direct client entity access to Site (base44.entities.Site.*) is
 * restricted to platform admins by the Site entity's RLS. Every tenant
 * read/write must go through the siteAccess backend gateway, which resolves
 * the caller's customer/reseller scope SERVER-SIDE — a browser can never
 * retrieve or mutate another tenant's sites, checkpoints or geofences.
 *
 *   listSites({ customer_id?, status? }) — tenant-scoped sites
 *     (reseller admins may pass a customer_id within their reseller;
 *      platform admins may list any or all tenants)
 *   getSite(id)        — scope-checked single-site read (403 if foreign)
 *   createSite(data)   — ownership (customer_id/reseller_id) resolved
 *                        server-side; client-supplied scopes are ignored
 *   updateSite(id, changes) — scope-checked; ownership fields stripped for
 *                        tenant callers (platform admins may re-scope)
 *   deleteSite(id)     — scope-checked
 */
import { base44 } from "@/api/base44Client";

async function invokeSiteAccess(payload) {
  let res;
  try {
    res = await base44.functions.invoke("siteAccess", payload);
  } catch (e) {
    // The SDK THROWS on non-2xx — surface the gateway's real error message
    // so a rejected tenant request is never a silent empty list.
    const d = e?.response?.data;
    const err = new Error(d?.error || e?.message || "Site request failed");
    err.code = d?.code;
    throw err;
  }
  const d = res?.data !== undefined ? res.data : res;
  if (!d || d.error) {
    const err = new Error(d?.error || "Site request failed");
    err.code = d?.code;
    throw err;
  }
  return d;
}

export async function listSites(params = {}) {
  const d = await invokeSiteAccess({ action: "list", ...params });
  // A malformed/undefined payload must NEVER render as "0 sites" —
  // surface it as a real error instead.
  if (!Array.isArray(d.sites)) {
    throw new Error("Site list response was malformed — no sites array returned.");
  }
  return d.sites;
}

export async function getSite(siteId) {
  const d = await invokeSiteAccess({ action: "get", id: siteId });
  return d.site;
}

export async function createSite(data) {
  return invokeSiteAccess({ action: "create", ...data });
}

export async function updateSite(siteId, changes) {
  return invokeSiteAccess({ action: "update", id: siteId, changes });
}

export async function deleteSite(siteId) {
  return invokeSiteAccess({ action: "delete", id: siteId });
}