/**
 * sendShiftScheduleSummary — SERVER-SIDE BRANDED DISPATCH for the scheduler's
 * "email guards their schedule" actions (BulkShiftActions bulk share and
 * ShiftDetailsModal single-shift share). Previously these emails were
 * composed in the browser from client-side state with no branding and no
 * delivery audit; the client now only sends shift IDs, and this function is
 * the authoritative source for every fact (shift, guard, site, times) and
 * for the effective tenant branding (resolveCommunicationBrand). Every email
 * attempt is recorded in the NotificationDelivery audit trail.
 *
 * Migration of the previous client-composed emails — the workflow itself is
 * unchanged from the operator's perspective.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import {
  resolveCommunicationBrand, buildBrandedEmail,
  formatSastDate, formatSastTime, formatSastDateTime,
} from '../../shared/brandedCommunication.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;

    const body = await req.json().catch(() => ({})) || {};
    const ids = (Array.isArray(body.shift_ids) ? body.shift_ids : [])
      .map((x: any) => String(x || '')).filter(Boolean).slice(0, 200);
    const single = String(body.mode || '') === 'single';
    if (!ids.length) return Response.json({ error: 'shift_ids is required' }, { status: 400 });

    const isPlatformCaller = caller.role_type === 'admin' || caller.role_type === 'platform_admin'
      || caller.admin_level === 'platform';
    const callerCid = caller.customer_id || null;

    // AUTHORITATIVE RESOLUTION — only shifts of the caller's OWN tenant are
    // dispatched; a guard caller may additionally only share shifts assigned
    // to themselves. Foreign ids are excluded, never processed.
    const shifts: any[] = [];
    let excluded = 0;
    for (const id of ids) {
      const rows = await svc.entities.Shift.filter({ id }).catch(() => []);
      const s = (rows && rows[0]) || null;
      if (!s) { excluded++; continue; }
      if (!isPlatformCaller && callerCid && s.customer_id
          && String(s.customer_id) !== String(callerCid)) { excluded++; continue; }
      if (caller.role_type === 'guard' && s.guard_id
          && String(s.guard_id) !== String(caller.id)) { excluded++; continue; }
      shifts.push(s);
    }
    if (!shifts.length) return Response.json({ error: 'No authorised shifts to share' }, { status: 403 });

    const brand = await resolveCommunicationBrand(svc, {
      customer_id: shifts[0].customer_id || callerCid,
      reseller_id: shifts[0].reseller_id || caller.reseller_id || null,
    });

    const byGuard = new Map<string, any[]>();
    for (const s of shifts) {
      const key = String(s.guard_id || '');
      if (!byGuard.has(key)) byGuard.set(key, []);
      byGuard.get(key).push(s);
    }

    let sent = 0;
    const failures: string[] = [];
    for (const [guardId, guardShifts] of byGuard.entries()) {
      let guard: any = null;
      if (guardId) {
        const rows = await svc.entities.User.filter({ id: guardId }).catch(() => []);
        guard = (rows && rows[0]) || null;
      }
      if (!guard || !guard.email) { failures.push('no_guard_email'); continue; }

      const details = guardShifts.map((s: any) => ({
        label: s.site_name || 'Site',
        value: `${formatSastDateTime(s.start_time)} → ${formatSastTime(s.end_time)}${s.notes ? ' — ' + s.notes : ''}`,
      }));
      const tpl = buildBrandedEmail({
        brand,
        heading: single
          ? 'Shift Schedule'
          : `Your Shift Schedule — ${guardShifts.length} Shift${guardShifts.length > 1 ? 's' : ''}`,
        greeting: `Dear ${guard.display_name || guard.full_name || 'Guard'},`,
        intro: single
          ? 'Here are the details of your upcoming shift.'
          : 'Here is your upcoming shift schedule.',
        details,
        closing: 'Please open the app to review and acknowledge your shifts.',
      });
      const res = await sendAuditedEmail(svc, {
        to: guard.email,
        subject: single
          ? `Shift Schedule — ${formatSastDate(guardShifts[0].start_time)}`
          : `Your Shift Schedule — ${guardShifts.length} Shifts`,
        html: tpl.html,
        text: tpl.text,
        brand,
        customer_id: guardShifts[0].customer_id || callerCid,
        reseller_id: guardShifts[0].reseller_id || null,
        recipient_id: guard.id,
        recipient_name: guard.display_name || guard.full_name,
        event_type: single ? 'shift_schedule_share' : 'shift_schedule_summary',
        reference_id: `${guard.id}:${Date.now()}`,
      });
      if (res.ok) sent++;
      else failures.push(String(res.error));
    }
    return Response.json({ sent, excluded, failures });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}