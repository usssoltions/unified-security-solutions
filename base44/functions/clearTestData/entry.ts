import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Only admins can clear test data
    if (!user || user.role_type !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const results = {};

    // Clear Incidents
    try {
      const incidents = await base44.asServiceRole.entities.Incident.list();
      for (const incident of incidents) {
        await base44.asServiceRole.entities.Incident.delete(incident.id);
      }
      results.incidents = `Deleted ${incidents.length} incidents`;
    } catch (error) {
      results.incidents = `Error: ${error.message}`;
    }

    // Clear Maintenance Requests
    try {
      const maintenance = await base44.asServiceRole.entities.MaintenanceRequest.list();
      for (const req of maintenance) {
        await base44.asServiceRole.entities.MaintenanceRequest.delete(req.id);
      }
      results.maintenance = `Deleted ${maintenance.length} maintenance requests`;
    } catch (error) {
      results.maintenance = `Error: ${error.message}`;
    }

    // Clear Alarm Responses
    try {
      const alarms = await base44.asServiceRole.entities.AlarmResponse.list();
      for (const alarm of alarms) {
        await base44.asServiceRole.entities.AlarmResponse.delete(alarm.id);
      }
      results.alarms = `Deleted ${alarms.length} alarm responses`;
    } catch (error) {
      results.alarms = `Error: ${error.message}`;
    }

    // Clear Shifts (except active ones)
    try {
      const shifts = await base44.asServiceRole.entities.Shift.filter({
        status: { $ne: 'active' }
      });
      for (const shift of shifts) {
        await base44.asServiceRole.entities.Shift.delete(shift.id);
      }
      results.shifts = `Deleted ${shifts.length} shifts (kept active ones)`;
    } catch (error) {
      results.shifts = `Error: ${error.message}`;
    }

    // Clear Alerts
    try {
      const alerts = await base44.asServiceRole.entities.Alert.list();
      for (const alert of alerts) {
        await base44.asServiceRole.entities.Alert.delete(alert.id);
      }
      results.alerts = `Deleted ${alerts.length} alerts`;
    } catch (error) {
      results.alerts = `Error: ${error.message}`;
    }

    // Clear Notifications
    try {
      const notifications = await base44.asServiceRole.entities.Notification.list();
      for (const notification of notifications) {
        await base44.asServiceRole.entities.Notification.delete(notification.id);
      }
      results.notifications = `Deleted ${notifications.length} notifications`;
    } catch (error) {
      results.notifications = `Error: ${error.message}`;
    }

    // Clear PTT Messages
    try {
      const pttMessages = await base44.asServiceRole.entities.PTTMessage.list();
      for (const msg of pttMessages) {
        await base44.asServiceRole.entities.PTTMessage.delete(msg.id);
      }
      results.pttMessages = `Deleted ${pttMessages.length} PTT messages`;
    } catch (error) {
      results.pttMessages = `Error: ${error.message}`;
    }

    // Clear Call History
    try {
      const callHistory = await base44.asServiceRole.entities.CallHistory.list();
      for (const call of callHistory) {
        await base44.asServiceRole.entities.CallHistory.delete(call.id);
      }
      results.callHistory = `Deleted ${callHistory.length} call records`;
    } catch (error) {
      results.callHistory = `Error: ${error.message}`;
    }

    return Response.json({
      success: true,
      message: 'Test data cleared successfully',
      details: results,
      clearedBy: user.full_name,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});