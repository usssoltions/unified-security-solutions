/**
 * tenantLookups — SHARED frontend consumption layer for server-side
 * tenant-scoped user lookups (the getTenantUsers gateway).
 *
 * SECURITY: the built-in User entity only lets platform admins list users,
 * so every direct client-side User.list()/User.filter() selector silently
 * returned [] for customer/reseller administrators (the platform-wide
 * empty-dropdown defect). All tenant-sensitive user selectors now go through
 * these helpers — the SERVER resolves the caller's tenant scope; the client
 * only renders what it receives and is never the security boundary.
 *
 * RESPONSE SHAPE: base44.functions.invoke() returns an HTTP-response-like
 * wrapper whose payload lives under res.data. unwrapFunctionPayload() is the
 * single normalisation point for that wrapper — no per-page res.data
 * assumptions.
 *
 * ERROR POLICY: these helpers THROW on failure or a malformed response so the
 * calling query reaches a visible error state. A failed tenant lookup must
 * never render as a silent empty selector.
 */
import { base44 } from "@/api/base44Client";

export function unwrapFunctionPayload(res) {
  return res?.data !== undefined ? res.data : res;
}

export async function fetchTenantUsers() {
  const res = await base44.functions.invoke("getTenantUsers", {});
  const d = unwrapFunctionPayload(res);
  if (!d || !Array.isArray(d.users)) {
    throw new Error("User list response was malformed — no users array returned.");
  }
  return d.users;
}

export function isActiveUser(u) {
  return (u.user_status || u.status || "active") === "active";
}

/** Active Security Guards of the caller's own tenant (server-scoped). */
export async function fetchTenantGuards() {
  const users = await fetchTenantUsers();
  return users.filter(u => u.role_type === "guard" && isActiveUser(u));
}

/** Tenant users holding one of the given role_types (server-scoped). */
export async function fetchTenantUsersInRoles(roles = []) {
  const users = await fetchTenantUsers();
  return users.filter(u => roles.includes(u.role_type));
}

/**
 * Colleagues of the CALLER for chat / operational contact discovery —
 * server-scoped by the getTenantUsers gateway. Admin roles receive their
 * authorised scope; a NON-ADMIN tenant user receives users of their OWN
 * customer only (never reseller-wide, never platform-wide); a user with no
 * tenant scope receives only themselves. Replaces the previous direct
 * User.list(), which the platform permits only to platform admins.
 */
export async function fetchTenantColleagues() {
  const res = await base44.functions.invoke("getTenantUsers", { colleagues: true });
  const d = unwrapFunctionPayload(res);
  if (!d || !Array.isArray(d.users)) {
    throw new Error("User list response was malformed — no users array returned.");
  }
  return d.users;
}