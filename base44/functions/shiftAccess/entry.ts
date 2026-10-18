import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { customerModuleLicensed } from '../../shared/entitlementActive.ts';

/**
 * shiftAccess — server-authoritative guard shift lifecycle gateway.
 *
 * ONE lifecycle for BOTH scheduler modes (scheduled and unscheduled clock-ins
 * produce the same active Shift record + the same guard duty state) and the
 * customer-level Scheduler setting.
 *
 * Security posture:
 *  - The caller, tenant, entitlement and ownership are resolved SERVER-SIDE —
 *    never from a client-supplied id.
 *  - Clock-in REQUIRES an active OPERATIONS or COMPLETE_SECURITY licence
 *    (role AND module — never role alone).
 *  - UNSCHEDULED clock-in (Scheduler OFF only) requires: an ACTIVE site the
 *    guard's account is authorised for, valid current GPS from the guard, a
 *    site with configured GPS + geofence radius, and the guard INSIDE that
 *    radius. Missing GPS or missing geofence data is a hard failure — never
 *    treated as a passed check. PIN enforced when configured.
 *  - SCHEDULED clock-in retains the assigned-shift process; the site geofence
 *    is enforced server-side WHEN the site has GPS configured.
 *  - Duplicate active shifts are prevented with the platform CAS pattern
 *    (conditional updateMany verified by re-read).
 *  - A FAILED guard-state update rolls the shift back / deletes the created
 *    shift, so a shift can never be left falsely active.
 *  - The Scheduler setting is changed ONLY by a Customer Administrator.
 *
 * Actions: config | set_config | clock_in_sites | clock_in_scheduled |
 * clock_in_unscheduled | clock_out
 */

const SECURITY_MODULE_KEYS = ['OPERATIONS', 'COMPLETE_SECURITY'];
const UNSCHEDULED_DEFAULT_DURATION_MS = 12 * 60 * 60 * 1000; // 12h placeholder until clock-out

function fail(error, code, status = 400) {
  return Response.json({ error, code }, { status });
}

function validCoords(loc) {
  return !!loc
    && typeof loc.lat === 'number' && isFinite(loc.lat)
    && typeof loc.lng === 'number' && isFinite(loc.lng)
    && !(loc.lat === 0 && loc.lng === 0);
}

function validGeofence(site) {
  return validCoords(site && site.location)
    && typeof site.geofence_radius === 'number'
    && site.geofence_radius > 0;
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function guardName(caller) {
  return caller.display_name || caller.full_name || caller.email || 'Guard';
}

/** Scheduler mode for the caller's customer. Default ON (existing customers
 *  without a saved value, and any customer read failure, keep the scheduled
 *  flow — never silently disables scheduling). */
async function schedulerEnabled(svc, customerId) {
  if (!customerId) return true;
  try {
    const c = await svc.entities.Customer.get(customerId);
    return c ? c.shift_scheduler_enabled !== false : true;
  } catch (_) {
    return true;
  }
}

/** Server-side guard + tenant + entitlement gate for every shift action. */
async function requireGuardShiftContext(base44, svc) {
  const caller = await base44.auth.me();
  if (!caller) return { error: fail('Unauthorized', 'unauthorized', 401) };
  if (caller.role_type !== 'guard') {
    return { error: fail('Only guards can clock in or out', 'forbidden', 403) };
  }
  if (!caller.customer_id) {
    return { error: fail('No tenant scope resolved for this account — access denied', 'no_tenant', 403) };
  }
  const licensed = await customerModuleLicensed(svc, caller.customer_id, SECURITY_MODULE_KEYS).catch(() => false);
  if (!licensed) {
    return { error: fail('Your organisation is not licensed for shift operations', 'not_licensed', 403) };
  }
  return { caller };
}

async function readCustomer(svc, customerId) {
  try {
    return await svc.entities.Customer.get(customerId);
  } catch (_) {
    return null;
  }
}

/** Duplicate-active-shift prevention: exactly ONE active shift per guard. */
async function findActiveShift(svc, caller) {
  const rows = await svc.entities.Shift.filter({
    guard_id: caller.id, customer_id: caller.customer_id, status: 'active',
  }).catch(() => []);
  return (rows && rows[0]) || null;
}

/**
 * Guard duty-state update. FULL update first (parity with the previous
 * client-side updateMe payload); if any non-core field is rejected, retry with
 * the core state only. Returns null on total failure so the caller can roll
 * the shift back — a failed state update must never leave a shift active.
 */
async function setGuardDutyState(svc, caller, patch) {
  try {
    await svc.entities.User.update(caller.id, patch);
    return true;
  } catch (_) {
    try {
      await svc.entities.User.update(caller.id, {
        is_clocked_in: patch.is_clocked_in,
        current_shift_id: patch.current_shift_id || null,
        needs_start_of_shift_report: !!patch.needs_start_of_shift_report,
      });
      return true;
    } catch (__) {
      return false;
    }
  }
}

async function readBody(req) {
  try {
    return await req.json();
  } catch (_) {
    return {};
  }
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const body = await readBody(req);
    const action = body.action;

    // ── config ────────────────────────────────────────────────────────────
    if (action === 'config') {
      const caller = await base44.auth.me();
      if (!caller) return fail('Unauthorized', 'unauthorized', 401);
      if (!caller.customer_id) {
        return Response.json({ ok: true, scheduler_enabled: true, resolved: false });
      }
      const scheduler_enabled = await schedulerEnabled(svc, caller.customer_id);
      return Response.json({ ok: true, scheduler_enabled, resolved: true, customer_id: caller.customer_id });
    }

    // ── set_config (Customer Administrator ONLY) ──────────────────────────
    if (action === 'set_config') {
      const caller = await base44.auth.me();
      if (!caller) return fail('Unauthorized', 'unauthorized', 401);
      const isCustomerAdministrator =
        caller.role_type === 'customer_admin' || caller.role_type === 'admin';
      const isPlatformAdmin = caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
      if (!isCustomerAdministrator && !isPlatformAdmin) {
        return fail('Only a Customer Administrator can change the shift scheduler setting', 'forbidden', 403);
      }
      if (!caller.customer_id) return fail('No tenant scope resolved for this account', 'no_tenant', 403);
      if (typeof body.enabled !== 'boolean') return fail('enabled must be true or false', 'bad_request');
      await svc.entities.Customer.update(caller.customer_id, { shift_scheduler_enabled: body.enabled });
      return Response.json({ ok: true, scheduler_enabled: body.enabled });
    }

    // ── clock_in_sites (scheduler OFF picker) ─────────────────────────────
    if (action === 'clock_in_sites') {
      const ctx = await requireGuardShiftContext(base44, svc);
      if (ctx.error) return ctx.error;
      const caller = ctx.caller;
      let sites = await svc.entities.Site.filter({ customer_id: caller.customer_id, status: 'active' }).catch(() => []);
      sites = sites || [];
      // Account-level site authorisation: a site-scoped guard may only start
      // duty at their own primary site.
      if (caller.site_id) sites = sites.filter((s) => s.id === caller.site_id);
      return Response.json({
        ok: true,
        sites: sites.map((s) => ({
          id: s.id,
          name: s.name,
          address: s.address || '',
          lat: validCoords(s.location) ? s.location.lat : null,
          lng: validCoords(s.location) ? s.location.lng : null,
          geofence_radius: typeof s.geofence_radius === 'number' ? s.geofence_radius : null,
          geofence_valid: validGeofence(s),
        })),
      });
    }

    // ── clock_in_scheduled ────────────────────────────────────────────────
    if (action === 'clock_in_scheduled') {
      const ctx = await requireGuardShiftContext(base44, svc);
      if (ctx.error) return ctx.error;
      const caller = ctx.caller;
      if (!body.shift_id) return fail('A shift must be selected to clock in', 'bad_request');

      const shift = await svc.entities.Shift.get(body.shift_id).catch(() => null);
      if (!shift) return fail('Shift not found', 'not_found', 404);
      if (shift.guard_id !== caller.id) return fail('This shift is not assigned to you', 'forbidden', 403);
      if (shift.customer_id !== caller.customer_id) return fail('This shift does not belong to your organisation', 'forbidden', 403);

      if (shift.status === 'active' && shift.clock_in && shift.clock_in.timestamp) {
        return Response.json({ ok: true, shift, already_active: true });
      }
      if (!['scheduled', 'accepted'].includes(shift.status)) {
        return fail('This shift is no longer available to clock in (' + shift.status + ')', 'bad_state');
      }

      const active = await findActiveShift(svc, caller);
      if (active && active.id !== shift.id) {
        return fail('You are already on duty — clock out of your current shift first', 'already_on_duty', 409);
      }

      // Scheduled mode: geofence enforced ONLY when the site has GPS configured.
      const site = shift.site_id ? await svc.entities.Site.get(shift.site_id).catch(() => null) : null;
      let clockIn;
      if (site && validGeofence(site)) {
        const lat = Number(body.lat), lng = Number(body.lng);
        if (!isFinite(lat) || !isFinite(lng)) {
          return fail('Location services must be enabled to clock in at this site', 'gps_required');
        }
        const dist = distanceMeters(lat, lng, site.location.lat, site.location.lng);
        if (dist > site.geofence_radius) {
          return fail(
            'You are ' + Math.round(dist) + 'm from ' + (site.name || 'the site') +
            ' (must be within ' + Math.round(site.geofence_radius) + 'm) — move closer to clock in',
            'out_of_geofence'
          );
        }
        clockIn = {
          timestamp: new Date().toISOString(),
          location: { lat, lng },
          verified: true,
          geofence: { checked: true, distance_m: Math.round(dist), radius_m: site.geofence_radius },
        };
      } else {
        // No configured site GPS — the scheduled flow proceeds without a
        // geofence check (this is NOT a passed check; it is stamped as such).
        clockIn = {
          timestamp: new Date().toISOString(),
          location: isFinite(Number(body.lat)) && isFinite(Number(body.lng))
            ? { lat: Number(body.lat), lng: Number(body.lng) }
            : null,
          verified: false,
          geofence: { checked: false },
        };
      }

      // PIN (server-side, both modes) — when one is configured.
      if (caller.security_pin) {
        if (!body.pin || String(body.pin) !== String(caller.security_pin)) {
          return fail('Invalid security PIN', 'invalid_pin');
        }
      }

      // CAS claim: conditional update verified by re-read.
      await svc.entities.Shift.updateMany(
        { id: shift.id, guard_id: caller.id, status: { $in: ['scheduled', 'accepted'] } },
        { $set: { status: 'active', clock_in: clockIn, unscheduled: false } },
      ).catch(() => {});
      const activated = await svc.entities.Shift.get(shift.id).catch(() => null);
      if (!activated || activated.status !== 'active' || !activated.clock_in || !activated.clock_in.timestamp) {
        const nowActive = await findActiveShift(svc, caller);
        if (nowActive) {
          return fail('You are already on duty — clock out of your current shift first', 'already_on_duty', 409);
        }
        return fail('Could not start the shift — it changed state, please retry', 'claim_lost', 409);
      }

      // Guard state — on failure, roll the shift back so it is never falsely active.
      const stateOk = await setGuardDutyState(svc, caller, {
        is_clocked_in: true,
        current_shift_id: activated.id,
        last_clock_in: clockIn.timestamp,
        last_location: clockIn.location ? { ...clockIn.location, timestamp: clockIn.timestamp } : null,
        needs_start_of_shift_report: true,
      });
      if (!stateOk) {
        await svc.entities.Shift.updateMany(
          { id: activated.id, status: 'active' },
          { $set: { status: shift.status }, $unset: { clock_in: '' } },
        ).catch(() => {});
        return fail('Could not update your duty state — please retry', 'state_update_failed', 500);
      }

      return Response.json({ ok: true, shift: activated });
    }

    // ── clock_in_unscheduled ──────────────────────────────────────────────
    if (action === 'clock_in_unscheduled') {
      const ctx = await requireGuardShiftContext(base44, svc);
      if (ctx.error) return ctx.error;
      const caller = ctx.caller;

      const schedulerOn = await schedulerEnabled(svc, caller.customer_id);
      if (schedulerOn) {
        return fail('Unscheduled shifts are disabled — clock in against your scheduled shift', 'scheduler_on');
      }
      if (!body.site_id) return fail('Select a site to start your shift', 'bad_request');

      // Valid current GPS is COMPULSORY — missing GPS is never a passed check.
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!isFinite(lat) || !isFinite(lng)) {
        return fail('Location services must be enabled with a valid current GPS position to start an unscheduled shift', 'gps_required');
      }

      const site = await svc.entities.Site.get(body.site_id).catch(() => null);
      if (!site) return fail('Site not found', 'not_found', 404);
      if (site.customer_id !== caller.customer_id) return fail('This site does not belong to your organisation', 'forbidden', 403);
      if (site.status !== 'active') return fail('This site is not active', 'site_inactive');
      if (caller.site_id && site.id !== caller.site_id) {
        return fail('This site is not authorised for your account', 'forbidden', 403);
      }

      // Server-side geofence: the site MUST have configured GPS + radius and
      // the guard MUST be inside it.
      if (!validGeofence(site)) {
        return fail(
          'This site has no valid GPS coordinates and geofence radius configured — ask your administrator to set the site location before starting an unscheduled shift here',
          'geofence_not_configured'
        );
      }
      const dist = distanceMeters(lat, lng, site.location.lat, site.location.lng);
      if (dist > site.geofence_radius) {
        return fail(
          'You are ' + Math.round(dist) + 'm from ' + (site.name || 'the site') +
          ' (must be within ' + Math.round(site.geofence_radius) + 'm) — move closer to start your shift',
          'out_of_geofence'
        );
      }

      if (caller.security_pin) {
        if (!body.pin || String(body.pin) !== String(caller.security_pin)) {
          return fail('Invalid security PIN', 'invalid_pin');
        }
      }

      const active = await findActiveShift(svc, caller);
      if (active) {
        return fail('You are already on duty — clock out of your current shift first', 'already_on_duty', 409);
      }

      const customer = await readCustomer(svc, caller.customer_id);
      const nowIso = new Date().toISOString();
      const clockIn = {
        timestamp: nowIso,
        location: { lat, lng },
        verified: true,
        geofence: { checked: true, distance_m: Math.round(dist), radius_m: site.geofence_radius },
      };
      const created = await svc.entities.Shift.create({
        customer_id: caller.customer_id,
        reseller_id: (customer && customer.reseller_id) || null,
        guard_id: caller.id,
        guard_name: guardName(caller),
        site_id: site.id,
        site_name: site.name || '',
        start_time: nowIso,
        end_time: new Date(Date.now() + UNSCHEDULED_DEFAULT_DURATION_MS).toISOString(),
        status: 'active',
        unscheduled: true,
        clock_in: clockIn,
      }).catch(() => null);
      if (!created) return fail('Could not start the shift — please retry', 'create_failed', 500);

      const stateOk = await setGuardDutyState(svc, caller, {
        is_clocked_in: true,
        current_shift_id: created.id,
        last_clock_in: nowIso,
        last_location: { lat, lng, timestamp: nowIso },
        needs_start_of_shift_report: true,
      });
      if (!stateOk) {
        // Roll the created shift back — never leave a shift falsely active.
        await svc.entities.Shift.delete(created.id).catch(() => {});
        return fail('Could not update your duty state — please retry', 'state_update_failed', 500);
      }

      return Response.json({ ok: true, shift: created });
    }

    // ── clock_out ─────────────────────────────────────────────────────────
    if (action === 'clock_out') {
      const ctx = await requireGuardShiftContext(base44, svc);
      if (ctx.error) return ctx.error;
      const caller = ctx.caller;
      if (!body.shift_id) return fail('No shift to clock out of', 'bad_request');

      const shift = await svc.entities.Shift.get(body.shift_id).catch(() => null);
      if (!shift) return fail('Shift not found', 'not_found', 404);
      if (shift.guard_id !== caller.id || shift.customer_id !== caller.customer_id) {
        return fail('This shift does not belong to you', 'forbidden', 403);
      }
      if (shift.status !== 'active') {
        return Response.json({ ok: true, shift, already_closed: true });
      }

      const outTs = new Date().toISOString();
      const lat = Number(body.lat), lng = Number(body.lng);
      const clockOut = {
        timestamp: outTs,
        location: isFinite(lat) && isFinite(lng) ? { lat, lng } : null,
        verified: true,
      };

      await svc.entities.Shift.updateMany(
        { id: shift.id, guard_id: caller.id, status: 'active' },
        { $set: { status: 'completed', clock_out: clockOut } },
      ).catch(() => {});
      const closed = await svc.entities.Shift.get(shift.id).catch(() => null);
      if (!closed || closed.status !== 'completed' || !closed.clock_out || !closed.clock_out.timestamp) {
        return fail('Could not complete the shift — please retry', 'claim_lost', 409);
      }

      const stateOk = await setGuardDutyState(svc, caller, {
        is_clocked_in: false,
        current_shift_id: null,
        last_location: clockOut.location ? { ...clockOut.location, timestamp: outTs } : null,
      });
      if (!stateOk) {
        await svc.entities.Shift.updateMany(
          { id: shift.id, status: 'completed' },
          { $set: { status: 'active' }, $unset: { clock_out: '' } },
        ).catch(() => {});
        return fail('Could not update your duty state — please retry', 'state_update_failed', 500);
      }

      return Response.json({ ok: true, shift: closed });
    }

    return fail('Unknown action', 'bad_request');
  } catch (error) {
    return Response.json({ error: String((error && error.message) || error) }, { status: 500 });
  }
}