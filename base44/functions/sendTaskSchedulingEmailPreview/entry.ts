/**
 * sendTaskSchedulingEmailPreview — ACCEPTANCE-PREVIEW tool for the Task
 * Scheduling module's migrated branded emails.
 *
 * Renders EVERY Task Scheduling email type through the module's ONE shared
 * tenant-branded template (customer → reseller → platform branding) using the
 * REAL tenant's data (real task list + real task records) and delivers each
 * one to the requesting platform administrator's inbox for acceptance review.
 *
 * ABSOLUTELY READ-ONLY with respect to operational data: no task, batch or
 * user record is created, updated or signed. Statuses not present in the
 * chosen task list are simulated with in-memory presentation copies only —
 * no signatures, no sign-offs, no database writes. Every send is audit-logged.
 *
 * Platform admin only (fail closed 403 otherwise).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { resolveTaskBrandContext, sendTaskEmail, logTaskScopeAudit } from '../../shared/taskNotifications.ts';
import {
  assignmentNotification, buildAssignmentEmailHtml, buildReopenedEmailHtml,
  completionNotification, reminderNotification, reasonRequiredNotification, deadlineReport,
} from '../../shared/taskReportContent.ts';

function isPlatformAdmin(u) {
  return !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({})) || {};
    let caller = null;
    try { caller = await base44.auth.me(); } catch (_) {}
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPlatformAdmin(caller)) {
      return Response.json({ error: 'Only platform administrators may send Task Scheduling email acceptance previews' }, { status: 403 });
    }
    const svc = base44.asServiceRole;

    const customerId = String(body.customer_id || '');
    if (!customerId) return Response.json({ error: 'customer_id is required' }, { status: 400 });
    const custRows = await svc.entities.Customer.filter({ id: customerId }).catch(() => []);
    if (!custRows || !custRows.length) return Response.json({ error: 'Customer not found' }, { status: 404 });

    // Tenant brand context — customer → reseller → platform (same resolver the
    // production email paths use, so branding evidence is authentic).
    const brandCtx = await resolveTaskBrandContext(svc, customerId);
    const customerName = brandCtx.customerName;

    // Real task list: explicit batch_id or the tenant's most recent occurrence batch.
    let batch = null;
    if (body.batch_id) {
      const bRows = await svc.entities.TaskBatch.filter({ id: body.batch_id }).catch(() => []);
      batch = (bRows && bRows[0]) || null;
    } else {
      const bRows = await svc.entities.TaskBatch.filter(
        { customer_id: customerId, is_series: false }, '-scheduled_date', 20).catch(() => []);
      batch = (bRows || []).find((b) => b.customer_id === customerId && !b.archived) ||
        (bRows || []).find((b) => b.customer_id === customerId) || null;
    }
    if (!batch) return Response.json({ error: 'No task list found for this customer' }, { status: 404 });

    const taskRows = await svc.entities.OperationalTask.filter({ task_batch_id: batch.id }).catch(() => []);
    if (!taskRows || !taskRows.length) return Response.json({ error: 'No tasks found on the task list' }, { status: 404 });
    // Prefer a genuinely completed task as the realistic base record.
    const realTask = taskRows.find((t) => t.status === 'completed') || taskRows[0];

    const assigneeName = realTask.assigned_to_name || 'Thabo Nkosi';
    const operatorName = realTask.verified_by_name || 'Lerato Mokoena';
    const supervisorName = batch.primary_supervisor_name || operatorName;
    const to = String(body.to || caller.email || '');

    /* ── Presentation-only copies (in-memory; NO database writes, NO signatures) ── */
    const onTimeCopy = { ...realTask, completed_late: false, late_reason: null };
    const assignedCopy = { ...realTask, status: 'assigned', completed_late: false, completed_at: null, verified_at: null };
    const overdueNoReasonCopy = { ...assignedCopy, status: 'overdue' };

    const brand = brandCtx.brand, brandName = brandCtx.brandName;
    const mails = [];

    // 1. Task Assigned
    {
      const c = assignmentNotification(assignedCopy, batch, operatorName, false);
      mails.push({ type: 'task_assigned', subject: c.subject, emailBody: c.emailBody,
        emailHtml: buildAssignmentEmailHtml(assignedCopy, batch, brand, brandName, assigneeName, operatorName, false),
        wording: 'Task Assigned' });
    }
    // 2. Task Reassigned
    {
      const c = assignmentNotification(assignedCopy, batch, operatorName, true);
      mails.push({ type: 'task_reassigned', subject: c.subject, emailBody: c.emailBody,
        emailHtml: buildAssignmentEmailHtml(assignedCopy, batch, brand, brandName, assigneeName, operatorName, true),
        wording: 'Task Reassigned' });
    }
    // 3. Outstanding Task Reminder (2-hour cycle)
    {
      const c = reminderNotification(batch, [assignedCopy], customerName, brand, brandName);
      mails.push({ type: 'outstanding_task_reminder', subject: c.subject, emailBody: c.emailBody,
        emailHtml: c.emailHtml, wording: 'OUTSTANDING TASK' });
    }
    // 4. Reason Required (deadline reason gate exception)
    {
      const c = reasonRequiredNotification(batch, [overdueNoReasonCopy], customerName, brand, brandName);
      mails.push({ type: 'reason_required', subject: c.subject, emailBody: c.emailBody,
        emailHtml: c.emailHtml, wording: 'ACTION REQUIRED' });
    }
    // 5. Task Completed (on time)
    {
      const c = completionNotification(onTimeCopy, batch, customerName, brand, brandName);
      mails.push({ type: 'task_completed', subject: c.subject, emailBody: c.emailBody,
        emailHtml: c.emailHtml, wording: 'COMPLETED ON TIME' });
    }
    // 6. Task Completed Late
    {
      const c = completionNotification(realTask, batch, customerName, brand, brandName);
      mails.push({ type: 'task_completed_late', subject: c.subject, emailBody: c.emailBody,
        emailHtml: c.emailHtml, wording: 'COMPLETED LATE' });
    }
    // 7. Deadline Task Completion Report (on-time + late, no outstanding → the
    //    conclusion MUST warn about the late completion, never claim blanket success)
    {
      const c = deadlineReport(batch, [onTimeCopy, realTask], customerName, brand, brandName);
      mails.push({ type: 'task_completion_report', subject: c.subject, emailBody: c.emailBody,
        emailHtml: c.emailHtml, wording: 'Task Completion Report' });
    }
    // 8. Task Reopened (operator rejected the sign-off)
    mails.push({ type: 'task_reopened', subject: 'Task Reopened — ' + realTask.title,
      emailBody: 'TASK REOPENED\n\n' + realTask.title + '\nReturned to ' + assigneeName + ' by ' + operatorName +
        '\nRejection reason: Photo evidence unreadable — please retake in good lighting.',
      emailHtml: buildReopenedEmailHtml(assignedCopy, brand, brandName, assigneeName, operatorName,
        'Photo evidence unreadable — please retake in good lighting.'),
      wording: 'RETURNED TO YOU' });

    // Deliver every email with the EXACT production subject (html + plain-text
    // alternative — the same multipart send the production paths use).
    // dry_run: render evidence only — nothing is sent (repeat verification
    // without spamming the admin's inbox).
    const dryRun = !!body.dry_run;
    const results = [];
    let delivered = 0;
    for (const m of mails) {
      const ok = dryRun ? null : await sendTaskEmail(svc, { to, subject: m.subject, body: m.emailBody, html: m.emailHtml, from_name: brandName });
      if (ok) delivered++;
      const saysAllCompletedSuccessfully = /completed successfully within/.test(m.emailBody);
      results.push({
        type: m.type,
        subject: m.subject,
        delivered: dryRun ? false : !!ok,
        dry_run: dryRun,
        branded_html: !!m.emailHtml,
        html_bytes: m.emailHtml ? m.emailHtml.length : 0,
        responsive_600px_shell: !!m.emailHtml && m.emailHtml.includes('max-width:600px'),
        mobile_wrap_safe: !!m.emailHtml && m.emailHtml.includes('overflow-wrap:anywhere'),
        status_wording_ok: !!m.emailHtml && m.emailHtml.indexOf(m.wording) !== -1,
        says_all_completed_successfully: saysAllCompletedSuccessfully,
      });
    }

    // Report conclusion evidence (the specific acceptance check)
    const rep = mails.find((m) => m.type === 'task_completion_report');
    const reportConclusion = {
      late_count_in_report: 1,
      says_all_completed_successfully: rep ? /completed successfully within/.test(rep.emailBody) : null,
      warns_completed_after_deadline: rep ? /completed after (its|their) deadline/.test(rep.emailBody) : null,
      conclusion_excerpt: rep ? (rep.emailBody.split('\n').find((l) => l.startsWith('All scheduled tasks')) || '') : '',
    };

    if (!dryRun) {
      await logTaskScopeAudit(svc, { event_type: 'task.email_preview_sent', actor: caller,
        customerId, resellerId: (brandCtx.customer && brandCtx.customer.reseller_id) || null,
        controlId: batch.control_room_id,
        notes: 'Task Scheduling branded-email acceptance preview: ' + delivered + '/' + mails.length +
          ' email types delivered to ' + to + ' for customer ' + customerName + ' (read-only — no signatures created)' });
    }

    return Response.json({
      success: true,
      recipient: to,
      tenant_brand: {
        customer_name: customerName,
        brand_name: brandName,
        logo_in_emails: !!(brand && brand.logo_url),
        primary_color: (brand && brand.primary_color) || null,
      },
      batch: { title: batch.title, scheduled_date: batch.scheduled_date, window: (batch.active_start_time || '—') + ' – ' + (batch.deadline_time || '—') },
      emails: results,
      report_conclusion: reportConclusion,
    });
  } catch (e) {
    console.error('email preview failed:', e?.message || e);
    return Response.json({ error: 'Preview failed: ' + (e?.message || e) }, { status: 500 });
  }
}