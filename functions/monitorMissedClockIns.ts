import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);

    // Get shifts that should have started but haven't been clocked in
    const shifts = await base44.asServiceRole.entities.Shift.filter({
      status: "scheduled"
    });

    const missedShifts = shifts.filter(shift => {
      const startTime = new Date(shift.start_time);
      return startTime <= fifteenMinutesAgo && startTime <= now && !shift.clock_in;
    });

    const alertsCreated = [];

    for (const shift of missedShifts) {
      // Check if alert already exists
      const existingAlerts = await base44.asServiceRole.entities.Alert.filter({
        type: "missed_checkin",
        shift_id: shift.id,
        status: "active"
      });

      if (existingAlerts.length === 0) {
        // Create critical alert
        const alert = await base44.asServiceRole.entities.Alert.create({
          type: "missed_checkin",
          priority: "critical",
          title: "⚠️ Missed Clock-In",
          message: `${shift.guard_name || 'Guard'} missed clock-in at ${shift.site_name}. Scheduled: ${new Date(shift.start_time).toLocaleString()}`,
          guard_id: shift.guard_id,
          guard_name: shift.guard_name,
          site_id: shift.site_id,
          shift_id: shift.id,
          status: "active"
        });

        // Send email notification to admins
        const admins = await base44.asServiceRole.entities.User.filter({ role: "admin" });
        
        for (const admin of admins) {
          try {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: admin.email,
              subject: "🚨 Critical: Missed Clock-In Alert",
              body: `
Guard: ${shift.guard_name || 'Unknown'}
Site: ${shift.site_name}
Scheduled Start: ${new Date(shift.start_time).toLocaleString()}
Status: No clock-in detected after 15 minutes

Please investigate immediately.
              `
            });
          } catch (emailError) {
            console.error("Failed to send email:", emailError);
          }
        }

        alertsCreated.push(alert);
      }
    }

    return Response.json({
      success: true,
      missedShifts: missedShifts.length,
      alertsCreated: alertsCreated.length,
      alerts: alertsCreated
    });

  } catch (error) {
    console.error("Error monitoring clock-ins:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});