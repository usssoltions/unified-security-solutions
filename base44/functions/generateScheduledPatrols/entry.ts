/**
 * generateScheduledPatrols
 *
 * Generates ScheduledPatrol records for active sites with patrol_config.enabled = true.
 * Also marks overdue/missed patrols and sends 10-min pre-patrol alerts.
 *
 * OPTIMIZED: Exits immediately if no active shifts exist — zero extra calls on idle days.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function timeToMins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function addMinutes(base, mins) {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + mins);
  return d;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

    // 0a. Fetch patrol-enabled sites first — exit immediately if none
    const sites = await base44.asServiceRole.entities.Site.filter({ status: 'active' });
    const patrolSites = sites.filter(s => s.patrol_config?.enabled && s.patrol_config?.schedules?.length > 0);

    if (patrolSites.length === 0) {
      return Response.json({ success: true, skipped: true, reason: 'No patrol-enabled sites', patrolsCreated: 0 });
    }

    // 0b. GATE CHECK — only fetch shifts for patrol-enabled sites today
    const patrolSiteIds = new Set(patrolSites.map(s => s.id));
    const allShifts = await base44.asServiceRole.entities.Shift.filter({});
    const todayShifts = allShifts.filter(s => {
      const d = new Date(s.start_time);
      return d >= todayStart && d <= todayEnd &&
        ['scheduled', 'active', 'accepted'].includes(s.status) &&
        patrolSiteIds.has(s.site_id);
    });

    if (todayShifts.length === 0) {
      return Response.json({ success: true, skipped: true, reason: 'No active shifts on patrol sites today', patrolsCreated: 0 });
    }

    // 1. Fetch existing scheduled patrols for TODAY only (paginated to avoid loading all history)
    const todayPatrolsRaw = await base44.asServiceRole.entities.ScheduledPatrol.list('-scheduled_start', 500);
    const todayPatrols = todayPatrolsRaw.filter(p => {
      const d = new Date(p.scheduled_start);
      return d >= todayStart && d <= todayEnd;
    });

    const created = [];
    const skipped = [];

    for (const site of patrolSites) {
      const cfg = site.patrol_config;
      const siteShift = todayShifts.find(s => s.site_id === site.id);

      // Only generate patrols if there's a guard assigned to this site today
      if (!siteShift) continue;

      for (const schedule of cfg.schedules) {
        const startMins = timeToMins(schedule.start_time || '06:00');
        const endMins = timeToMins(schedule.end_time || '18:00');
        const freqMins = schedule.frequency_minutes || 60;

        let patrolMins = startMins;
        let patrolNum = 1;

        while (patrolMins <= endMins) {
          const scheduledStart = new Date(todayStart);
          scheduledStart.setMinutes(scheduledStart.getMinutes() + patrolMins);

          const alreadyExists = todayPatrols.some(p =>
            p.site_id === site.id &&
            Math.abs(new Date(p.scheduled_start) - scheduledStart) < 5 * 60 * 1000
          );

          if (!alreadyExists) {
            const checkpoints = (site.checkpoints || []).map(cp => ({
              checkpoint_id: cp.id,
              checkpoint_name: cp.name,
              risk_level: cp.risk_level || 'medium',
              required: cp.required !== false,
              completed: false,
              order: 0,
            }));

            const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            const shuffled = cfg.ai_route_optimization
              ? checkpoints.sort((a, b) =>
                  (riskOrder[b.risk_level] || 2) + Math.random() * 0.4 -
                  (riskOrder[a.risk_level] || 2) - Math.random() * 0.4
                ).map((cp, i) => ({ ...cp, order: i + 1 }))
              : checkpoints.map((cp, i) => ({ ...cp, order: i + 1 }));

            const patrol = await base44.asServiceRole.entities.ScheduledPatrol.create({
              site_id: site.id,
              site_name: site.name,
              guard_id: siteShift.guard_id,
              guard_name: siteShift.guard_name,
              shift_id: siteShift.id,
              scheduled_start: scheduledStart.toISOString(),
              scheduled_end: addMinutes(scheduledStart, cfg.duration_target_minutes || 30).toISOString(),
              status: scheduledStart <= now ? 'due' : 'upcoming',
              patrol_number: patrolNum,
              route_checkpoints: shuffled,
              checkpoints_total: shuffled.length,
              checkpoints_completed: 0,
              ai_route_generated: !!cfg.ai_route_optimization,
            });

            created.push(patrol.id);
          } else {
            skipped.push(`${site.name} +${patrolMins - startMins}m`);
          }

          patrolMins += freqMins;
          patrolNum++;
        }
      }
    }

    // 3. Mark overdue / missed patrols — only on today's patrols
    const overdueThreshold = 15;
    const missedThreshold = 60;
    let markedOverdue = 0;
    let markedMissed = 0;

    // Fetch supervisors once for all missed patrol notifications
    const allUsers = await base44.asServiceRole.entities.User.list();
    const supervisors = allUsers.filter(u => ['admin', 'dispatcher', 'supervisor'].includes(u.role_type)).slice(0, 3);

    for (const patrol of todayPatrols) {
      if (patrol.status !== 'upcoming' && patrol.status !== 'due') continue;
      const minsLate = (now - new Date(patrol.scheduled_start)) / 60000;

      if (minsLate > missedThreshold) {
        await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, { status: 'missed' });
        markedMissed++;

        if (patrol.guard_name && supervisors.length > 0) {
          await Promise.all(supervisors.map(sup =>
            base44.asServiceRole.entities.Notification.create({
              recipient_id: sup.id,
              recipient_name: sup.full_name,
              type: 'system',
              priority: 'high',
              title: `⚠️ Missed Patrol — ${patrol.site_name}`,
              message: `${patrol.guard_name} missed patrol #${patrol.patrol_number} at ${patrol.site_name}.`,
              read: false,
              related_entity: 'ScheduledPatrol',
              related_id: patrol.id,
              sent_via: ['in_app'],
            }).catch(() => {})
          ));
        }
      } else if (minsLate > overdueThreshold) {
        await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, { status: 'overdue' });
        markedOverdue++;
      } else if (minsLate >= 0 && patrol.status === 'upcoming') {
        await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, { status: 'due' });
      }
    }

    // 4. Send 10-min pre-patrol alerts (in-app only, no email/push integration call)
    const alertWindowEnd = new Date(now.getTime() + 10 * 60 * 1000);
    const dueAlerts = todayPatrols.filter(p =>
      p.status === 'upcoming' &&
      p.guard_id &&
      new Date(p.scheduled_start) >= now &&
      new Date(p.scheduled_start) <= alertWindowEnd &&
      !p.alerts_sent?.includes('10min')
    );

    for (const patrol of dueAlerts) {
      // In-app notification only — no push integration credit used
      await base44.asServiceRole.entities.Notification.create({
        recipient_id: patrol.guard_id,
        type: 'patrol_due',
        priority: 'high',
        title: '🛡️ Patrol Due in 10 Minutes',
        message: `Patrol #${patrol.patrol_number} at ${patrol.site_name} starts at ${new Date(patrol.scheduled_start).toLocaleTimeString('en-ZA')}.`,
        read: false,
        related_entity: 'ScheduledPatrol',
        related_id: patrol.id,
        sent_via: ['in_app'],
      }).catch(() => {});

      await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, {
        alerts_sent: [...(patrol.alerts_sent || []), '10min'],
      }).catch(() => {});
    }

    return Response.json({
      success: true,
      patrolSitesProcessed: patrolSites.length,
      patrolsCreated: created.length,
      patrolsSkipped: skipped.length,
      markedOverdue,
      markedMissed,
      dueAlertsSet: dueAlerts.length,
    });

  } catch (error) {
    console.error('generateScheduledPatrols error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});