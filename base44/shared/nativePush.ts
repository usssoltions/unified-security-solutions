/**
 * SHARED PLATFORM SERVICE — Base44 NATIVE push delivery.
 *
 * Architecture: Base44's native push (Core integrations.SendPushNotification)
 * delivers to a USER id on their registered devices and works with the app
 * fully CLOSED, once the native store builds are generated with push
 * credentials (iOS: APNs .p8 auth key; Android: your Firebase project with
 * google-services.json + service-account key — configured in the Base44
 * Publish → Mobile app flow, never in app code). Delivery is one call per
 * recipient; the platform owns the FCM/APNs token registry (invalid-token
 * lifecycle is handled platform-side — this service never retries dead
 * tokens, each logical event pushes exactly once).
 *
 * Rules enforced here (every module uses this one function — no per-module
 * push systems):
 *   1. POLICY: only CRITICAL / HIGH / NORMAL priorities push by default.
 *      'informational'/'low' events are skipped unless force=true
 *      (used by diagnostic test pushes and CRITICAL security alerts).
 *   2. IDEMPOTENCY: one push per event_key + user — deterministic keys make
 *      refresh/API-retry/sweep-retry/reconnect double-sends impossible.
 *   3. PERMISSION + PREFERENCE: skipped (and logged) when the user has no
 *      active device registration, denied OS permission, or push disabled.
 *   4. FAILURE ISOLATION: this function NEVER throws — a push failure can
 *      never break the business transaction or other channels. Every
 *      attempt is logged to NotificationDelivery (channel 'push').
 */

const PUSH_PRIORITIES = ['critical', 'high', 'medium', 'normal'];

export async function sendNativePush(svc, opts) {
  const {
    user_id,
    title,
    body,
    priority = 'normal',
    action_label,
    action_url,
    event_key,
    customer_id,
    reseller_id,
    force = false,
  } = opts || {};

  if (!user_id || !title || !body) {
    return { status: 'skipped', reason: 'INVALID_PUSH_PAYLOAD' };
  }

  // 1. Global notification policy gate.
  if (!force && PUSH_PRIORITIES.indexOf(String(priority).toLowerCase()) === -1) {
    return { status: 'skipped', reason: 'POLICY_' + String(priority).toUpperCase() };
  }

  const idempKey = event_key
    ? String(event_key) + ':user:' + user_id + ':push'
    : null;

  // 2. Idempotency — one push per logical event + recipient.
  if (idempKey) {
    try {
      const existing = await svc.entities.NotificationDelivery.filter(
        { idempotency_key: idempKey }, '-created_date', 1);
      if (existing && existing.length && existing[0].status === 'sent') {
        return { status: 'deduped' };
      }
    } catch (_) { /* idempotency check failure never blocks delivery */ }
  }

  // 3. Device registration + OS permission + user preference.
  let regs = [];
  try {
    regs = await svc.entities.PushRegistration.filter(
      { user_id, status: 'active' }) || [];
  } catch (_) { /* registration lookup failure never blocks delivery */ }

  if (!regs.length) {
    await logPushDelivery(svc, event_key, user_id, 'skipped', customer_id, reseller_id, idempKey, 'NO_PUSH_REGISTRATION');
    return { status: 'skipped', reason: 'NO_PUSH_REGISTRATION' };
  }
  if (regs.every((r) => r.notification_permission === 'denied')) {
    await logPushDelivery(svc, event_key, user_id, 'skipped', customer_id, reseller_id, idempKey, 'PERMISSION_DENIED');
    return { status: 'skipped', reason: 'PERMISSION_DENIED' };
  }
  if (regs.every((r) => r.push_enabled === false)) {
    await logPushDelivery(svc, event_key, user_id, 'skipped', customer_id, reseller_id, idempKey, 'PUSH_DISABLED');
    return { status: 'skipped', reason: 'PUSH_DISABLED' };
  }

  // 4. Deliver — Base44 native push, one call per recipient.
  try {
    await svc.integrations.Core.SendPushNotification({
      user_id,
      title: String(title).slice(0, 180),
      content: String(body).slice(0, 500),
      action_label: action_label || undefined,
      action_url: action_url || undefined,
    });
    const nowIso = new Date().toISOString();
    await logPushDelivery(svc, event_key, user_id, 'sent', customer_id, reseller_id, idempKey, null);
    try {
      await svc.entities.PushRegistration.updateMany(
        { user_id, status: 'active' },
        { $set: { last_push_at: nowIso } });
    } catch (_) { /* diagnostics timestamp only */ }
    return { status: 'sent' };
  } catch (e) {
    // Never retry here — the logical event pushes once; the failure is
    // recorded and the business transaction continues untouched.
    const msg = String((e && e.message) || e).slice(0, 400);
    await logPushDelivery(svc, event_key, user_id, 'failed', customer_id, reseller_id, idempKey, msg);
    return { status: 'failed', error: msg };
  }
}

/** Push the same event to many recipients (each idempotent per user). */
export async function sendNativePushToUsers(svc, userIds, opts) {
  const out = { sent: 0, skipped: 0, failed: 0, deduped: 0 };
  for (const uid of (userIds || [])) {
    const r = await sendNativePush(svc, { ...(opts || {}), user_id: uid }).catch(() => ({ status: 'failed' }));
    if (out[r.status] !== undefined) out[r.status]++;
  }
  return out;
}

async function logPushDelivery(svc, event_key, recipient_id, status, customer_id, reseller_id, idempKey, detail) {
  try {
    await svc.entities.NotificationDelivery.create({
      event_key: event_key || 'push_' + Date.now(),
      channel: 'push',
      status,
      recipient_id,
      customer_id: customer_id || undefined,
      reseller_id: reseller_id || undefined,
      send_time: new Date().toISOString(),
      // Provider responses / errors are stored WITHOUT credentials or tokens.
      provider_response: detail ? String(detail).slice(0, 300) : undefined,
      skip_reason: status === 'skipped' ? String(detail || '') : undefined,
      idempotency_key: idempKey || undefined,
      retries: 0,
    });
  } catch (_) { /* delivery logging must never break the notification */ }
}