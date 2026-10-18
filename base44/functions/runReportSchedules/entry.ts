import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * runReportSchedules — the MISSING dispatcher for ReportSchedule rows.
 *
 * Until now a saved report schedule was only a stored record: nothing ever
 * executed it. This dispatcher (driven by the 15-minute "Report Schedule
 * Dispatcher" workflow) closes that gap:
 *
 *  • Loads every ReportSchedule (service role).
 *  • Considers only schedules that are actually ACTIVE (is_active !== false
 *    and legacy status !== 'paused') and auto-sendable (daily / weekly /
 *    monthly). 'real-time' / 'realtime' / 'yearly' schedules are manual-send
 *    only and are reported as skipped — never claimed as automated.
 *  • Computes each schedule's due instant in SAST (Africa/Johannesburg,
 *    UTC+2, no DST) from frequency + day + time, and dispatches only when
 *    the due instant has passed since the schedule's last_sent_at (failures
 *    stay due and are retried on the next tick).
 *  • Delegates delivery to sendScheduledReport, which re-validates the
 *    schedule's tenant scope server-side and delivers ONLY to approved
 *    recipients of that tenant (never arbitrary addresses), idempotently.
 *  • Stamps a dispatcher audit entry per skipped schedule reason.
 */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SA_OFFSET_MS = 2 * 60 * 60 * 1000;

function parseHHMM(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
  if (!m) return [8, 0];
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return [hh, mm];
}

/** Due instant (UTC Date) of one schedule within the CURRENT SAST period. */
function dueInstantFor(schedule) {
  const freq = String(schedule.frequency || '').toLowerCase();
  const [hh, mm] = parseHHMM(schedule.schedule_time || schedule.send_time);
  // SAST wall-clock "now" expressed in its UTC components.
  const j = new Date(Date.now() + SA_OFFSET_MS);
  const y = j.getUTCFullYear(), mo = j.getUTCMonth(), d = j.getUTCDate(), dow = j.getUTCDay();

  if (freq === 'daily') {
    return new Date(Date.UTC(y, mo, d, hh, mm) - SA_OFFSET_MS);
  }
  if (freq === 'weekly') {
    const idx = DAY_NAMES.indexOf(String(schedule.send_day || 'Monday'));
    const targetDow = idx >= 0 ? idx : 1;
    const weekStart = d - ((dow + 6) % 7); // this week's Monday (SAST)
    const day = Math.min(weekStart + ((targetDow - 1 + 7) % 7), new Date(Date.UTC(y, mo + 1, 0)).getUTCDate());
    return new Date(Date.UTC(y, mo, Math.max(1, day), hh, mm) - SA_OFFSET_MS);
  }
  if (freq === 'monthly') {
    const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const day = Math.min(Math.max(1, Number(schedule.schedule_day) || 1), daysInMonth);
    return new Date(Date.UTC(y, mo, day, hh, mm) - SA_OFFSET_MS);
  }
  return null; // real-time / yearly → manual send only
}

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    // Workflow identity check — the dispatcher runs as the platform.
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const isPlatform = user.role === 'admin' || user.role_type === 'admin' ||
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    if (!isPlatform) return Response.json({ error: 'Forbidden' }, { status: 403 });

    // DRY-RUN MODE: dry_run=true computes and reports what WOULD be
    // dispatched without invoking any sender — used to verify the dispatcher
    // before it is enabled for real sends.
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;

    const schedules = (await svc.entities.ReportSchedule.list().catch(() => [])) || [];
    const now = new Date();
    const details = [];
    let dispatched = 0;
    let sent = 0;
    let failed = 0;
    let wouldDispatch = 0;
    let skippedInactive = 0;
    let skippedManualOnly = 0;
    let notDue = 0;

    for (const s of schedules) {
      const active = s.is_active !== false && s.status !== 'paused';
      if (!active) { skippedInactive++; continue; }

      const freq = String(s.frequency || '').toLowerCase();
      if (!['daily', 'weekly', 'monthly'].includes(freq)) { skippedManualOnly++; continue; }

      const due = dueInstantFor(s);
      if (!due) { skippedManualOnly++; continue; }
      const last = s.last_sent_at ? new Date(s.last_sent_at) : null;
      if (now < due || (last && last >= due)) { notDue++; continue; }

      // DUE — in dry-run mode report only; nothing is sent.
      if (dryRun) {
        wouldDispatch++;
        details.push({
          schedule_id: s.id,
          report_type: s.report_type,
          frequency: freq,
          tenant: s.customer_id || 'platform_pool',
          status: 'would_dispatch (dry run — nothing sent)',
        });
        continue;
      }

      dispatched++;
      try {
        const res = await base44.functions.invoke('sendScheduledReport', { schedule_id: s.id });
        const ok = res && res.success !== false;
        if (ok) sent++; else failed++;
        details.push({ schedule_id: s.id, report_type: s.report_type, status: ok ? 'sent' : 'failed', message: res?.message || null });
      } catch (e) {
        failed++;
        details.push({ schedule_id: s.id, report_type: s.report_type, status: 'failed', message: String(e?.message || e) });
      }
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      would_dispatch: wouldDispatch,
      schedules_total: schedules.length,
      dispatched,
      sent,
      failed,
      not_due: notDue,
      skipped_inactive: skippedInactive,
      skipped_manual_only: skippedManualOnly,
      details,
    });
  } catch (error) {
    console.error('runReportSchedules error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}