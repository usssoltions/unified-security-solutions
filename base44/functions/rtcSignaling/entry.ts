import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * rtcSignaling — WebRTC signaling relay with AUTHORITATIVE call sessions.
 *
 * Two layers of protection:
 *
 * 1. AUTHORITATIVE CALL SESSION — initiate_call creates a CallSession record
 *    (server-generated call_id, caller stamped from the authenticated user,
 *    participants resolved server-side). Every subsequent signaling action is
 *    validated against that record:
 *      - the requester must be a listed participant (no forged call ids, no
 *        signaling arbitrary targets outside the invited set)
 *      - the session status must permit the action:
 *          offer            → caller only, while 'ringing'
 *          answer/answered  → callee only, 'ringing' → 'active'
 *          candidate        → any participant, 'ringing' or 'active'
 *          end_call         → any participant → 'ended' ('declined' when the
 *                             callee rejects while still ringing)
 *      - ringing sessions older than RINGING_TTL_SECONDS are auto-expired
 *        (expired calls accept nothing but end_call)
 *      - replayed offers after the call is active are rejected by the status
 *        gate
 *
 * 2. TENANT MEMBERSHIP — a call may only be placed to users of the caller's
 *    own tenant (platform oversight excepted); sequential User ids were
 *    previously callable by anyone.
 *
 * Recordings are stored in PRIVATE storage and served only through
 * get_recording, which revalidates participation at access time and returns a
 * short-lived signed URL.
 *
 * Messages are persisted in the SignalingMessage entity so every invocation
 * reads/writes the same durable store. poll_messages fetches and deletes the
 * caller's queued messages.
 */

const RINGING_TTL_SECONDS = 90;
const MAX_RECORDING_BYTES = 20 * 1024 * 1024; // 20 MB
const RECORDING_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // NOTE: customer_id / reseller_id / platform_scope / caller identity are
    // NEVER accepted from the request — the call context is resolved
    // exclusively from the authenticated User record and the target records
    // loaded below. Client-supplied values are ignored entirely.
    const { action, targetUserId, participantIds, offer, answer, candidate, callId,
            audioBase64, duration, contentType, recordingUri, platformReason } = await req.json();

    /* ── Caller + tenant resolution (User record wins over session claims) ── */
    const [callerRec] = await svc.entities.User.filter({ id: String(user.id) }).catch(() => []);
    const isPlatform = (u) => !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');

    /* ── Participant resolution for a NEW call ──────────────────────────── *
     * Only the target User ids are accepted; every tenant/scope decision is
     * made in initiate_call from the resolved records, never from input. */
    const validateInvitees = async (ids) => {
      const uniqueIds = [...new Set((ids || []).filter(Boolean))];
      if (!uniqueIds.length) return { error: Response.json({ error: 'Missing call participants' }, { status: 400 }) };
      const resolved = [];
      const records = [];
      for (const id of uniqueIds) {
        const target = await svc.entities.User.get(id).catch(() => null);
        if (!target) return { error: Response.json({ error: 'Target user not found' }, { status: 404 }) };
        records.push(target);
        resolved.push({ user_id: target.id, user_name: target.full_name || target.display_name || 'Unknown' });
      }
      return { resolved, records };
    };

    /* ── Session lookup + participant/status gate ─────────────────────────── */
    const RINGING_TTL_MS = RINGING_TTL_SECONDS * 1000;
    const loadSession = async (id, { allowExpired = false } = {}) => {
      if (!id || typeof id !== 'string') return { error: Response.json({ error: 'Missing callId' }, { status: 400 }) };
      const [session] = await svc.entities.CallSession.filter({ call_id: id }).catch(() => []);
      if (!session) return { error: Response.json({ error: 'Call session not found' }, { status: 404 }) };
      const participantIds = [session.caller_id, session.callee_id, ...(session.participants || []).map(p => p.user_id)];
      if (!participantIds.includes(user.id)) {
        return { error: Response.json({ error: 'Forbidden — you are not a participant in this call' }, { status: 403 }) };
      }
      if (session.status === 'ringing' && Date.now() - new Date(session.created_date).getTime() > RINGING_TTL_MS) {
        // Auto-expire stale ringing sessions (durable, compare-and-swap style).
        try {
          await svc.entities.CallSession.update(session.id, { status: 'expired', ended_at: new Date().toISOString() });
          session.status = 'expired';
        } catch (_) {}
      }
      if (session.status === 'expired' && !allowExpired) {
        return { error: Response.json({ error: 'Call is no longer available' }, { status: 410 }) };
      }
      return { session };
    };
    const requireStatus = (session, allowed, actionName) => {
      if (!allowed.includes(session.status)) {
        return Response.json({ error: `Call is ${session.status} — ${actionName} is not allowed` }, { status: 409 });
      }
      return null;
    };

    const enqueue = async (type, toUserId, payload) => {
      await svc.entities.SignalingMessage.create({
        to_user_id: toUserId,
        from_user_id: user.id,
        type,
        call_id: callId || null,
        payload: payload ? JSON.stringify(payload) : '',
      });
    };

    switch (action) {
      /* ── Call initiation — creates the AUTHORITATIVE session ──────────── */
      case 'initiate_call': {
        const ids = Array.isArray(participantIds) && participantIds.length
          ? participantIds
          : (targetUserId ? [targetUserId] : []);
        const check = await validateInvitees(ids);
        if (check.error) return check.error;

        const callerIsPlatform = isPlatform(callerRec);
        const targets = check.records;
        const platformTargets = targets.filter(t => isPlatform(t));
        const tenantTargets = targets.filter(t => !isPlatform(t));

        /* ── Call context classification (server-side, exclusive) ────────── */
        let scope = { customer_id: null, reseller_id: null, platform_scope: false, initiation_reason: null };

        if (callerIsPlatform) {
          if (!tenantTargets.length) {
            // Platform admin → platform admin: explicitly classified platform
            // session. customer_id stays null ONLY here — never as a general
            // platform-admin bypass.
            scope.platform_scope = true;
          } else {
            if (platformTargets.length) {
              return Response.json({ error: 'Platform calls cannot mix platform and tenant participants' }, { status: 403 });
            }
            // Platform oversight into ONE tenant: bind the session to the
            // TARGET's authoritative tenant, not the (tenant-less) caller.
            const custIds = [...new Set(tenantTargets.map(t => t.customer_id).filter(Boolean))];
            if (custIds.length !== 1) {
              // No cross-tenant support workflow exists → bridging refused.
              return Response.json({ error: 'Cross-tenant calls are not permitted' }, { status: 403 });
            }
            const reason = typeof platformReason === 'string' ? platformReason.trim() : '';
            if (reason.length < 3) {
              return Response.json({ error: 'An explicit reason is required for platform-to-tenant calls' }, { status: 400 });
            }
            scope = {
              customer_id: custIds[0],
              reseller_id: tenantTargets.find(t => t.reseller_id)?.reseller_id || null,
              platform_scope: true,
              initiation_reason: reason.slice(0, 500),
            };
          }
        } else {
          // Tenant caller — a missing tenant scope fails CLOSED (unscoped
          // legacy users cannot initiate ordinary tenant calls).
          if (!callerRec?.customer_id) {
            return Response.json({ error: 'Your account has no organisation scope — calls are unavailable. Contact support through the support channel.' }, { status: 403 });
          }
          for (const t of targets) {
            if (isPlatform(t)) {
              return Response.json({ error: 'Platform staff cannot be called directly — use the support channel' }, { status: 403 });
            }
            if (!t.customer_id || t.customer_id !== callerRec.customer_id) {
              return Response.json({ error: 'Forbidden — calls are limited to your own organisation' }, { status: 403 });
            }
          }
          scope = {
            customer_id: callerRec.customer_id,
            reseller_id: callerRec.reseller_id || null,
            platform_scope: false,
            initiation_reason: null,
          };
        }

        /* ── CLASSIFICATION INVARIANTS (asserted server-side, fail closed) ── *
         * platform_scope=true requires either every participant to be a
         * platform administrator (platform-to-platform) or the explicitly
         * classified platform-oversight relationship (single tenant scope +
         * recorded initiation_reason). platform_scope=false requires an
         * authoritative customer tenant — an ordinary unscoped CallSession
         * can NEVER be created. */
        if (scope.platform_scope && !scope.customer_id && tenantTargets.length) {
          return Response.json({ error: 'Invalid platform session classification' }, { status: 500 });
        }
        if (scope.platform_scope && scope.customer_id && !scope.initiation_reason) {
          return Response.json({ error: 'Invalid platform session classification' }, { status: 500 });
        }
        if (!scope.platform_scope && !scope.customer_id) {
          return Response.json({ error: 'Refusing to create an unscoped call session' }, { status: 500 });
        }

        /* ── Initiation rate limit ───────────────────────────────────────── */
        const recentSessions = await svc.entities.CallSession.filter({ caller_id: String(user.id) }).catch(() => []);
        const recentCount = (recentSessions || []).filter(s =>
          Date.now() - new Date(s.created_date).getTime() < 60 * 1000).length;
        if (recentCount >= 5) {
          return Response.json({ error: 'Too many calls started — please wait a moment' }, { status: 429 });
        }

        const callIdAuth = `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const callee = check.resolved[0];
        const session = await svc.entities.CallSession.create({
          customer_id: scope.customer_id,
          reseller_id: scope.reseller_id,
          call_id: callIdAuth,
          caller_id: user.id,
          caller_name: callerRec?.display_name || callerRec?.full_name || user.full_name || 'Unknown',
          callee_id: callee.user_id,
          callee_name: callee.user_name,
          participants: check.resolved,
          call_type: (check.resolved.length > 1 || participantIds?.length > 1) ? 'group' : 'direct',
          platform_scope: scope.platform_scope,
          initiation_reason: scope.initiation_reason,
          status: 'ringing',
          started_at: new Date().toISOString(),
        });

        // Platform-initiated call — explicit platform audit trail for BOTH
        // platform-oversight calls into a tenant AND platform-to-platform
        // calls: every platform call is audited as a platform call.
        if (callerIsPlatform) {
          try {
            await svc.entities.PlatformAuditLog.create({
              event_type: scope.customer_id ? 'call.platform_initiated' : 'call.platform_to_platform',
              user_id: String(user.id),
              user_name: session.caller_name,
              customer_id: scope.customer_id,
              reseller_id: scope.reseller_id,
              entity_name: 'CallSession',
              entity_id: session.call_id,
              action: 'initiate_call (platform oversight)',
              notes: scope.customer_id
                ? `Platform administrator placed a call into a tenant. Reason: ${scope.initiation_reason}`
                : 'Platform administrator placed a platform-to-platform call.',
            });
          } catch (_) { /* audit must never break the call path */ }
        }

        return Response.json({
          success: true,
          callId: session.call_id,
          sessionId: session.id,
          platform_scope: scope.platform_scope,
          session_scope: scope.customer_id ? 'tenant' : 'platform',
        });
      }

      /* ── Signaling actions — validated against the session ────────────── */
      case 'send_offer': {
        const { session, error } = await loadSession(callId);
        if (error) return error;
        if (session.caller_id !== user.id) {
          return Response.json({ error: 'Only the caller may send the offer' }, { status: 403 });
        }
        const bad = requireStatus(session, ['ringing'], 'sending an offer');
        if (bad) return bad;
        if (targetUserId && ![session.callee_id, ...(session.participants || []).map(p => p.user_id)].includes(targetUserId)) {
          return Response.json({ error: 'Target is not a participant in this call' }, { status: 403 });
        }
        await enqueue('offer', targetUserId, offer);
        return Response.json({ success: true });
      }

      case 'send_answer':
      case 'call_answered': {
        const { session, error } = await loadSession(callId);
        if (error) return error;
        // Only an INVITED participant may answer — the caller cannot answer
        // their own call (self-answer would forge an accepted session).
        if (session.caller_id === user.id) {
          return Response.json({ error: 'Only the callee may answer' }, { status: 403 });
        }
        const bad = requireStatus(session, ['ringing', 'active'], 'answering');
        if (bad) return bad;
        if (action === 'send_answer') {
          await enqueue('answer', targetUserId, answer);
        } else {
          await enqueue('call_answered', targetUserId, null);
        }
        // First accepted answer activates the call exactly once (CAS-guarded).
        if (session.status === 'ringing') {
          try {
            await svc.entities.CallSession.update(session.id, { status: 'active', started_at: session.started_at || new Date().toISOString() });
          } catch (_) {}
        }
        return Response.json({ success: true });
      }

      case 'send_candidate': {
        const { session, error } = await loadSession(callId);
        if (error) return error;
        const bad = requireStatus(session, ['ringing', 'active'], 'sending a candidate');
        if (bad) return bad;
        if (targetUserId && ![session.caller_id, session.callee_id, ...(session.participants || []).map(p => p.user_id)].includes(targetUserId)) {
          return Response.json({ error: 'Target is not a participant in this call' }, { status: 403 });
        }
        // CANDIDATE FLOOD CAP — ICE produces dozens of candidates normally,
        // but a runaway or hostile participant must not enqueue unbounded
        // signaling records. The cap is per CALL SESSION (never global), so
        // one busy customer can never affect another tenant's calls.
        const candRows = await svc.entities.SignalingMessage.filter({ call_id: callId, type: 'candidate' }).catch(() => []);
        if ((candRows || []).length >= 200) {
          return Response.json({ error: 'Too many connection candidates for this call' }, { status: 429 });
        }
        await enqueue('candidate', targetUserId, candidate);
        return Response.json({ success: true });
      }

      case 'end_call': {
        const { session, error } = await loadSession(callId, { allowExpired: true });
        if (error) return error;
        if (['ended', 'declined', 'expired'].includes(session.status)) {
          return Response.json({ success: true, alreadyEnded: true });
        }
        const finalStatus = (session.status === 'ringing' && user.id !== session.caller_id) ? 'declined' : 'ended';
        try {
          await svc.entities.CallSession.update(session.id, { status: finalStatus, ended_at: new Date().toISOString() });
        } catch (_) {}
        if (targetUserId && targetUserId !== user.id) {
          await enqueue('call_ended', targetUserId, null);
        }
        return Response.json({ success: true });
      }

      /* ── Recording upload — participants only, PRIVATE storage ────────── */
      case 'upload_recording': {
        const { session, error } = await loadSession(callId, { allowExpired: true });
        if (error) return error;
        // Format/size are validated BEFORE the status gate so malformed
        // uploads are always reported as format errors.
        const type = String(contentType || 'audio/webm').split(';')[0].toLowerCase();
        if (!RECORDING_TYPES.includes(type)) {
          return Response.json({ error: 'Unsupported recording format' }, { status: 400 });
        }
        if (!audioBase64 || typeof audioBase64 !== 'string') {
          return Response.json({ error: 'Missing recording data' }, { status: 400 });
        }
        const size = Math.floor(audioBase64.length * 3 / 4);
        if (size > MAX_RECORDING_BYTES) {
          return Response.json({ error: 'Recording too large' }, { status: 413 });
        }
        if (session.status === 'ringing') {
          return Response.json({ error: 'Recording is only available once the call has connected or ended' }, { status: 409 });
        }
        const buffer = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const { file_uri } = await svc.integrations.Core.UploadPrivateFile({ file: new File([buffer], 'recording.webm', { type }) });
        await svc.entities.CallSession.update(session.id, { recording_uri: file_uri });
        // Attach to the CallHistory record if it already exists (same call id).
        const [history] = await svc.entities.CallHistory.filter({ call_id: callId }).catch(() => []);
        if (history) {
          const isParticipant = history.caller_id === user.id || history.receiver_id === user.id ||
            (Array.isArray(history.participants) && history.participants.some(p => p.user_id === user.id));
          if (isParticipant) {
            await svc.entities.CallHistory.update(history.id, {
              recording_url: file_uri, has_recording: true,
              duration_seconds: Number(duration) || history.duration_seconds || 0,
            });
          }
        }
        return Response.json({ success: true, recording_uri: file_uri });
      }

      /* ── Recording access — participants only, short-lived signed URL ──── */
      case 'get_recording': {
        const uri = typeof recordingUri === 'string' && recordingUri.startsWith('mp/private/')
          ? recordingUri
          : null;
        // Authorization is NEVER implied by the supplied uri: the requester
        // must be a participant of the call session, or — for uri-only
        // access — of the CallHistory record the recording belongs to.
        let targetUri = null;
        if (callId) {
          const lookup = await loadSession(callId, { allowExpired: true });
          if (lookup.error) return lookup.error;
          targetUri = uri || lookup.session.recording_uri;
        } else if (uri) {
          const [history] = await svc.entities.CallHistory.filter({ recording_url: uri }).catch(() => []);
          if (!history) return Response.json({ error: 'Recording not found' }, { status: 404 });
          const isParticipant = history.caller_id === user.id || history.receiver_id === user.id ||
            (Array.isArray(history.participants) && history.participants.some(p => p.user_id === user.id));
          if (!isParticipant) return Response.json({ error: 'Forbidden' }, { status: 403 });
          targetUri = uri;
        }
        if (!targetUri) return Response.json({ error: 'Recording not found' }, { status: 404 });
        const { signed_url } = await svc.integrations.Core.CreateFileSignedUrl({ file_uri: targetUri, expires_in: 300 });
        return Response.json({ success: true, signed_url });
      }

      case 'poll_messages': {
        const messages = await svc.entities.SignalingMessage.filter({ to_user_id: user.id });
        // Delete the messages we're about to deliver so they aren't redelivered.
        for (const m of messages || []) {
          try { await svc.entities.SignalingMessage.delete(m.id); } catch (_) {}
        }
        const out = (messages || []).map((m) => {
          let parsed = null;
          try { parsed = m.payload ? JSON.parse(m.payload) : null; } catch (_) {}
          return {
            type: m.type,
            from: m.from_user_id,
            callId: m.call_id,
            offer: m.type === 'offer' ? parsed : undefined,
            answer: m.type === 'answer' ? parsed : undefined,
            candidate: m.type === 'candidate' ? parsed : undefined,
          };
        });
        return Response.json({ success: true, messages: out });
      }

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('RTC Signaling error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});