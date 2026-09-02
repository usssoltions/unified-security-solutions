/**
 * generateScheduledPatrols — EVENT-DRIVEN patrol generation (zero idle cost).
 *
 * Previously executed hourly by a dedicated scheduled automation (~24 idle
 * executions/day even with no patrol-enabled sites). That automation is now
 * retired. This function runs ONLY when real work happens:
 *
 *   Triggers (entity automations):
 *   - Shift create / update / delete
 *       → generate patrols for that shift's site+date (idempotent), propagate
 *         guard reassignment, or clean up the deleted shift's future patrols.
 *   - Site update (patrol_config / checkpoints changed)
 *       → rebuild that site's future not-yet-started patrols with the new config.
 *   - Direct invocation with { site_id } (bulk scheduling in the app —
 *     bulkCreate skips per-record events) → targeted sweep for that site.
 *   - Direct invocation with no payload → full recovery sweep (manual lever).
 *
 * Behaviour preserved from the previous hourly generator:
 *   - Per-site patrol_config schedules (time window + frequency)
 *   - First eligible shift per site+date supplies the guard (same rule)
 *   - Randomised/AI-optimised checkpoint ordering applied at creation time
 *   - Duration target, patrol numbering, due/upcoming status
 *   - Never duplicates: an existing patrol within 5 min of the scheduled time
 *     is skipped, so repeated events are safe (idempotent)
 *
 * Patrol STATUS monitoring (overdue/missed marking + 10-min pre-patrol alerts)
 * moved to the shared 2-hourly runAllMonitors tick (same thresholds).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const ELIGIBLE_SHIFT_STATUSES = ['scheduled', 'active', 'accepted'];

function timeToMins(hhmm) {
  const parts = String(hhmm || '06:00').split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate — blocks unauthenticated external invocations. Entity and
    // scheduled contexts carry the platform identity (same pattern as the
    // other automation-backed functions).
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role_type !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    let body = {};
    try { body = await req.json(); } catch (_) {}
    const evt = body.event || {};
    let record = body.data || null;
    const oldData = body.old_data || null;

    // Re-fetch when the automation payload omitted the record (payload_too_large).
    if (!record && evt.entity_id) {
      if (evt.entity_name === 'Shift') {
        record = await base44.asServiceRole.entities.Shift.get(evt.entity_id);
      } else if (evt.entity_name === 'Site') {
        record = await base44.asServiceRole.entities.Site.get(evt.entity_id);
      }
    }

    const now = new Date();
    const audit = {
      processedAt: now.toISOString(),
      trigger: evt.entity_name ? `${evt.type || 'update'}:${evt.entity_name}` : (body.site_id ? 'site_sweep' : 'manual_sweep'),
      patrolsCreated: 0,
      patrolsRemoved: 0,
      guardsReassigned: 0,
      sitesProcessed: 0,
    };

    // ── 1. Shift DELETED → remove its future not-yet-started patrols so no
    // orphaned obligations linger (and no false "missed patrol" alerts).
    // Cleanup runs even when the kill switch is off.
    if (evt.type === 'delete' && evt.entity_name === 'Shift' && evt.entity_id) {
      const orphans = await base44.asServiceRole.entities.ScheduledPatrol.filter({
        shift_id: evt.entity_id,
        status: 'upcoming',
      });
      for (const p of orphans) {
        if (new Date(p.scheduled_start) > now) {
          await base44.asServiceRole.entities.ScheduledPatrol.delete(p.id).catch(() => {});
          audit.patrolsRemoved++;
        }
      }
      return Response.json({ success: true, ...audit });
    }

    // ── 2. Platform kill switch — the same toggle that gated the retired
    // hourly run. Enabled unless an admin explicitly set it to false.
    const settingsRecs = await base44.asServiceRole.entities.AutomationSetting.list();
    const settings = settingsRecs?.[0];
    if (settings && settings.generate_scheduled_patrols === false) {
      return Response.json({ success: true, skipped: true, reason: 'Automation disabled', ...audit });
    }

    // ── 3. Resolve the target site(s) from the event (or sweep scope).
    let sites = [];
    let eventShift = null;

    if (record && evt.entity_name === 'Shift') {
      eventShift = record;
      if (!ELIGIBLE_SHIFT_STATUSES.includes(record.status)) {
        return Response.json({ success: true, skipped: true, reason: `Shift status '${record.status}' not eligible`, ...audit });
      }
      const site = await base44.asServiceRole.entities.Site.get(record.site_id).catch(() => null);
      if (!site || site.status !== 'active') {
        return Response.json({ success: true, skipped: true, reason: 'Site not active', ...audit });
      }
      sites = [site];

      // Guard reassigned → propagate to this shift's future not-yet-started
      // patrols (patrols already visible to the previous guard otherwise).
      if (oldData && record.guard_id && oldData.guard_id !== record.guard_id) {
        const linked = await base44.asServiceRole.entities.ScheduledPatrol.filter({
          shift_id: record.id,
          status: 'upcoming',
        });
        for (const p of linked) {
          if (new Date(p.scheduled_start) > now) {
            await base44.asServiceRole.entities.ScheduledPatrol.update(p.id, {
              guard_id: record.guard_id,
              guard_name: record.guard_name,
            }).catch(() => {});
            audit.guardsReassigned++;
          }
        }
      }
    } else if (record && evt.entity_name === 'Site') {
      if (!(record.patrol_config?.enabled && record.patrol_config?.schedules?.length > 0)) {
        // Auto-Generate Patrols turned OFF for this site → generate nothing new.
        // Already-generated patrols remain (same semantics as before).
        return Response.json({ success: true, skipped: true, reason: 'Auto-Generate Patrols disabled for site', ...audit });
      }
      // Config / routes changed → rebuild this site's future not-yet-started
      // patrols with the new configuration. Started/completed/missed history is
      // never touched (scheduled_start > now only).
      const future = await base44.asServiceRole.entities.ScheduledPatrol.filter({
        site_id: record.id,
        status: 'upcoming',
      });
      for (const p of future) {
        if (new Date(p.scheduled_start) > now) {
          await base44.asServiceRole.entities.ScheduledPatrol.delete(p.id).catch(() => {});
          audit.patrolsRemoved++;
        }
      }
      sites = [record];
    } else if (body.site_id) {
      // Targeted sweep — used after bulk shift creation (bulkCreate skips the
      // per-record events the entity automations rely on).
      const site = await base44.asServiceRole.entities.Site.get(body.site_id).catch(() => null);
      sites = site ? [site] : [];
    } else {
      // Full recovery sweep across every patrol-enabled site (manual lever).
      const allSites = await base44.asServiceRole.entities.Site.filter({ status: 'active' });
      sites = allSites;
    }

    sites = sites.filter(s =>
      s && s.status === 'active' &&
      s.patrol_config?.enabled &&
      s.patrol_config?.schedules?.length > 0
    );

    // ── 4. Generate (idempotent — an existing patrol within 5 minutes of the
    // scheduled time is never duplicated, no matter how often events fire).
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // One dedup snapshot, reused for all sites (latest scheduled starts first).
    const existingRaw = sites.length > 0
      ? await base44.asServiceRole.entities.ScheduledPatrol.list('-scheduled_start', 300)
      : [];

    for (const site of sites) {
      const cfg = site.patrol_config;

      // Shifts to generate for: the event's shift, or every future eligible
      // shift of the site — first shift per date (same rule as the old
      // generator, which used the first matching shift of the day).
      const shiftsByDate = new Map();
      if (eventShift) {
        shiftsByDate.set(dayKey(eventShift.start_time), eventShift);
      } else {
        const siteShifts = await base44.asServiceRole.entities.Shift.filter({ site_id: site.id });
        for (const s of siteShifts) {
          if (!ELIGIBLE_SHIFT_STATUSES.includes(s.status)) continue;
          const st = new Date(s.start_time);
          if (st < todayStart) continue;
          const key = dayKey(st);
          if (!shiftsByDate.has(key)) shiftsByDate.set(key, s);
        }
      }
      if (shiftsByDate.size === 0) continue;

      const sitePatrols = existingRaw.filter(p => p.site_id === site.id);

      for (const shift of shiftsByDate.values()) {
        const dayStart = new Date(shift.start_time);
        dayStart.setHours(0, 0, 0, 0);

        for (const schedule of cfg.schedules) {
          const startMins = timeToMins(schedule.start_time || '06:00');
          const endMins = timeToMins(schedule.end_time || '18:00');
          const freqMins = schedule.frequency_minutes || 60;

          let patrolMins = startMins;
          let patrolNum = 1;

          while (patrolMins <= endMins) {
            const scheduledStart = new Date(dayStart);
            scheduledStart.setMinutes(scheduledStart.getMinutes() + patrolMins);

            const alreadyExists = sitePatrols.some(p =>
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

              const scheduledEnd = new Date(scheduledStart);
              scheduledEnd.setMinutes(scheduledEnd.getMinutes() + (cfg.duration_target_minutes || 30));

              const patrol = await base44.asServiceRole.entities.ScheduledPatrol.create({
                site_id: site.id,
                site_name: site.name,
                guard_id: shift.guard_id,
                guard_name: shift.guard_name,
                shift_id: shift.id,
                scheduled_start: scheduledStart.toISOString(),
                scheduled_end: scheduledEnd.toISOString(),
                status: scheduledStart <= now ? 'due' : 'upcoming',
                patrol_number: patrolNum,
                route_checkpoints: shuffled,
                checkpoints_total: shuffled.length,
                checkpoints_completed: 0,
                ai_route_generated: !!cfg.ai_route_optimization,
              });

              sitePatrols.push(patrol);
              audit.patrolsCreated++;
            }

            patrolMins += freqMins;
            patrolNum++;
          }
        }
      }
      audit.sitesProcessed++;
    }

    return Response.json({ success: true, ...audit });
  } catch (error) {
    console.error('generateScheduledPatrols error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}