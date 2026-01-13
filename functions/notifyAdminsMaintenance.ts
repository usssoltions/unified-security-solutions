import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { maintenanceId, guardName, maintenanceType, siteName, details, location } = await req.json();

    // Get all admin users
    const allUsers = await base44.asServiceRole.entities.User.filter({});
    const admins = allUsers.filter(u => 
      u.role_type === 'admin' || 
      u.role_type === 'dispatcher' || 
      u.role_type === 'supervisor'
    );

    if (admins.length === 0) {
      return Response.json({ success: false, message: 'No admins found' });
    }

    // Send notifications to all admins
    const notificationPromises = admins.map(admin => 
      base44.asServiceRole.functions.invoke('sendComprehensiveNotification', {
        recipientIds: [admin.id],
        type: 'maintenance_reported',
        title: `🔧 Maintenance Request - ${maintenanceType}`,
        message: `${guardName} submitted: ${maintenanceType} at ${siteName}. Review required.`,
        priority: 'high',
        relatedEntity: 'maintenance',
        relatedId: maintenanceId,
        metadata: {
          guard: guardName,
          type: maintenanceType,
          site: siteName,
          details: details,
          location: location
        },
        sendEmail: true
      })
    );

    await Promise.all(notificationPromises);

    return Response.json({ 
      success: true, 
      notificationsSent: admins.length 
    });
  } catch (error) {
    console.error('Error in notifyAdminsMaintenance:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});