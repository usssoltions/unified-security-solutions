import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Clear all active alerts
    const activeAlerts = await base44.asServiceRole.entities.Alert.filter({
      status: "active"
    });

    for (const alert of activeAlerts) {
      await base44.asServiceRole.entities.Alert.update(alert.id, {
        status: "resolved"
      });
    }

    // Clear all unread notifications
    const unreadNotifications = await base44.asServiceRole.entities.Notification.filter({
      read: false
    });

    for (const notification of unreadNotifications) {
      await base44.asServiceRole.entities.Notification.update(notification.id, {
        read: true,
        read_at: new Date().toISOString()
      });
    }

    // Update old scheduled shifts to prevent false alerts
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    const oldScheduledShifts = await base44.asServiceRole.entities.Shift.list();
    const shiftsToUpdate = oldScheduledShifts.filter(shift => {
      const startTime = new Date(shift.start_time);
      return shift.status === "scheduled" && startTime < yesterday;
    });

    for (const shift of shiftsToUpdate) {
      await base44.asServiceRole.entities.Shift.update(shift.id, {
        status: "missed"
      });
    }

    return Response.json({
      success: true,
      alertsCleared: activeAlerts.length,
      notificationsCleared: unreadNotifications.length,
      shiftsUpdated: shiftsToUpdate.length
    });

  } catch (error) {
    console.error("Error clearing alerts:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});