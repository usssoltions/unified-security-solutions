import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function runs as a scheduled task, so we need service role access
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Fetch incidents created in the last 5 minutes that haven't been notified
    const allIncidents = await base44.asServiceRole.entities.Incident.list('-created_date', 100);
    
    const recentIncidents = allIncidents.filter(incident => {
      const createdDate = new Date(incident.created_date);
      const notificationSent = incident.notification_sent === true;
      return createdDate >= fiveMinutesAgo && !notificationSent;
    });

    console.log(`Found ${recentIncidents.length} new incidents to notify`);

    if (recentIncidents.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No new incidents to notify',
        count: 0
      });
    }

    // Get all admin users
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const adminUsers = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'dispatcher' || 
      u.role_type === 'supervisor'
    );

    console.log(`Notifying ${adminUsers.length} admin users`);

    let totalNotificationsSent = 0;

    // Process each incident
    for (const incident of recentIncidents) {
      try {
        // Send notifications to all admins
        for (const admin of adminUsers) {
          try {
            // Create in-app notification
            await base44.asServiceRole.entities.Notification.create({
              recipient_id: admin.id,
              recipient_name: admin.full_name,
              type: 'incident_reported',
              priority: incident.priority === 'critical' ? 'critical' : 'high',
              title: `🚨 New Incident - ${incident.category}`,
              message: `${incident.guard_name} reported: ${incident.title} at ${incident.site_name}. Priority: ${incident.priority}`,
              read: false,
              related_entity: 'incident',
              related_id: incident.id,
              sent_via: ['in_app', 'email']
            });

            // Send email
            if (admin.email) {
              await base44.asServiceRole.integrations.Core.SendEmail({
                to: admin.email,
                subject: `🚨 New Incident Alert - ${incident.category}`,
                body: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                      <h1 style="color: white; margin: 0; font-size: 24px;">🚨 New Incident Reported</h1>
                    </div>
                    <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 10px 10px;">
                      <div style="background: white; padding: 25px; border-radius: 8px; border-left: 4px solid ${incident.priority === 'critical' ? '#dc2626' : '#ea580c'};">
                        <h2 style="color: #1e293b; margin-top: 0; font-size: 20px;">${incident.title}</h2>
                        <div style="background: #fee2e2; padding: 15px; border-radius: 6px; margin: 15px 0;">
                          <p style="margin: 5px 0;"><strong>Category:</strong> ${incident.category}</p>
                          <p style="margin: 5px 0;"><strong>Priority:</strong> <span style="color: ${incident.priority === 'critical' ? '#dc2626' : '#ea580c'}; font-weight: bold;">${incident.priority.toUpperCase()}</span></p>
                          <p style="margin: 5px 0;"><strong>Guard:</strong> ${incident.guard_name}</p>
                          <p style="margin: 5px 0;"><strong>Site:</strong> ${incident.site_name}</p>
                          <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date(incident.created_date).toLocaleString()}</p>
                        </div>
                        ${incident.description ? `<p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 15px 0;"><strong>Description:</strong><br>${incident.description}</p>` : ''}
                        ${incident.location ? `<p style="color: #64748b; font-size: 14px; margin-top: 15px;">📍 Location: ${incident.location.lat}, ${incident.location.lng}</p>` : ''}
                      </div>
                      <div style="background: #fef2f2; border: 2px solid #fca5a5; padding: 15px; border-radius: 8px; text-align: center; margin-top: 20px;">
                        <p style="color: #dc2626; font-weight: bold; margin: 0; font-size: 14px;">⚠️ IMMEDIATE ATTENTION REQUIRED</p>
                      </div>
                      <div style="text-align: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                        <p style="color: #94a3b8; font-size: 12px; margin: 0;">SecureGuard Security Management System</p>
                        <p style="color: #cbd5e1; font-size: 11px; margin: 5px 0 0 0;">This is an automated real-time notification</p>
                      </div>
                    </div>
                  </div>
                `
              });

              totalNotificationsSent++;
            }
          } catch (adminError) {
            console.error(`Failed to notify admin ${admin.id}:`, adminError);
          }
        }

        // Mark incident as notified
        await base44.asServiceRole.entities.Incident.update(incident.id, {
          notification_sent: true
        });

        console.log(`Processed incident ${incident.id}`);

      } catch (incidentError) {
        console.error(`Failed to process incident ${incident.id}:`, incidentError);
      }
    }

    return Response.json({ 
      success: true,
      incidentsProcessed: recentIncidents.length,
      notificationsSent: totalNotificationsSent,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Function error:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});