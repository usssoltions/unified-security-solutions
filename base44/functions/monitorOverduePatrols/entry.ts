import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const now = new Date();

    // Get active patrol plans
    const patrols = await base44.asServiceRole.entities.PatrolPlan.filter({
      status: "active"
    });

    const alertsCreated = [];
    const OVERDUE_THRESHOLD_MINUTES = 30;

    for (const patrol of patrols) {
      if (!patrol.started_at) continue;

      const startTime = new Date(patrol.started_at);
      const estimatedDuration = patrol.estimated_duration_minutes || 60;
      const expectedEndTime = new Date(startTime.getTime() + estimatedDuration * 60 * 1000);
      const overdueTime = new Date(expectedEndTime.getTime() + OVERDUE_THRESHOLD_MINUTES * 60 * 1000);

      // Check if patrol is overdue
      if (now > overdueTime) {
        // Check incomplete checkpoints
        const totalCheckpoints = patrol.route_checkpoints?.length || 0;
        const completedCheckpoints = patrol.route_checkpoints?.filter(cp => cp.completed).length || 0;

        if (completedCheckpoints < totalCheckpoints) {
          // Check if alert already exists
          const existingAlerts = await base44.asServiceRole.entities.Alert.filter({
            type: "patrol_overdue",
            metadata: { patrol_id: patrol.id },
            status: "active"
          });

          if (existingAlerts.length === 0) {
            const alert = await base44.asServiceRole.entities.Alert.create({
              type: "system",
              priority: "critical",
              title: "⏰ Overdue Patrol Route",
              message: `${patrol.assigned_to_name} patrol at ${patrol.site_name} is overdue. ${completedCheckpoints}/${totalCheckpoints} checkpoints completed.`,
              guard_id: patrol.assigned_to,
              guard_name: patrol.assigned_to_name,
              site_id: patrol.site_id,
              status: "active",
              metadata: {
                patrol_id: patrol.id,
                checkpoints_completed: completedCheckpoints,
                total_checkpoints: totalCheckpoints,
                expected_end: expectedEndTime.toISOString()
              }
            });

            // Send email to supervisors
            const supervisors = await base44.asServiceRole.entities.User.filter({ 
              role_type: "dispatcher" 
            });

            for (const supervisor of supervisors) {
              try {
                await base44.asServiceRole.integrations.Core.SendEmail({
                  to: supervisor.email,
                  subject: "🚨 Critical: Overdue Patrol Alert",
                  body: `
Patrol: ${patrol.name}
Guard: ${patrol.assigned_to_name}
Site: ${patrol.site_name}
Started: ${startTime.toLocaleString()}
Expected End: ${expectedEndTime.toLocaleString()}
Progress: ${completedCheckpoints}/${totalCheckpoints} checkpoints completed

The patrol is now ${Math.floor((now - overdueTime) / 60000)} minutes overdue. Please investigate.
                  `
                });
              } catch (emailError) {
                console.error("Failed to send email:", emailError);
              }
            }

            alertsCreated.push(alert);
          }
        }
      }
    }

    return Response.json({
      success: true,
      patrolsChecked: patrols.length,
      alertsCreated: alertsCreated.length,
      alerts: alertsCreated
    });

  } catch (error) {
    console.error("Error monitoring patrols:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});