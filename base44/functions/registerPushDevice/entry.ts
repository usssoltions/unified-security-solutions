/**
 * registerPushDevice — SHARED PLATFORM SERVICE: device push registration
 * lifecycle for Base44 NATIVE push.
 *
 * Self-service ONLY: an authenticated user manages ONLY their own device
 * registrations — user_id is always the authenticated caller (the client
 * never supplies it). Multi-device is native: each device registers its own
 * fingerprint; registering a new device never deactivates existing ones.
 *
 * Actions:
 *   register       — upsert this device (fingerprint) with platform, label,
 *                    OS permission state; re-registration after reinstall
 *                    simply revives/updates the record.
 *   heartbeat      — refresh last_active_at + OS permission state.
 *   setEnabled     — user's push on/off preference across their devices.
 *   unregister     — deactivate this device (or all) with a reason
 *                    (logout / user_disabled / reinstall).
 *   myRegistrations — list the caller's active registrations (status UI).
 *
 * Raw FCM/APNs tokens are NOT handled here — the Base44 platform owns the
 * provider token registry for SendPushNotification; this registry powers
 * UX status, delivery policy and admin diagnostics.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const svc = base44.asServiceRole;
    const nowIso = new Date().toISOString();
    const fingerprint = String(body.device_fingerprint || '').trim();

    if (action === 'register') {
      if (!fingerprint || fingerprint.length < 8) {
        return Response.json({ error: 'A device fingerprint is required' }, { status: 400 });
      }
      const platform = ['android', 'ios', 'web', 'other'].includes(body.device_platform) ? body.device_platform : 'web';
      const permission = ['granted', 'denied', 'default'].includes(body.notification_permission)
        ? body.notification_permission : 'default';
      const payload = {
        user_id: caller.id,
        customer_id: caller.customer_id || null,
        reseller_id: caller.reseller_id || null,
        device_fingerprint: fingerprint,
        device_platform: platform,
        device_label: String(body.device_label || '').trim() || null,
        app_version: String(body.app_version || '').trim() || null,
        notification_permission: permission,
        push_enabled: body.push_enabled === false ? false : true,
        status: 'active',
        last_active_at: nowIso,
        registered_at: nowIso,
        unregistered_at: null,
        unregistered_reason: null,
      };
      const existing = await svc.entities.PushRegistration.filter(
        { user_id: caller.id, device_fingerprint: fingerprint }).catch(() => []);
      if (existing && existing.length) {
        const reg = await svc.entities.PushRegistration.update(existing[0].id, payload);
        return Response.json({ success: true, registration: reg });
      }
      const reg = await svc.entities.PushRegistration.create(payload);
      return Response.json({ success: true, registration: reg });
    }

    if (action === 'heartbeat') {
      if (!fingerprint) return Response.json({ error: 'A device fingerprint is required' }, { status: 400 });
      const permission = ['granted', 'denied', 'default'].includes(body.notification_permission)
        ? body.notification_permission : undefined;
      const set = { last_active_at: nowIso };
      if (permission) set.notification_permission = permission;
      await svc.entities.PushRegistration.updateMany(
        { user_id: caller.id, device_fingerprint: fingerprint, status: 'active' },
        { $set: set }).catch(() => {});
      return Response.json({ success: true });
    }

    if (action === 'setPermission') {
      const permission = ['granted', 'denied', 'default'].includes(body.notification_permission)
        ? body.notification_permission : null;
      if (!permission) return Response.json({ error: 'A valid permission state is required' }, { status: 400 });
      await svc.entities.PushRegistration.updateMany(
        { user_id: caller.id, status: 'active' },
        { $set: { notification_permission: permission, last_active_at: nowIso } }).catch(() => {});
      return Response.json({ success: true });
    }

    if (action === 'setEnabled') {
      await svc.entities.PushRegistration.updateMany(
        { user_id: caller.id, status: 'active' },
        { $set: { push_enabled: !!body.enabled, last_active_at: nowIso } }).catch(() => {});
      return Response.json({ success: true });
    }

    if (action === 'unregister') {
      const reason = ['logout', 'user_disabled', 'reinstall', 'other'].includes(body.reason) ? body.reason : 'other';
      const query = fingerprint
        ? { user_id: caller.id, device_fingerprint: fingerprint, status: 'active' }
        : { user_id: caller.id, status: 'active' };
      await svc.entities.PushRegistration.updateMany(query,
        { $set: { status: 'inactive', unregistered_at: nowIso, unregistered_reason: reason } }).catch(() => {});
      return Response.json({ success: true });
    }

    if (action === 'myRegistrations') {
      const regs = await svc.entities.PushRegistration.filter(
        { user_id: caller.id, status: 'active' }).catch(() => []);
      return Response.json({ success: true, registrations: regs || [] });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}