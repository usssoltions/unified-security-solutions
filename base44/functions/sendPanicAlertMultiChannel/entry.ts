import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { guardId, guardName, location, shiftId, siteId, siteName } = await req.json();
    
    const panicId = `panic_${Date.now()}_${guardId}`;
    
    // Get all admins and supervisors
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const recipients = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'supervisor' ||
      u.role_type === 'dispatcher'
    );
    
    const googleMapsUrl = location?.lat && location?.lng
      ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
      : null;

    const title = '🚨 PANIC ALERT - IMMEDIATE ACTION REQUIRED';
    const message = `${guardName} has triggered a PANIC BUTTON at ${siteName || 'Unknown Location'}. ${googleMapsUrl ? `Location: ${googleMapsUrl}` : ''} RESPOND IMMEDIATELY.`;
    
    // Create alert in database
    await base44.asServiceRole.entities.Alert.create({
      type: 'panic',
      priority: 'critical',
      title: title,
      message: message,
      guard_id: guardId,
      guard_name: guardName,
      site_id: siteId,
      shift_id: shiftId,
      location: location,
      status: 'active'
    });
    
    const notificationPromises = [];
    
    // Send to all recipients via ALL channels
    for (const recipient of recipients) {
      notificationPromises.push(
        base44.asServiceRole.functions.invoke('sendPushNotification', {
          userId: recipient.id,
          title: title,
          message: message,
          type: 'PANIC',
          priority: 'critical',
          data: {
            panicId: panicId,
            guardId: guardId,
            location: location,
            related_entity: 'panic',
            related_id: panicId
          },
          channels: ['push', 'email', 'whatsapp']
        })
      );
    }
    
    // Send to customer contacts (email only)
    const customerEmails = Deno.env.get('CUSTOMER_EMAILS')?.split(',') || [];
    for (const email of customerEmails) {
      if (email.trim()) {
        notificationPromises.push(
          base44.asServiceRole.integrations.Core.SendEmail({
            from_name: 'Unified Security Solutions - URGENT',
            to: email.trim(),
            subject: '🚨 PANIC ALERT - Security Emergency',
            body: `
              <div style="background: #dc2626; color: white; padding: 20px; border-radius: 8px;">
                <h1 style="margin: 0;">🚨 PANIC ALERT</h1>
                <p style="font-size: 18px; font-weight: bold;">IMMEDIATE ACTION REQUIRED</p>
              </div>
              <div style="padding: 20px;">
                <p><strong>Guard:</strong> ${guardName}</p>
                <p><strong>Site:</strong> ${siteName || 'Unknown'}</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Location:</strong> ${googleMapsUrl ? `<a href="${googleMapsUrl}" style="color:#dc2626;font-weight:bold;">📍 Open in Google Maps (${location.lat.toFixed(6)}, ${location.lng.toFixed(6)})</a>` : 'Unknown'}</p>
                <p><strong>Status:</strong> ACTIVE - Requires immediate response</p>
                <br>
                <p style="color: #dc2626; font-weight: bold;">This is an emergency situation. Please respond immediately.</p>
              </div>
            `
          })
        );
      }
    }
    
    await Promise.all(notificationPromises);
    
    // Retry mechanism - resend after 30 seconds if not acknowledged
    setTimeout(async () => {
      try {
        const alerts = await base44.asServiceRole.entities.Alert.filter({ type: 'panic', status: 'active' });
        const activePanic = alerts.find(a => a.message.includes(guardName));
        
        if (activePanic) {
          // Still not acknowledged - resend
          console.log('PANIC NOT ACKNOWLEDGED - RESENDING');
          await base44.asServiceRole.functions.invoke('sendPanicAlertMultiChannel', {
            guardId, guardName, location, shiftId, siteId, siteName
          });
        }
      } catch (error) {
        console.error('Retry error:', error);
      }
    }, 30000);
    
    return Response.json({ 
      success: true,
      panicId: panicId,
      recipientCount: recipients.length,
      customerEmailCount: customerEmails.length
    });
  } catch (error) {
    console.error('Panic alert error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});