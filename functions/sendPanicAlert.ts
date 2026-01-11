import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { location, notes, shiftId, siteId } = await req.json();

    if (!location || !location.lat || !location.lng) {
      return Response.json({ 
        error: 'Location coordinates required' 
      }, { status: 400 });
    }

    // Get all admin users
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const adminUsers = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'dispatcher' || 
      u.role_type === 'supervisor'
    );

    if (adminUsers.length === 0) {
      return Response.json({ 
        error: 'No admin users found to notify' 
      }, { status: 404 });
    }

    // Create panic alert in system
    const alert = await base44.asServiceRole.entities.Alert.create({
      type: 'panic',
      priority: 'critical',
      title: `🚨 PANIC ALERT - ${user.full_name}`,
      message: `EMERGENCY: Guard ${user.full_name} has triggered a panic alert!`,
      guard_id: user.id,
      guard_name: user.full_name,
      site_id: siteId,
      shift_id: shiftId,
      location,
      status: 'active',
      metadata: {
        notes: notes || 'No additional notes',
        timestamp: new Date().toISOString(),
        badge_number: user.badge_number,
        phone: user.phone_number
      }
    });

    const googleMapsUrl = `https://www.google.com/maps?q=${location.lat},${location.lng}`;

    // Send notifications to all admins
    const notificationPromises = adminUsers.map(async (admin) => {
      try {
        // Create in-app notification
        await base44.asServiceRole.entities.Notification.create({
          recipient_id: admin.id,
          recipient_name: admin.full_name,
          type: 'panic',
          priority: 'critical',
          title: `🚨 PANIC ALERT - ${user.full_name}`,
          message: `EMERGENCY: Guard ${user.full_name} has triggered a panic alert at ${new Date().toLocaleString()}. Immediate response required!`,
          read: false,
          related_entity: 'alert',
          related_id: alert.id,
          action_url: googleMapsUrl,
          sent_via: ['in_app']
        });

        // Send email
        if (admin.email) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            subject: `🚨 CRITICAL: PANIC ALERT - ${user.full_name}`,
            body: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 30px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 28px;">🚨 PANIC ALERT 🚨</h1>
                  <p style="color: white; margin: 10px 0 0 0; font-size: 16px;">IMMEDIATE ACTION REQUIRED</p>
                </div>
                <div style="background: #fef2f2; padding: 30px;">
                  <div style="background: white; padding: 25px; border-radius: 8px; border-left: 6px solid #dc2626; margin-bottom: 20px;">
                    <h2 style="color: #dc2626; margin-top: 0; font-size: 22px;">Emergency Panic Button Activated</h2>
                    <div style="background: #fee2e2; padding: 15px; border-radius: 6px; margin: 15px 0;">
                      <p style="margin: 5px 0;"><strong>Guard:</strong> ${user.full_name}</p>
                      <p style="margin: 5px 0;"><strong>Badge:</strong> ${user.badge_number || 'N/A'}</p>
                      <p style="margin: 5px 0;"><strong>Phone:</strong> ${user.phone_number || 'N/A'}</p>
                      <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                      ${notes ? `<p style="margin: 5px 0;"><strong>Notes:</strong> ${notes}</p>` : ''}
                    </div>
                    <div style="margin: 20px 0;">
                      <p style="font-weight: bold; color: #991b1b; margin-bottom: 10px;">📍 Guard Location:</p>
                      <p style="margin: 5px 0;">Latitude: ${location.lat}</p>
                      <p style="margin: 5px 0;">Longitude: ${location.lng}</p>
                    </div>
                    <div style="text-align: center; margin: 25px 0;">
                      <a href="${googleMapsUrl}" style="display: inline-block; background: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">📍 VIEW LOCATION ON MAP</a>
                    </div>
                  </div>
                  <div style="background: #fef2f2; border: 2px solid #fca5a5; padding: 15px; border-radius: 8px; text-align: center;">
                    <p style="color: #dc2626; font-weight: bold; margin: 0; font-size: 14px;">⚠️ THIS IS A CRITICAL EMERGENCY - RESPOND IMMEDIATELY</p>
                  </div>
                </div>
              </div>
            `
          });
        }

        return { adminId: admin.id, status: 'success' };
      } catch (error) {
        return { adminId: admin.id, status: 'failed', error: error.message };
      }
    });

    const results = await Promise.all(notificationPromises);

    return Response.json({ 
      success: true,
      alertId: alert.id,
      notificationsSent: results.filter(r => r.status === 'success').length,
      adminCount: adminUsers.length,
      location: googleMapsUrl,
      results
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});