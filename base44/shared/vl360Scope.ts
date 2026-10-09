/**
 * vl360Scope — shared server-side scope helpers for the VOICELINK 360 module.
 * Imported by BOTH the vl360Access gateway and the vl360SelfTest function, so
 * the isolated self-test exercises the REAL scope derivation code that every
 * gateway action runs.
 */

/** Active sites the caller may act on: VL admins see the whole customer's
 *  active sites; every other role sees only their own assignments' sites —
 *  and ONLY sites that exist AND belong to the caller's own customer
 *  (defense-in-depth: a crafted cross-tenant assignment row can never leak
 *  another customer's site through this path). */
export async function scopedSites(svc: any, profile: any, isVlAdmin: boolean, customerId: string) {
  if (isVlAdmin) {
    const sites = await svc.entities.Site.filter({ customer_id: customerId, status: 'active' }).catch(() => []);
    return (sites || []).map((s: any) => ({ id: s.id, name: s.name }));
  }
  const asg = await svc.entities.VL360SiteAssignment.filter({ customer_id: customerId, user_id: profile.user_id }).catch(() => []);
  const ids = [...new Set((asg || []).map((a: any) => a.site_id).filter(Boolean))];
  if (!ids.length) return [];
  const sites = await svc.entities.Site.filter({ id: { $in: ids }, customer_id: customerId, status: 'active' }).catch(() => []);
  return (sites || []).map((s: any) => ({ id: s.id, name: s.name }));
}

/** The caller's single active duty session (drives duplicate-session
 *  prevention in duty_on and the bootstrap/resume display). */
export async function activeDuty(svc: any, userId: string, customerId: string) {
  const rows = await svc.entities.VL360DutySession.filter({ customer_id: customerId, user_id: userId, status: 'active' }).catch(() => []);
  return (rows && rows[0]) || null;
}

/** Wide All Personnel group — ROLE gate (server-side, mirrors the spec):
 *  Guards and Armed Response Officers NEVER see wide-group actions;
 *  Supervisors, Control Room Operators and Customer Administrators do.
 *  Platform administrators retain their oversight scope. */
export function vlWideGroupAllowed(vlRole: string, platformAdmin: boolean): boolean {
  if (platformAdmin) return true;
  return ['customer_admin', 'control_room_operator', 'supervisor'].includes(vlRole);
}

/** Wide All Personnel group — per-site ACCESS SCOPE gate: a site whose wider
 *  group is scoped 'management' excludes Supervisors and Control Room
 *  Operators (Customer Administrators and platform admins keep access). */
export function vlWideGroupScopeOk(comms: any, vlRole: string, platformAdmin: boolean): boolean {
  if (!comms || comms.wide_group_scope !== 'management') return true;
  return platformAdmin || vlRole === 'customer_admin';
}