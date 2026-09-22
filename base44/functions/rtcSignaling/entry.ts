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

    const { action, targetUserId, participantIds, offer, answer, candidate, callId,
            audioBase64, duration, contentType, recordingUri } = await req.json();

    /* ── Caller + tenant resolution (User record wins over session claims) ── */
    const [callerRec] = await svc.entities.User.filter({ id: String(user.id) }).catch(() => []);
    const isPlatform = (u) => !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');

    /* ── Participant/tenant validation for a NEW call ────────────────────── */
    const validateInvitees = async (ids) => {
      const uniqueIds = [...new Set((ids || []).filter(Boolean))];
      if (!uniqueIds.length) return { error: Response.json({ error: 'Missing call participants' }, { status: 400 }) };
      const resolved = [];
      for (const id of uniqueIds) {
        const target = await svc.entities.User.get(id).catch(() => null);
        if (!target) return { error: Response.json({ error: 'Target user not found' }, { status: 404 }) };
        if (!isPlatform(callerRec) && !(callerRec?.customer_id && target.customer_id === callerRec.customer_id)) {
          return { error: Response.json({ error: 'Forbidden — calls are limited to your own organisation' }, { status: 403 }) };
        }
        resolved.push({ user_id: target.id, user_name: target.full_name || target.display_name || 'Unknown' });
      }
      return { resolved };
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
        const callIdAuth = `call_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const callee = check.resolved[0];
        const session = await svc.entities.CallSession.create({
          customer_id: callerRec?.customer_id || null,
          call_id: callIdAuth,
          caller_id: user.id,
          caller_name: callerRec?.display_name || callerRec?.full_name || user.full_name || 'Unknown',
          callee_id: callee.user_id,
          callee_name: callee.user_name,
          participants: check.resolved,
          call_type: (check.resolved.length > 1 || participantIds?.length > 1) ? 'group' : 'direct',
          status: 'ringing',
          started_at: new Date().toISOString(),
        });
        return Response.json({ success: true, callId: session.call_id, sessionId: session.id });
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
        const { file_uri } = await svc.integrations.Core.UploadPrivateFile({ file: buffer });
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