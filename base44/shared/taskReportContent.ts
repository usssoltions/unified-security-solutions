/**
 * Task Scheduling module — notification + report content builders.
 * Shared between scheduledTaskAccess (assignment/reopened/completion
 * notifications + reason-gate report finalisation) and the scheduled sweep
 * (2-hour reminders, deadline Task Completion Report, reason-required).
 * Pure functions: no SDK access, no side effects.
 *
 * UNIFIED BRANDED EMAILS: every Task Scheduling email renders through the ONE
 * shared tenant-branded template (taskEmailTemplate.renderTaskEmail —
 * customer → reseller → platform branding, mobile responsive). Each builder
 * returns { subject, emailBody, emailHtml, telegramText }: emailBody is the
 * plain-text alternative mirror, emailHtml the branded rendering. There are
 * no separate/inconsistent per-type email builders.
 */
import {
  escHtml, statusBadge, infoTable, sectionCard, cardLabel, cardLine,
  summaryCards, renderTaskEmail,
} from './taskEmailTemplate.ts';

export function fmtSast(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch (e) { return String(iso); }
}

const APP_URL = 'https://guard-track-pro-26cedab8.base44.app';
export const MY_TASKS_LINK = APP_URL + '/ScheduledTasks';

function fmtYmd(ymd) {
  if (!ymd) return '—';
  const p = String(ymd).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(ymd);
}

function priorityLabel(p) {
  const v = String(p || 'medium');
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function statusWord(t) {
  if (t.status === 'completed') return t.completed_late ? 'Completed Late' : 'Completed On Time';
  if (t.status === 'cancelled') return 'Cancelled';
  return String(t.status || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusKind(t) {
  if (t.status === 'completed') return t.completed_late ? 'warning' : 'success';
  if (t.status === 'overdue') return 'danger';
  return 'neutral';
}

function taskAccent(t) {
  if (t.status === 'completed') return t.completed_late ? '#f59e0b' : '#16a34a';
  if (t.status === 'overdue') return '#ef4444';
  return '#94a3b8';
}

function assignmentDeadlineStr(task, batch) {
  if (task.due_date) return fmtSast(task.due_date);
  if (batch && batch.deadline_time && batch.scheduled_date) {
    return fmtSast(batch.scheduled_date + 'T' + batch.deadline_time + ':00+02:00');
  }
  return '—';
}

function assignmentWindowStr(task, batch) {
  const start = task.scheduled_time || (batch && batch.active_start_time) || null;
  if (start && batch && batch.deadline_time) return start + ' – ' + batch.deadline_time;
  return start || '—';
}

/* ── Task Completed / Completed Late ─────────────────────────────────────── */

export function completionNotification(task, batch, customerName, brand, brandName) {
  const late = !!task.completed_late;
  const subject = (late ? 'Task Completed Late — ' : 'Task Completed — ') + task.title;
  const emailHtml = renderTaskEmail({
    brand, brandName,
    heading: 'Task Completed',
    badgeHtml: statusBadge(late ? 'COMPLETED LATE' : 'COMPLETED ON TIME', late ? 'warning' : 'success'),
    introHtml: '<p style="color:#334155;font-size:14px;margin:0 0 16px"><b>' + escHtml(task.title) +
      '</b> has been verified with both sign-offs.</p>',
    bodyHtml:
      infoTable([
        ['Task', task.title],
        ['Control Room', task.control_room_name || (batch && batch.control_room_name) || '—'],
        ['Service Area', task.site_name || '—'],
        ['Task List', task.task_batch_title || (batch && batch.title) || '—'],
        ['Assigned To', task.assigned_to_name || '—'],
        ['Deadline', fmtSast(task.due_date)],
      ]) +
      sectionCard(
        cardLabel('Guard / User Sign-off', '#0ea5e9') +
        cardLine('Signed by', task.completed_by_name || '—') +
        cardLine('Time', fmtSast(task.completed_at)) +
        cardLine('Notes', task.completion_notes || '—'),
        '#0ea5e9') +
      sectionCard(
        cardLabel('Control Room Verification', '#16a34a') +
        cardLine('Verified by', task.verified_by_name || '—') +
        cardLine('Time', fmtSast(task.verified_at)) +
        cardLine('Notes', task.verification_notes || '—'),
        '#16a34a') +
      (late ? sectionCard(
        cardLabel('Completed Late', '#d97706') +
        '<p style="margin:0 0 6px;font-size:13px;color:#92400e">This task was verified after its deadline (' +
        escHtml(fmtSast(task.due_date)) + '). The deadline miss is permanently recorded.</p>' +
        cardLine('Late Reason', task.late_reason || '—'),
        '#f59e0b') : ''),
    ctaLabel: 'View Task', ctaUrl: MY_TASKS_LINK,
  });
  const emailBody = [
    'TASK COMPLETED' + (late ? ' (LATE)' : '') + ' — verified with both sign-offs',
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (task.control_room_name || '—'),
    'Task List: ' + (task.task_batch_title || (batch && batch.title) || '—'),
    'Task: ' + task.title,
    'Service area: ' + (task.site_name || '—'),
    'Assigned to: ' + (task.assigned_to_name || '—'),
    '',
    'Guard/User sign-off: ' + (task.completed_by_name || '—') + ' — ' + fmtSast(task.completed_at),
    'Guard/User notes: ' + (task.completion_notes || '—'),
    '',
    'Control Room verification: ' + (task.verified_by_name || '—') + ' — ' + fmtSast(task.verified_at),
    'Verification notes: ' + (task.verification_notes || '—'),
    '',
    'Deadline: ' + fmtSast(task.due_date),
    'Final status: ' + (late ? 'COMPLETED LATE' : 'COMPLETED ON TIME') + ' — ' + fmtSast(task.final_completed_at),
    late ? 'Late reason: ' + (task.late_reason || '—') : '',
  ].filter(Boolean).join('\n');
  const telegramText = (late ? '🕐 *Task Completed Late*\n' : '✅ *Task Completed*\n') + task.title +
    '\nControl Room: ' + (task.control_room_name || '—') +
    '\nAssigned to: ' + (task.assigned_to_name || '—') +
    '\nVerified by: ' + (task.verified_by_name || '—') +
    '\nCompleted: ' + fmtSast(task.final_completed_at) +
    (late ? '\nDeadline missed: ' + fmtSast(task.due_date) : '');
  return { subject, emailBody, emailHtml, telegramText };
}

/* ── 2-hour Outstanding Task Reminder ────────────────────────────────────── */

export function reminderNotification(batch, outstanding, customerName, brand, brandName) {
  const n = outstanding.length;
  let remainingStr = '—';
  try {
    const deadlineMs = Date.parse(batch.scheduled_date + 'T' + batch.deadline_time + ':00+02:00');
    const mins = Math.round((deadlineMs - Date.now()) / 60000);
    if (mins > 0) remainingStr = Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
    else remainingStr = 'Deadline passed';
  } catch (e) {}
  const taskCards = outstanding.map((t) => sectionCard(
    cardLabel(t.title, taskAccent(t)) +
    '<div style="margin:0 0 8px">' + statusBadge(statusWord(t), statusKind(t)) + '</div>' +
    cardLine('Assigned To', t.assigned_to_name || 'Unassigned') +
    cardLine('Due', fmtSast(t.due_date) !== '—' ? fmtSast(t.due_date) : (batch.deadline_time || '—')),
    taskAccent(t))).join('');
  const subject = 'Task Reminder — ' + n + ' Outstanding Task' + (n === 1 ? '' : 's');
  const emailHtml = renderTaskEmail({
    brand, brandName,
    heading: 'Outstanding Task Reminder',
    badgeHtml: statusBadge(n + ' OUTSTANDING TASK' + (n === 1 ? '' : 'S'), 'warning'),
    introHtml: '<p style="color:#334155;font-size:14px;margin:0 0 16px">The following task' + (n === 1 ? ' has' : 's have') +
      ' not yet been completed with both sign-offs.</p>',
    bodyHtml:
      infoTable([
        ['Control Room', batch.control_room_name || '—'],
        ['Task List', batch.title],
        ['Scheduled Date', fmtYmd(batch.scheduled_date)],
        ['Active Window', (batch.active_start_time || '—') + ' – ' + (batch.deadline_time || '—')],
        ['Time Remaining', remainingStr],
        ['Outstanding Count', String(n)],
      ]) +
      taskCards +
      '<p style="color:#64748b;font-size:13px;margin:0 0 16px">Tasks not completed with BOTH sign-offs by the deadline are flagged and included in the Task Completion Report.</p>',
    ctaLabel: 'Open Task Scheduling', ctaUrl: MY_TASKS_LINK,
  });
  const taskLines = outstanding.map((t) =>
    '- ' + t.title + ' [' + statusWord(t) + '] — ' + (t.assigned_to_name || 'unassigned'));
  const emailBody = [
    'OUTSTANDING TASK REMINDER',
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (batch.control_room_name || '—'),
    'Task List: ' + batch.title + ' (' + fmtYmd(batch.scheduled_date) + ')',
    'Active window: ' + (batch.active_start_time || '—') + ' – ' + (batch.deadline_time || '—'),
    'Time remaining: ' + remainingStr,
    '',
    n + ' task(s) still outstanding (no dual sign-off yet):',
    ...taskLines,
    '',
    'Tasks not completed with BOTH sign-offs by the deadline are flagged and included in the Task Completion Report.',
  ].join('\n');
  const telegramText = '⏰ *Task Reminder* — ' + batch.title + ' (' + (batch.control_room_name || '—') + ')\n' +
    n + ' task(s) outstanding:\n' + taskLines.join('\n').slice(0, 3000);
  return { subject, emailBody, emailHtml, telegramText };
}

/* ── Deadline Task Completion Report ────────────────────────────────────── */

export function deadlineReport(batch, tasks, customerName, brand, brandName) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed');
  const cancelled = tasks.filter((t) => t.status === 'cancelled');
  const outstanding = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const overdue = outstanding.filter((t) => t.status === 'overdue');
  const reopened = tasks.filter((t) => t.status === 'reopened');
  const completedLate = completed.filter((t) => t.completed_late);
  const completedOnTime = completed.filter((t) => !t.completed_late);
  const pct = total ? Math.round((completed.length / total) * 100) : 100;

  // CONDITIONAL CONCLUSION — a late completion is NEVER described as on-time
  // success, and outstanding work is never described as successful.
  let conclusion, conclusionKind, conclusionAccent;
  if (outstanding.length) {
    conclusion = 'The reporting period closed with outstanding tasks requiring attention.';
    conclusionKind = 'danger'; conclusionAccent = '#ef4444';
  } else if (completedLate.length) {
    conclusion = 'All scheduled tasks were completed. ' + completedLate.length + ' task' +
      (completedLate.length > 1 ? 's' : '') + ' completed after ' + (completedLate.length > 1 ? 'their' : 'its') + ' deadline.';
    conclusionKind = 'warning'; conclusionAccent = '#f59e0b';
  } else {
    conclusion = 'All scheduled tasks were completed successfully within the required timeframe.';
    conclusionKind = 'success'; conclusionAccent = '#16a34a';
  }

  const taskCards = tasks.map((t) => {
    const done = t.status === 'completed';
    const accent = taskAccent(t);
    let inner = cardLabel(t.title, accent) +
      '<div style="margin:0 0 8px">' + statusBadge(statusWord(t), statusKind(t)) + '</div>' +
      cardLine('Assigned To', t.assigned_to_name || '—');
    if (done) {
      inner += cardLine('Sign-off 1', (t.completed_by_name || '—') + ' — ' + fmtSast(t.completed_at));
      inner += cardLine('Sign-off 2', (t.verified_by_name || '—') + ' — ' + fmtSast(t.verified_at));
    }
    inner += cardLine('Deadline', t.due_date ? fmtSast(t.due_date)
      : fmtSast(batch.scheduled_date + 'T' + (batch.deadline_time || '00:00') + ':00+02:00'));
    if (t.completed_late) inner += cardLine('Late Reason', t.late_reason || '—');
    if (!done && t.status !== 'cancelled') {
      inner += cardLine('Non-Completion Reason', t.non_completion_reason || 'Reason not yet captured');
    }
    return sectionCard(inner, accent);
  }).join('');

  const subject = 'Task Completion Report — ' + batch.title + ' (' + fmtYmd(batch.scheduled_date) + ')';
  const emailHtml = renderTaskEmail({
    brand, brandName,
    heading: 'Task Completion Report',
    introHtml: '<p style="color:#334155;font-size:14px;margin:0 0 16px">Deadline report for <b>' + escHtml(batch.title) + '</b>.</p>',
    bodyHtml:
      infoTable([
        ['Customer', customerName],
        ['Control Room', batch.control_room_name || '—'],
        ['Task List', batch.title],
        ['Period', fmtYmd(batch.scheduled_date) + ' · ' + (batch.active_start_time || '—') + ' – ' + (batch.deadline_time || '—')],
      ]) +
      sectionCard('<p style="margin:0;font-size:14px;font-weight:600;color:#0f172a">' + escHtml(conclusion) + '</p>', conclusionAccent) +
      summaryCards([
        { label: 'Total Tasks', value: total },
        { label: 'Completed On Time', value: completedOnTime.length, color: '#16a34a' },
        { label: 'Completed Late', value: completedLate.length, color: '#d97706' },
        { label: 'Outstanding', value: outstanding.length, color: outstanding.length ? '#ef4444' : '#16a34a' },
        { label: 'Cancelled', value: cancelled.length },
        { label: 'Completion', value: pct + '%', color: '#0ea5e9' },
      ]) +
      taskCards,
    ctaLabel: 'Open Task Scheduling', ctaUrl: MY_TASKS_LINK,
    footerNote: 'Report generated ' + fmtSast(new Date().toISOString()) + ' (SAST)',
  });

  const completedSection = completed.map((t) => [
    '• ' + t.title + (t.completed_late ? ' [COMPLETED LATE — deadline ' + fmtSast(t.due_date) + ']' : ' [COMPLETED ON TIME]'),
    '   Assigned: ' + (t.assigned_to_name || '—') + ' | Completed: ' + fmtSast(t.final_completed_at || t.completed_at),
    '   Guard/User sign-off: ' + (t.completed_by_name || '—'),
    '   Operator sign-off: ' + (t.verified_by_name || '—'),
    '   Verification notes: ' + (t.verification_notes || '—'),
    ...(t.completed_late ? ['   Late reason: ' + (t.late_reason || '—')] : []),
  ].join('\n')).join('\n\n');
  const outstandingSection = outstanding.map((t) => [
    '• ' + t.title + ' [' + statusWord(t) + ']',
    '   Assigned: ' + (t.assigned_to_name || '—') + ' | Due: ' + fmtSast(t.due_date || batch.deadline_time),
    '   Reason for non-completion: ' + (t.non_completion_reason || 'Reason not yet captured'),
    '   Responsible operator: ' + (t.assigned_by_operator_name || (batch.control_room_name || 'Control Room')),
  ].join('\n')).join('\n\n');
  const emailBody = [
    'TASK COMPLETION REPORT',
    'Generated: ' + fmtSast(new Date().toISOString()),
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (batch.control_room_name || '—'),
    'Task List: ' + batch.title,
    'Period: ' + fmtYmd(batch.scheduled_date) + ' (' + (batch.active_start_time || '—') + ' – ' + (batch.deadline_time || '—') + ')',
    '',
    conclusion,
    '',
    'SUMMARY',
    'Total tasks: ' + total,
    'Completed on time: ' + completedOnTime.length,
    'Completed late: ' + completedLate.length,
    'Still incomplete / overdue: ' + outstanding.length,
    'Overdue: ' + overdue.length,
    'Reopened: ' + reopened.length,
    'Cancelled: ' + cancelled.length,
    'Completion percentage: ' + pct + '%',
    '',
    'COMPLETED TASKS',
    completedSection || '(none)',
    '',
    'OUTSTANDING / OVERDUE TASKS',
    outstandingSection || '(none)',
  ].join('\n');

  const telegramText = '📋 *Task Completion Report* — ' + batch.title + '\n' + conclusion +
    '\nTotal: ' + total + ' | On time: ' + completedOnTime.length + ' | Late: ' + completedLate.length +
    ' | Outstanding: ' + outstanding.length + '\nCompletion: ' + pct + '%' +
    '\nPeriod: ' + fmtYmd(batch.scheduled_date);

  return {
    subject, emailBody, emailHtml, telegramText,
    allDone: completed.length === total && total > 0,
    counts: { total, completed: completed.length, outstanding: outstanding.length, overdue: overdue.length, reopened: reopened.length, cancelled: cancelled.length, pct },
  };
}

/* ── Reason Required (deadline reason gate) ─────────────────────────────── */

export function reasonRequiredNotification(batch, tasksNeedingReason, customerName, brand, brandName) {
  const n = tasksNeedingReason.length;
  const taskCards = tasksNeedingReason.map((t) => sectionCard(
    cardLabel(t.title, taskAccent(t)) +
    '<div style="margin:0 0 8px">' + statusBadge(statusWord(t), statusKind(t)) + '</div>' +
    cardLine('Assigned', t.assigned_to_name || 'Unassigned') +
    cardLine('Deadline', t.due_date ? fmtSast(t.due_date) : (batch.deadline_time || '—')),
    taskAccent(t))).join('');
  const subject = 'Action Required — Task Reason Needed — ' + batch.title;
  const emailHtml = renderTaskEmail({
    brand, brandName,
    heading: 'Action Required',
    badgeHtml: statusBadge('ACTION REQUIRED', 'danger'),
    introHtml: '<p style="color:#334155;font-size:14px;margin:0 0 16px">A non-completion / late reason is required before the Task Completion Report can be finalised.</p>',
    bodyHtml:
      sectionCard(
        cardLabel('Action Required', '#ef4444') +
        '<p style="margin:0;font-size:14px;color:#991b1b">' + n + ' task' + (n === 1 ? ' requires' : 's require') +
        ' a non-completion / late reason before the Task Completion Report can be finalised.</p>',
        '#ef4444') +
      infoTable([
        ['Customer', customerName],
        ['Control Room', batch.control_room_name || '—'],
        ['Task List', batch.title + ' (' + fmtYmd(batch.scheduled_date) + ')'],
        ['Deadline', batch.deadline_time || '—'],
      ]) +
      taskCards +
      '<p style="color:#64748b;font-size:13px;margin:0 0 16px">Capture the reason in Task Scheduling (Overdue view → Reason). The Task Completion Report is generated and delivered automatically once all reasons are present.</p>',
    ctaLabel: 'Open Task Scheduling', ctaUrl: MY_TASKS_LINK,
  });
  const lines = tasksNeedingReason.map((t) =>
    '- ' + t.title + ' [' + statusWord(t) + '] — ' + (t.assigned_to_name || 'unassigned'));
  const emailBody = [
    'ACTION REQUIRED — TASK REASON NEEDED',
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (batch.control_room_name || '—'),
    'Task List: ' + batch.title + ' (' + fmtYmd(batch.scheduled_date) + ')',
    'Deadline: ' + (batch.deadline_time || '—') + ' — passed without dual sign-off on the task(s) below.',
    '',
    'The authoritative Task Completion Report CANNOT be finalised until a reason for non-completion is captured for EVERY incomplete task:',
    ...lines,
    '',
    'Capture the reason in Task Scheduling (Overdue view → Reason). The report is generated and delivered automatically once all reasons are present.',
  ].join('\n');
  const telegramText = '⚠️ *Reason Required* — ' + batch.title + ' (' + (batch.control_room_name || '—') + ')\n' +
    n + ' incomplete task(s) need a non-completion reason before the Task Completion Report can be finalised.';
  return { subject, emailBody, emailHtml, telegramText };
}

/* ── Assignment / Reassignment (immediate, multi-channel) ────────────────── */

export function assignmentNotification(task, batch, assignedByName, isReassign) {
  const cr = task.control_room_name || (batch && batch.control_room_name) || '—';
  const site = task.site_name || '—';
  const pri = priorityLabel(task.priority);
  const deadline = assignmentDeadlineStr(task, batch);
  const window = assignmentWindowStr(task, batch);
  const date = fmtYmd(task.scheduled_date);
  const label = isReassign ? 'Task Reassigned' : 'Task Assigned';
  const subject = label + ' — ' + task.title;
  const emailBody = [
    label.toUpperCase(),
    '',
    task.title,
    '',
    'Control Room: ' + cr,
    'Site / service area: ' + site,
    'Task List: ' + (task.task_batch_title || batch?.title || '—'),
    'Priority: ' + pri,
    'Scheduled date: ' + date,
    'Start time / active window: ' + window,
    'Deadline: ' + deadline,
    'Instructions: ' + (task.description || '—'),
    'Assigned by: ' + (assignedByName || '—'),
    '',
    'Open My Tasks to start the task: ' + MY_TASKS_LINK,
  ].join('\n');
  const telegramText = (isReassign ? '🔁 *Task Reassigned*\n' : '📌 *Task Assigned*\n') + task.title +
    '\nControl Room: ' + cr +
    (task.site_name ? '\nSite: ' + site : '') +
    '\nPriority: ' + pri +
    (task.scheduled_date ? '\nScheduled: ' + date : '') +
    ((task.due_date || (batch && batch.deadline_time)) ? '\nDeadline: ' + deadline : '') +
    '\nAssigned by: ' + (assignedByName || '—') +
    '\nOpen My Tasks: ' + MY_TASKS_LINK;
  const inApp = {
    title: label + ' — ' + task.title,
    message: cr + (task.site_name ? ' · ' + site : '') + ' · Priority: ' + pri +
      ' · Deadline: ' + deadline + ' · Assigned by ' + (assignedByName || '—'),
  };
  return { subject, emailBody, telegramText, inApp };
}

/** Branded assignment/reassignment email — same shared template as every
 * other Task Scheduling email (customer → reseller → platform branding). */
export function buildAssignmentEmailHtml(task, batch, brand, brandName, assigneeName, assignedByName, isReassign) {
  const first = String(assigneeName || '').trim().split(/\s+/)[0];
  const pri = priorityLabel(task.priority);
  const priKind = task.priority === 'critical' ? 'danger' : task.priority === 'high' ? 'warning' : 'info';
  const rows = [
    ['Control Room', task.control_room_name || (batch && batch.control_room_name) || '—'],
    ['Site / service area', task.site_name || '—'],
    ['Priority', pri],
    ['Scheduled date', fmtYmd(task.scheduled_date)],
    ['Start time / active window', assignmentWindowStr(task, batch)],
    ['Deadline', assignmentDeadlineStr(task, batch)],
    ['Instructions', task.description || '—'],
    ['Assigned by', assignedByName || '—'],
  ];
  return renderTaskEmail({
    brand, brandName,
    heading: isReassign ? 'Task Reassigned' : 'Task Assigned',
    badgeHtml: statusBadge(pri.toUpperCase() + ' PRIORITY', priKind),
    introHtml: '<p style="color:#334155;font-size:14px;margin:0 0 16px">' + (first ? 'Hi ' + escHtml(first) + ',' : 'Hello,') +
      ' <b>' + escHtml(task.title) + '</b> has been ' + (isReassign ? 'reassigned' : 'assigned') + ' to you' +
      (assignedByName ? ' by ' + escHtml(assignedByName) : '') + '.</p>',
    bodyHtml: infoTable(rows),
    ctaLabel: 'Open My Tasks', ctaUrl: MY_TASKS_LINK,
  });
}

/* ── Reopened task (operator rejected the guard sign-off) ────────────────── */

export function buildReopenedEmailHtml(task, brand, brandName, assigneeName, reopenedByName, reason) {
  const first = String(assigneeName || '').trim().split(/\s+/)[0];
  return renderTaskEmail({
    brand, brandName,
    heading: 'Task Reopened',
    badgeHtml: statusBadge('RETURNED TO YOU', 'danger'),
    introHtml: '<p style="color:#334155;font-size:14px;margin:0 0 16px">' + (first ? 'Hi ' + escHtml(first) + ',' : 'Hello,') +
      ' your completion of <b>' + escHtml(task.title) + '</b> was rejected' +
      (reopenedByName ? ' by ' + escHtml(reopenedByName) : '') +
      ' and the task has been returned to you for rework.</p>',
    bodyHtml:
      sectionCard(
        cardLabel('Rejection Reason', '#ef4444') +
        '<p style="margin:0;font-size:14px;color:#0f172a">' + escHtml(reason) + '</p>',
        '#ef4444') +
      infoTable([
        ['Control Room', task.control_room_name || '—'],
        ['Service Area', task.site_name || '—'],
        ['Deadline', fmtSast(task.due_date)],
      ]),
    ctaLabel: 'Open My Tasks', ctaUrl: MY_TASKS_LINK,
  });
}