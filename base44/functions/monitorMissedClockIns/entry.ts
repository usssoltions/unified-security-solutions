import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    // Only fetch shifts scheduled to start in the past 15min–2hr window (not all time)
    const scheduledShifts = await base44.asServiceRole.entities.Shift.filter({ status: 'scheduled' });

    const missedShifts = scheduledShifts.filter(shift => {
      if (!shift.guard_id) return false;
      const startTime = new Date(shift.start_time);
      // Started more than 15 min ago but less than 2 hours ago — still relevant
      return startTime <= fifteenMinutesAgo && startTime >= twoHoursAgo && !shift.clock_in?.timestamp;
    });

    // Exit early — no integration calls if nothing to do
    if (missedShifts.length === 0) {
      return Response.json({ success: true, missedShifts: 0, alertsCreated: 0 });
    }

    // Fetch admins once for all missed shifts
    const allUsers = await base44.asServiceRole.entities.User.list();
    const admins = allUsers.filter(u => u.role_type === 'admin' || u.role_type === 'dispatcher');

    const alertsCreated = [];

    for (const shift of missedShifts) {
      // Check if alert already exists — prevents duplicate emails on repeat runs
      const existingAlerts = await base44.asServiceRole.entities.Alert.filter({
        type: 'missed_checkin',
        shift_id: shift.id,
        status: 'active'
      });
      if (existingAlerts.length > 0) continue;

      // Create alert record
      const alert = await base44.asServiceRole.entities.Alert.create({
        type: 'missed_checkin',
        priority: 'critical',
        title: '⚠️ Missed Clock-In',
        message: `${shift.guard_name || 'Guard'} missed clock-in at ${shift.site_name}. Scheduled: ${new Date(shift.start_time).toLocaleString('en-ZA')}`,
        guard_id: shift.guard_id,
        guard_name: shift.guard_name,
        site_id: shift.site_id,
        shift_id: shift.id,
        status: 'active'
      });

      // Email admins in parallel — only once per missed shift (deduped above)
      await Promise.all(admins.filter(a => a.email).map(admin =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'SecureGuard Alerts',
          to: admin.email,
          subject: '🚨 Missed Clock-In Alert',
          body: `Guard: ${shift.guard_name || 'Unknown'}\nSite: ${shift.site_name}\nScheduled Start: ${new Date(shift.start_time).toLocaleString('en-ZA')}\n\nNo clock-in detected after 15 minutes. Please investigate.`
        }).catch(err => console.error('Email failed:', err.message))
      ));

      alertsCreated.push(alert.id);
    }

    return Response.json({ success: true, missedShifts: missedShifts.length, alertsCreated: alertsCreated.length });
  } catch (error) {
    console.error('monitorMissedClockIns error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});