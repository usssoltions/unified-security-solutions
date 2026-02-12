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
            from_name: 'Unified Security Solutions - EMERGENCY',
            subject: `🚨 CRITICAL PANIC ALERT - ${user.full_name} - IMMEDIATE ACTION REQUIRED`,
            body: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              </head>
              <body style="margin: 0; padding: 0; background-color: #f5f5f5;">
                <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; background-color: white;">
                  <!-- Company Header -->
                  <div style="background-color: #1e40af; padding: 20px; text-align: center;">
                    <div style="background-color: white; display: inline-block; padding: 10px 20px; border-radius: 8px;">
                      <h2 style="margin: 0; color: #1e40af; font-size: 24px;">Unified Security Solutions</h2>
                      <p style="margin: 5px 0 0 0; color: #64748b; font-size: 12px;">Professional Security Management</p>
                    </div>
                  </div>
                  
                  <!-- Emergency Alert Banner -->
                  <div style="background: linear-gradient(135deg, #dc2626 0%, #7f1d1d 100%); padding: 40px 20px; text-align: center; animation: pulse 2s infinite;">
                    <h1 style="color: white; margin: 0; font-size: 36px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">🚨 PANIC ALERT 🚨</h1>
                    <p style="color: #fef2f2; margin: 15px 0 0 0; font-size: 20px; font-weight: bold;">IMMEDIATE EMERGENCY RESPONSE REQUIRED</p>
                    <div style="background-color: rgba(255,255,255,0.2); margin-top: 15px; padding: 10px; border-radius: 8px;">
                      <p style="color: white; font-size: 14px; margin: 0;">Emergency activated at ${new Date().toLocaleTimeString()}</p>
                    </div>
                  </div>
                  
                  <!-- Main Content -->
                  <div style="padding: 30px;">
                    <!-- Guard Details Card -->
                    <div style="background: linear-gradient(to right, #fee2e2, #fef2f2); padding: 25px; border-radius: 12px; border-left: 8px solid #dc2626; margin-bottom: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                      <h2 style="color: #7f1d1d; margin: 0 0 20px 0; font-size: 20px; border-bottom: 2px solid #dc2626; padding-bottom: 10px;">🆘 Emergency Details</h2>
                      
                      <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold; width: 100px;">👤 Guard:</td>
                          <td style="padding: 8px 0; color: #1f2937; font-size: 16px; font-weight: bold;">${user.full_name}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">🎫 Badge:</td>
                          <td style="padding: 8px 0; color: #1f2937;">${user.badge_number || 'Not assigned'}</td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">📞 Phone:</td>
                          <td style="padding: 8px 0; color: #1f2937;"><a href="tel:${user.phone_number || ''}" style="color: #dc2626; text-decoration: none;">${user.phone_number || 'Not available'}</a></td>
                        </tr>
                        <tr>
                          <td style="padding: 8px 0; color: #7f1d1d; font-weight: bold;">⏰ Time:</td>
                          <td style="padding: 8px 0; color: #1f2937;">${new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</td>
                        </tr>
                        ${notes ? `
                        <tr>
                          <td colspan="2" style="padding: 15px 0 0 0;">
                            <div style="background-color: #fef2f2; padding: 12px; border-radius: 6px; border-left: 4px solid #dc2626;">
                              <p style="margin: 0; color: #7f1d1d; font-weight: bold; font-size: 12px;">GUARD NOTES:</p>
                              <p style="margin: 5px 0 0 0; color: #1f2937;">${notes}</p>
                            </div>
                          </td>
                        </tr>
                        ` : ''}
                      </table>
                    </div>
                    
                    <!-- Location Card -->
                    <div style="background: linear-gradient(to right, #dbeafe, #eff6ff); padding: 25px; border-radius: 12px; border-left: 8px solid #dc2626; margin-bottom: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                      <h3 style="color: #7f1d1d; margin: 0 0 15px 0; font-size: 18px;">📍 Live Guard Location</h3>
                      <div style="background-color: white; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
                        <p style="margin: 5px 0; color: #374151; font-family: monospace;">
                          <strong>GPS:</strong> ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}
                        </p>
                        <p style="margin: 5px 0; color: #6b7280; font-size: 12px;">
                          Accuracy: High-precision GPS coordinates
                        </p>
                      </div>
                      
                      <!-- Large Action Button -->
                      <div style="text-align: center; margin: 20px 0;">
                        <a href="${googleMapsUrl}" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 18px; box-shadow: 0 6px 12px rgba(220, 38, 38, 0.4); transition: all 0.3s;">
                          🗺️ TRACK GUARD LOCATION NOW
                        </a>
                      </div>
                      
                      <div style="background-color: #fef2f2; padding: 10px; border-radius: 6px; text-align: center; border: 1px dashed #dc2626;">
                        <p style="margin: 0; color: #7f1d1d; font-size: 12px;">
                          ⚡ Click above for real-time Google Maps tracking
                        </p>
                      </div>
                    </div>
                    
                    <!-- Critical Action Notice -->
                    <div style="background: linear-gradient(135deg, #7f1d1d 0%, #450a0a 100%); padding: 20px; border-radius: 12px; text-align: center; margin-bottom: 25px; box-shadow: 0 6px 12px rgba(127, 29, 29, 0.3);">
                      <p style="color: white; font-weight: bold; margin: 0; font-size: 18px; text-transform: uppercase; letter-spacing: 1px;">
                        ⚠️ CRITICAL EMERGENCY
                      </p>
                      <p style="color: #fef2f2; margin: 10px 0 0 0; font-size: 14px;">
                        Dispatch immediate response • Contact guard • Verify situation
                      </p>
                    </div>
                    
                    <!-- Protocol Checklist -->
                    <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; border: 2px solid #e5e7eb;">
                      <h4 style="color: #374151; margin: 0 0 15px 0; font-size: 14px; text-transform: uppercase;">Emergency Response Protocol:</h4>
                      <ul style="margin: 0; padding-left: 20px; color: #4b5563; font-size: 14px; line-height: 24px;">
                        <li>✓ Contact guard immediately via phone</li>
                        <li>✓ Dispatch nearest available backup</li>
                        <li>✓ Monitor live GPS location</li>
                        <li>✓ Alert local emergency services if needed</li>
                        <li>✓ Document all actions taken</li>
                      </ul>
                    </div>
                  </div>
                  
                  <!-- Footer -->
                  <div style="background-color: #1e40af; padding: 20px; text-align: center;">
                    <p style="color: white; margin: 0; font-size: 14px; font-weight: bold;">Unified Security Solutions</p>
                    <p style="color: #93c5fd; margin: 5px 0; font-size: 12px;">Professional Security Management • 24/7 Emergency Response</p>
                    <p style="color: #bfdbfe; margin: 5px 0; font-size: 11px;">This is an automated emergency alert from SecureGuard System</p>
                  </div>
                </div>
              </body>
              </html>
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