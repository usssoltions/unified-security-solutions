import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { callId, audioBlob, duration, participants } = await req.json();

    if (!callId || !audioBlob) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Convert base64 to blob and upload
    const buffer = Uint8Array.from(atob(audioBlob), c => c.charCodeAt(0));
    
    const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({
      file: buffer
    });

    // Update call history with recording
    const callHistory = await base44.asServiceRole.entities.CallHistory.filter({ call_id: callId });
    
    if (callHistory && callHistory.length > 0) {
      await base44.asServiceRole.entities.CallHistory.update(callHistory[0].id, {
        recording_url: file_url,
        has_recording: true,
        duration_seconds: duration || 0
      });
    }

    return Response.json({ 
      success: true, 
      recording_url: file_url,
      callId
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});