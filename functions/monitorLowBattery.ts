import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Get recent location tracking data
    const locationData = await base44.asServiceRole.entities.LocationTracking.list("-timestamp", 200);

    // Group by guard and get latest for each
    const latestByGuard = {};
    for (const loc of locationData) {
      if (!latestByGuard[loc.guard_id] || new Date(loc.timestamp) > new Date(latestByGuard[loc.guard_id].timestamp)) {
        latestByGuard[loc.guard_id] = loc;
      }
    }

    const alertsCreated = [];
    const LOW_BATTERY_THRESHOLD = 15; // 15%

    for (const [guardId, location] of Object.entries(latestByGuard)) {
      // Check if recent (within 5 minutes) and low battery
      const locationTime = new Date(location.timestamp);
      const isRecent = locationTime >= fiveMinutesAgo;
      
      if (isRecent && location.battery_level && location.battery_level <= LOW_BATTERY_THRESHOLD) {
        // Check if alert already exists
        const existingAlerts = await base44.asServiceRole.entities.Alert.filter({
          type: "low_battery",
          guard_id: guardId,
          status: "active"
        });

        if (existingAlerts.length === 0) {
          const alert = await base44.asServiceRole.entities.Alert.create({
            type: "low_battery",
            priority: "high",
            title: "🔋 Low Battery Alert",
            message: `${location.guard_name || 'Guard'} device battery at ${location.battery_level}%. Immediate charging required.`,
            guard_id: guardId,
            guard_name: location.guard_name,
            status: "active",
            metadata: {
              battery_level: location.battery_level,
              location: location.location
            }
          });

          // Send notification to guard
          await base44.asServiceRole.entities.Notification.create({
            recipient_id: guardId,
            type: "system",
            priority: "high",
            title: "Low Battery Warning",
            message: `Your device battery is at ${location.battery_level}%. Please charge immediately to avoid losing connectivity.`,
            sent_via: ["in_app"]
          });

          alertsCreated.push(alert);
        }
      }
    }

    return Response.json({
      success: true,
      guardsChecked: Object.keys(latestByGuard).length,
      alertsCreated: alertsCreated.length,
      alerts: alertsCreated
    });

  } catch (error) {
    console.error("Error monitoring battery:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});