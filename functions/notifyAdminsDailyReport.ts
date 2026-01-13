import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { guardId, guardName, reportData, reportType, period } = await req.json();

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
        type: 'shift_reminder',
        title: `📊 Daily Activity Report Submitted`,
        message: `${guardName} has submitted their ${period} activity report. Review available now.`,
        priority: 'medium',
        relatedEntity: 'report',
        relatedId: reportData?.id || `report_${guardId}_${Date.now()}`,
        metadata: {
          guard: guardName,
          report_type: reportType,
          period: period,
          submitted_at: new Date().toLocaleString(),
          summary: reportData?.summary || 'Daily shift report submitted'
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
    console.error('Error in notifyAdminsDailyReport:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});