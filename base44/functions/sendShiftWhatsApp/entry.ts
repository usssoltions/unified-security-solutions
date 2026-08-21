import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — WhatsApp dispatch uses backend credentials
    // and must not be triggerable without a login.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { guardId, shiftDetails, action } = await req.json();
    
    // Get guard details
    const guard = await base44.asServiceRole.entities.User.get(guardId);
    if (!guard || !guard.whatsapp_number) {
      return Response.json({ error: 'Guard WhatsApp not found' }, { status: 404 });
    }
    
    const waApiKey = Deno.env.get('WHATSAPP_API_KEY');
    const waPhoneId = Deno.env.get('WHATSAPP_PHONE_ID');
    
    if (!waApiKey || !waPhoneId) {
      return Response.json({ error: 'WhatsApp not configured' }, { status: 500 });
    }
    
    let messageText = '';
    
    switch (action) {
      case 'assigned':
        messageText = `*🛡️ New Shift Assignment*\n\n` +
          `Hello ${guard.full_name},\n\n` +
          `You have been assigned to a new shift:\n\n` +
          `📍 *Site:* ${shiftDetails.site_name}\n` +
          `📅 *Date:* ${new Date(shiftDetails.start_time).toLocaleDateString()}\n` +
          `🕐 *Start:* ${new Date(shiftDetails.start_time).toLocaleTimeString()}\n` +
          `🕐 *End:* ${new Date(shiftDetails.end_time).toLocaleTimeString()}\n\n` +
          `Please confirm receipt and ensure you clock in on time.\n\n` +
          `_Unified Security Solutions_`;
        break;
        
      case 'changed':
        messageText = `*⚠️ Shift Update*\n\n` +
          `Hello ${guard.full_name},\n\n` +
          `Your shift has been updated:\n\n` +
          `📍 *Site:* ${shiftDetails.site_name}\n` +
          `📅 *Date:* ${new Date(shiftDetails.start_time).toLocaleDateString()}\n` +
          `🕐 *New Start:* ${new Date(shiftDetails.start_time).toLocaleTimeString()}\n` +
          `🕐 *New End:* ${new Date(shiftDetails.end_time).toLocaleTimeString()}\n\n` +
          `_Unified Security Solutions_`;
        break;
        
      case 'reminder':
        messageText = `*⏰ Shift Reminder*\n\n` +
          `Hello ${guard.full_name},\n\n` +
          `Reminder: Your shift starts soon!\n\n` +
          `📍 *Site:* ${shiftDetails.site_name}\n` +
          `🕐 *Start Time:* ${new Date(shiftDetails.start_time).toLocaleTimeString()}\n\n` +
          `Please ensure you arrive on time and clock in.\n\n` +
          `_Unified Security Solutions_`;
        break;
        
      case 'cancelled':
        messageText = `*❌ Shift Cancelled*\n\n` +
          `Hello ${guard.full_name},\n\n` +
          `Your shift has been cancelled:\n\n` +
          `📍 *Site:* ${shiftDetails.site_name}\n` +
          `📅 *Date:* ${new Date(shiftDetails.start_time).toLocaleDateString()}\n\n` +
          `_Unified Security Solutions_`;
        break;
    }
    
    const waResponse = await fetch(`https://graph.facebook.com/v18.0/${waPhoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${waApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: guard.whatsapp_number.replace(/\D/g, ''),
        type: 'text',
        text: {
          body: messageText
        }
      })
    });
    
    const waResult = await waResponse.json();
    
    if (!waResponse.ok) {
      throw new Error(waResult.error?.message || 'WhatsApp send failed');
    }
    
    // Track delivery
    await base44.asServiceRole.entities.NotificationDelivery.create({
      notification_id: `whatsapp_${Date.now()}_${guardId}`,
      recipient_id: guardId,
      recipient_name: guard.full_name,
      notification_type: 'SHIFT',
      priority: 'medium',
      message: messageText,
      channels: [{
        channel: 'whatsapp',
        status: 'sent',
        sent_at: new Date().toISOString()
      }],
      related_entity: 'shift',
      related_id: shiftDetails.id
    });
    
    return Response.json({ 
      success: true,
      messageId: waResult.messages?.[0]?.id
    });
  } catch (error) {
    console.error('WhatsApp send error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});