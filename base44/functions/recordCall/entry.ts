import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * recordCall — attach a call recording to an existing CallHistory record.
 *
 * HARDENED RECORDING UPLOAD:
 *  - the CallHistory record must ALREADY exist (a recording can never be
 *    attached to an unknown/forged call id — 'before authorization' uploads
 *    are rejected);
 *  - only a PARTICIPANT of that call (caller, receiver, listed participant)
 *    may attach a recording (IDOR guard);
 *  - the recording is stored in PRIVATE storage — access is only possible
 *    through rtcSignaling get_recording, which revalidates participation and
 *    returns a short-lived signed URL;
 *  - content type and size are validated server-side.
 */
const MAX_RECORDING_BYTES = 20 * 1024 * 1024; // 20 MB
const RECORDING_TYPES = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/mp4'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { callId, audioBlob, duration, contentType } = await req.json();

    if (!callId || !audioBlob) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const svc = base44.asServiceRole;

    // AUTHORIZED CALL REQUIRED — the call history must exist and the uploader
    // must be a participant.
    const [call] = await svc.entities.CallHistory.filter({ call_id: callId }).catch(() => []);
    if (!call) {
      return Response.json({ error: 'Call not found — recording cannot be attached' }, { status: 404 });
    }
    const isParticipant =
      call.caller_id === user.id ||
      call.receiver_id === user.id ||
      (Array.isArray(call.participants) && call.participants.some(p => p.user_id === user.id));
    if (!isParticipant) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const type = String(contentType || 'audio/webm').split(';')[0].toLowerCase();
    if (!RECORDING_TYPES.includes(type)) {
      return Response.json({ error: 'Unsupported recording format' }, { status: 400 });
    }

    const buffer = Uint8Array.from(atob(audioBlob), c => c.charCodeAt(0));
    if (buffer.length > MAX_RECORDING_BYTES) {
      return Response.json({ error: 'Recording too large' }, { status: 413 });
    }

    // PRIVATE storage — no public recording URLs are ever created.
    const { file_uri } = await svc.integrations.Core.UploadPrivateFile({ file: new File([buffer], 'recording.webm', { type }) });

    await svc.entities.CallHistory.update(call.id, {
      recording_url: file_uri,
      has_recording: true,
      duration_seconds: Number(duration) || call.duration_seconds || 0
    });

    return Response.json({
      success: true,
      recording_uri: file_uri,
      callId
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});