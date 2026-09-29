import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import {
  isPlatformAdmin, isResellerAdmin,
  countActiveDevices, loadCustomerById,
  DEVICE_LIMIT_REACHED_MESSAGE, DEVICE_INACTIVE_MESSAGE,
} from '../../shared/deviceLicensing.ts';

/**
 * deviceAccess — AUTHORITATIVE customer device licensing gateway.
 *
 * One DeviceRegistration per PHYSICAL APP INSTALLATION (installation UUID
 * generated and persisted client-side on first install — never IP, account,
 * user-agent or hardware fingerprinting). Licensing is CUSTOMER-WIDE:
 * the count of active registrations is compared against Customer.device_limit.
 *
 * ACTIONS
 *  • register   — client post-auth (and platform-admin provisioning with an
 *                 explicit customer_id). Idempotent: an existing active
 *                 registration for (customer_id + installation_id) is reused
 *                 (only last_seen/last_user are updated — never a second
 *                 slot); multiple users on the same installation consume ONE
 *                 slot; logging out never frees a slot (no unregister here).
 *                 LIMIT ENFORCEMENT IS TRANSACTION-SAFE: registration happens
 *                 under a per-customer mutex implemented as a CAS update on
 *                 Customer.device_lock_token (null→token, stealable after
 *                 device_lock_expires_at), so two simultaneous registrations
 *                 can NEVER both take the final slot.
 *                 Legacy customers with device_limit null are NOT limited
 *                 (flagged 'requires configuration' — never silently locked
 *                 out); once a limit is configured, enforcement is immediate.
 *  • heartbeat  — refresh last_seen_at/last_user for the caller's device.
 *  • list       — platform admin, or reseller administrator of the
 *                 customer's reseller: all devices + licence summary.
 *  • update     — rename / assign site / assign gate (same authorizers).
 *  • set_status — deactivate (frees the slot, blocks the installation) /
 *                 reactivate (consumes a slot — blocked at the limit).
 *
 * Device limit CHANGES are NOT handled here — customerAccess is the single
 * authority for device_limit (platform-level only, audited).
 *
 * AUDIT EVENTS: device.registered, device.registration_blocked_limit,
 * device.deactivated, device.reactivated, device.updated. Never logged:
 * tokens, passwords or any authentication credential.
 */

const LOCK_TTL_MS = 15000;
const LOCK_ATTEMPTS = 24;

const loadCustomer = loadCustomerById;

function auditEntry(base: any, fields: any) {
  return base.asServiceRole.entities.PlatformAuditLog.create(fields).catch(() => {});
}

/**
 * withCustomerLock — per-customer mutex via CAS on the Customer record's
 * device_lock_token. Acquire: conditional updateMany matching the CURRENT
 * observed token (null, or an expired token being stolen); the winner is
 * confirmed by read-back. Two registrations racing for the final slot are
 * therefore serialized: exactly one can win.
 */
async function withCustomerLock(svc: any, customerId: string, fn: () => Promise<any>): Promise<any> {
  const token = crypto.randomUUID();
  const tryAcquire = async (): Promise<boolean> => {
    const cust = await loadCustomer(svc, customerId);
    if (!cust) throw new Error('customer_not_found');
    const held = cust.device_lock_token || null;
    const expired = !cust.device_lock_expires_at ||
      new Date(cust.device_lock_expires_at).getTime() < Date.now();
    if (held && !expired) return false;
    // CAS: match the observed token value exactly (null matches the
    // not-yet-held state; a stale observed token is stolen only if no other
    // writer replaced it in between — the conditional update enforces this).
    const filter = held
      ? { id: customerId, device_lock_token: held }
      : { id: customerId, device_lock_token: null };
    await svc.entities.Customer.updateMany(filter, {
      $set: { device_lock_token: token, device_lock_expires_at: new Date(Date.now() + LOCK_TTL_MS).toISOString() },
    }).catch(() => null);
    const again = await loadCustomer(svc, customerId);
    return again?.device_lock_token === token;
  };
  let held = false;
  for (let i = 0; i < LOCK_ATTEMPTS && !held; i++) {
    held = await tryAcquire();
    if (!held) await new Promise((r) => setTimeout(r, 120 + Math.floor(Math.random() * 180)));
  }
  if (!held) return { lock_error: 'lock_timeout' };
  try {
    return await fn();
  } finally {
    await svc.entities.Customer.updateMany({ id: customerId, device_lock_token: token }, {
      $set: { device_lock_token: null, device_lock_expires_at: null },
    }).catch(() => {});
  }
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');
    const callerName = caller.display_name || caller.full_name || caller.email;

    /* ── REGISTER (client post-auth / platform-admin provisioning) ─────── */
    if (action === 'register') {
      const installationId = String(body?.installation_id || '').trim();
      if (!/^[A-Za-z0-9-]{16,64}$/.test(installationId)) {
        return Response.json({ error: 'A valid installation id is required', code: 'invalid_installation_id' }, { status: 400 });
      }
      // Effective customer: the caller's OWN tenant scope. Platform admins
      // may provision/register for an explicit customer (legitimate
      // oversight); every other caller is pinned to their own customer.
      let customerId = caller.customer_id || null;
      if (!customerId && isPlatformAdmin(caller) && body?.customer_id) customerId = String(body.customer_id);
      if (!customerId) {
        return Response.json({
          error: 'This account has no customer scope. Devices are licensed per customer.',
          code: 'no_customer_scope',
        }, { status: 400 });
      }
      const cust = await loadCustomer(svc, customerId);
      if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });
      if (!isPlatformAdmin(caller) && caller.customer_id !== customerId) {
        return Response.json({ error: 'Devices can only be registered for your own customer', code: 'permission_denied' }, { status: 403 });
      }

      const now = new Date().toISOString();
      const platform = String(body?.device_platform || 'web').slice(0, 20);
      const appType = ['native', 'pwa', 'web'].includes(body?.app_type) ? body.app_type : 'web';

      // Idempotency: an existing registration for this installation NEVER
      // consumes another slot — only its presence/health is refreshed.
      const existingRows = await svc.entities.DeviceRegistration
        .filter({ customer_id: customerId, installation_id: installationId }).catch(() => []);
      const existing = existingRows?.[0] || null;
      if (existing) {
        if (existing.status === 'active') {
          await svc.entities.DeviceRegistration.update(existing.id, {
            last_seen_at: now, last_user_id: caller.id, last_user_name: callerName,
          }).catch(() => {});
          return Response.json({ status: 'active', device: { id: existing.id, device_name: existing.device_name, site_id: existing.site_id || null, gate_name: existing.gate_name || null }, device_limit: cust.device_limit ?? null });
        }
        // Deactivated/revoked installation: blocked. The slot stays free and
        // the block persists regardless of who logs in on this installation.
        return Response.json({ status: 'inactive', reason: existing.status, message: DEVICE_INACTIVE_MESSAGE });
      }

      // NEW installation — licence check + create under the customer mutex.
      const result = await withCustomerLock(svc, customerId, async () => {
        const c2 = await loadCustomer(svc, customerId);
        const activeCount = await countActiveDevices(svc, customerId);
        const limit = c2?.device_limit ?? null;
        if (limit != null && activeCount >= limit) {
          await auditEntry(base44, {
            event_type: 'device.registration_blocked_limit',
            customer_id: customerId, reseller_id: cust.reseller_id || undefined,
            user_id: caller.id, user_name: callerName,
            entity_name: 'DeviceRegistration', action: 'device_registration_blocked',
            notes: `Blocked installation ${installationId.slice(0, 8)}… — ${activeCount}/${limit} device slots in use`,
          });
          return { blocked: true, activeCount, limit };
        }
        const created = await svc.entities.DeviceRegistration.create({
          customer_id: customerId,
          reseller_id: cust.reseller_id || null,
          installation_id: installationId,
          device_name: String(body?.device_name || '').slice(0, 80) || `${platform} device ${new Date().toISOString().slice(0, 10)}`,
          site_id: body?.site_id || null,
          gate_name: body?.gate_name || null,
          device_platform: platform,
          device_model: String(body?.device_model || '').slice(0, 120),
          app_type: appType,
          app_version: String(body?.app_version || '').slice(0, 40),
          status: 'active',
          first_registered_at: now,
          last_seen_at: now,
          last_user_id: caller.id,
          last_user_name: callerName,
          activated_at: now,
        });
        await auditEntry(base44, {
          event_type: 'device.registered',
          customer_id: customerId, reseller_id: cust.reseller_id || undefined,
          user_id: caller.id, user_name: callerName,
          entity_name: 'DeviceRegistration', entity_id: created.id,
          action: 'device_registered',
          new_values: JSON.stringify({ installation_id: installationId, platform, app_type }),
          notes: `Device registered (${activeCount + 1}${limit != null ? '/' + limit : ' unlicensed'} slots${limit == null ? ' — device allowance requires configuration' : ''})`,
        });
        return { blocked: false, device: created, activeCount: activeCount + 1, limit };
      });

      if (result.lock_error) {
        return Response.json({ status: 'busy', message: 'Device registration is busy. Please try again.', code: 'lock_timeout' }, { status: 503 });
      }
      if (result.blocked) {
      return Response.json({
        status: 'blocked', reason: 'device_limit_reached', code: 'device_limit_reached',
        message: DEVICE_LIMIT_REACHED_MESSAGE,
          device_limit: result.limit, active_count: result.activeCount,
        });
      }
      return Response.json({
        status: 'active',
        device: { id: result.device.id, device_name: result.device.device_name },
        device_limit: result.limit ?? null,
        unlicensed: result.limit == null,
      });
    }

    /* ── HEARTBEAT (caller's own device) ──────────────────────────────── */
    if (action === 'heartbeat') {
      const installationId = String(body?.installation_id || '').trim();
      if (!caller.customer_id || !installationId) {
        return Response.json({ status: 'unregistered' });
      }
      const rows = await svc.entities.DeviceRegistration
        .filter({ customer_id: caller.customer_id, installation_id: installationId }).catch(() => []);
      const reg = rows?.[0] || null;
      if (!reg || reg.status !== 'active') return Response.json({ status: 'unregistered' });
      await svc.entities.DeviceRegistration.update(reg.id, {
        last_seen_at: new Date().toISOString(), last_user_id: caller.id, last_user_name: callerName,
      }).catch(() => {});
      return Response.json({ status: 'active' });
    }

    /* ── Admin authorization for list/update/set_status ──────────────────
     * Platform admin: any customer. Reseller administrator: only customers
     * belonging to their own reseller. Everyone else: denied. */
    const adminAuthorize = async (customerId: string): Promise<Response | null> => {
      if (isPlatformAdmin(caller)) return null;
      if (isResellerAdmin(caller)) {
        const cust = await loadCustomer(svc, customerId);
        if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });
        if (!cust.reseller_id || cust.reseller_id !== caller.reseller_id) {
          return Response.json({ error: 'That customer does not belong to your reseller', code: 'permission_denied' }, { status: 403 });
        }
        return null;
      }
      return Response.json({ error: 'You do not have permission to manage devices', code: 'permission_denied' }, { status: 403 });
    };

    /* ── LIST (devices + licence summary) ──────────────────────────────── */
    if (action === 'list') {
      const customerId = String(body?.customer_id || '');
      if (!customerId) return Response.json({ error: 'customer_id required', code: 'missing_customer' }, { status: 400 });
      const denied = await adminAuthorize(customerId);
      if (denied) return denied;
      const cust = await loadCustomer(svc, customerId);
      if (!cust) return Response.json({ error: 'Customer not found', code: 'customer_not_found' }, { status: 404 });
      const devices = (await svc.entities.DeviceRegistration
        .filter({ customer_id: customerId }, '-last_seen_at', 200).catch(() => [])) || [];
      const activeCount = devices.filter((d: any) => d.status === 'active').length;
      const limit = cust.device_limit ?? null;
      return Response.json({
        devices,
        summary: {
          device_limit: limit,
          active_count: activeCount,
          licensed: limit,
          slots_available: limit == null ? null : Math.max(0, limit - activeCount),
          requires_configuration: limit == null,
        },
        can_set_limit: isPlatformAdmin(caller),
      });
    }

    /* ── UPDATE (rename / assign site / assign gate) ────────────────────── */
    if (action === 'update') {
      const deviceId = String(body?.device_id || '');
      const rows = await svc.entities.DeviceRegistration.filter({ id: deviceId }).catch(() => []);
      const reg = rows?.[0] || null;
      if (!reg) return Response.json({ error: 'Device not found', code: 'device_not_found' }, { status: 404 });
      const denied = await adminAuthorize(reg.customer_id);
      if (denied) return denied;

      const upd: any = {};
      if (body.device_name !== undefined) {
        const name = String(body.device_name || '').trim().slice(0, 80);
        if (!name) return Response.json({ error: 'Device name cannot be empty', code: 'invalid_device_name' }, { status: 400 });
        upd.device_name = name;
      }
      if (body.site_id !== undefined) {
        if (body.site_id === null || body.site_id === 'none' || body.site_id === '') {
          upd.site_id = null;
        } else {
          const siteRows = await svc.entities.Site.filter({ id: String(body.site_id) }).catch(() => []);
          const site = siteRows?.[0];
          if (!site || site.customer_id !== reg.customer_id) {
            return Response.json({ error: 'The selected site does not belong to this customer', code: 'bad_site' }, { status: 400 });
          }
          if (site.status && site.status !== 'active') {
            return Response.json({ error: 'The selected site is not active', code: 'bad_site' }, { status: 400 });
          }
          upd.site_id = site.id;
        }
      }
      if (body.gate_name !== undefined) upd.gate_name = String(body.gate_name || '').trim().slice(0, 60) || null;
      if (Object.keys(upd).length === 0) return Response.json({ error: 'Nothing to update', code: 'no_changes' }, { status: 400 });

      const updated = await svc.entities.DeviceRegistration.update(deviceId, upd);
      await auditEntry(base44, {
        event_type: 'device.updated',
        customer_id: reg.customer_id, reseller_id: reg.reseller_id || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'DeviceRegistration', entity_id: deviceId, action: 'device_update',
        new_values: JSON.stringify(upd),
        notes: `Device ${reg.device_name} updated`,
      });
      return Response.json({ success: true, device: updated });
    }

    /* ── SET_STATUS (deactivate / reactivate) ──────────────────────────── */
    if (action === 'set_status') {
      const deviceId = String(body?.device_id || '');
      const target = String(body?.status || '');
      if (!['active', 'deactivated'].includes(target)) {
        return Response.json({ error: 'Status must be active or deactivated', code: 'invalid_status' }, { status: 400 });
      }
      const rows = await svc.entities.DeviceRegistration.filter({ id: deviceId }).catch(() => []);
      const reg = rows?.[0] || null;
      if (!reg) return Response.json({ error: 'Device not found', code: 'device_not_found' }, { status: 404 });
      const denied = await adminAuthorize(reg.customer_id);
      if (denied) return denied;
      if (reg.status === target) return Response.json({ success: true, unchanged: true });
      if (reg.status === 'revoked') {
        return Response.json({ error: 'A revoked device cannot be reactivated', code: 'revoked' }, { status: 400 });
      }
      const now = new Date().toISOString();

      if (target === 'deactivated') {
        const updated = await svc.entities.DeviceRegistration.update(deviceId, {
          status: 'deactivated', deactivated_at: now, deactivated_by: caller.id, deactivated_by_name: callerName,
        });
        await auditEntry(base44, {
          event_type: 'device.deactivated',
          customer_id: reg.customer_id, reseller_id: reg.reseller_id || undefined,
          user_id: caller.id, user_name: callerName,
          entity_name: 'DeviceRegistration', entity_id: deviceId, action: 'device_deactivated',
          notes: `Device ${reg.device_name} deactivated — its licence slot is now free`,
        });
        return Response.json({ success: true, device: updated });
      }

      // REACTIVATE consumes a licence slot — enforce the limit under the mutex.
      const result = await withCustomerLock(svc, reg.customer_id, async () => {
        const activeCount = await countActiveDevices(svc, reg.customer_id);
        const cust = await loadCustomer(svc, reg.customer_id);
        const limit = cust?.device_limit ?? null;
        if (limit != null && activeCount >= limit) return { blocked: true, activeCount, limit };
        const updated = await svc.entities.DeviceRegistration.update(deviceId, {
          status: 'active', activated_at: now,
          deactivated_at: null, deactivated_by: null, deactivated_by_name: null,
        });
        return { blocked: false, device: updated };
      });
      if (result.lock_error) {
        return Response.json({ error: 'Device management is busy. Please try again.', code: 'lock_timeout' }, { status: 503 });
      }
      if (result.blocked) {
        return Response.json({
          error: `Cannot reactivate: ${result.activeCount} of ${result.limit} device slots are already in use. Deactivate another device first or increase the licensed device limit.`,
          code: 'device_limit_reached',
        }, { status: 409 });
      }
      await auditEntry(base44, {
        event_type: 'device.reactivated',
        customer_id: reg.customer_id, reseller_id: reg.reseller_id || undefined,
        user_id: caller.id, user_name: callerName,
        entity_name: 'DeviceRegistration', entity_id: deviceId, action: 'device_reactivated',
        notes: `Device ${reg.device_name} reactivated`,
      });
      return Response.json({ success: true, device: result.device });
    }

    return Response.json({ error: 'Unknown action. Use register, heartbeat, list, update or set_status', code: 'bad_action' }, { status: 400 });
  } catch (error) {
    console.log('[deviceAccess] fatal', String((error as any)?.message || error));
    return Response.json({ error: 'Device operation failed. Please try again.', code: 'internal_error' }, { status: 500 });
  }
}