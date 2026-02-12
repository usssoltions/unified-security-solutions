import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { channelId, audioBlob, duration } = await req.json();

    if (!channelId || !audioBlob) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Convert base64 to blob and upload
    const buffer = Uint8Array.from(atob(audioBlob), c => c.charCodeAt(0));
    
    const { file_url } = await base44.asServiceRole.integrations.Core.UploadFile({
      file: buffer
    });

    // Create PTT message record
    const message = await base44.asServiceRole.entities.PTTMessage.create({
      channel_id: channelId,
      sender_id: user.id,
      sender_name: user.full_name,
      sender_role: user.role_type,
      audio_url: file_url,
      duration_seconds: duration || 0,
      priority: 'normal'
    });

    // Update channel last message time
    const channel = await base44.asServiceRole.entities.PTTChannel.get(channelId);
    if (channel) {
      await base44.asServiceRole.entities.PTTChannel.update(channelId, {
        last_message_at: new Date().toISOString()
      });
    }

    return Response.json({ 
      success: true, 
      audio_url: file_url,
      message_id: message.id
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});