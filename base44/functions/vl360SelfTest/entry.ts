/**
 * vl360SelfTest — PLATFORM-ADMIN-ONLY isolated verification suite for the USS
 * VOICELINK 360 module. Creates ISOLATED TEST FIXTURES (synthetic customer
 * ids, is_test=true records, 'vl360selftest' prefixes), then exercises the
 * REAL shared code the vl360Access gateway runs on every action:
 *   - entitlement gate (customerModuleLicensed from entitlementActive.ts)
 *   - site-scope derivation (scopedSites from vl360Scope.ts, incl. the
 *     defense-in-depth cross-tenant-assignment filter)
 *   - duplicate-duty prevention input (activeDuty)
 *   - wide-group role + per-site scope gates (vlWideGroupAllowed /
 *     vlWideGroupScopeOk)
 *   - Telegram destination allowlist + telephone number validation
 *     (validateTelegramDest / validatePhoneNumber from vl360Core.ts)
 *   - cross-tenant data isolation of the module entities
 * Every fixture row is deleted before returning. No notifications, no
 * customer enablement, no publish.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { customerModuleLicensed } from '../../shared/entitlementActive.ts';
import { scopedSites, activeDuty, vlWideGroupAllowed, vlWideGroupScopeOk, vlWideGroupSitesOk, startDutySessionAtomic, vlIsSiteAdmin } from '../../shared/vl360Scope.ts';
import { validateTelegramDest, validatePhoneNumber, isVlRole, VL_ROLES } from '../../shared/vl360Core.ts';

const CUST_A = 'vl360selftest-cust-a'; // licensed synthetic tenant
const CUST_B = 'vl360selftest-cust-b'; // unlicensed synthetic tenant

Deno.serve(async (req: Request): Promise<Response> => {
  const base44 = createClientFromRequest(req);
  const svc = base44.asServiceRole;
  const results: { check: string; pass: boolean; detail?: any }[] = [];
  const check = (name: string, pass: boolean, detail: any = null) =>
    results.push({ check: name, pass: Boolean(pass), detail });

  // ── Authorization: platform administration only ──
  let caller: any = null;
  try { caller = await resolveTenantCaller(base44); } catch (_) {}
  const platform = caller && (caller.role_type === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform');
  if (!platform) return Response.json({ error: 'Forbidden — platform administration only.' }, { status: 403 });

  const now = new Date();
  const iso = (d: Date) => d.toISOString();
  const created: Record<string, any[]> = {
    Site: [], ModuleEntitlement: [], VL360Profile: [], VL360SiteAssignment: [],
    VL360SiteComms: [], VL360DutySession: [], VL360PhoneContact: [],
  };
  const track = (entity: string, rec: any) => { if (rec && rec.id) created[entity].push(rec.id); return rec; };

  try {
    // ── Fixtures ──
    const siteA1 = track('Site', await svc.entities.Site.create({ name: 'VL360ST Site A1', address: '1 Test Road', client_name: 'VL360 SelfTest', customer_id: CUST_A, reseller_id: 'vl360selftest', status: 'active' }));
    const siteA2 = track('Site', await svc.entities.Site.create({ name: 'VL360ST Site A2 (inactive)', address: '2 Test Road', client_name: 'VL360 SelfTest', customer_id: CUST_A, reseller_id: 'vl360selftest', status: 'inactive' }));
    const siteB1 = track('Site', await svc.entities.Site.create({ name: 'VL360ST Site B1 (other tenant)', address: '3 Test Road', client_name: 'VL360 SelfTest', customer_id: CUST_B, reseller_id: 'vl360selftest', status: 'active' }));
    const siteA3 = track('Site', await svc.entities.Site.create({ name: 'VL360ST Site A3', address: '4 Test Road', client_name: 'VL360 SelfTest', customer_id: CUST_A, reseller_id: 'vl360selftest', status: 'active' }));
    const CUST_C = 'vl360selftest-cust-c'; // expired-licence synthetic tenant
    const entA = track('ModuleEntitlement', await svc.entities.ModuleEntitlement.create({ customer_id: CUST_A, module_key: 'VOICELINK360', enabled: true, status: 'active', licence_start: iso(new Date(now.getTime() - 86400000)) }));
    track('ModuleEntitlement', await svc.entities.ModuleEntitlement.create({ customer_id: CUST_C, module_key: 'VOICELINK360', enabled: true, status: 'active', licence_start: iso(new Date(now.getTime() - 2 * 86400000)), licence_end: iso(new Date(now.getTime() - 86400000)) }));
    const entB = track('ModuleEntitlement', await svc.entities.ModuleEntitlement.create({ customer_id: CUST_B, module_key: 'VOICELINK360', enabled: false, status: 'suspended' }));

    const profAdminA = track('VL360Profile', await svc.entities.VL360Profile.create({ user_id: 'vl360st-admin-a', customer_id: CUST_A, vl_role: 'customer_admin', enabled: true, contact_status: 'unconfigured' }));
    const profGuard1 = track('VL360Profile', await svc.entities.VL360Profile.create({ user_id: 'vl360st-guard-1', customer_id: CUST_A, vl_role: 'guard', enabled: true }));
    const profGuard2 = track('VL360Profile', await svc.entities.VL360Profile.create({ user_id: 'vl360st-guard-2', customer_id: CUST_A, vl_role: 'guard', enabled: true }));
    const profGuard3 = track('VL360Profile', await svc.entities.VL360Profile.create({ user_id: 'vl360st-guard-3', customer_id: CUST_A, vl_role: 'guard', enabled: true }));
    track('VL360SiteAssignment', await svc.entities.VL360SiteAssignment.create({ customer_id: CUST_A, user_id: 'vl360st-guard-1', site_id: siteA1.id, kind: 'personnel' }));
    track('VL360SiteAssignment', await svc.entities.VL360SiteAssignment.create({ customer_id: CUST_A, user_id: 'vl360st-guard-1', site_id: siteA2.id, kind: 'personnel' }));
    // Crafted adversarial row: claims customer A but points at customer B's site.
    track('VL360SiteAssignment', await svc.entities.VL360SiteAssignment.create({ customer_id: CUST_A, user_id: 'vl360st-guard-3', site_id: siteB1.id, kind: 'personnel' }));

    // ── 1. Entitlement gate (real helper) ──
    check('entitlement licensed customer', (await customerModuleLicensed(svc, CUST_A, ['VOICELINK360'])) === true);
    check('entitlement unlicensed customer refuses', (await customerModuleLicensed(svc, CUST_B, ['VOICELINK360'])) === false);
    check('entitlement expired licence refuses', (await customerModuleLicensed(svc, 'vl360selftest-cust-c', ['VOICELINK360'])) === false);
    check('role keys: all five roles valid', VL_ROLES.every(isVlRole));
    check('role keys: unknown role invalid', isVlRole('platform_admin') === false);

    // ── 2. Site-scope derivation (real helper) ──
    const adminSites = await scopedSites(svc, profAdminA, true, CUST_A);
    const adminSiteIds = new Set(adminSites.map((s: any) => s.id));
    check('admin sees all ACTIVE customer sites', adminSiteIds.has(siteA1.id) && adminSiteIds.has(siteA3.id) && !adminSiteIds.has(siteA2.id) && adminSites.length === 2, adminSites);
    const g1Sites = await scopedSites(svc, profGuard1, false, CUST_A);
    check('guard scoped to assigned ACTIVE site only', g1Sites.length === 1 && g1Sites[0].id === siteA1.id, g1Sites);
    const g2Sites = await scopedSites(svc, profGuard2, false, CUST_A);
    check('unassigned guard has EMPTY scope', g2Sites.length === 0, g2Sites);
    const g3Sites = await scopedSites(svc, profGuard3, false, CUST_A);
    check('cross-tenant assignment row yields NO site', g3Sites.length === 0, g3Sites);

    // ── 3. Duty session input (real helper) ──
    const duty = track('VL360DutySession', await svc.entities.VL360DutySession.create({ customer_id: CUST_A, user_id: 'vl360st-guard-1', status: 'active', started_at: iso(now) }));
    check('activeDuty finds the active session', (await activeDuty(svc, 'vl360st-guard-1', CUST_A))?.id === duty.id);
    check('activeDuty empty for other user', (await activeDuty(svc, 'vl360st-guard-2', CUST_A)) === null);
    await svc.entities.VL360DutySession.update(duty.id, { status: 'closed', closed_at: iso(now) });
    check('activeDuty null after close (dup prevention)', (await activeDuty(svc, 'vl360st-guard-1', CUST_A)) === null);

    // ── 3b. Concurrency: SIMULTANEOUS duty starts (real CAS helper) ──
    // A closed session returning null proves nothing about races; this fires
    // FIVE duty starts through the real startDutySessionAtomic helper at the
    // same instant and asserts exactly one active session survives.
    const parallel = await Promise.all([0, 1, 2, 3, 4].map(() =>
      startDutySessionAtomic(svc, { customerId: CUST_A, resellerId: 'vl360selftest', userId: 'vl360st-guard-2', userName: 'ST Guard Two', siteRow: siteA1, isTest: true })));
    parallel.filter((r: any) => r.session).forEach((r: any) => track('VL360DutySession', r.session));
    const concurrentActive = await svc.entities.VL360DutySession.filter({ customer_id: CUST_A, user_id: 'vl360st-guard-2', status: 'active' }).catch(() => []);
    check('5 concurrent duty starts yield exactly ONE active session',
      (concurrentActive || []).length === 1,
      { created: parallel.filter((r: any) => r.session).length, busy: parallel.filter((r: any) => r.busy).length });
    const profAfter = await svc.entities.VL360Profile.filter({ user_id: 'vl360st-guard-2', customer_id: CUST_A }).catch(() => []);
    check('duty claim released after concurrent start', !profAfter?.[0]?.duty_claim_token);

    // ── 4. Wide-group gates (real helpers) ──
    check('wide group: guard DENIED', vlWideGroupAllowed('guard', false) === false);
    check('wide group: armed_response DENIED', vlWideGroupAllowed('armed_response', false) === false);
    check('wide group: supervisor allowed', vlWideGroupAllowed('supervisor', false) === true);
    check('wide group: controller allowed', vlWideGroupAllowed('control_room_operator', false) === true);
    check('wide group: customer_admin allowed', vlWideGroupAllowed('customer_admin', false) === true);
    check('wide group: platform admin allowed', vlWideGroupAllowed('guard', true) === true);
    check('management scope: supervisor excluded', vlWideGroupScopeOk({ wide_group_scope: 'management' }, 'supervisor', false) === false);
    check('management scope: controller excluded', vlWideGroupScopeOk({ wide_group_scope: 'management' }, 'control_room_operator', false) === false);
    check('management scope: customer_admin allowed', vlWideGroupScopeOk({ wide_group_scope: 'management' }, 'customer_admin', false) === true);
    check('scope "all": supervisor allowed', vlWideGroupScopeOk({ wide_group_scope: 'all' }, 'supervisor', false) === true);

    // ── 4b. Wider-group COMPLETE SITE SCOPE (controller assigned only Site A) ──
    const profCtrl = track('VL360Profile', await svc.entities.VL360Profile.create({ user_id: 'vl360st-ctrl-1', customer_id: CUST_A, vl_role: 'control_room_operator', enabled: true }));
    track('VL360SiteAssignment', await svc.entities.VL360SiteAssignment.create({ customer_id: CUST_A, user_id: 'vl360st-ctrl-1', site_id: siteA1.id, kind: 'controller' }));
    const commsAB = track('VL360SiteComms', await svc.entities.VL360SiteComms.create({ customer_id: CUST_A, site_id: siteA1.id, wide_group_dest: 'https://t.me/vl360stwidegroup', wide_group_scope: 'all', wide_group_site_ids: [siteA1.id, siteA3.id] }));
    const ctrlSites = new Set((await scopedSites(svc, profCtrl, false, CUST_A)).map((s: any) => s.id));
    check('wide group Sites A+A3: controller of Site A only DENIED', vlWideGroupSitesOk(commsAB, ctrlSites, false, false) === false);
    track('VL360SiteAssignment', await svc.entities.VL360SiteAssignment.create({ customer_id: CUST_A, user_id: 'vl360st-ctrl-1', site_id: siteA3.id, kind: 'controller' }));
    const ctrlSitesFull = new Set((await scopedSites(svc, profCtrl, false, CUST_A)).map((s: any) => s.id));
    check('wide group Sites A+A3: controller authorised for complete scope allowed', vlWideGroupSitesOk(commsAB, ctrlSitesFull, false, false) === true);
    const commsCross = track('VL360SiteComms', await svc.entities.VL360SiteComms.create({ customer_id: CUST_A, site_id: siteA1.id, wide_group_site_ids: [siteA1.id, siteB1.id] }));
    check('wide group covering a cross-customer site stays DENIED', vlWideGroupSitesOk(commsCross, ctrlSitesFull, false, false) === false);
    check('wide group site scope: customer admin whole-customer allowed', vlWideGroupSitesOk(commsAB, new Set(), true, false) === true);
    check('wide group single-site group needs no extra scope', vlWideGroupSitesOk({ wide_group_site_ids: [] }, new Set(), false, false) === true);

    // ── 4c. SITE MANAGEMENT MUTATIONS — administrators ONLY (negative tests
    // against the REAL predicate the gateway's sites_list_all / site_save
    // actions evaluate) ──
    track('VL360Profile', await svc.entities.VL360Profile.create({ user_id: 'vl360st-sup-1', customer_id: CUST_A, vl_role: 'supervisor', enabled: true, management_powers: true }));
    track('VL360Profile', await svc.entities.VL360Profile.create({ user_id: 'vl360st-armed-1', customer_id: CUST_A, vl_role: 'armed_response', enabled: true }));
    check('site mgmt: customer_admin allowed', vlIsSiteAdmin({ vl_role: 'customer_admin' }, false) === true);
    check('site mgmt: platform admin allowed', vlIsSiteAdmin({ vl_role: 'guard' }, true) === true);
    check('site mgmt: EMPOWERED supervisor (management_powers) denied', vlIsSiteAdmin({ vl_role: 'supervisor', management_powers: true }, false) === false);
    check('site mgmt: control_room_operator denied', vlIsSiteAdmin({ vl_role: 'control_room_operator' }, false) === false);
    check('site mgmt: guard denied', vlIsSiteAdmin({ vl_role: 'guard' }, false) === false);
    check('site mgmt: armed_response denied', vlIsSiteAdmin({ vl_role: 'armed_response' }, false) === false);
    check('site mgmt: null profile denied', vlIsSiteAdmin(null, false) === false);

    // ── 5. Destination + number validation (real helpers) ──
    check('telegram https://t.me ok', validateTelegramDest('https://t.me/usstestbot').ok === true);
    check('telegram telegram.me ok', validateTelegramDest('https://telegram.me/USS_Test').ok === true);
    check('telegram private invite ok', validateTelegramDest('https://t.me/+AbCdEf123').ok === true);
    check('telegram joinchat ok', validateTelegramDest('https://t.me/joinchat/AbCdEf').ok === true);
    check('telegram tg://resolve ok', validateTelegramDest('tg://resolve?domain=ussctrl').ok === true);
    check('telegram http:// rejected', validateTelegramDest('http://t.me/usstestbot').ok === false);
    check('telegram other host rejected', validateTelegramDest('https://evil.com/usstestbot').ok === false);
    check('telegram javascript: rejected', validateTelegramDest('javascript:alert(1)').ok === false);
    check('telegram bare domain rejected', validateTelegramDest('t.me/usstestbot').ok === false);
    check('telegram short slug rejected', validateTelegramDest('https://t.me/ab').ok === false);
    check('phone international ok', validatePhoneNumber('+27 82 555 1234').ok === true);
    check('phone leading zero ok', validatePhoneNumber('021 555-0100').ok === true);
    check('phone letters rejected', validatePhoneNumber('call support').ok === false);
    check('phone injection chars rejected', validatePhoneNumber('<script>').ok === false);

    // ── 6. Cross-tenant data isolation ──
    const contactA = track('VL360PhoneContact', await svc.entities.VL360PhoneContact.create({ customer_id: CUST_A, label: 'VL360ST Control Room', number: '021 555 0100' }));
    const contactsB = await svc.entities.VL360PhoneContact.filter({ customer_id: CUST_B }).catch(() => []);
    check('phone contact isolated across tenants', !(contactsB || []).some((c: any) => c.id === contactA.id));
    const dutyB = await svc.entities.VL360DutySession.filter({ customer_id: CUST_B, status: 'active' }).catch(() => []);
    check('duty sessions isolated across tenants', !(dutyB || []).some((d: any) => d.customer_id === CUST_A));

    // ── Cleanup: delete every fixture row ──
    const cleanup: Record<string, number> = {};
    for (const [entity, ids] of Object.entries(created)) {
      if (!ids.length) continue;
      try { await svc.entities[entity].deleteMany({ id: { $in: ids } }); cleanup[entity] = ids.length; } catch (e) { cleanup[entity] = -1; }
    }
    const residual = await svc.entities.VL360Profile.filter({ user_id: { $regex: '^vl360st-' } }).catch(() => []);
    if (residual && residual.length) { try { await svc.entities.VL360Profile.deleteMany({ user_id: { $regex: '^vl360st-' } }); } catch (_) {} }

    const passed = results.filter(r => r.pass).length;
    return Response.json({
      selftest: 'vl360', passed, failed: results.length - passed, total: results.length,
      all_passed: passed === results.length, results, cleanup,
    });
  } catch (error) {
    // Best-effort cleanup even on failure
    for (const [entity, ids] of Object.entries(created)) {
      if (ids.length) { try { await svc.entities[entity].deleteMany({ id: { $in: ids } }); } catch (_) {} }
    }
    return Response.json({ selftest: 'vl360', fatal: String((error as any)?.message || error), results }, { status: 500 });
  }
});