/**
 * gatewayRoles — SHARED role/admin helpers for tenant-scoped backend gateways.
 *
 * Extracted from the identical per-gateway copies (siteAccess, obAccess, …)
 * so there is exactly ONE implementation of the platform/reseller admin
 * checks: the built-in role 'admin' is the USS Platform Admin alongside
 * explicit platform_admin role_type / admin_level; a reseller admin is
 * explicitly role_type 'reseller_admin' / admin_level 'reseller' (a legacy
 * tenant 'admin' is a CUSTOMER administrator, never a platform admin).
 */
export function isPlatformAdmin(u) {
  return !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
}
export function isResellerAdmin(u) {
  return !!u && !isPlatformAdmin(u) && (u.role_type === 'reseller_admin' || u.admin_level === 'reseller');
}
export function userName(u) {
  return (u && (u.display_name || u.full_name || u.email)) || '—';
}