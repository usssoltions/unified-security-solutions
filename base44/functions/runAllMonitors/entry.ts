import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Load toggle settings — exit immediately if ALL are disabled
    const settingsRecs = await base44.asServiceRole.entities.AutomationSetting.list();
    const settings = settingsRecs?.[0] || {};
    const anyEnabled = settings.monitor_overdue_patrols || settings.monitor_missed_clockins ||
      settings.monitor_low_battery || settings.generate_scheduled_patrols || settings.send_shift_reminders;
    if (!anyEnabled) {
      return Response.json({ success: true, skipped: true, reason: 'All monitors disabled' });
    }

    const now = new Date();
    const results = {};

    // ── 1. Overdue Patrol Monitor ──
    if (settings.monitor_overdue_patrols) {
      try {
        const activePatrols = await base44.asServiceRole.entities.PatrolPlan.filter({ status: 'active' });
        const startedPatrols = activePatrols.filter(p => p.started_at);
        if (startedPatrols.length > 0) {
          const [allUsers, existingOverdueAlerts] = await Promise.all([
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.Alert.filter({ type: 'patrol_overdue', status: 'active' })
          ]);
          const supervisors = allUsers.filter(u => u.role_type === 'dispatcher' || u.role_type === 'admin');
          const alertedPatrolIds = new Set(existingOverdueAlerts.map(a => a.metadata?.patrol_id).filter(Boolean));
          const OVERDUE_THRESHOLD_MINUTES = 30;
          let overdueAlerts = 0;
          for (const patrol of startedPatrols) {
            const startTime = new Date(patrol.started_at);
            const estimatedDuration = patrol.estimated_duration_minutes || 60;
            const overdueTime = new Date(startTime.getTime() + (estimatedDuration + OVERDUE_THRESHOLD_MINUTES) * 60000);
            if (now <= overdueTime) continue;
            const total = patrol.route_checkpoints?.length || 0;
            const completed = patrol.route_checkpoints?.filter(cp => cp.completed).length || 0;
            if (completed >= total) continue;
            if (alertedPatrolIds.has(patrol.id)) continue;
            await base44.asServiceRole.entities.Alert.create({
              type: 'patrol_overdue', priority: 'critical',
              title: '⏰ Overdue Patrol Route',
              message: `${patrol.assigned_to_name} patrol at ${patrol.site_name} is overdue. ${completed}/${total} checkpoints completed.`,
              guard_id: patrol.assigned_to, guard_name: patrol.assigned_to_name,
              site_id: patrol.site_id, status: 'active',
              metadata: { patrol_id: patrol.id, checkpoints_completed: completed, total_checkpoints: total }
            });
            await Promise.all(supervisors.filter(s => s.email).map(sup =>
              base44.asServiceRole.integrations.Core.SendEmail({
                from_name: 'SecureGuard Alerts', to: sup.email,
                subject: '🚨 Overdue Patrol Alert',
                body: `Patrol: ${patrol.name}\nGuard: ${patrol.assigned_to_name}\nSite: ${patrol.site_name}\nProgress: ${completed}/${total} checkpoints`
              }).catch(err => console.error('Email failed:', err.message))
            ));
            overdueAlerts++;
          }
          results.overdue_patrols = { checked: startedPatrols.length, alerts: overdueAlerts };
        }
      } catch (e) { results.overdue_patrols = { error: e.message }; }
    }

    // ── 2. Missed Clock-In Monitor ──
    if (settings.monitor_missed_clockins) {
      try {
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60000);
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60000);
        const scheduledShifts = await base44.asServiceRole.entities.Shift.filter({ status: 'scheduled' });
        const missedShifts = scheduledShifts.filter(s => {
          if (!s.guard_id) return false;
          const st = new Date(s.start_time);
          return st <= fifteenMinutesAgo && st >= twoHoursAgo && !s.clock_in?.timestamp;
        });
        if (missedShifts.length > 0) {
          const [allUsers, existingMissedAlerts] = await Promise.all([
            base44.asServiceRole.entities.User.list(),
            base44.asServiceRole.entities.Alert.filter({ type: 'missed_checkin', status: 'active' })
          ]);
          const admins = allUsers.filter(u => u.role_type === 'admin' || u.role_type === 'dispatcher');
          const alertedShiftIds = new Set(existingMissedAlerts.map(a => a.shift_id).filter(Boolean));
          let clockinAlerts = 0;
          for (const shift of missedShifts) {
            if (alertedShiftIds.has(shift.id)) continue;
            await base44.asServiceRole.entities.Alert.create({
              type: 'missed_checkin', priority: 'critical',
              title: '⚠️ Missed Clock-In',
              message: `${shift.guard_name || 'Guard'} missed clock-in at ${shift.site_name}.`,
              guard_id: shift.guard_id, guard_name: shift.guard_name,
              site_id: shift.site_id, shift_id: shift.id, status: 'active'
            });
            await Promise.all(admins.filter(a => a.email).map(admin =>
              base44.asServiceRole.integrations.Core.SendEmail({
                from_name: 'SecureGuard Alerts', to: admin.email,
                subject: '🚨 Missed Clock-In Alert',
                body: `Guard: ${shift.guard_name || 'Unknown'}\nSite: ${shift.site_name}\nScheduled Start: ${new Date(shift.start_time).toLocaleString('en-ZA')}`
              }).catch(err => console.error('Email failed:', err.message))
            ));
            clockinAlerts++;
          }
          results.missed_clockins = { checked: missedShifts.length, alerts: clockinAlerts };
        }
      } catch (e) { results.missed_clockins = { error: e.message }; }
    }

    // ── 3. Low Battery Monitor ──
    if (settings.monitor_low_battery) {
      try {
        const activeShifts = await base44.asServiceRole.entities.Shift.filter({ status: 'active' });
        if (activeShifts.length > 0) {
          const activeGuardIds = new Set(activeShifts.map(s => s.guard_id).filter(Boolean));
          const locationData = await base44.asServiceRole.entities.LocationTracking.list('-timestamp', 50);
          const latestByGuard = {};
          for (const loc of locationData) {
            if (!activeGuardIds.has(loc.guard_id)) continue;
            if (!latestByGuard[loc.guard_id] || new Date(loc.timestamp) > new Date(latestByGuard[loc.guard_id].timestamp)) {
              latestByGuard[loc.guard_id] = loc;
            }
          }
          const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
          const LOW_BATTERY_THRESHOLD = 15;
          let batteryAlerts = 0;
          for (const [guardId, location] of Object.entries(latestByGuard)) {
            const isRecent = new Date(location.timestamp) >= fiveMinutesAgo;
            if (!isRecent || !location.battery_level || location.battery_level > LOW_BATTERY_THRESHOLD) continue;
            const existingAlerts = await base44.asServiceRole.entities.Alert.filter({
              type: 'low_battery', guard_id: guardId, status: 'active'
            });
            if (existingAlerts.length > 0) continue;
            await base44.asServiceRole.entities.Alert.create({
              type: 'low_battery', priority: 'high',
              title: '🔋 Low Battery Alert',
              message: `${location.guard_name || 'Guard'} device battery at ${location.battery_level}%.`,
              guard_id: guardId, guard_name: location.guard_name, status: 'active',
              metadata: { battery_level: location.battery_level }
            });
            await base44.asServiceRole.entities.Notification.create({
              recipient_id: guardId, type: 'system', priority: 'high',
              title: 'Low Battery Warning',
              message: `Your device battery is at ${location.battery_level}%. Please charge immediately.`,
              read: false, sent_via: ['in_app']
            });
            batteryAlerts++;
          }
          results.low_battery = { checked: Object.keys(latestByGuard).length, alerts: batteryAlerts };
        }
      } catch (e) { results.low_battery = { error: e.message }; }
    }

    // ── 4. Scheduled Patrol Generation is owned by the dedicated
    //    generateScheduledPatrols automation (runs every 30 min, gated on
    //    active shifts + patrol_config.enabled). Removed here to avoid
    //    duplicate site/shift/patrol fetches and keep this monitor lean.

    // ── 5. Shift Reminders (once per shift) ──
    if (settings.send_shift_reminders) {
      try {
        const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60000);
        const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60000);
        const shifts = await base44.asServiceRole.entities.Shift.filter({ status: 'scheduled' });
        const acceptedShifts = await base44.asServiceRole.entities.Shift.filter({ status: 'accepted' });
        const upcomingShifts = [...shifts, ...acceptedShifts].filter(s => {
          if (!s.guard_id || s.reminder_sent) return false;
          const st = new Date(s.start_time);
          return st >= twoHoursFromNow && st <= threeHoursFromNow;
        });
        if (upcomingShifts.length > 0) {
          const guardIds = [...new Set(upcomingShifts.map(s => s.guard_id))];
          const allUsers = await base44.asServiceRole.entities.User.list();
          const guardMap = Object.fromEntries(allUsers.filter(u => guardIds.includes(u.id)).map(u => [u.id, u]));
          let remindersSent = 0;
          for (const shift of upcomingShifts) {
            const guard = guardMap[shift.guard_id];
            if (!guard?.email) continue;
            await base44.asServiceRole.integrations.Core.SendEmail({
              from_name: 'SecureGuard', to: guard.email,
              subject: `⏰ Shift Reminder — ${shift.site_name}`,
              body: `Hi ${shift.guard_name || guard.full_name},\n\nYour shift starts in approximately 2 hours.\n\nSite: ${shift.site_name}\nStart: ${new Date(shift.start_time).toLocaleString('en-ZA')}\nEnd: ${new Date(shift.end_time).toLocaleString('en-ZA')}\n\nPlease ensure you arrive on time and clock in via the SecureGuard app.`
            }).catch(err => console.error(`Reminder failed:`, err.message));
            await base44.asServiceRole.entities.Shift.update(shift.id, { reminder_sent: true }).catch(() => {});
            remindersSent++;
          }
          results.shift_reminders = { sent: remindersSent };
        }
      } catch (e) { results.shift_reminders = { error: e.message }; }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    console.error('runAllMonitors error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});