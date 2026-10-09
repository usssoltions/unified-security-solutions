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

/** Wide All Personnel group — COMPLETE SITE SCOPE gate: when a wider group is
 *  explicitly configured to cover several sites, a caller may open it ONLY if
 *  their server-derived authorised sites contain EVERY listed site. Role alone
 *  never grants a controller or supervisor a group covering unallocated sites;
 *  customer administrators and platform admins hold whole-customer scope.
 *  Empty/absent list = the group belongs to this site alone (only the usual
 *  per-site scope check applies). */
export function vlWideGroupSitesOk(comms: any, scopedIds: Set<string>, isVlAdmin: boolean, platformAdmin: boolean): boolean {
  if (!comms || platformAdmin || isVlAdmin) return true;
  const ids = comms.wide_group_site_ids;
  if (!Array.isArray(ids) || !ids.length) return true;
  return ids.every((id: string) => scopedIds.has(id));
}

/** ATOMIC duplicate prevention for duty_on. The platform database has no
 *  transactions or unique constraints, so two simultaneous "Go On Duty"
 *  requests could otherwise BOTH pass the read-check and create two active
 *  sessions. This uses the platform's conditional-update (CAS) pattern:
 *  1. CLAIM — a conditional updateMany on the caller's VL360Profile pins the
 *     exact prior claim state (token null, or a >2-minute-stale token) and
 *     sets a fresh unique token. Writes are serialised server-side, so only
 *     ONE concurrent claim's conditional update can ever match — a loser
 *     matches nothing and is verified as lost by re-reading the profile.
 *  2. SUPERSEDE — any active session that raced in is closed.
 *  3. CREATE — the single new active session.
 *  4. RELEASE — the claim is cleared, conditionally on its own token.
 *  A crashed attempt leaves a stale claim the next duty_on takes over after
 *  2 minutes. Returns { session, busy } — busy means another duty start is in
 *  flight; the caller should re-check activeDuty and may retry. */
export async function startDutySessionAtomic(svc: any, opts: {
  customerId: string; resellerId: string | null; userId: string; userName: string;
  siteRow: any; isTest: boolean;
}): Promise<{ session: any; busy: boolean }> {
  const token = 'duty_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const nowIso = () => new Date().toISOString();
  const profFilter = { customer_id: opts.customerId, user_id: opts.userId };
  const claim = async (priorState: any): Promise<boolean> => {
    try {
      await svc.entities.VL360Profile.updateMany({ ...profFilter, ...priorState }, {
        $set: { duty_claim_token: token, duty_claim_at: nowIso() },
      });
    } catch (_) { return false; }
    const rows = await svc.entities.VL360Profile.filter(profFilter).catch(() => []);
    return !!(rows && rows[0] && rows[0].duty_claim_token === token);
  };
  // 1. free-profile claim; 2. stale-claim takeover (> 2 minutes old)
  let won = await claim({ duty_claim_token: null });
  if (!won) {
    won = await claim({
      duty_claim_token: { $ne: null },
      duty_claim_at: { $lt: new Date(new Date().getTime() - 2 * 60 * 1000).toISOString() },
    });
  }
  if (!won) return { session: null, busy: true };
  try {
    // 2. close any active session that raced in (superseded by the new one)
    await svc.entities.VL360DutySession.updateMany(
      { customer_id: opts.customerId, user_id: opts.userId, status: 'active' },
      { $set: { status: 'closed', closed_at: nowIso(), closed_by_id: opts.userId, closed_by_name: opts.userName, close_reason: 'superseded_by_new_session' } },
    ).catch(() => {});
    // 3. the single new active session
    const session = await svc.entities.VL360DutySession.create({
      customer_id: opts.customerId, reseller_id: opts.resellerId, user_id: opts.userId, user_name: opts.userName,
      site_id: opts.siteRow?.id || null, site_name: opts.siteRow?.name || null,
      status: 'active', started_at: nowIso(), last_confirmed_at: nowIso(),
      is_test: opts.isTest === true,
    });
    return { session, busy: false };
  } finally {
    // 4. release the claim, conditionally on our own token
    await svc.entities.VL360Profile.updateMany({ ...profFilter, duty_claim_token: token }, {
      $set: { duty_claim_token: null, duty_claim_at: null },
    }).catch(() => {});
  }
}