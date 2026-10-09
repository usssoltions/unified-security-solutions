import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { entitlementIsActiveNow, customerModuleLicensed } from '../../shared/entitlementActive.ts';
import { isPlatformAdmin, isResellerAdmin, userName } from '../../shared/gatewayRoles.ts';
import {
  VL_MODULE_KEY, VL_ROLES, VL_ROLE_LABELS, isVlRole, vlRoleForPlatformRole,
  validateTelegramDest, validatePhoneNumber, actorName,
} from '../../shared/vl360Core.ts';

/**
 * vl360Access — THE single server-side gateway for the USS VOICELINK 360
 * module (a new, independently licensed communications module).
 *
 * SECURITY POSTURE (every action, first save):
 *   1. Authentication — the caller is resolved from the session (never from
 *      the browser payload).
 *   2. Entitlement — the caller's SERVER-RESOLVED customer must hold an
 *      active VOICELINK360 ModuleEntitlement (central entitlementActive rule);
 *      platform administrators retain their established management scope.
 *   3. Role — actions are gated by the server-resolved VoiceLink operational
 *      role (VL360Profile); role assignments never change platform roles and
 *      users can never grant themselves permissions.
 *   4. Site scope — every site-scoped action validates the site against the
 *      caller's server-resolved authorised sites. Cross-customer and
 *      unauthorised cross-site access fail closed with 403.
 *   5. Destinations — stored Telegram links are re-validated on every open;
 *      only the allowlisted Telegram link forms are ever returned. Activity
 *      records describe actions initiated from USS and make NO claims about
 *      call outcomes, delivery or presence.
 *
 * The old Voice Link module (voiceLink gateway, VoiceLink* entities, pages)
 * is NOT read, referenced or modified by this code.
 */

const DENIED = (msg: string, code = 'permission_denied', status = 403) =>
  Response.json({ error: msg, code }, { status });

const FAIL = (msg: string, code = 'bad_request', status = 400) =>
  Response.json({ error: msg, code }, { status });

async function ensureProfile(svc: any, user: any, customerId: string, resellerId: string | null) {
  const rows = await svc.entities.VL360Profile.filter({ user_id: user.id, customer_id: customerId }).catch(() => []);
  if (rows && rows[0]) return rows[0];
  const role = vlRoleForPlatformRole(user.role_type) || 'guard';
  return await svc.entities.VL360Profile.create({
    user_id: user.id, customer_id: customerId, reseller_id: resellerId,
    vl_role: role, enabled: true, contact_status: 'unconfigured',
    external_calling_enabled: false, management_powers: false,
  });
}

async function scopedSites(svc: any, profile: any, isVlAdmin: boolean, customerId: string) {
  if (isVlAdmin) {
    const sites = await svc.entities.Site.filter({ customer_id: customerId, status: 'active' }).catch(() => []);
    return (sites || []).map((s: any) => ({ id: s.id, name: s.name }));
  }
  const asg = await svc.entities.VL360SiteAssignment.filter({ customer_id: customerId, user_id: profile.user_id }).catch(() => []);
  const ids = [...new Set((asg || []).map((a: any) => a.site_id).filter(Boolean))];
  if (!ids.length) return [];
  const sites = await svc.entities.Site.filter({ id: { $in: ids }, status: 'active' }).catch(() => []);
  return (sites || []).map((s: any) => ({ id: s.id, name: s.name }));
}

async function activeDuty(svc: any, userId: string, customerId: string) {
  const rows = await svc.entities.VL360DutySession.filter({ customer_id: customerId, user_id: userId, status: 'active' }).catch(() => []);
  return (rows && rows[0]) || null;
}

async function logActivity(svc: any, entry: Record<string, any>) {
  try { await svc.entities.VL360Activity.create(entry); } catch (_) { /* audit is best-effort */ }
}

function publicProfile(p: any) {
  if (!p) return null;
  return {
    user_id: p.user_id, vl_role: p.vl_role, vl_role_label: VL_ROLE_LABELS[p.vl_role] || p.vl_role,
    enabled: p.enabled !== false, personnel_id: p.personnel_id || null,
    contact_status: p.contact_status || 'unconfigured',
    external_calling_enabled: !!p.external_calling_enabled,
    management_powers: !!p.management_powers, telegram_username: p.telegram_username || null,
  };
}

async function targetUserIsProtected(svc: any, userId: string): Promise<boolean> {
  const rows = await svc.entities.User.filter({ id: userId }).catch(() => []);
  const u = (rows || [])[0];
  return !u || u.role === 'admin' || u.role_type === 'platform_admin' || u.role_type === 'reseller_admin';
}

export default async function(req: Request): Promise<Response> {
  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const action = body.action;

  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Authentication required', code: 'auth_required' }, { status: 401 });
    const svc = base44.asServiceRole;
    const platformAdmin = isPlatformAdmin(caller);

    // Platform administrators keep their established management scope and may
    // operate the module for a customer they select. Every other caller is
    // strictly bound to their SERVER-RESOLVED customer and an ACTIVE licence.
    let customerId = caller.customer_id || null;
    let resellerId = caller.reseller_id || null;
    if (platformAdmin && body.customer_id) {
      const rows = await svc.entities.Customer.filter({ id: body.customer_id }).catch(() => []);
      if (!rows || !rows[0]) return FAIL('Selected customer not found', 'customer_not_found', 404);
      customerId = rows[0].id; resellerId = rows[0].reseller_id || null;
    }
    if (!platformAdmin && body.customer_id && body.customer_id !== customerId) {
      return DENIED('Cross-customer access is not permitted', 'cross_tenant_denied');
    }
    if (!customerId) {
      return DENIED('No customer scope is linked to this account.', 'no_tenant_scope');
    }
    if (!platformAdmin) {
      const licensed = await customerModuleLicensed(svc, customerId, [VL_MODULE_KEY]);
      if (!licensed) {
        return DENIED('VoiceLink 360 is not licensed for your organisation.', 'entitlement_required');
      }
    }

    const profile = await ensureProfile(svc, caller, customerId, resellerId);
    if (profile.enabled === false && !platformAdmin) {
      return DENIED('Your VoiceLink 360 access has been removed.', 'profile_disabled');
    }
    const isVlAdmin = profile.vl_role === 'customer_admin';
    const canManage = isVlAdmin || platformAdmin || (!!profile.management_powers && profile.vl_role === 'supervisor');
    const sites = await scopedSites(svc, profile, isVlAdmin, customerId);
    const scopedIds = new Set(sites.map((s: any) => s.id));
    const actor = actorName(caller);
    const nowIso = () => new Date().toISOString();

    switch (action) {
      // ── bootstrap: the caller's own context (server-resolved) ──
      case 'bootstrap': {
        const duty = await activeDuty(svc, caller.id, customerId);
        return Response.json({
          customer_id: customerId, role: profile.vl_role, role_label: VL_ROLE_LABELS[profile.vl_role] || profile.vl_role,
          profile: publicProfile(profile), sites, duty: duty ? {
            id: duty.id, site_id: duty.site_id, site_name: duty.site_name,
            started_at: duty.started_at, last_confirmed_at: duty.last_confirmed_at,
          } : null,
          can_manage: canManage, wide_group_allowed: !platformAdmin
            ? ['customer_admin', 'control_room_operator', 'supervisor'].includes(profile.vl_role) : true,
        });
      }

      // ── personnel list (scope-filtered; minimal fields only) ──
      case 'list_personnel': {
        const siteFilter: string | null = body.site_id || null;
        if (siteFilter && !scopedIds.has(siteFilter)) return DENIED('That site is not within your authorised scope.');
        let siteIds = siteFilter ? [siteFilter] : [...scopedIds];
        if (!isVlAdmin && profile.vl_role === 'guard') {
          // A guard sees only personnel who share one of their authorised sites.
          const mine = await svc.entities.VL360SiteAssignment.filter({ customer_id: customerId, user_id: caller.id }).catch(() => []);
          const mySites = new Set((mine || []).map((a: any) => a.site_id));
          siteIds = siteIds.filter((s: string) => mySites.has(s));
          if (!siteIds.length) return Response.json({ personnel: [], sites });
        }
        if (!siteIds.length) return Response.json({ personnel: [], sites });
        const asg = await svc.entities.VL360SiteAssignment.filter({ customer_id: customerId, site_id: { $in: siteIds } }).catch(() => []);
        const userIds = [...new Set((asg || []).map((a: any) => a.user_id))];
        const profiles = await svc.entities.VL360Profile.filter({ customer_id: customerId, user_id: { $in: userIds }, enabled: true }).catch(() => []);
        const profById: Record<string, any> = {};
        (profiles || []).forEach((p: any) => { profById[p.user_id] = p; });
        const dutyRows = await svc.entities.VL360DutySession.filter({ customer_id: customerId, status: 'active', site_id: { $in: siteIds } }).catch(() => []);
        const dutyByUser: Record<string, any> = {};
        (dutyRows || []).forEach((d: any) => { dutyByUser[d.user_id] = d; });
        const users = await svc.entities.User.filter({ id: { $in: userIds } }).catch(() => []);
        const userById: Record<string, any> = {};
        (users || []).forEach((u: any) => { userById[u.id] = u; });
        const personnel = (asg || [])
          .filter((a: any) => profById[a.user_id] && userById[a.user_id])
          .map((a: any) => {
            const p = profById[a.user_id]; const u = userById[a.user_id]; const d = dutyByUser[a.user_id];
            return {
              user_id: a.user_id, name: u.full_name || u.display_name || u.email,
              personnel_id: p.personnel_id || u.badge_number || null,
              vl_role: p.vl_role, vl_role_label: VL_ROLE_LABELS[p.vl_role] || p.vl_role,
              site_id: a.site_id, site_name: (sites.find((s: any) => s.id === a.site_id) || {}).name || null,
              on_duty: !!d, duty_started_at: d?.started_at || null, duty_site_id: d?.site_id || null,
              contact_configured: !!p.contact_link, telegram_username: isVlAdmin ? (p.telegram_username || null) : null,
            };
          });
        // Deduplicate by user across shared sites (personnel assigned to many sites).
        const seen = new Set();
        const deduped = personnel.filter((p: any) => (seen.has(p.user_id + ':' + p.site_id) ? false : (seen.add(p.user_id + ':' + p.site_id), true)));
        return Response.json({ personnel: deduped, sites });
      }

      // ── single profile read (management; used by edit-user forms) ──
      case 'get_profile': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const pRows = await svc.entities.VL360Profile.filter({ user_id: body.target_user_id, customer_id: customerId }).catch(() => []);
        return Response.json({ profile: publicProfile((pRows || [])[0] || null) });
      }

      // ── destination resolution + handoff attempt record ──
      case 'resolve_destination': {
        const t = body.target || {};
        const type = t.type;
        const siteId = t.site_id || null;
        if (siteId && !scopedIds.has(siteId)) return DENIED('That site is not within your authorised scope.', 'site_not_authorised');
        if (type === 'individual') {
          if (!t.user_id) return FAIL('A colleague must be selected.', 'missing_target');
          if (t.user_id === caller.id) return FAIL('Select another colleague.', 'self_target');
          const tRows = await svc.entities.VL360Profile.filter({ customer_id: customerId, user_id: t.user_id, enabled: true }).catch(() => []);
          const tp = (tRows || [])[0];
          if (!tp) return Response.json({ error: 'That colleague has no VoiceLink 360 profile.', code: 'missing_configuration', missing: 'individual' }, { status: 400 });
          if (!isVlAdmin) {
            const tAsg = await svc.entities.VL360SiteAssignment.filter({ customer_id: customerId, user_id: t.user_id }).catch(() => []);
            const shared = (tAsg || []).some((a: any) => scopedIds.has(a.site_id));
            if (!shared) return DENIED('That colleague is outside your authorised sites.', 'site_not_authorised');
          }
          const v = validateTelegramDest(tp.contact_link || '');
          if (!v.ok) return Response.json({ error: 'This colleague has no confirmed conversation destination yet.', code: 'missing_configuration', missing: 'individual' }, { status: 400 });
          const uRows = await svc.entities.User.filter({ id: t.user_id }).catch(() => []);
          const label = userName((uRows || [])[0]);
          await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'open_conversation', destination_type: 'individual', destination_label: label, target_name: label, detail: 'Handoff attempted: individual conversation opened in Telegram.' });
          return Response.json({ label, link: v.link, app: 'Telegram', hint: 'Opens the conversation. Tap Call, Video or send your message inside Telegram.' });
        }
        // Site-scoped destinations
        if (!siteId) return FAIL('Select a site first.', 'missing_site');
        const siteRow = sites.find((s: any) => s.id === siteId);
        const commsRows = await svc.entities.VL360SiteComms.filter({ customer_id: customerId, site_id: siteId }).catch(() => []);
        const comms = (commsRows || [])[0] || null;
        const map: Record<string, string | null> = comms ? {
          control_room: comms.control_room_dest, site_group: comms.group_dest,
          emergency_group: comms.emergency_dest, wide_group: comms.wide_group_dest,
        } : {};
        const labels: Record<string, string | null> = comms ? {
          control_room: comms.control_room_label || 'Control Room', site_group: comms.group_label || 'Site Group',
          emergency_group: comms.emergency_label || 'Emergency Team', wide_group: comms.wide_group_label || 'All Personnel',
        } : {};
        if (type === 'wide_group') {
          if (!['customer_admin', 'control_room_operator', 'supervisor'].includes(profile.vl_role) && !platformAdmin) {
            return DENIED('Wide All Personnel communication is not part of your role.', 'permission_denied');
          }
          if (comms && comms.wide_group_scope === 'management' && !['customer_admin'].includes(profile.vl_role) && !platformAdmin) {
            return DENIED('This All Personnel group is restricted to management access.', 'permission_denied');
          }
        }
        const dest = map[type];
        if (!dest) {
          const code = type === 'emergency_group' ? 'missing_emergency' : 'missing_configuration';
          return Response.json({ error: type === 'emergency_group'
            ? 'No emergency-response group is configured for this site yet. You can call the control room instead.'
            : `The ${type.replace(/_/g, ' ')} destination is not configured for this site yet.`,
            code, missing: type, control_room_available: !!map['control_room'] }, { status: 400 });
        }
        const v = validateTelegramDest(dest);
        if (!v.ok) return Response.json({ error: 'The stored destination for this action is malformed. Ask your administrator to correct it in Site Communication Setup.', code: 'malformed_destination', missing: type }, { status: 400 });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'open_conversation', site_id: siteId, site_name: siteRow?.name || null, destination_type: type, destination_label: labels[type] || type, detail: 'Handoff attempted: Telegram conversation opened.' });
        return Response.json({ label: labels[type] || type, site_name: siteRow?.name || null, link: v.link, app: 'Telegram', hint: 'Opens the conversation. Tap Call, Video or send your message inside Telegram.' });
      }

      // ── duty sessions ──
      case 'duty_on': {
        const existing = await activeDuty(svc, caller.id, customerId);
        if (existing) return Response.json({ already: true, duty: existing });
        const siteId = body.site_id || null;
        if (siteId && !scopedIds.has(siteId)) return DENIED('That site is not within your authorised scope.', 'site_not_authorised');
        const siteRow = sites.find((s: any) => s.id === siteId);
        const session = await svc.entities.VL360DutySession.create({
          customer_id: customerId, reseller_id: resellerId, user_id: caller.id, user_name: actor,
          site_id: siteRow?.id || null, site_name: siteRow?.name || null,
          status: 'active', started_at: nowIso(), last_confirmed_at: nowIso(),
          is_test: body.is_test === true,
        });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'duty_on', site_id: siteRow?.id || null, site_name: siteRow?.name || null, detail: 'Duty session started.' });
        return Response.json({ duty: session });
      }
      case 'duty_off': {
        const existing = await activeDuty(svc, caller.id, customerId);
        if (existing) {
          await svc.entities.VL360DutySession.update(existing.id, { status: 'closed', closed_at: nowIso(), closed_by_id: caller.id, closed_by_name: actor, close_reason: 'self_off' });
          await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'duty_off', site_id: existing.site_id, site_name: existing.site_name, detail: 'Went off duty.' });
        }
        return Response.json({ duty: null });
      }
      case 'duty_change_site': {
        const existing = await activeDuty(svc, caller.id, customerId);
        if (!existing) return FAIL('You are not on duty.', 'not_on_duty');
        const siteId = body.site_id || null;
        if (siteId && !scopedIds.has(siteId)) return DENIED('That site is not within your authorised scope.', 'site_not_authorised');
        const siteRow = sites.find((s: any) => s.id === siteId);
        await svc.entities.VL360DutySession.update(existing.id, { site_id: siteRow?.id || null, site_name: siteRow?.name || null, last_confirmed_at: nowIso() });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'duty_site_change', site_id: siteRow?.id || null, site_name: siteRow?.name || null, detail: `Site changed from ${existing.site_name || 'none'}.` });
        return Response.json({ duty: { ...existing, site_id: siteRow?.id || null, site_name: siteRow?.name || null } });
      }
      case 'list_on_duty': {
        const siteFilter: string | null = body.site_id || null;
        if (siteFilter && !scopedIds.has(siteFilter)) return DENIED('That site is not within your authorised scope.', 'site_not_authorised');
        const q: any = { customer_id: customerId, status: 'active' };
        if (siteFilter) q.site_id = siteFilter;
        else if (!isVlAdmin && [...scopedIds].length) q.site_id = { $in: [...scopedIds] };
        const rows = await svc.entities.VL360DutySession.filter(q).catch(() => []);
        return Response.json({ on_duty: (rows || []).map((d: any) => ({ user_id: d.user_id, user_name: d.user_name, site_id: d.site_id, site_name: d.site_name, started_at: d.started_at })) });
      }
      case 'close_duty_session': {
        if (!canManage) return DENIED('Only authorised management can close duty sessions.');
        const rows = await svc.entities.VL360DutySession.filter({ id: body.session_id, customer_id: customerId }).catch(() => []);
        const session = (rows || [])[0];
        if (!session || session.status !== 'active') return FAIL('That duty session is not active.', 'not_active', 404);
        await svc.entities.VL360DutySession.update(session.id, { status: 'closed', closed_at: nowIso(), closed_by_id: caller.id, closed_by_name: actor, close_reason: 'stale_closed_by_management' });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'duty_session_closed', site_id: session.site_id, site_name: session.site_name, target_name: session.user_name, detail: `Stale duty session closed for ${session.user_name}. Reason: ${String(body.reason || 'management close').slice(0, 200)}` });
        return Response.json({ closed: true });
      }

      // ── external dialler: activity only (no auto-launch, no SIM fallback) ──
      case 'log_dial': {
        if (!profile.external_calling_enabled && !platformAdmin) return DENIED('External telephone calling is not enabled for your profile.', 'external_calling_disabled');
        const v = validatePhoneNumber(body.number || '');
        if (!v.ok) return Response.json({ error: 'The number contains unsupported characters.', code: v.error }, { status: 400 });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'dial_external_assisted', destination_type: 'external_number', destination_label: v.number!, detail: 'Assisted dial flow shown: number copied for Wave Lite. No call outcome recorded.' });
        return Response.json({ ok: true });
      }

      // ── administration (management only) ──
      case 'admin_list_users': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const users = await svc.entities.User.filter({ customer_id: customerId }).catch(() => []);
        const profiles = await svc.entities.VL360Profile.filter({ customer_id: customerId }).catch(() => []);
        const asg = await svc.entities.VL360SiteAssignment.filter({ customer_id: customerId }).catch(() => []);
        const profByUser: Record<string, any> = {};
        (profiles || []).forEach((p: any) => { profByUser[p.user_id] = p; });
        const asgByUser: Record<string, any[]> = {};
        (asg || []).forEach((a: any) => { (asgByUser[a.user_id] = asgByUser[a.user_id] || []).push(a); });
        const siteName: Record<string, string> = {};
        sites.forEach((s: any) => { siteName[s.id] = s.name; });
        return Response.json({
          users: (users || []).filter((u: any) => u.role !== 'admin' && u.role_type !== 'platform_admin' && u.role_type !== 'reseller_admin').map((u: any) => ({
            user_id: u.id, name: u.full_name || u.display_name || u.email, email: u.email, role_type: u.role_type,
            user_status: u.user_status || 'active',
            vl_profile: publicProfile(profByUser[u.id]) || null,
            assignments: (asgByUser[u.id] || []).map((a: any) => ({ site_id: a.site_id, site_name: siteName[a.site_id] || a.site_id, kind: a.kind })),
          })),
          sites,
        });
      }
      case 'save_profile': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const targetId = body.target_user_id;
        if (!targetId) return FAIL('Select a person.', 'missing_target');
        if (await targetUserIsProtected(svc, targetId)) return DENIED('Platform and reseller administrators cannot be configured here.', 'protected_role');
        const tRows = await svc.entities.User.filter({ id: targetId }).catch(() => []);
        const target = (tRows || [])[0];
        if (!target || target.customer_id !== customerId) return DENIED('That person does not belong to your organisation.', 'cross_tenant_denied');
        const updates: any = { updated_at: nowIso(), updated_by_name: actor };
        if (body.personnel_id !== undefined) updates.personnel_id = String(body.personnel_id || '').trim().slice(0, 40) || null;
        if (body.telegram_username !== undefined) updates.telegram_username = String(body.telegram_username || '').trim().replace(/^@/, '').slice(0, 64) || null;
        if (body.vl_role !== undefined) {
          if (!isVlRole(body.vl_role)) return FAIL('Unknown VoiceLink role.', 'bad_role');
          if (body.vl_role === 'customer_admin' && !isVlAdmin && !platformAdmin) return DENIED('Only a Customer Administrator can grant the Customer Administrator role.', 'permission_denied');
          updates.vl_role = body.vl_role;
        }
        if (body.management_powers !== undefined) {
          if (!isVlAdmin && !platformAdmin) return DENIED('Only a Customer Administrator can grant management powers.', 'permission_denied');
          updates.management_powers = !!body.management_powers;
        }
        if (body.external_calling_enabled !== undefined) {
          if (!isVlAdmin && !platformAdmin) return DENIED('Only a Customer Administrator can change telephone permissions.', 'permission_denied');
          updates.external_calling_enabled = !!body.external_calling_enabled;
        }
        if (body.enabled !== undefined) {
          if (!isVlAdmin && !platformAdmin) return DENIED('Only a Customer Administrator can change VoiceLink access.', 'permission_denied');
          updates.enabled = !!body.enabled;
        }
        if (body.contact_link !== undefined) {
          const raw = String(body.contact_link || '').trim();
          if (!raw) {
            updates.contact_link = null; updates.contact_status = 'unconfigured';
          } else {
            const v = validateTelegramDest(raw);
            if (!v.ok) return Response.json({ error: v.error === 'unsupported_format'
              ? 'Unsupported link format. Use a https://t.me/… or tg://resolve?domain=… Telegram link.'
              : 'The Telegram link is malformed.', code: `invalid_contact_${v.error}` }, { status: 400 });
            updates.contact_link = v.link;
            updates.contact_status = 'configured';
          }
        }
        const pRows = await svc.entities.VL360Profile.filter({ user_id: targetId, customer_id: customerId }).catch(() => []);
        let saved;
        if (pRows && pRows[0]) saved = await svc.entities.VL360Profile.update(pRows[0].id, updates);
        else saved = await svc.entities.VL360Profile.create({ user_id: targetId, customer_id: customerId, reseller_id: resellerId, vl_role: updates.vl_role || vlRoleForPlatformRole(target.role_type) || 'guard', enabled: updates.enabled !== false, ...updates });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'profile_saved', target_name: userName(target), detail: `Personnel profile saved (${Object.keys(updates).filter((k) => !k.startsWith('updated')).join(', ')}).` });
        return Response.json({ profile: publicProfile(saved) });
      }
      case 'confirm_contact_setup': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const targetId = body.target_user_id;
        const pRows = await svc.entities.VL360Profile.filter({ user_id: targetId, customer_id: customerId }).catch(() => []);
        if (!pRows || !pRows[0] || !pRows[0].contact_link) return Response.json({ error: 'Configure and save a destination first.', code: 'missing_configuration', missing: 'individual' }, { status: 400 });
        const saved = await svc.entities.VL360Profile.update(pRows[0].id, { contact_status: 'confirmed', contact_confirmed_at: nowIso(), contact_confirmed_by_name: actor, updated_at: nowIso(), updated_by_name: actor });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'contact_saved', target_name: body.target_name || null, detail: 'Individual destination confirmed after opening it.' });
        return Response.json({ profile: publicProfile(saved) });
      }
      case 'save_assignments': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const targetId = body.target_user_id, kind = body.kind || 'personnel';
        if (!['personnel', 'controller'].includes(kind)) return FAIL('Unknown assignment kind.', 'bad_request');
        if (await targetUserIsProtected(svc, targetId)) return DENIED('Platform and reseller administrators cannot be configured here.', 'protected_role');
        const tRows = await svc.entities.User.filter({ id: targetId }).catch(() => []);
        const target = (tRows || [])[0];
        if (!target || target.customer_id !== customerId) return DENIED('That person does not belong to your organisation.', 'cross_tenant_denied');
        const siteIds: string[] = [...new Set(body.site_ids || [])];
        for (const sid of siteIds) {
          const sRows = await svc.entities.Site.filter({ id: sid }).catch(() => []);
          if (!sRows || !sRows[0] || sRows[0].customer_id !== customerId) return DENIED('A selected site does not belong to your organisation.', 'cross_tenant_denied');
        }
        await svc.entities.VL360SiteAssignment.deleteMany({ customer_id: customerId, user_id: targetId, kind }).catch(() => {});
        if (siteIds.length) {
          await svc.entities.VL360SiteAssignment.bulkCreate(siteIds.map((sid: string) => ({ customer_id: customerId, reseller_id: resellerId, user_id: targetId, site_id: sid, kind, assigned_by_name: actor })));
        }
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'assignments_saved', target_name: userName(target), detail: `${kind} assignments set: ${siteIds.length} site(s).` });
        return Response.json({ ok: true });
      }
      case 'save_site_comms': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const siteId = body.site_id;
        if (!siteId || !scopedIds.has(siteId)) return DENIED('That site is not within your authorised scope.', 'site_not_authorised');
        const updates: any = { updated_at: nowIso(), updated_by_name: actor };
        const linkFields: Record<string, string> = {
          control_room_dest: 'control_room_label', group_dest: 'group_label',
          emergency_dest: 'emergency_label', wide_group_dest: 'wide_group_label',
        };
        for (const [destField, labelField] of Object.entries(linkFields)) {
          if (body[labelField] !== undefined) updates[labelField] = String(body[labelField] || '').trim().slice(0, 80) || null;
          if (body[destField] !== undefined) {
            const raw = String(body[destField] || '').trim();
            if (!raw) { updates[destField] = null; continue; }
            const v = validateTelegramDest(raw);
            if (!v.ok) return Response.json({ error: v.error === 'unsupported_format'
              ? 'Unsupported link format. Use a https://t.me/… or tg://resolve?domain=… Telegram link.'
              : 'A Telegram link is malformed.', code: `invalid_${destField}_${v.error}`, field: destField }, { status: 400 });
            updates[destField] = v.link;
          }
        }
        if (body.wide_group_scope !== undefined) {
          if (!['management', 'all'].includes(body.wide_group_scope)) return FAIL('Unknown wider-group access scope.', 'bad_request');
          updates.wide_group_scope = body.wide_group_scope;
        }
        if (updates.wide_group_dest === null) updates.wide_group_scope = 'management';
        const rows = await svc.entities.VL360SiteComms.filter({ customer_id: customerId, site_id: siteId }).catch(() => []);
        const saved = (rows && rows[0])
          ? await svc.entities.VL360SiteComms.update(rows[0].id, updates)
          : await svc.entities.VL360SiteComms.create({ customer_id: customerId, reseller_id: resellerId, site_id: siteId, ...updates });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'site_comms_saved', site_id: siteId, site_name: (sites.find((s: any) => s.id === siteId) || {}).name || null, detail: 'Site communication destinations saved (labels only in the audit).' });
        return Response.json({ comms: saved });
      }
      case 'get_site_comms': {
        const siteId = body.site_id;
        if (!siteId || !scopedIds.has(siteId)) return DENIED('That site is not within your authorised scope.', 'site_not_authorised');
        const rows = await svc.entities.VL360SiteComms.filter({ customer_id: customerId, site_id: siteId }).catch(() => []);
        const c = (rows || [])[0] || null;
        if (isVlAdmin || platformAdmin) return Response.json({ comms: c });
        return Response.json({ comms: c ? { site_id: c.site_id, group_setup_confirmed: c.group_setup_confirmed, group_label: c.group_label || null, emergency_label: c.emergency_label || null } : null });
      }
      case 'confirm_group_setup': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const siteId = body.site_id;
        if (!siteId || !scopedIds.has(siteId)) return DENIED('That site is not within your authorised scope.', 'site_not_authorised');
        const rows = await svc.entities.VL360SiteComms.filter({ customer_id: customerId, site_id: siteId }).catch(() => []);
        if (!rows || !rows[0] || !(rows[0].group_dest || rows[0].emergency_dest || rows[0].control_room_dest)) {
          return Response.json({ error: 'Save at least one destination before confirming setup.', code: 'missing_configuration' }, { status: 400 });
        }
        const saved = await svc.entities.VL360SiteComms.update(rows[0].id, { group_setup_confirmed: true, confirmed_at: nowIso(), confirmed_by_name: actor, updated_at: nowIso(), updated_by_name: actor });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'group_setup_confirmed', site_id: siteId, site_name: (sites.find((s: any) => s.id === siteId) || {}).name || null, detail: 'Administrator confirmed group onboarding: destinations open the correct groups.' });
        return Response.json({ comms: saved });
      }

      // ── operational contacts (dialler) ──
      case 'phone_contacts_list': {
        const rows = await svc.entities.VL360PhoneContact.filter({ customer_id: customerId }).catch(() => []);
        return Response.json({ contacts: (rows || []).map((c: any) => ({ id: c.id, label: c.label, number: c.number, site_id: c.site_id || null })) });
      }
      case 'phone_contact_save': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const label = String(body.label || '').trim().slice(0, 80);
        const v = validatePhoneNumber(body.number || '');
        if (!label) return FAIL('A label is required.', 'bad_request');
        if (!v.ok) return Response.json({ error: v.error === 'unsupported_characters' ? 'The number contains unsupported characters.' : 'The number is malformed.', code: `invalid_number_${v.error}` }, { status: 400 });
        const saved = await svc.entities.VL360PhoneContact.create({ customer_id: customerId, reseller_id: resellerId, label, number: v.number, site_id: body.site_id || null, created_by_name: actor });
        await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'phone_contact_saved', destination_label: label, detail: 'Operational contact saved.' });
        return Response.json({ contact: { id: saved.id, label: saved.label, number: saved.number, site_id: saved.site_id || null } });
      }
      case 'phone_contact_delete': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const rows = await svc.entities.VL360PhoneContact.filter({ id: body.contact_id, customer_id: customerId }).catch(() => []);
        if (rows && rows[0]) {
          await svc.entities.VL360PhoneContact.delete(rows[0].id);
          await logActivity(svc, { customer_id: customerId, reseller_id: resellerId, actor_id: caller.id, actor_name: actor, actor_role: profile.vl_role, action: 'phone_contact_deleted', destination_label: rows[0].label, detail: 'Operational contact deleted.' });
        }
        return Response.json({ ok: true });
      }

      // ── activity + setup checks ──
      case 'activity_list': {
        const q: any = { customer_id: customerId };
        if (!canManage) q.actor_id = caller.id;
        if (body.actor_id && canManage) q.actor_id = body.actor_id;
        const rows = await svc.entities.VL360Activity.filter(q, '-created_date', 100).catch(() => []);
        return Response.json({ activity: (rows || []).map((a: any) => ({ id: a.id, actor_name: a.actor_name, actor_role: a.actor_role, action: a.action, site_name: a.site_name || null, destination_type: a.destination_type || null, destination_label: a.destination_label || null, detail: a.detail || null, created_date: a.created_date })) });
      }
      case 'run_setup_checks': {
        if (!isVlAdmin && !platformAdmin) return DENIED('Administrator access required.');
        const commsRows = await svc.entities.VL360SiteComms.filter({ customer_id: customerId }).catch(() => []);
        const profiles = await svc.entities.VL360Profile.filter({ customer_id: customerId, enabled: true }).catch(() => []);
        const users = await svc.entities.User.filter({ id: { $in: (profiles || []).map((p: any) => p.user_id) } }).catch(() => []);
        const uName: Record<string, string> = {};
        (users || []).forEach((u: any) => { uName[u.id] = u.full_name || u.display_name || u.email; });
        const siteChecks = (commsRows || []).map((c: any) => {
          const dests = [
            ['Control room', c.control_room_dest], ['Site group', c.group_dest],
            ['Emergency group', c.emergency_dest], ['Wider group', c.wide_group_dest],
          ];
          return {
            scope: 'site', name: (sites.find((s: any) => s.id === c.site_id) || {}).name || c.site_id,
            setup_confirmed: !!c.group_setup_confirmed,
            items: dests.map(([label, link]) => ({ label, link, status: !link ? 'missing' : (validateTelegramDest(link).ok ? 'valid' : 'malformed') })),
          };
        });
        const personChecks = (profiles || []).map((p: any) => ({
          scope: 'person', name: uName[p.user_id] || p.user_id,
          setup_confirmed: p.contact_status === 'confirmed',
          items: [{ label: 'Individual destination', link: p.contact_link, status: !p.contact_link ? 'missing' : (validateTelegramDest(p.contact_link).ok ? 'valid' : 'malformed') }],
        }));
        return Response.json({ site_checks: siteChecks, person_checks: personChecks });
      }

      default:
        return Response.json({ error: 'Unsupported action', code: 'bad_action' }, { status: 400 });
    }
  } catch (error) {
    const msg = String((error as any)?.message || error);
    console.log('[vl360Access] fatal', msg);
    return Response.json({ error: 'VoiceLink 360 request failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}