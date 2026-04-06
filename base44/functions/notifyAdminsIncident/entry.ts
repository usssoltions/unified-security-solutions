import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { incidentId, guardName, incidentType, siteName, incidentTime, location } = await req.json();

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
        type: 'incident_reported',
        title: `🚨 New Incident - ${incidentType}`,
        message: `${guardName} reported: ${incidentType} at ${siteName}. Immediate attention required!`,
        priority: 'critical',
        relatedEntity: 'incident',
        relatedId: incidentId,
        metadata: {
          guard: guardName,
          type: incidentType,
          site: siteName,
          time: new Date(incidentTime).toLocaleString(),
          ...(location && { location: location }),
          ...(location && location.lat && { lat: location.lat }),
          ...(location && location.lng && { lng: location.lng })
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
    console.error('Error in notifyAdminsIncident:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});