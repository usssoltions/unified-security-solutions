import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';

/**
 * sendCallPushNotification — push leg of the incoming-call flow.
 *
 * PROVIDER DECISION (documented, deliberate): OneSignal is the SUPPORTED
 * provider for CALL pushes. Native push (Core.SendPushNotification) is used
 * for the rest of the app, but it cannot replace OneSignal for calls yet
 * because the native Android Firebase upload credentials required for
 * production native push delivery have not been provided/uploaded to the
 * platform — until they are, native push cannot reliably wake the Android
 * app for an incoming call, and include_external_user_ids currently reaches
 * every recipient device (Android native SDK + web SDK) via OneSignal.login.
 *
 * SERVER-AUTHORITATIVE CONTROLS:
 *  - caller identity resolved from the authenticated User record only;
 *    browser-supplied caller name/avatar/URL/tenant are NEVER used;
 *  - the recipient must be a listed participant of the server-created
 *    CallSession the authenticated caller placed (cross-tenant and forged
 *    call ids are rejected before any push dispatch);
 *  - ended/declined/expired sessions are rejected;
 *  - delivery is deduplicated per call + recipient (NotificationDelivery
 *    idempotency key) and rate-limited per caller;
 *  - branding (push accent colour) follows customer → reseller → platform;
 *  - the tap URL opens the validated call session only (call id; identity
 *    is re-resolved in-app from the session, never from the URL);
 *  - truthful provider results are recorded in NotificationDelivery —
 *    no credentials, tokens or audio content are ever logged.
 */
const MAX_PUSH_PER_CALLER_PER_MINUTE = 10;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Browser-supplied caller identity/branding fields are deliberately NOT
    // read from the body.
    const { recipientId, callId, isGroupCall } = await req.json();

    if (!recipientId || !callId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // CALLER IDENTITY — resolved server-side (impersonation fix).
    const [callerRec] = await svc.entities.User.filter({ id: String(user.id) }).catch(() => []);
    const callerName = callerRec?.display_name || callerRec?.full_name || user.full_name || 'Unknown';

    // AUTHORITATIVE SESSION — push is only sent for a call the authenticated
    // user actually placed (server-created CallSession).
    const [session] = await svc.entities.CallSession.filter({ call_id: String(callId) }).catch(() => []);
    if (!session || session.caller_id !== user.id) {
      return Response.json({ error: 'Unknown call session' }, { status: 404 });
    }

    // Reject ended/declined/expired sessions — no push for dead calls.
    if (session.status === 'ended' || session.status === 'declined' || session.status === 'expired') {
      return Response.json({ error: `Call is ${session.status} — push not sent` }, { status: 409 });
    }

    // MEMBERSHIP — the recipient must be a listed participant of this exact
    // session (prevents cross-tenant/stranger ring spam even within a tenant).
    const participantIds = [session.callee_id, ...(session.participants || []).map(p => p.user_id)].filter(Boolean);
    if (!participantIds.includes(recipientId)) {
      return Response.json({ error: 'Recipient is not a participant in this call' }, { status: 403 });
    }

    // DEDUPLICATION — one push per call + recipient + event. A repeated
    // request (double-tap, retry) is a no-op, not a second ring.
    const idemKey = `call_push:${callId}:${recipientId}`;
    const existing = await svc.entities.NotificationDelivery.filter({ idempotency_key: idemKey }).catch(() => []);
    if (existing && existing.length) {
      return Response.json({ success: true, deduplicated: true });
    }

    // DELIVERY RATE LIMIT — ring-bombing guard: at most N call pushes to this
    // recipient per minute (call CREATION itself is already rate-limited per
    // caller by rtcSignaling initiate_call).
    const recent = await svc.entities.NotificationDelivery.filter({ recipient_id: String(recipientId) }).catch(() => []);
    const pushesLastMinute = (recent || []).filter(d =>
      d.event_type === 'call_push' &&
      Date.now() - new Date(d.created_date || 0).getTime() < 60 * 1000).length;
    if (pushesLastMinute >= MAX_PUSH_PER_CALLER_PER_MINUTE) {
      return Response.json({ error: 'Too many call pushes — please wait a moment' }, { status: 429 });
    }

    // Claim the delivery record FIRST (idempotency), then dispatch. SDK create
    // returns the created record object directly — never array-destructure it.
    const delivery = await svc.entities.NotificationDelivery.create({
      event_key: idemKey,
      event_type: 'call_push',
      reference_id: String(callId),
      customer_id: session.customer_id || undefined,
      reseller_id: session.reseller_id || undefined,
      recipient_id: String(recipientId),
      channel: 'push',
      status: 'pending',
      send_time: new Date().toISOString(),
      idempotency_key: idemKey,
    }).catch(() => null);

    // Deployment origin from the incoming request — never hard-coded, so
    // custom domains and preview deployments stay correct. The URL carries
    // ONLY the validated call id; identity is resolved in-app from the
    // session (never trusted from the URL).
    const appOrigin = new URL(req.url).origin;

    // BRANDING — customer → reseller → platform accent colour for Android.
    const brand = await resolveCommunicationBrand(svc, {
      customer_id: session.customer_id || null,
      reseller_id: session.reseller_id || null,
    }).catch(() => null);
    const hex = String(brand?.primary_color || '#10B981').replace('#', '');
    const accent = /^[0-9a-fA-F]{6}$/.test(hex) ? `FF${hex.toUpperCase()}` : 'FF10B981';

    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    const recordResult = async (status: string, provider_response: string, skip_reason?: string) => {
      if (!delivery) return;
      try {
        await svc.entities.NotificationDelivery.update(delivery.id, {
          status,
          provider_response: String(provider_response || '').slice(0, 300),
          ...(skip_reason ? { skip_reason } : {}),
        });
      } catch (_) { /* delivery logging must never break the call path */ }
    };

    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
      await recordResult('failed', 'OneSignal not configured', 'NO_ONESIGNAL_CREDENTIALS');
      console.warn('[sendCallPushNotification] OneSignal not configured');
      return Response.json({ success: false, message: 'OneSignal not configured' });
    }

    // include_external_user_ids reaches ALL of the recipient's devices
    // (Android native SDK + web SDK) via OneSignal.login(userId).
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_API_KEY}`
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_external_user_ids: [recipientId],
        headings: { en: '📞 Incoming Call' },
        contents: {
          en: isGroupCall
            ? `${callerName} is calling (Group Call)`
            : `${callerName} is calling you`
        },
        priority: 10,
        ttl: 30,
        // No android_channel_id: the OneSignal app has no custom 'calls' channel
        // (live rejection 2026-09-22). The DEFAULT channel is used, with
        // importance 5 = heads-up ring behaviour.
        android_visibility: 1,
        android_importance: 5,
        android_sound: 'default',
        android_accent_color: accent,
        android_led_color: accent,
        android_group: 'calls',
        android_group_message: { en: 'Incoming calls' },
        content_available: true,
        mutable_content: true,
        ios_sound: 'default',
        ios_badgeType: 'Increase',
        ios_badgeCount: 1,
        ios_category: 'call',
        apns_alert: {
          title: '📞 Incoming Call',
          subtitle: isGroupCall ? 'Group Call' : 'Direct Call'
        },
        url: `${appOrigin}/?call_id=${encodeURIComponent(String(callId))}`,
        web_url: `${appOrigin}/?call_id=${encodeURIComponent(String(callId))}`,
        data: {
          type: 'call',
          callId: callId,
          isGroupCall: !!isGroupCall
        }
      })
    });

    const result = await response.json().catch(() => ({}));
    const ok = response.ok && !(result as any).errors;

    await recordResult(ok ? 'sent' : 'failed', ok ? JSON.stringify(result).slice(0, 300) : JSON.stringify((result as any).errors || result).slice(0, 300));

    return Response.json({
      success: ok,
      onesignal_response: result
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});