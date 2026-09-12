import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { sendNativePush } from '../../shared/nativePush.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate — blocks unauthenticated external invocations.
    let user = null;
    try { user = await base44.auth.me(); } catch (_) {}
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role_type !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const now = new Date();
    const results = {};

    // ── 0. Medical Appointment Reminders (shared tick) ──
    // Deadline-driven idempotent sweep; replaces the retired dedicated 30-minute
    // reminder automation. Runs on this already-scheduled 2-hour tick regardless
    // of the security toggles below, and early-exits inside when nothing is due.
    try {
      const rem = await base44.functions.invoke('sendAppointmentReminders', {});
      // invoke returns an Axios-shaped response — keep only the payload
      results.appointment_reminders = rem?.data !== undefined ? rem.data : { invoked: true };
    } catch (e) {
      results.appointment_reminders = { error: e.message };
    }

    // Load toggle settings — exit immediately if ALL are disabled
    const settingsRecs = await base44.asServiceRole.entities.AutomationSetting.list();
    const settings = settingsRecs?.[0] || {};
    const anyEnabled = settings.monitor_overdue_patrols || settings.monitor_missed_clockins ||
      settings.monitor_low_battery || settings.generate_scheduled_patrols || settings.send_shift_reminders;
    if (!anyEnabled) {
      return Response.json({ success: true, results });
    }

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
          // TENANT-SCOPED — legacy PatrolPlan route overdue alerts reach only
          // the patrol's own customer's operational roles (platform oversight
          // always permitted). When a legacy plan carries no customer scope,
          // the previous behaviour is preserved (fail-open for legacy data).
          const isPlatformUser = (u) => u.role_type === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform';
          const scopedSupervisors = (patrol) => allUsers.filter(u =>
            ['dispatcher', 'admin', 'supervisor', 'customer_admin'].includes(u.role_type) &&
            (isPlatformUser(u) || !patrol.customer_id || u.customer_id === patrol.customer_id));
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
            // NATIVE PUSH — shared platform service. A critical overdue patrol
            // reaches supervisors with the app closed; deterministic event key.
            for (const sup of scopedSupervisors(patrol)) {
              await sendNativePush(base44.asServiceRole, {
                user_id: sup.id,
                title: '⏰ Overdue Patrol Route',
                body: `${patrol.assigned_to_name} patrol at ${patrol.site_name} is overdue. ${completed}/${total} checkpoints completed.`,
                priority: 'critical',
                action_label: 'Open Patrol Monitoring', action_url: '/PatrolMonitoring',
                event_key: 'patrolplan_overdue:' + patrol.id,
              }).catch(() => {});
            }
            await Promise.all(scopedSupervisors(patrol).filter(s => s.email).map(sup =>
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
          // TENANT-SCOPED operational recipients: same-customer admin/
          // dispatcher/supervisor/customer admin (platform oversight always
          // permitted). No cross-tenant missed-clock-in notifications.
          const isPlatformUser = (u) => u.role_type === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform';
          const scopedAdmins = (shift) => allUsers.filter(u =>
            ['admin', 'dispatcher', 'supervisor', 'customer_admin'].includes(u.role_type) &&
            (isPlatformUser(u) || !shift.customer_id || u.customer_id === shift.customer_id));
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
            // RECIPIENTS: the affected GUARD + tenant-scoped operational
            // supervisors. Every channel failure-isolated; deterministic
            // event key 'missed_clockin:<shiftId>' dedupes sweep retries.
            const guardUser = allUsers.find(u => u.id === shift.guard_id) || null;
            const targets = [guardUser, ...scopedAdmins(shift)].filter(Boolean);
            for (const t of targets) {
              // IN-APP — server-persisted record (feeds the Bell, survives refresh)
              await base44.asServiceRole.entities.Notification.create({
                recipient_id: t.id,
                recipient_name: t.display_name || t.full_name,
                type: 'system', priority: 'high',
                title: '⚠️ Missed Clock-In',
                message: `${shift.guard_name || 'Guard'} missed clock-in at ${shift.site_name}. Scheduled: ${new Date(shift.start_time).toLocaleString('en-ZA')}`,
                read: false,
                related_entity: 'shift', related_id: shift.id,
                action_url: '/Scheduling', sent_via: ['in_app'],
                customer_id: shift.customer_id || undefined,
                reseller_id: shift.reseller_id || undefined,
              }).catch(() => {});
              // NATIVE PUSH — reaches the recipient with the app closed
              await sendNativePush(base44.asServiceRole, {
                user_id: t.id,
                title: '⚠️ Missed Clock-In',
                body: `${shift.guard_name || 'Guard'} missed clock-in at ${shift.site_name}. Scheduled: ${new Date(shift.start_time).toLocaleString('en-ZA')}`,
                priority: 'high',
                action_label: 'Open Scheduling', action_url: '/Scheduling',
                event_key: 'missed_clockin:' + shift.id,
                customer_id: shift.customer_id || undefined,
                reseller_id: shift.reseller_id || undefined,
              }).catch(() => {});
              // TELEGRAM — verified per-user mapping; same-chat dedupe
              if (t.telegram_connected && t.telegram_notifications_enabled !== false && t.telegram_chat_id) {
                await sendTaskTelegramDeduped(base44.asServiceRole, secrets, 'missed_clockin:' + shift.id,
                  t.telegram_chat_id,
                  `⚠️ Missed Clock-In\n\n${shift.guard_name || 'Guard'} missed clock-in at ${shift.site_name}. Scheduled: ${new Date(shift.start_time).toLocaleString('en-ZA')}`)
                  .catch(() => {});
              }
              // EMAIL
              if (t.email) {
                await base44.asServiceRole.integrations.Core.SendEmail({
                  from_name: 'SecureGuard Alerts', to: t.email,
                  subject: '🚨 Missed Clock-In Alert',
                  body: `Guard: ${shift.guard_name || 'Unknown'}\nSite: ${shift.site_name}\nScheduled Start: ${new Date(shift.start_time).toLocaleString('en-ZA')}`
                }).catch(err => console.error('Email failed:', err.message));
              }
            }
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
            if (!guard) continue;
            const reminderTitle = `⏰ Shift Reminder — ${shift.site_name}`;
            const reminderBody = `Your shift starts in ~2 hours. Site: ${shift.site_name}. Start: ${new Date(shift.start_time).toLocaleString('en-ZA')}.`;
            // EMAIL — only when the guard has an address; a missing email no
            // longer silently cancels the whole reminder (previous defect).
            if (guard.email) {
              await base44.asServiceRole.integrations.Core.SendEmail({
                from_name: 'SecureGuard', to: guard.email,
                subject: reminderTitle,
                body: `Hi ${shift.guard_name || guard.full_name},\n\nYour shift starts in approximately 2 hours.\n\nSite: ${shift.site_name}\nStart: ${new Date(shift.start_time).toLocaleString('en-ZA')}\nEnd: ${new Date(shift.end_time).toLocaleString('en-ZA')}\n\nPlease ensure you arrive on time and clock in via the SecureGuard app.`
              }).catch(err => console.error(`Reminder failed:`, err.message));
            }
            // NATIVE PUSH — shared platform service: the 2-hour shift reminder
            // reaches the guard with the app closed (NORMAL priority reminder).
            await sendNativePush(base44.asServiceRole, {
              user_id: shift.guard_id,
              title: reminderTitle,
              body: reminderBody,
              priority: 'normal',
              action_label: 'Open My Shift', action_url: '/GuardShift',
              event_key: 'shift_reminder:' + shift.id,
            }).catch(() => {});
            // IN-APP — server-persisted record (feeds the Bell, survives refresh)
            await base44.asServiceRole.entities.Notification.create({
              recipient_id: shift.guard_id,
              recipient_name: guard.display_name || guard.full_name || shift.guard_name,
              type: 'shift_reminder', priority: 'medium',
              title: reminderTitle, message: reminderBody, read: false,
              related_entity: 'shift', related_id: shift.id,
              action_url: '/GuardShift', sent_via: ['in_app'],
              customer_id: shift.customer_id || undefined,
              reseller_id: shift.reseller_id || undefined,
            }).catch(() => {});
            // TELEGRAM — high-frequency reminder channel (verified per-user
            // mapping; failure never blocks the reminder bookkeeping)
            if (guard.telegram_connected && guard.telegram_notifications_enabled !== false && guard.telegram_chat_id) {
              await sendTaskTelegramDeduped(base44.asServiceRole, secrets, 'shift_reminder:' + shift.id,
                guard.telegram_chat_id, `${reminderTitle}\n\n${reminderBody}`)
                .catch(() => {});
            }
            await base44.asServiceRole.entities.Shift.update(shift.id, { reminder_sent: true }).catch(() => {});
            remindersSent++;
          }
          results.shift_reminders = { sent: remindersSent };
        }
      } catch (e) { results.shift_reminders = { error: e.message }; }
    }

    // ── 6. Scheduled Patrol status monitor ──
    // Moved from the retired hourly patrol automation. Same thresholds (15-min
    // overdue, 60-min missed) and 10-min pre-patrol alerts; now runs on this
    // shared 2-hour tick. Gated by the same "Auto-Generate Patrols" toggle that
    // gated the old hourly run (enabled unless explicitly false).
    if (!(settings.generate_scheduled_patrols === false)) {
      try {
        const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
        const patrolsRaw = await base44.asServiceRole.entities.ScheduledPatrol.list('-scheduled_start', 500);
        const todayPatrols = patrolsRaw.filter(p => {
          const d = new Date(p.scheduled_start);
          return d >= todayStart && d <= todayEnd;
        });

        if (todayPatrols.length > 0) {
          const overdueThreshold = 15;
          const missedThreshold = 60;
          let markedOverdue = 0;
          let markedMissed = 0;
          let markedDue = 0;

          // TENANT-SCOPED RECIPIENT RESOLUTION (server-side): a patrol's
          // operational recipients are the assigned guard plus SAME-CUSTOMER
          // supervisors/dispatchers/customer admins (platform oversight
          // always permitted). No cross-tenant recipient is ever notified.
          const allUsers = (await base44.asServiceRole.entities.User.list().catch(() => [])) || [];
          const isPlatformUser = (u) => u.role_type === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform';
          const resolvePatrolRecipients = (patrol) => ({
            guard: allUsers.find(u => u.id === patrol.guard_id) || null,
            supervisors: allUsers.filter(u =>
              ['admin', 'dispatcher', 'supervisor', 'customer_admin'].includes(u.role_type) &&
              (isPlatformUser(u) || !patrol.customer_id || u.customer_id === patrol.customer_id)),
          });

          // Multi-channel patrol exception dispatch — every channel is
          // FAILURE-ISOLATED (a Telegram/email/in-app failure never blocks
          // the others or the status update), and the deterministic event
          // key (patrol_missed/patrol_overdue:<id>) makes each channel
          // idempotent per patrol + recipient across sweep retries.
          const dispatchPatrolException = async (patrol, targets, kind, title, body) => {
            for (const t of targets.filter(Boolean)) {
              // IN-APP — tenant-owned record
              await base44.asServiceRole.entities.Notification.create({
                recipient_id: t.id,
                recipient_name: t.display_name || t.full_name,
                type: 'system',
                priority: 'high',
                title, message: body, read: false,
                related_entity: 'ScheduledPatrol', related_id: patrol.id,
                action_url: '/PatrolMonitoring', sent_via: ['in_app'],
                customer_id: patrol.customer_id || undefined,
                reseller_id: patrol.reseller_id || undefined,
              }).catch(() => {});
              // NATIVE PUSH — additional channel, never depended on
              await sendNativePush(base44.asServiceRole, {
                user_id: t.id, title, body, priority: 'high',
                action_label: 'Open Patrol Monitoring', action_url: '/PatrolMonitoring',
                event_key: kind + ':' + patrol.id,
                customer_id: patrol.customer_id || undefined,
                reseller_id: patrol.reseller_id || undefined,
              }).catch(() => {});
              // TELEGRAM — verified per-user mapping; same-chat dedupe by
              // event_key + chat; each separate user keeps their own event.
              if (t.telegram_connected && t.telegram_notifications_enabled !== false && t.telegram_chat_id) {
                await sendTaskTelegramDeduped(base44.asServiceRole, secrets, kind + ':' + patrol.id,
                  t.telegram_chat_id,
                  `${title}\n\n${body}\nPatrol #${patrol.patrol_number} — ${patrol.site_name}`)
                  .catch(() => {});
              }
              // EMAIL — important operational exceptions only (missed/overdue)
              if (t.email) {
                await base44.asServiceRole.integrations.Core.SendEmail({
                  from_name: 'USS Patrol Alerts', to: t.email, subject: title, body,
                }).catch(() => {});
              }
            }
          };

          for (const patrol of todayPatrols) {
            if (patrol.status !== 'upcoming' && patrol.status !== 'due') continue;
            const minsLate = (now - new Date(patrol.scheduled_start)) / 60000;

            if (minsLate > missedThreshold) {
              await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, { status: 'missed' });
              markedMissed++;
              const { guard, supervisors } = resolvePatrolRecipients(patrol);
              if (patrol.guard_name || guard) {
                await dispatchPatrolException(patrol, [guard, ...supervisors], 'patrol_missed',
                  `⚠️ Missed Patrol — ${patrol.site_name}`,
                  `${patrol.guard_name || 'The assigned guard'} missed patrol #${patrol.patrol_number} at ${patrol.site_name}.`);
              }
            } else if (minsLate > overdueThreshold) {
              await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, { status: 'overdue' });
              markedOverdue++;
              const { guard, supervisors } = resolvePatrolRecipients(patrol);
              if (patrol.guard_name || guard) {
                await dispatchPatrolException(patrol, [guard, ...supervisors], 'patrol_overdue',
                  `⏰ Patrol Overdue — ${patrol.site_name}`,
                  `${patrol.guard_name || 'The assigned guard'}'s patrol #${patrol.patrol_number} at ${patrol.site_name} is overdue.`);
              }
            } else if (minsLate >= 0 && patrol.status === 'upcoming') {
              await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, { status: 'due' });
              markedDue++;
              // PATROL DUE NOW — guard notification (in-app + push + Telegram;
              // no email on high-frequency reminders). Failure-isolated; the
              // deterministic event key dedupes sweep retries.
              const { guard: dueGuard } = resolvePatrolRecipients(patrol);
              const dueTitle = '🛡️ Patrol Due Now';
              const dueBody = `Patrol #${patrol.patrol_number} at ${patrol.site_name} is due now — ${patrol.checkpoints_total || 0} checkpoints.`;
              if (dueGuard) {
                await base44.asServiceRole.entities.Notification.create({
                  recipient_id: dueGuard.id,
                  recipient_name: dueGuard.display_name || dueGuard.full_name || patrol.guard_name,
                  type: 'patrol_due', priority: 'high',
                  title: dueTitle, message: dueBody, read: false,
                  related_entity: 'ScheduledPatrol', related_id: patrol.id,
                  action_url: '/GuardPatrol', sent_via: ['in_app'],
                  customer_id: patrol.customer_id || undefined,
                  reseller_id: patrol.reseller_id || undefined,
                }).catch(() => {});
                await sendNativePush(base44.asServiceRole, {
                  user_id: dueGuard.id, title: dueTitle, body: dueBody, priority: 'high',
                  action_label: 'Start Patrol', action_url: '/GuardPatrol',
                  event_key: 'patrol_due:' + patrol.id,
                  customer_id: patrol.customer_id || undefined,
                  reseller_id: patrol.reseller_id || undefined,
                }).catch(() => {});
                if (dueGuard.telegram_connected && dueGuard.telegram_notifications_enabled !== false && dueGuard.telegram_chat_id) {
                  await sendTaskTelegramDeduped(base44.asServiceRole, secrets, 'patrol_due:' + patrol.id,
                    dueGuard.telegram_chat_id, `${dueTitle}\n\n${dueBody}`).catch(() => {});
                }
              }
            }
          }

          // 10-min pre-patrol alerts (in-app only — no integration credit)
          const alertWindowEnd = new Date(now.getTime() + 10 * 60 * 1000);
          const dueAlerts = todayPatrols.filter(p =>
            p.status === 'upcoming' &&
            p.guard_id &&
            new Date(p.scheduled_start) >= now &&
            new Date(p.scheduled_start) <= alertWindowEnd &&
            !p.alerts_sent?.includes('10min')
          );
          for (const patrol of dueAlerts) {
            const guardUser = allUsers.find(u => u.id === patrol.guard_id) || null;
            await base44.asServiceRole.entities.Notification.create({
              recipient_id: patrol.guard_id,
              recipient_name: guardUser?.display_name || guardUser?.full_name || patrol.guard_name,
              type: 'patrol_due',
              priority: 'high',
              title: '🛡️ Patrol Due in 10 Minutes',
              message: `Patrol #${patrol.patrol_number} at ${patrol.site_name} starts at ${new Date(patrol.scheduled_start).toLocaleTimeString('en-ZA')}.`,
              read: false,
              related_entity: 'ScheduledPatrol',
              related_id: patrol.id,
              action_url: '/GuardPatrol',
              customer_id: patrol.customer_id || undefined,
              reseller_id: patrol.reseller_id || undefined,
              sent_via: ['in_app'],
            }).catch(() => {});
            // NATIVE PUSH — shared platform service: the configured 10-minute
            // pre-patrol alert reaches the guard with the app closed. Voice
            // guidance inside the patrol flow is untouched.
            await sendNativePush(base44.asServiceRole, {
              user_id: patrol.guard_id,
              title: '🛡️ Patrol Due in 10 Minutes',
              body: `Patrol #${patrol.patrol_number} at ${patrol.site_name} starts at ${new Date(patrol.scheduled_start).toLocaleTimeString('en-ZA')}.`,
              priority: 'normal',
              action_label: 'Start Patrol', action_url: '/GuardPatrol',
              event_key: 'patrol_due10:' + patrol.id,
            }).catch(() => {});
            // TELEGRAM — automatic reminder channel to the guard (no email:
            // repetitive reminders stay off email by default). Same verified
            // per-user mapping; failure never blocks the alert bookkeeping.
            if (guardUser && guardUser.telegram_connected && guardUser.telegram_notifications_enabled !== false && guardUser.telegram_chat_id) {
              await sendTaskTelegramDeduped(base44.asServiceRole, secrets, 'patrol_reminder10:' + patrol.id,
                guardUser.telegram_chat_id,
                `🛡️ Patrol Due in 10 Minutes\n\nPatrol #${patrol.patrol_number} at ${patrol.site_name} starts at ${new Date(patrol.scheduled_start).toLocaleTimeString('en-ZA')}.`)
                .catch(() => {});
            }
            await base44.asServiceRole.entities.ScheduledPatrol.update(patrol.id, {
              alerts_sent: [...(patrol.alerts_sent || []), '10min'],
            }).catch(() => {});
          }

          results.scheduled_patrol_monitor = {
            checked: todayPatrols.length,
            markedDue,
            markedOverdue,
            markedMissed,
            prePatrolAlerts: dueAlerts.length,
          };
        }
      } catch (e) { results.scheduled_patrol_monitor = { error: e.message }; }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    console.error('runAllMonitors error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});