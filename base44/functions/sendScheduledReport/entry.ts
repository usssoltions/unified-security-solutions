import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { resolveCommunicationBrand, buildBrandedEmail } from '../../shared/brandedCommunication.ts';
import { friendlyLabel } from '../../shared/transactionalEmail.ts';
import { sendAuditedEmail } from '../../shared/auditedEmail.ts';

/**
 * sendScheduledReport — scheduled report generation and distribution.
 *
 * SECURITY (server-enforced):
 *  - The ReportSchedule is RELOADED by id; the caller's authorization is
 *    checked against the schedule's OWN tenant scope (IDOR hardening): a
 *    Customer A caller can never trigger Customer B's schedule; platform
 *    admins retain oversight; reseller admins their own reseller's
 *    customers; everyone else is rejected.
 *  - Tenant scope is resolved from the schedule CREATOR's authoritative User
 *    record — forged customer_id/reseller_id in the request are ignored (the
 *    request carries only schedule_id).
 *  - Report data queries carry authoritative tenant filters at
 *    DATABASE-QUERY level (no platform-wide .list() with in-memory filtering).
 *  - Reporting day boundaries are Africa/Johannesburg (UTC+2, no DST) — not
 *    the UTC day the server runs on.
 *  - Recipients are validated server-side: an address is deliverable only if
 *    it is an approved ExternalRecipient of the report's own tenant, a user
 *    of that tenant, or (platform-created schedule) a platform user.
 *    Arbitrary addresses are skipped and audited.
 *  - Delivery is idempotent per schedule + Johannesburg day + recipient
 *    (a retry never re-sends an already-sent email), every attempt is
 *    audited through the shared auditedEmail helper, and `last_sent_at`
 *    changes ONLY after the required delivery success — failures are
 *    retained for retry.
 *  - WhatsApp is NOT an automated channel: configured WhatsApp recipients
 *    are reported as SKIPPED, never claimed as sent.
 */

// Africa/Johannesburg day bounds: SAST is UTC+2 year-round (no DST).
function jhbDayBounds() {
  const nowShifted = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const ymd = nowShifted.toISOString().slice(0, 10);
  const [y, m, d] = ymd.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - 2 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { ymd, startIso: start.toISOString(), endIso: end.toISOString() };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ONLY schedule_id is read — every tenant/content field in the body is
    // ignored; scope comes from the stored record + its creator.
    const { schedule_id } = await req.json();
    if (!schedule_id) {
      return Response.json({ error: 'schedule_id is required' }, { status: 400 });
    }

    // AUTHORITATIVE RELOAD by id.
    const schedule = await svc.entities.ReportSchedule.get(schedule_id).catch(() => null);
    // CURRENT SCHEMA: ReportSchedule uses is_active (there is no `status` field).
    if (!schedule || schedule.is_active === false) {
      return Response.json({ error: 'Schedule not found or inactive' }, { status: 404 });
    }

    // ── TENANT SCOPE — the schedule CREATOR's authoritative tenant owns this
    // report; it can only ever contain records from that tenant (or the
    // platform-managed legacy pool for a platform creator).
    let scopeCid = null;
    let scopeRid = null;
    try {
      if (schedule.created_by_id) {
        const creatorRows = await svc.entities.User.filter({ id: String(schedule.created_by_id) });
        const creator = (creatorRows && creatorRows[0]) || null;
        scopeCid = creator?.customer_id || null;
        scopeRid = creator?.reseller_id || null;
      }
    } catch (_) { /* unresolvable scope fails CLOSED below */ }

    // ── CALLER AUTHORIZATION (IDOR hardening, server-side) ─────────────────
    const isPlatformAdmin = user.role === 'admin' || user.role_type === 'platform_admin' || user.admin_level === 'platform';
    if (!isPlatformAdmin) {
      const callerAdminLevel = user.admin_level || null;
      const callerIsResellerAdmin = user.role_type === 'reseller_admin' || callerAdminLevel === 'reseller';
      const callerIsTenantAdmin = !!user.customer_id && (
        callerAdminLevel === 'customer' ||
        ['customer_admin', 'practice_admin', 'estate_manager'].includes(user.role_type)
      );
      if (callerIsResellerAdmin) {
        if (!scopeRid || scopeRid !== (user.reseller_id || null)) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      } else if (callerIsTenantAdmin) {
        if (!scopeCid || scopeCid !== user.customer_id) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      } else {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // TENANT BRANDING — customer → reseller → platform default, resolved from
    // the report's OWN tenant scope.
    const brand = await resolveCommunicationBrand(svc, {
      customer_id: scopeCid, reseller_id: scopeRid });

    // ── APPROVED RECIPIENTS (tenant-consistent membership) ─────────────────
    const approvedEmails = new Set();
    if (scopeCid) {
      const exts = await svc.entities.ExternalRecipient.filter({ customer_id: scopeCid }).catch(() => []);
      (exts || []).forEach((e) => {
        if (e.active !== false && e.email_enabled !== false && e.reports_enabled !== false && e.email) {
          approvedEmails.add(String(e.email).toLowerCase());
        }
      });
      // RecipientGroup membership resolves to this tenant's approved
      // ExternalRecipients + tenant users (groups never span tenants).
      const tenantUsers = await svc.entities.User.filter({ customer_id: scopeCid }).catch(() => []);
      (tenantUsers || []).forEach((u) => { if (u.email) approvedEmails.add(String(u.email).toLowerCase()); });
    } else {
      // Platform-created schedule: platform administrators only.
      const allUsers = await svc.entities.User.list().catch(() => []);
      (allUsers || []).forEach((u) => {
        if ((u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform') && u.email) {
          approvedEmails.add(String(u.email).toLowerCase());
        }
      });
    }

    // CURRENT SCHEMA recipient list: schedule.recipients[] ({email, name,
    // type}); legacy records may still carry email_recipients[] strings.
    const requestedEmails = [...new Set([
      ...((schedule.recipients || []).map((r) => (typeof r === 'string' ? r : (r && r.email))).filter(Boolean)),
      ...(Array.isArray(schedule.email_recipients) ? schedule.email_recipients.filter(Boolean) : []),
    ].map((e) => String(e).toLowerCase()))];

    // ── REPORT DATA — tenant filters at DATABASE-QUERY level, Johannesburg
    // day boundaries.
    const bounds = jhbDayBounds();
    const reportData = await generateReportData(svc, scopeCid, bounds.startIso, bounds.endIso);
    // READABLE SUMMARY — counts are computed from the schedule's
    // authoritative tenant at DATABASE-QUERY level (generateReportData).
    // No raw HTML fragments appended as text, no internal enum values:
    // "daily_activity" renders as "Daily Activity Report" through the
    // central renderer's friendlyLabel, and both the HTML and plain-text
    // versions are generated from this one structured content set.
    const completedShifts = (reportData.shifts || []).filter((s) => s.status === 'completed').length;
    const activeShifts = (reportData.shifts || []).filter((s) => s.status === 'active').length;
    const reportDetails = [
      { label: 'Report', value: schedule.name || friendlyLabel(schedule.report_type) },
      { label: 'Date', value: new Date().toLocaleDateString('en-ZA') },
      { label: 'Incidents', value: String(reportData.incidents?.length || 0) },
      { label: 'Shifts', value: String(reportData.shifts?.length || 0) },
      { label: 'Completed Shifts', value: String(completedShifts) },
      { label: 'Active Shifts', value: String(activeShifts) },
      { label: 'Maintenance Requests', value: String(reportData.maintenance?.length || 0) },
      { label: 'Patrol Checkpoints', value: String(reportData.patrols?.length || 0) },
    ];
    const summaryLines = (reportData.incidents || []).slice(0, 5)
      .map((inc) => `Incident: ${inc.title || 'Untitled incident'} (${friendlyLabel(inc.priority)} priority)`);

    const brandTpl = buildBrandedEmail({
      brand,
      heading: schedule.name || friendlyLabel(schedule.report_type),
      intro: 'Your scheduled report is ready.',
      details: reportDetails,
      closing: summaryLines.join('\n'),
    });
    const subject = `${friendlyLabel(schedule.report_type)} — ${new Date().toLocaleDateString('en-ZA')}`;

    // ── DELIVERY — idempotent per schedule + JHB day + recipient ───────────
    const runKey = `scheduled_report:${schedule_id}:${bounds.ymd}`;
    let sentCount = 0;
    let skippedUnapproved = 0;
    let failedCount = 0;
    for (const email of requestedEmails) {
      const idemKey = `${runKey}:email:${email}`;
      // Idempotent retry — an already-sent recipient is never re-sent.
      const prior = await svc.entities.NotificationDelivery
        .filter({ idempotency_key: idemKey, channel: 'email', status: 'sent' }).catch(() => []);
      if (prior && prior.length) { sentCount++; continue; }

      if (!approvedEmails.has(email)) {
        skippedUnapproved++;
        try {
          await svc.entities.NotificationDelivery.create({
            event_key: runKey, event_type: 'scheduled_report',
            reference_id: String(schedule_id), channel: 'email', status: 'skipped',
            customer_id: scopeCid || undefined, reseller_id: scopeRid || undefined,
            recipient_address: email, send_time: new Date().toISOString(),
            skip_reason: 'RECIPIENT_NOT_APPROVED', idempotency_key: idemKey,
          });
        } catch (_) { /* audit write is non-fatal */ }
        continue;
      }

      const res = await sendAuditedEmail(svc, {
        to: email, subject, html: brandTpl.html, text: brandTpl.text,
        from_name: brand.brand_name,
        customer_id: scopeCid, reseller_id: scopeRid,
        recipient_address: email,
        event_type: 'scheduled_report', reference_id: `${schedule_id}:${bounds.ymd}`,
        idempotency_key: idemKey,
      });
      if (res.ok) sentCount++; else failedCount++;
    }

    // WHATSAPP — NOT SUPPORTED for scheduled distribution (no automated
    // WhatsApp channel exists). Configured WhatsApp recipients (legacy
    // records only) are reported as SKIPPED, never claimed as sent.
    const whatsappSkipped = (schedule.whatsapp_recipients || []).length;

    // last_sent_at changes ONLY after the required delivery success. All
    // recipients failing leaves the schedule due for a retry (failures are
    // already audited and retained). A schedule with no configured
    // recipients completes its run trivially.
    if (sentCount > 0 || requestedEmails.length === 0) {
      await svc.entities.ReportSchedule.update(schedule_id, {
        last_sent_at: new Date().toISOString()
      }).catch(() => {});
    }

    return Response.json({
      success: failedCount === 0 && (sentCount > 0 || requestedEmails.length === 0),
      message: failedCount
        ? 'Report completed with delivery failures — retained for retry'
        : 'Report sent successfully',
      email_count: sentCount,
      skipped_unapproved: skippedUnapproved,
      failed: failedCount,
      whatsapp_count: 0,
      whatsapp_skipped: whatsappSkipped,
    });

  } catch (error) {
    console.error('Error sending scheduled report:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function generateReportData(svc, scopeCid, startIso, endIso) {
  const data = {};
  // TENANT SCOPE MATCH at query level: customer scope = only that customer's
  // records; platform scope = only the unscoped legacy pool.
  const tenantQuery = scopeCid ? { customer_id: scopeCid } : { customer_id: null };
  const window = (field) => ({ $gte: startIso, $lt: endIso });

  try {
    data.incidents = await svc.entities.Incident
      .filter({ ...tenantQuery, reported_at: window() }).catch(() => []);
    data.shifts = await svc.entities.Shift
      .filter({ ...tenantQuery, start_time: window() }).catch(() => []);
    data.maintenance = await svc.entities.MaintenanceRequest
      .filter({ ...tenantQuery, reported_at: window() }).catch(() => []);
    data.patrols = await svc.entities.PatrolLog
      .filter({ ...tenantQuery, timestamp: window() }).catch(() => []);
    // Platform pool: unscoped legacy records additionally require NO
    // reseller scope (defense in depth on top of the query filter).
    if (!scopeCid) {
      for (const k of ['incidents', 'shifts', 'maintenance', 'patrols']) {
        data[k] = (data[k] || []).filter((r) => !r.reseller_id);
      }
    }
  } catch (error) {
    console.error('Error fetching report data:', error);
  }

  return data;
}

// formatReportMessage retired — the central transactional renderer now
// renders the structured summary (no emoji soup, no '<br/>' as plain text).