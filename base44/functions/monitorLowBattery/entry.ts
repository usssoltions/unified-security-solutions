import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // NOTE: This is a scheduled function — no user auth needed, use service role only

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Check if any guards are currently on active shifts — exit immediately if not
    const activeShifts = await base44.asServiceRole.entities.Shift.filter({ status: 'active' });
    if (activeShifts.length === 0) {
      return Response.json({ success: true, guardsChecked: 0, alertsCreated: 0, reason: 'No active shifts' });
    }

    const activeGuardIds = new Set(activeShifts.map(s => s.guard_id).filter(Boolean));

    // Get recent location data — only last 50 records
    const locationData = await base44.asServiceRole.entities.LocationTracking.list('-timestamp', 50);

    // Group by guard, keep latest per guard, only for active guards
    const latestByGuard = {};
    for (const loc of locationData) {
      if (!activeGuardIds.has(loc.guard_id)) continue;
      if (!latestByGuard[loc.guard_id] || new Date(loc.timestamp) > new Date(latestByGuard[loc.guard_id].timestamp)) {
        latestByGuard[loc.guard_id] = loc;
      }
    }

    const LOW_BATTERY_THRESHOLD = 15;
    const alertsCreated = [];

    for (const [guardId, location] of Object.entries(latestByGuard)) {
      const isRecent = new Date(location.timestamp) >= fiveMinutesAgo;
      if (!isRecent || !location.battery_level || location.battery_level > LOW_BATTERY_THRESHOLD) continue;

      // Deduplicate — skip if active alert already exists
      const existingAlerts = await base44.asServiceRole.entities.Alert.filter({
        type: 'low_battery',
        guard_id: guardId,
        status: 'active'
      });
      if (existingAlerts.length > 0) continue;

      // Create alert + in-app notification (no push/email credit used)
      const alert = await base44.asServiceRole.entities.Alert.create({
        type: 'low_battery',
        priority: 'high',
        title: '🔋 Low Battery Alert',
        message: `${location.guard_name || 'Guard'} device battery at ${location.battery_level}%. Immediate charging required.`,
        guard_id: guardId,
        guard_name: location.guard_name,
        status: 'active',
        metadata: { battery_level: location.battery_level, location: location.location }
      });

      await base44.asServiceRole.entities.Notification.create({
        recipient_id: guardId,
        type: 'system',
        priority: 'high',
        title: 'Low Battery Warning',
        message: `Your device battery is at ${location.battery_level}%. Please charge immediately.`,
        read: false,
        sent_via: ['in_app']
      });

      alertsCreated.push(alert.id);
    }

    return Response.json({ success: true, guardsChecked: Object.keys(latestByGuard).length, alertsCreated: alertsCreated.length });
  } catch (error) {
    console.error('Error monitoring battery:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});