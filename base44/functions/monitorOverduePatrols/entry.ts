import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();

    // Only check patrols that are currently ACTIVE (status=active) — not all patrols
    const activePatrols = await base44.asServiceRole.entities.PatrolPlan.filter({ status: 'active' });

    // Exit early — zero integration calls if no active patrols
    if (activePatrols.length === 0) {
      return Response.json({ success: true, patrolsChecked: 0, alertsCreated: 0 });
    }

    // Only process patrols that have actually started
    const startedPatrols = activePatrols.filter(p => p.started_at);
    if (startedPatrols.length === 0) {
      return Response.json({ success: true, patrolsChecked: 0, alertsCreated: 0 });
    }

    const OVERDUE_THRESHOLD_MINUTES = 30;
    const alertsCreated = [];

    // Fetch supervisors + existing overdue alerts in parallel (no N+1)
    const [allUsers, existingOverdueAlerts] = await Promise.all([
      base44.asServiceRole.entities.User.list(),
      base44.asServiceRole.entities.Alert.filter({ type: 'patrol_overdue', status: 'active' })
    ]);
    const supervisors = allUsers.filter(u => u.role_type === 'dispatcher' || u.role_type === 'admin');
    const alertedPatrolIds = new Set(existingOverdueAlerts.map(a => a.metadata?.patrol_id).filter(Boolean));

    for (const patrol of startedPatrols) {
      const startTime = new Date(patrol.started_at);
      const estimatedDuration = patrol.estimated_duration_minutes || 60;
      const expectedEndTime = new Date(startTime.getTime() + estimatedDuration * 60 * 1000);
      const overdueTime = new Date(expectedEndTime.getTime() + OVERDUE_THRESHOLD_MINUTES * 60 * 1000);

      if (now <= overdueTime) continue;

      const totalCheckpoints = patrol.route_checkpoints?.length || 0;
      const completedCheckpoints = patrol.route_checkpoints?.filter(cp => cp.completed).length || 0;

      if (completedCheckpoints >= totalCheckpoints) continue;

      // Skip if already alerted — no per-patrol query needed
      if (alertedPatrolIds.has(patrol.id)) continue;

      await base44.asServiceRole.entities.Alert.create({
        type: 'patrol_overdue',
        priority: 'critical',
        title: '⏰ Overdue Patrol Route',
        message: `${patrol.assigned_to_name} patrol at ${patrol.site_name} is overdue. ${completedCheckpoints}/${totalCheckpoints} checkpoints completed.`,
        guard_id: patrol.assigned_to,
        guard_name: patrol.assigned_to_name,
        site_id: patrol.site_id,
        status: 'active',
        metadata: { patrol_id: patrol.id, checkpoints_completed: completedCheckpoints, total_checkpoints: totalCheckpoints }
      });

      // Email supervisors in parallel
      await Promise.all(supervisors.filter(s => s.email).map(sup =>
        base44.asServiceRole.integrations.Core.SendEmail({
          from_name: 'SecureGuard Alerts',
          to: sup.email,
          subject: '🚨 Overdue Patrol Alert',
          body: `Patrol: ${patrol.name}\nGuard: ${patrol.assigned_to_name}\nSite: ${patrol.site_name}\nProgress: ${completedCheckpoints}/${totalCheckpoints} checkpoints\n\nPatrol is ${Math.floor((now - overdueTime) / 60000)} minutes overdue.`
        }).catch(err => console.error('Email failed:', err.message))
      ));

      alertsCreated.push(patrol.id);
    }

    return Response.json({ success: true, patrolsChecked: startedPatrols.length, alertsCreated: alertsCreated.length });
  } catch (error) {
    console.error('monitorOverduePatrols error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});