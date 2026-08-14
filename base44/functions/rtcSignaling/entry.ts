import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * rtcSignaling — WebRTC signaling relay.
 *
 * PREVIOUSLY this stored offer/answer/candidate messages in an in-memory Map.
 * That does NOT work on a serverless runtime: each invocation can hit a
 * different (cold) instance, so a message written by `send_offer` in one
 * instance was invisible to `poll_messages` in another — voice calls never
 * connected.
 *
 * NOW messages are persisted in the SignalingMessage entity so every
 * invocation reads/writes the same durable store. poll_messages fetches and
 * deletes the caller's queued messages.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, targetUserId, offer, answer, candidate, callId } = await req.json();

    const enqueue = async (type, toUserId, payload) => {
      await base44.asServiceRole.entities.SignalingMessage.create({
        to_user_id: toUserId,
        from_user_id: user.id,
        type,
        call_id: callId || null,
        payload: payload ? JSON.stringify(payload) : '',
      });
    };

    switch (action) {
      case 'initiate_call':
        return Response.json({ success: true, callId: `call_${Date.now()}_${user.id}` });

      case 'send_offer':
        await enqueue('offer', targetUserId, offer);
        return Response.json({ success: true });

      case 'send_answer':
        await enqueue('answer', targetUserId, answer);
        return Response.json({ success: true });

      case 'call_answered':
        await enqueue('call_answered', targetUserId, null);
        return Response.json({ success: true });

      case 'send_candidate':
        await enqueue('candidate', targetUserId, candidate);
        return Response.json({ success: true });

      case 'end_call':
        if (targetUserId && targetUserId !== user.id) {
          await enqueue('call_ended', targetUserId, null);
        }
        return Response.json({ success: true });

      case 'poll_messages': {
        const messages = await base44.asServiceRole.entities.SignalingMessage.filter({ to_user_id: user.id });
        // Delete the messages we're about to deliver so they aren't redelivered.
        for (const m of messages || []) {
          try { await base44.asServiceRole.entities.SignalingMessage.delete(m.id); } catch (_) {}
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