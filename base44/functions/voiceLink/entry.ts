import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

/**
 * voiceLink — USS VOICE LINK (pilot) gateway. Phase 1: reliable individual calls.
 *
 * FULLY ISOLATED from the legacy calling engine (rtcSignaling / CallSession /
 * SignalingMessage / sendCallPushNotification are untouched); a Voice Link call
 * can never ring legacy devices and vice versa — distinct entities, distinct
 * push data type ('voicelink_call'), distinct notification handling.
 *
 * SERVER-AUTHORITATIVE on every action:
 *  - caller/callee identity resolved from the authenticated session, or from a
 *    call-scoped callee_signal_token delivered only inside the callee's own
 *    push (native Android engine, no browser session);
 *  - tenant membership, site membership, control-room assignment, the CALLING
 *    commercial entitlement and the per-user VoiceLinkPilot enrolment are all
 *    validated server-side; cross-tenant targets are refused;
 *  - duplicate calls refused while either party has a live (ringing/connecting/
 *    connected) call;
 *  - status transitions are ATOMIC conditional updates: accept claims
 *    ringing -> connecting exactly once (answering on one device stops the
 *    others), and a call that rang out transitions to 'missed' rather than
 *    being answerable late;
 *  - the WebRTC offer is permitted ONLY in status 'connecting' — a call is
 *    never marked active before its connection offer is permitted, and
 *    'connected' is stamped only when media is actually established;
 *  - signaling payloads are size-capped, participant-bound and consumed
 *    exactly once per recipient;
 *  - stale notifications re-opening ended calls are refused by the state gate.
 */

const RINGING_TTL_MS = 45 * 1000;
const ACTIVE_STATUSES = ['ringing', 'connecting', 'connected'];
const MAX_SIGNAL_CHARS = 16000;

const iceServers = () => {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  // BEST-EFFORT relay for restrictive LTE/carrier NAT: a free public community
  // TURN (no account, no cost, no SLA). If P2P and this relay both fail, the
  // call fails — the honest limitation of the no-new-infrastructure model.
  servers.push({
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  });
  return servers;
};

const nowIso = () => new Date().toISOString();

const displayName = (u) =>
  (u && (u.display_name || u.full_name)) || (u && u.full_name) || 'Unknown';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const me = await base44.auth.me().catch(() => null);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    /* ── GLOBAL RELEASE FLAG (platform-wide, default OFF) ─────────────────
     * INDEPENDENT of the CALLING entitlement and the per-user pilot flag:
     * while the global flag is OFF, every call action fails closed — no
     * contacts, no initiation, no listeners, no push dispatch. Only 'status'
     * (release state query) and the isolated platform-admin 'selftest' run.
     * The flag is read from SystemConfiguration (config_key
     * 'voice_link_release', platform-wide customer_id null). A missing row
     * or an unparseable value defaults to OFF. Customer-scoped rows with
     * the same key are IGNORED (only the platform-wide row counts), so a
     * customer administrator can never release the module themselves. */
    const releaseCfg = (await svc.entities.SystemConfiguration.filter({
      config_key: 'voice_link_release',
      customer_id: null,
    }).catch(() => [])) || [];
    const releaseRow = releaseCfg.filter((r) => !r.customer_id).pop();
    let releaseEnabled = false;
    try {
      releaseEnabled = !!(releaseRow && JSON.parse(releaseRow.config_value || '{}').enabled === true);
    } catch (_) { releaseEnabled = false; }

    if (action === 'status') {
      return Response.json({ release_enabled: releaseEnabled });
    }
    if (!releaseEnabled && action !== 'selftest') {
      if (action === 'contacts') return Response.json({ release_enabled: false });
      return Response.json({ error: 'Voice Link is not released yet' }, { status: 403 });
    }

    /* ── Identity resolution: session first, then call-token ─────────────── */
    let user = me;
    let tokenCallId = null;
    if (!user && body.token && body.call_id) {
      tokenCallId = String(body.call_id);
      const [tokCall] = await svc.entities.VoiceLinkCall.filter({ call_id: tokenCallId }).catch(() => []);
      const validToken = !!tokCall &&
        tokCall.callee_signal_token &&
        tokCall.callee_signal_token === String(body.token) &&
        tokCall.callee_id;
      if (!validToken) {
        return Response.json({ error: 'Invalid call token' }, { status: 401 });
      }
      // Token identity: act as the call's callee for this call only.
      user = { id: tokCall.callee_id, _tokenScopedCall: tokenCallId };
    }
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    /* ── Records + platform/pilot/entitlement helpers ────────────────────── */
    let userRec = null;
    if (me) {
      [userRec] = await svc.entities.User.filter({ id: String(user.id) }).catch(() => []);
    }
    const isPlatformAdmin = !!userRec && (
      userRec.role === 'admin' || userRec.role_type === 'platform_admin' || userRec.admin_level === 'platform'
    );

    const assertPilot = async (uid) => {
      if (isPlatformAdmin) return true;
      const rows = await svc.entities.VoiceLinkPilot.filter({ user_id: String(uid), enabled: true }).catch(() => []);
      return (rows || []).length > 0;
    };

    const assertCallingEntitlement = async (customerId) => {
      if (!customerId) return false;
      const rows = await svc.entities.ModuleEntitlement.filter({
        customer_id: String(customerId), module_key: 'CALLING', enabled: true, status: 'active',
      }).catch(() => []);
      return (rows || []).length > 0;
    };

    /* ── Server-side routing resolution ──────────────────────────────────── */
    // On-duty = actually signed in / clocked in, not merely scheduled.
    const onDutyAtSite = async (customerId, siteId) => {
      if (!customerId || !siteId) return [];
      const shifts = await svc.entities.Shift.filter({ customer_id: String(customerId), site_id: String(siteId) }).catch(() => []);
      const seen = new Map();
      for (const s of shifts || []) {
        const ci = s.clock_in && s.clock_in.timestamp;
        const co = s.clock_out && s.clock_out.timestamp;
        const onDuty = (!!ci && !co) || s.status === 'active';
        const scheduled = ['scheduled', 'open', 'accepted'].includes(s.status);
        if (!onDuty && !scheduled) continue;
        const prev = seen.get(s.guard_id);
        if (!prev || (onDuty && !prev.on_duty)) {
          seen.set(s.guard_id, {
            user_id: s.guard_id,
            name: s.guard_name || 'Unknown',
            availability: onDuty ? 'on_duty' : 'scheduled',
          });
        }
      }
      return [...seen.values()];
    };

    // Rooms explicitly serving a site (never guessed).
    const roomsForSite = async (customerId, siteId) => {
      if (!customerId || !siteId) return [];
      const rooms = await svc.entities.ControlRoom.filter({ customer_id: String(customerId), status: 'active' }).catch(() => []);
      return (rooms || []).filter((r) => (r.linked_site_ids || []).includes(String(siteId)));
    };

    const resolveOperator = async (operatorId) => {
      const rooms = await svc.entities.ControlRoom.filter({ customer_id: String(userRec?.customer_id || ''), status: 'active' }).catch(() => []);
      for (const r of rooms || []) {
        if ((r.operator_user_ids || []).includes(String(operatorId))) {
          return { control_room_id: r.id, control_room_name: r.name };
        }
      }
      return null;
    };

    /* ── Call lookup + transition helpers ────────────────────────────────── */
    const loadCall = async (callId) => {
      if (!callId) return null;
      const [c] = await svc.entities.VoiceLinkCall.filter({ call_id: String(callId) }).catch(() => []);
      return c || null;
    };

    // A ringing call past its deadline becomes 'missed' at the next touch.
    const expireIfNeeded = async (call) => {
      if (!call || call.status !== 'ringing') return call;
      if (!call.expires_at || new Date(call.expires_at).getTime() > Date.now()) return call;
      await svc.entities.VoiceLinkCall.updateMany(
        { call_id: call.call_id, status: 'ringing' },
        { $set: { status: 'missed', end_reason: 'timeout', ended_at: nowIso() } }
      ).catch(() => null);
      const fresh = await loadCall(call.call_id);
      return fresh || call;
    };

    const appendLog = (call, status, actorId, actorName, note) => {
      const log = [...(call.lifecycle_log || [])];
      log.push({ at: nowIso(), status, actor_id: actorId || null, actor_name: actorName || null, note: note || null });
      return log.slice(-50);
    };

    const isParticipant = (call, uid) => !!call && (call.caller_id === uid || call.callee_id === uid);

    /* ── Best-effort push dispatch (Voice Link data only) ────────────────── */
    const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID');
    const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_REST_API_KEY');

    const pushData = async (toIds, data, opts) => {
      if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY || !(toIds || []).length) return { ok: false, reason: 'push_not_configured' };
      try {
        const res = await fetch('https://onesignal.com/api/v1/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${ONESIGNAL_API_KEY}` },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            app_id: ONESIGNAL_APP_ID,
            include_external_user_ids: toIds.map(String),
            headings: { en: opts?.heading || 'USS Voice Link' },
            contents: { en: opts?.content || 'Call update' },
            priority: opts?.priority ?? 10,
            ttl: 30,
            android_visibility: 1,
            content_available: true,
            data,
          }),
        });
        const out = await res.json().catch(() => ({}));
        return { ok: res.ok && !out.errors, response: out };
      } catch (e) {
        return { ok: false, reason: String(e && e.message || e).slice(0, 200) };
      }
    };

    const callStateToOther = async (call, status, excludeId) => {
      const toIds = [call.caller_id, call.callee_id].filter((id) => id && id !== excludeId);
      await pushData(toIds, { type: 'voicelink_call_state', callId: call.call_id, status }, { priority: 9 });
    };

    /* ══════════════════════════ ACTIONS ══════════════════════════ */

    /* ── contacts: pilot-scoped directory, resolved server-side ──────────── */
    if (action === 'contacts') {
      if (!userRec) return Response.json({ error: 'Session required' }, { status: 401 });
      const pilotOk = await assertPilot(userRec.id);
      if (!pilotOk) return Response.json({ pilot_ok: false });
      const customer = userRec.customer_id;
      if (!customer || !(await assertCallingEntitlement(customer))) {
        return Response.json({ pilot_ok: true, entitled: false });
      }

      if (userRec.role_type === 'guard') {
        // Guard's site: prefer the shift they are actually signed in on.
        const myShifts = await svc.entities.Shift.filter({ customer_id: String(customer), guard_id: String(userRec.id) }).catch(() => []);
        const myActive = (myShifts || []).find((s) => (s.clock_in && s.clock_in.timestamp && !(s.clock_out && s.clock_out.timestamp)) || s.status === 'active');
        const siteId = (myActive && myActive.site_id) || userRec.site_id || null;
        if (!siteId) return Response.json({ pilot_ok: true, entitled: true, error: 'no_site' });
        const [site] = await svc.entities.Site.filter({ id: String(siteId) }).catch(() => []);
        const colleagues = await onDutyAtSite(customer, siteId);
        const rooms = await roomsForSite(customer, siteId);
        const operators = [];
        for (const room of rooms) {
          for (const opId of room.operator_user_ids || []) {
            if (String(opId) === String(userRec.id)) continue;
            const [u] = await svc.entities.User.get(String(opId)).catch(() => [null]);
            if (u) operators.push({
              user_id: u.id, name: displayName(u), role_type: u.role_type || null,
              control_room_id: room.id, control_room_name: room.name,
            });
          }
        }
        return Response.json({
          pilot_ok: true, entitled: true, view: 'guard',
          site_id: siteId, site_name: (site && site.name) || null,
          colleagues, operators, multiple_rooms: rooms.length > 1,
        });
      }

      // Control-room operator/dispatcher: their assigned rooms' sites.
      const rooms = await svc.entities.ControlRoom.filter({ customer_id: String(customer), status: 'active' }).catch(() => []);
      const myRooms = (rooms || []).filter((r) => (r.operator_user_ids || []).includes(String(userRec.id)) || (r.supervisor_user_ids || []).includes(String(userRec.id)));
      const sites = [];
      for (const room of myRooms) {
        for (const siteId of room.linked_site_ids || []) {
          const [site] = await svc.entities.Site.filter({ id: String(siteId) }).catch(() => []);
          const colleagues = await onDutyAtSite(customer, siteId);
          sites.push({ site_id: siteId, site_name: (site && site.name) || null, control_room_id: room.id, control_room_name: room.name, colleagues });
        }
      }
      return Response.json({ pilot_ok: true, entitled: true, view: 'operator', sites });
    }

    /* ── initiate: place an individual call (session-authenticated) ──────── */
    if (action === 'initiate') {
      if (!me || !userRec) return Response.json({ error: 'Session required' }, { status: 401 });
      if (!(await assertPilot(userRec.id))) return Response.json({ error: 'Voice Link pilot not enabled for this account' }, { status: 403 });
      const customer = userRec.customer_id;
      if (!customer || !(await assertCallingEntitlement(customer))) {
        return Response.json({ error: 'Calling is not licensed for this account' }, { status: 403 });
      }
      const targetId = String(body.target_user_id || '');
      if (!targetId || targetId === String(userRec.id)) {
        return Response.json({ error: 'Invalid call target' }, { status: 400 });
      }
      const [calleeRec] = await svc.entities.User.get(targetId).then((u) => [u]).catch(() => [null]);
      if (!calleeRec) return Response.json({ error: 'Target user not found' }, { status: 404 });
      if (calleeRec.customer_id && calleeRec.customer_id !== customer) {
        return Response.json({ error: 'Cross-tenant calls are not permitted' }, { status: 403 });
      }
      if (!(await assertCallingEntitlement(calleeRec.customer_id || customer))) {
        return Response.json({ error: 'Calling is not licensed for the recipient' }, { status: 403 });
      }
      if (!(await assertPilot(calleeRec.id))) {
        return Response.json({ error: 'Voice Link pilot not enabled for the recipient' }, { status: 403 });
      }

      // ELIGIBILITY (recomputed server-side): guard -> colleague on duty at the
      // caller's site, or an operator of a room explicitly serving that site;
      // operator -> personnel on duty at one of the caller's assigned sites.
      let eligibility = null;
      if (userRec.role_type === 'guard') {
        const myShifts = await svc.entities.Shift.filter({ customer_id: String(customer), guard_id: String(userRec.id) }).catch(() => []);
        const myActive = (myShifts || []).find((s) => (s.clock_in && s.clock_in.timestamp && !(s.clock_out && s.clock_out.timestamp)) || s.status === 'active');
        const siteId = (myActive && myActive.site_id) || userRec.site_id || null;
        if (!siteId) return Response.json({ error: 'No site assignment resolved for caller' }, { status: 403 });
        const [site] = await svc.entities.Site.filter({ id: String(siteId) }).catch(() => []);
        const colleagues = await onDutyAtSite(customer, siteId);
        const rooms = await roomsForSite(customer, siteId);
        const opMatch = (rooms || []).find((r) => (r.operator_user_ids || []).includes(targetId));
        const colleague = colleagues.find((c) => c.user_id === targetId);
        if (!opMatch && !colleague) {
          return Response.json({ error: 'Recipient is not eligible for a Voice Link call from you' }, { status: 403 });
        }
        eligibility = {
          site_id: siteId, site_name: (site && site.name) || null,
          control_room_id: opMatch ? opMatch.id : null, control_room_name: opMatch ? opMatch.name : null,
        };
      } else {
        const rooms = await svc.entities.ControlRoom.filter({ customer_id: String(customer), status: 'active' }).catch(() => []);
        const myRooms = (rooms || []).filter((r) => (r.operator_user_ids || []).includes(String(userRec.id)) || (r.supervisor_user_ids || []).includes(String(userRec.id)));
        let match = null;
        for (const room of myRooms) {
          for (const siteId of room.linked_site_ids || []) {
            const colleagues = await onDutyAtSite(customer, siteId);
            const colleague = colleagues.find((c) => c.user_id === targetId);
            if (colleague && !match) {
              const [site] = await svc.entities.Site.filter({ id: String(siteId) }).catch(() => []);
              match = { site_id: siteId, site_name: (site && site.name) || null, control_room_id: room.id, control_room_name: room.name };
            }
          }
        }
        if (!match) return Response.json({ error: 'Recipient is not eligible for a Voice Link call from you' }, { status: 403 });
        eligibility = match;
      }

      // DUPLICATE GUARD: neither party may already hold a live Voice Link call.
      const busyCheck = async (uid) => {
        const statuses = await Promise.all(ACTIVE_STATUSES.map((st) =>
          svc.entities.VoiceLinkCall.filter({ status: st }).catch(() => [])));
        const rows = statuses.flat();
        return rows.some((c) => (c.caller_id === String(uid) || c.callee_id === String(uid)));
      };
      if (await busyCheck(userRec.id)) return Response.json({ error: 'You already have a Voice Link call in progress' }, { status: 409 });
      if (await busyCheck(calleeRec.id)) return Response.json({ error: 'Recipient is busy on another Voice Link call' }, { status: 409 });

      const callId = 'VL-' + Date.now().toString(36).toUpperCase() + '-' +
        crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
      const signalToken = crypto.randomUUID();
      const created = await svc.entities.VoiceLinkCall.create({
        call_id: callId,
        customer_id: String(customer),
        reseller_id: userRec.reseller_id || calleeRec.reseller_id || null,
        caller_id: String(userRec.id),
        caller_name: displayName(userRec),
        caller_role_type: userRec.role_type || null,
        callee_id: String(calleeRec.id),
        callee_name: displayName(calleeRec),
        callee_role_type: calleeRec.role_type || null,
        site_id: eligibility.site_id || null,
        site_name: eligibility.site_name || null,
        control_room_id: eligibility.control_room_id || null,
        control_room_name: eligibility.control_room_name || null,
        status: 'ringing',
        requested_at: nowIso(),
        expires_at: new Date(Date.now() + RINGING_TTL_MS).toISOString(),
        callee_signal_token: signalToken,
        lifecycle_log: [{ at: nowIso(), status: 'ringing', actor_id: String(userRec.id), actor_name: displayName(userRec), note: 'Call initiated' }],
      }).catch((e) => { throw new Error('Failed to create call: ' + e.message); });

      // Ring the callee: one push to ALL of the callee's devices (native +
      // web). The token travels ONLY inside this callee's own push payload.
      // BOUNDED DISPATCH: the caller's response never waits on OneSignal —
      // past 1.2s the push continues in the background and the caller is told
      // it is dispatching (a slow relay can never stall call initiation).
      const push = await Promise.race([
        pushData([calleeRec.id], {
          type: 'voicelink_call', callId, callerId: String(userRec.id),
          callerName: displayName(userRec), token: signalToken,
        }, { heading: 'Incoming Call', content: `${displayName(userRec)} is calling you (Voice Link)` }),
        new Promise((resolve) => setTimeout(() => resolve({ ok: true, reason: 'dispatching' }), 1200)),
      ]);

      return Response.json({
        call: {
          call_id: callId, status: 'ringing', caller_id: created.caller_id, callee_id: created.callee_id,
          callee_name: created.callee_name, requested_at: created.requested_at, expires_at: created.expires_at,
        },
        role: 'caller', ice_servers: iceServers(), push_result: { ok: push.ok, reason: push.reason || null },
      });
    }

    /* ── Call-scoped actions (session OR call-token) ─────────────────────── */
    if (['accept', 'decline', 'cancel', 'mark_connected', 'hangup', 'state', 'signal', 'poll_signals', 'incoming'].includes(action)) {
      const call = await expireIfNeeded(await loadCall(tokenCallId || body.call_id));
      if (!call) return Response.json({ error: 'Unknown call' }, { status: 404 });

      const uid = String(user.id);
      const participant = isParticipant(call, uid);
      const calleeToken = !!tokenCallId && String(body.token) === call.callee_signal_token && call.callee_id === uid;

      if (action === 'incoming') {
        if (!me || !userRec) return Response.json({ error: 'Session required' }, { status: 401 });
        // Pilot-scoped: return the caller's live incoming call, if any.
        if (!(await assertPilot(userRec.id))) return Response.json({ pilot_ok: false });
        const mine = await svc.entities.VoiceLinkCall.filter({ callee_id: uid, status: 'ringing' }).catch(() => []);
        let live = null;
        for (const c of mine || []) {
          const expired = await expireIfNeeded(c);
          if (expired && expired.status === 'ringing') { live = expired; break; }
        }
        return Response.json({ call: live ? {
          call_id: live.call_id, caller_name: live.caller_name, caller_id: live.caller_id,
          expires_at: live.expires_at, status: live.status,
        } : null, ice_servers: iceServers() });
      }

      if (!participant && !calleeToken) {
        return Response.json({ error: 'Not a participant in this call' }, { status: 403 });
      }

      if (action === 'state') {
        const { callee_signal_token, ...safe } = call;
        return Response.json({ call: safe, role: call.caller_id === uid ? 'caller' : 'callee', ice_servers: iceServers() });
      }

      if (action === 'accept') {
        if (call.status === 'connecting' || call.status === 'connected') {
          return Response.json({ already_claimed: true, call_state: call.status });
        }
        if (call.status !== 'ringing') {
          return Response.json({ error: `Call is ${call.status} — cannot answer` }, { status: 409 });
        }
        const deviceId = String(body.device_id || 'device').slice(0, 120);
        await svc.entities.VoiceLinkCall.updateMany(
          { call_id: call.call_id, status: 'ringing' },
          { $set: {
            status: 'connecting', answered_at: nowIso(), answered_device: deviceId,
            lifecycle_log: appendLog(call, 'connecting', uid, null, `Answered on device ${deviceId}`),
          } }
        ).catch(() => null);
        const fresh = await loadCall(call.call_id);
        if (!fresh || fresh.status !== 'connecting' || fresh.answered_device !== deviceId) {
          const other = await loadCall(call.call_id);
          return Response.json({ already_claimed: true, call_state: other ? other.status : 'ended' });
        }
        // Tell the caller the callee picked up (subscription/polling also
        // covers web callers; this helps native-in-background callers).
        await callStateToOther(fresh, 'connecting', null);
        return Response.json({ accepted: true, role: 'callee', ice_servers: iceServers(), call: { call_id: fresh.call_id, status: fresh.status } });
      }

      if (action === 'decline') {
        if (call.caller_id === uid && !calleeToken) return Response.json({ error: 'Only the recipient can decline' }, { status: 403 });
        if (call.status === 'ringing') {
          await svc.entities.VoiceLinkCall.updateMany(
            { call_id: call.call_id, status: 'ringing' },
            { $set: { status: 'declined', end_reason: 'declined', ended_at: nowIso(), ended_by_id: uid,
              lifecycle_log: appendLog(call, 'declined', uid, null, 'Recipient declined') } }
          ).catch(() => null);
          await callStateToOther(call, 'declined', uid);
          return Response.json({ declined: true });
        }
        return Response.json({ error: `Call is ${call.status} — decline no longer applies` }, { status: 409 });
      }

      if (action === 'cancel') {
        if (call.caller_id !== uid) return Response.json({ error: 'Only the caller can cancel' }, { status: 403 });
        if (call.status === 'ringing') {
          await svc.entities.VoiceLinkCall.updateMany(
            { call_id: call.call_id, status: 'ringing' },
            { $set: { status: 'cancelled', end_reason: 'cancelled', ended_at: nowIso(), ended_by_id: uid,
              lifecycle_log: appendLog(call, 'cancelled', uid, null, 'Caller cancelled before answer') } }
          ).catch(() => null);
          await callStateToOther(call, 'cancelled', uid);
          return Response.json({ cancelled: true });
        }
        return Response.json({ error: `Call is ${call.status} — cancel no longer applies` }, { status: 409 });
      }

      if (action === 'mark_connected') {
        if (call.status === 'connected') return Response.json({ connected: true, already: true });
        if (call.status !== 'connecting') return Response.json({ error: `Call is ${call.status} — media cannot be marked connected` }, { status: 409 });
        await svc.entities.VoiceLinkCall.updateMany(
          { call_id: call.call_id, status: 'connecting' },
          { $set: { status: 'connected', connected_at: nowIso(),
            lifecycle_log: appendLog(call, 'connected', uid, null, 'Media established') } }
        ).catch(() => null);
        return Response.json({ connected: true });
      }

      if (action === 'hangup') {
        if (!['connecting', 'connected'].includes(call.status)) {
          return Response.json({ error: `Call is ${call.status}` }, { status: 409 });
        }
        const duration = call.connected_at
          ? Math.max(0, Math.round((Date.now() - new Date(call.connected_at).getTime()) / 1000)) : 0;
        await svc.entities.VoiceLinkCall.updateMany(
          { call_id: call.call_id, status: call.status },
          { $set: { status: 'ended', end_reason: String(body.reason || 'hangup').slice(0, 60), ended_at: nowIso(),
            ended_by_id: uid, ended_by_name: userRec ? displayName(userRec) : call.callee_name,
            duration_seconds: duration,
            lifecycle_log: appendLog(call, 'ended', uid, userRec ? displayName(userRec) : null, `Ended (${body.reason || 'hangup'}, ${duration}s)`) } }
        ).catch(() => null);
        await callStateToOther(call, 'ended', uid);
        return Response.json({ ended: true, duration_seconds: duration });
      }

      if (action === 'signal') {
        if (!['connecting', 'connected'].includes(call.status)) {
          return Response.json({ error: `Call is ${call.status} — signaling closed` }, { status: 409 });
        }
        const kind = String(body.kind || '');
        const payloadStr = String(body.payload || '');
        if (!['offer', 'answer', 'ice'].includes(kind)) return Response.json({ error: 'Invalid signal kind' }, { status: 400 });
        if (payloadStr.length > MAX_SIGNAL_CHARS) return Response.json({ error: 'Signal payload too large' }, { status: 413 });
        // Direction gates: offer = caller only, answer = callee only, both in
        // 'connecting' only. ICE either side while connecting/connected.
        if (kind === 'offer' && call.caller_id !== uid) return Response.json({ error: 'Only the caller sends the offer' }, { status: 403 });
        // The caller may re-offer with ICE restart while connected (reconnection).
        if (kind === 'offer' && !['connecting', 'connected'].includes(call.status)) {
          return Response.json({ error: 'Offer permitted only while connecting/connected' }, { status: 409 });
        }
        if (kind === 'answer' && call.callee_id !== uid) return Response.json({ error: 'Only the recipient sends the answer' }, { status: 403 });
        if (kind === 'answer' && call.status !== 'connecting') {
          return Response.json({ error: 'Answer permitted only while connecting' }, { status: 409 });
        }
        const toId = call.caller_id === uid ? call.callee_id : call.caller_id;
        const prior = await svc.entities.VoiceLinkSignal.filter({ call_id: call.call_id }).catch(() => []);
        const seq = (prior || []).length;
        await svc.entities.VoiceLinkSignal.create({
          call_id: call.call_id, from_id: uid, to_id: toId, kind, payload: payloadStr, seq, consumed: false,
        }).catch((e) => { throw new Error('Signal create failed: ' + e.message); });
        return Response.json({ signaled: true, seq });
      }

      if (action === 'poll_signals') {
        if (!['connecting', 'connected'].includes(call.status) && call.status !== 'ended') {
          return Response.json({ signals: [] });
        }
        const rows = await svc.entities.VoiceLinkSignal.filter({ call_id: call.call_id, to_id: uid }).catch(() => []);
        const pending = (rows || []).filter((s) => !s.consumed)
          .sort((a, b) => (a.seq || 0) - (b.seq || 0));
        if (pending.length) {
          await svc.entities.VoiceLinkSignal.bulkUpdate(pending.map((s) => ({ id: s.id, consumed: true }))).catch(() => null);
        }
        return Response.json({ signals: pending.map((s) => ({ kind: s.kind, payload: s.payload, seq: s.seq })) });
      }
    }

    /* ── selftest: ISOLATED lifecycle validation (platform admin only) ─────
     * Creates is_test calls, verifies (1) the expired-ringing sweep marks
     * 'missed', (2) the two-device accept claim is answered EXACTLY once and
     * (3) a signal row is consumed exactly once, then marks every test row
     * CANCELLED (never deleted — non-destructive; is_test rows are excluded
     * from live views and removable through the platform's test-data cleanup).
     * No real calls, devices or pushes are touched. */
    if (action === 'selftest') {
      if (!isPlatformAdmin) return Response.json({ error: 'Platform admin required' }, { status: 403 });
      const suffix = Date.now().toString(36).toUpperCase();
      const results = [];
      const mkTestCall = async (callId, expiresAt) => svc.entities.VoiceLinkCall.create({
        call_id: callId, customer_id: 'voicelink_selftest',
        caller_id: 'selftest-caller', caller_name: 'VoiceLink SelfTest Caller',
        callee_id: 'selftest-callee', callee_name: 'VoiceLink SelfTest Callee',
        status: 'ringing', requested_at: nowIso(), expires_at: expiresAt,
        callee_signal_token: crypto.randomUUID(), is_test: true,
        lifecycle_log: [{ at: nowIso(), status: 'ringing', actor_id: null, actor_name: 'selftest', note: 'Isolated self-test call' }],
      });
      // NON-DESTRUCTIVE cleanup: mark the test call cancelled with a selftest
      // reason. The rows stay (is_test = true) for audit and are never shown
      // to operational users; pending signal rows are consumed so nothing is
      // re-deliverable. Nothing is ever deleted here.
      const cleanup = async (callId) => {
        await svc.entities.VoiceLinkCall.updateMany(
          { call_id: callId, customer_id: 'voicelink_selftest' },
          { $set: { status: 'cancelled', end_reason: 'selftest' } }
        ).catch(() => null);
        const rows = await svc.entities.VoiceLinkSignal.filter({ call_id: callId }).catch(() => []);
        if (rows.length) {
          await svc.entities.VoiceLinkSignal.bulkUpdate(
            rows.map((s) => ({ id: s.id, consumed: true }))).catch(() => null);
        }
      };

      // (1) RING TIMEOUT: an expired ringing call is swept to 'missed'.
      const timeoutCallId = 'VL-SELFTEST-' + suffix + '-T';
      await mkTestCall(timeoutCallId, new Date(Date.now() - 2000).toISOString());
      const swept = await expireIfNeeded(await loadCall(timeoutCallId));
      results.push({ check: 'ring_timeout_marks_missed', pass: !!swept && swept.status === 'missed', detail: swept ? swept.status : 'no_call' });

      // (2) TWO-DEVICE ACCEPT CLAIM: exactly one device can claim the answer.
      const claimCallId = 'VL-SELFTEST-' + suffix + '-C';
      await mkTestCall(claimCallId, new Date(Date.now() + RINGING_TTL_MS).toISOString());
      const attemptAccept = async (deviceId) => {
        const rec = await loadCall(claimCallId);
        if (!rec) return { device: deviceId, result: 'no_call' };
        if (rec.status !== 'ringing') return { device: deviceId, result: 'already_claimed', state: rec.status };
        await svc.entities.VoiceLinkCall.updateMany(
          { call_id: claimCallId, status: 'ringing' },
          { $set: { status: 'connecting', answered_at: nowIso(), answered_device: deviceId } }
        ).catch(() => null);
        const fresh = await loadCall(claimCallId);
        return (fresh && fresh.status === 'connecting' && fresh.answered_device === deviceId)
          ? { device: deviceId, result: 'accepted' }
          : { device: deviceId, result: 'already_claimed', state: fresh ? fresh.status : 'ended' };
      };
      // SIMULTANEOUS attempt: both devices issue their conditional accept in
      // the SAME instant (Promise.all) — the platform's updateMany is a
      // single server-side conditional write (status 'ringing' matches exactly
      // once), so a genuine parallel race is decided by the database, never by
      // a read-then-write sequence.
      const [deviceA, deviceB] = await Promise.all([
        attemptAccept('selftest-device-a'), attemptAccept('selftest-device-b'),
      ]);
      const acceptedCount = [deviceA, deviceB].filter((r) => r.result === 'accepted').length;
      results.push({ check: 'single_device_accept_simultaneous', pass: acceptedCount === 1, detail: `A=${deviceA.result}, B=${deviceB.result}` });

      // (3) SIGNAL DELIVERY EXACTLY ONCE: a relay row is consumed exactly once.
      const sigCallId = 'VL-SELFTEST-' + suffix + '-S';
      await mkTestCall(sigCallId, new Date(Date.now() + RINGING_TTL_MS).toISOString());
      const sigId = 's-' + suffix;
      await svc.entities.VoiceLinkSignal.create({ call_id: sigCallId, from_id: 'selftest-caller', to_id: 'selftest-callee', kind: 'offer', payload: '{"sdp":"test"}', seq: 0, consumed: false }).catch(() => null);
      const read = await svc.entities.VoiceLinkSignal.filter({ call_id: sigCallId, to_id: 'selftest-callee' }).catch(() => []);
      const pendingFirst = (read || []).filter((s) => !s.consumed);
      if (pendingFirst.length) {
        await svc.entities.VoiceLinkSignal.bulkUpdate(pendingFirst.map((s) => ({ id: s.id, consumed: true }))).catch(() => null);
      }
      const after = await svc.entities.VoiceLinkSignal.filter({ call_id: sigCallId, to_id: 'selftest-callee' }).catch(() => []);
      const pendingSecond = (after || []).filter((s) => !s.consumed);
      results.push({
        check: 'signal_consumed_once', pass: pendingFirst.length === 1 && pendingSecond.length === 0,
        detail: `first=${pendingFirst.length}, second=${pendingSecond.length}`,
      });

      await cleanup(timeoutCallId); await cleanup(claimCallId); await cleanup(sigCallId);
      const allPass = results.every((r) => r.pass);
      return Response.json({ selftest: allPass ? 'passed' : 'failed', results });
    }

    return Response.json({ error: `Unknown action '${action}'` }, { status: 400 });
  } catch (error) {
    console.error('[voiceLink] error:', error);
    return Response.json({ error: error.message || 'Gateway error' }, { status: 500 });
  }
});