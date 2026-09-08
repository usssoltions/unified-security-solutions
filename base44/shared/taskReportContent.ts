/**
 * Task Scheduling module — notification + report content builders.
 * Shared between scheduledTaskAccess (completion notification) and the
 * scheduled sweep (2-hour reminders, deadline Task Completion Report).
 * Pure functions: no SDK access, no side effects.
 */

export function fmtSast(iso) {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Johannesburg', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch (e) { return String(iso); }
}

export function completionNotification(task, batch, customerName) {
  const lateLine = task.completed_late
    ? '⚠ This task was verified AFTER its deadline (' + fmtSast(task.due_date) + ') — recorded as COMPLETED LATE. Late reason: ' + (task.late_reason || '—')
    : '';
  const subject = 'Task Completed' + (task.completed_late ? ' (Late)' : '') + ' — ' + task.title + ' (' + (task.control_room_name || 'Control Room') + ')';
  const emailBody = [
    'TASK COMPLETED (verified with both sign-offs)',
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (task.control_room_name || '—'),
    'Task List: ' + (task.task_batch_title || batch?.title || '—'),
    'Task: ' + task.title,
    'Instructions: ' + (task.description || '—'),
    'Site / service area: ' + (task.site_name || '—'),
    '',
    'Assigned to: ' + (task.assigned_to_name || '—'),
    'Guard/User completion time: ' + fmtSast(task.completed_at),
    'Guard/User notes: ' + (task.completion_notes || '—'),
    'Guard/User sign-off: ' + (task.completed_by_name || '—') + ' (digital signature captured ' + fmtSast(task.completed_at) + ')',
    '',
    'Verified by Control Room Operator: ' + (task.verified_by_name || '—'),
    'Operator verification notes: ' + (task.verification_notes || '—'),
    'Operator sign-off: ' + (task.verified_by_name || '—') + ' (digital signature captured ' + fmtSast(task.verified_at) + ')',
    '',
    'Final status: COMPLETED' + (task.completed_late ? ' (LATE — deadline ' + fmtSast(task.due_date) + ')' : '') + ' — ' + fmtSast(task.final_completed_at),
    lateLine,
  ].filter(Boolean).join('\n');
  const telegramText = '✅ *Task Completed*\n' + task.title + '\nControl Room: ' + (task.control_room_name || '—') +
    '\nAssigned to: ' + (task.assigned_to_name || '—') +
    '\nVerified by: ' + (task.verified_by_name || '—') +
    '\nCompleted: ' + fmtSast(task.final_completed_at);
  return { subject, emailBody, telegramText };
}

export function reminderNotification(batch, outstanding, customerName) {
  const subject = 'Outstanding Task Reminder (' + outstanding.length + ') — ' + batch.title;
  const taskLines = outstanding.map((t) =>
    '- ' + t.title + ' [' + t.status + '] — ' + (t.assigned_to_name || 'unassigned') +
    (t.site_name ? ' @ ' + t.site_name : ''));
  const emailBody = [
    'TASK SCHEDULING — 2-HOUR REMINDER',
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (batch.control_room_name || '—'),
    'Task List: ' + batch.title + ' (' + batch.scheduled_date + ')',
    'Active window: ' + (batch.active_start_time || '—') + ' – ' + (batch.deadline_time || '—'),
    '',
    outstanding.length + ' task(s) still outstanding (no dual sign-off yet):',
    ...taskLines,
    '',
    'Tasks not completed with BOTH sign-offs by the deadline are flagged and included in the Task Completion Report.',
  ].join('\n');
  const telegramText = '⏰ *Task Reminder* — ' + batch.title + ' (' + (batch.control_room_name || '—') + ')\n' +
    outstanding.length + ' task(s) outstanding:\n' + taskLines.join('\n').slice(0, 3000);
  return { subject, emailBody, telegramText };
}

export function deadlineReport(batch, tasks, customerName) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed');
  const cancelled = tasks.filter((t) => t.status === 'cancelled');
  const outstanding = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
  const overdue = outstanding.filter((t) => t.status === 'overdue');
  const reopened = tasks.filter((t) => t.status === 'reopened');
  const completedLate = completed.filter((t) => t.completed_late);
  const completedOnTime = completed.filter((t) => !t.completed_late);
  const pct = total ? Math.round((completed.length / total) * 100) : 100;

  const completedSection = completed.map((t) => [
    '• ' + t.title + (t.completed_late ? ' [COMPLETED LATE — deadline ' + fmtSast(t.due_date) + ']' : ' [COMPLETED ON TIME]'),
    '   Assigned: ' + (t.assigned_to_name || '—') + ' | Completed: ' + fmtSast(t.final_completed_at || t.completed_at),
    '   Guard/User notes: ' + (t.completion_notes || '—'),
    '   Guard/User sign-off: ' + (t.completed_by_name || '—'),
    '   Operator: ' + (t.verified_by_name || '—') + ' | Operator sign-off captured',
    '   Verification notes: ' + (t.verification_notes || '—'),
    ...(t.completed_late ? ['   Late reason: ' + (t.late_reason || '—')] : []),
  ].join('\n')).join('\n\n');

  const outstandingSection = outstanding.map((t) => [
    '• ' + t.title + ' [' + t.status + ']',
    '   Assigned: ' + (t.assigned_to_name || '—') + ' | Due: ' + fmtSast(t.due_date || batch.deadline_time),
    '   Reason for non-completion: ' + (t.non_completion_reason || 'Reason not yet captured'),
    '   Latest status: ' + t.status + ' | Last reminder: ' + fmtSast(batch.last_reminder_at),
    '   Responsible operator: ' + (t.assigned_by_operator_name || (batch.control_room_name || 'Control Room')),
    '   Verification notes: ' + (t.verification_notes || '—'),
  ].join('\n')).join('\n\n');

  const allDone = completed.length === total;
  const emailBody = [
    'TASK COMPLETION REPORT',
    'Generated: ' + fmtSast(new Date().toISOString()),
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (batch.control_room_name || '—'),
    'Task List: ' + batch.title,
    'Period: ' + batch.scheduled_date + ' (' + (batch.active_start_time || '—') + ' – ' + (batch.deadline_time || '—') + ')',
    '',
    allDone ? 'ALL SCHEDULED TASKS FOR THIS CONTROL ROOM AND PERIOD WERE COMPLETED SUCCESSFULLY.' : '',
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
  ].filter((l) => l !== '').join('\n');

  const telegramText = (allDone
    ? '✅ *Task Completion Report* — ' + batch.title + '\nALL SCHEDULED TASKS FOR THIS CONTROL ROOM AND PERIOD WERE COMPLETED SUCCESSFULLY.'
    : '📋 *Task Completion Report* — ' + batch.title + ' (' + (batch.control_room_name || '—') + ')\n' +
      'Total: ' + total + ' | Completed: ' + completed.length + ' | Outstanding: ' + outstanding.length +
      ' | Overdue: ' + overdue.length + '\nCompletion: ' + pct + '%') +
    '\nPeriod: ' + batch.scheduled_date;

  const subject = 'Task Completion Report — ' + batch.title + ' — ' + batch.scheduled_date +
    (allDone ? ' (ALL COMPLETED)' : '');
  return {
    subject, emailBody, telegramText, allDone,
    counts: { total, completed: completed.length, outstanding: outstanding.length, overdue: overdue.length, reopened: reopened.length, cancelled: cancelled.length, pct },
  };
}

/* ── Assignment notification (immediate, multi-channel) ─────────────────── */

const APP_URL = 'https://guard-track-pro-26cedab8.base44.app';
export const MY_TASKS_LINK = APP_URL + '/ScheduledTasks';

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

function fmtYmd(ymd) {
  if (!ymd) return '—';
  const p = String(ymd).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(ymd);
}

function priorityLabel(p) {
  const v = String(p || 'medium');
  return v.charAt(0).toUpperCase() + v.slice(1);
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

export function assignmentNotification(task, batch, assignedByName) {
  const cr = task.control_room_name || (batch && batch.control_room_name) || '—';
  const site = task.site_name || '—';
  const pri = priorityLabel(task.priority);
  const deadline = assignmentDeadlineStr(task, batch);
  const window = assignmentWindowStr(task, batch);
  const date = fmtYmd(task.scheduled_date);
  const subject = 'Task Assigned — ' + task.title + ' (' + cr + ')';
  const emailBody = [
    'TASK ASSIGNED',
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
  const telegramText = '📌 *Task Assigned*\n' + task.title +
    '\nControl Room: ' + cr +
    (task.site_name ? '\nSite: ' + site : '') +
    '\nPriority: ' + pri +
    (task.scheduled_date ? '\nScheduled: ' + date : '') +
    ((task.due_date || (batch && batch.deadline_time)) ? '\nDeadline: ' + deadline : '') +
    '\nAssigned by: ' + (assignedByName || '—') +
    '\nOpen My Tasks: ' + MY_TASKS_LINK;
  const inApp = {
    title: 'Task Assigned — ' + task.title,
    message: cr + (task.site_name ? ' · ' + site : '') + ' · Priority: ' + pri +
      ' · Deadline: ' + deadline + ' · Assigned by ' + (assignedByName || '—'),
  };
  return { subject, emailBody, telegramText, inApp };
}

/** Tenant-branded assignment email (customer → reseller → platform default). */
export function buildAssignmentEmailHtml(task, batch, brand, brandName, assigneeName, assignedByName) {
  const primary = (brand && brand.primary_color) || '#0ea5e9';
  const first = String(assigneeName || '').trim().split(/\s+/)[0];
  const rows = [
    ['Control Room', task.control_room_name || (batch && batch.control_room_name) || '—'],
    ['Site / service area', task.site_name || '—'],
    ['Priority', priorityLabel(task.priority)],
    ['Scheduled date', fmtYmd(task.scheduled_date)],
    ['Start time / active window', assignmentWindowStr(task, batch)],
    ['Deadline', assignmentDeadlineStr(task, batch)],
    ['Instructions', task.description || '—'],
    ['Assigned by', assignedByName || '—'],
  ].map((kv) =>
    '<tr><td style="padding:6px 14px;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">' + escHtml(kv[0]) +
    '</td><td style="padding:6px 14px;color:#0f172a;font-size:13px;font-weight:600">' + escHtml(kv[1]) + '</td></tr>'
  ).join('');
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden">' +
    ((brand && brand.logo_url)
      ? '<div style="padding:20px;text-align:center;background:#f8fafc"><img src="' + escHtml(brand.logo_url) + '" alt="' + escHtml(brandName) + '" style="max-height:56px;max-width:180px;object-fit:contain"/></div>'
      : '') +
    '<div style="padding:24px 28px">' +
    '<h2 style="color:' + escHtml(primary) + ';margin:0 0 12px">Task Assigned</h2>' +
    '<p style="color:#334155;margin:0 0 8px">' + (first ? 'Hi ' + escHtml(first) + ',' : 'Hello,') + '</p>' +
    '<p style="color:#334155;margin:0 0 12px"><b>' + escHtml(task.title) + '</b> has been assigned to you' +
    (assignedByName ? ' by ' + escHtml(assignedByName) : '') + '.</p>' +
    '<table style="border-collapse:collapse;margin:0 0 18px">' + rows + '</table>' +
    '<a href="' + MY_TASKS_LINK + '" style="background:' + escHtml(primary) + ';color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">Open My Tasks</a>' +
    '</div>' +
    '<div style="padding:14px 28px;background:#f8fafc;color:#94a3b8;font-size:11px">' +
    ((brand && brand.support_email) ? 'Questions? Contact ' + escHtml(brand.support_email) + '.' : '') +
    '</div></div>';
}

export function reasonRequiredNotification(batch, tasksNeedingReason, customerName) {
  const lines = tasksNeedingReason.map((t) =>
    '- ' + t.title + ' [' + t.status + '] — ' + (t.assigned_to_name || 'unassigned'));
  const subject = 'Action Required — Non-Completion Reasons (' + tasksNeedingReason.length + ') — ' + batch.title;
  const emailBody = [
    'TASK SCHEDULING — REASON REQUIRED BEFORE REPORT',
    '',
    'Customer: ' + customerName,
    'Control Room: ' + (batch.control_room_name || '—'),
    'Task List: ' + batch.title + ' (' + batch.scheduled_date + ')',
    'Deadline: ' + (batch.deadline_time || '—') + ' — passed without dual sign-off on the task(s) below.',
    '',
    'The authoritative Task Completion Report CANNOT be finalised until a reason for non-completion is captured for EVERY incomplete task:',
    ...lines,
    '',
    'Capture the reason in the Task Scheduling screen (Overdue view → Reason). The Task Completion Report is generated and delivered automatically once all reasons are present.',
  ].join('\n');
  const telegramText = '⚠️ *Reason Required* — ' + batch.title + ' (' + (batch.control_room_name || '—') + ')\n' +
    tasksNeedingReason.length + ' incomplete task(s) need a non-completion reason before the Task Completion Report can be finalised.';
  return { subject, emailBody, telegramText };
}