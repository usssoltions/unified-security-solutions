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
  const subject = 'Task Completed — ' + task.title + ' (' + (task.control_room_name || 'Control Room') + ')';
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
    'Final status: COMPLETED — ' + fmtSast(task.final_completed_at),
  ].join('\n');
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
  const pct = total ? Math.round((completed.length / total) * 100) : 100;

  const completedSection = completed.map((t) => [
    '• ' + t.title,
    '   Assigned: ' + (t.assigned_to_name || '—') + ' | Completed: ' + fmtSast(t.final_completed_at || t.completed_at),
    '   Guard/User notes: ' + (t.completion_notes || '—'),
    '   Guard/User sign-off: ' + (t.completed_by_name || '—'),
    '   Operator: ' + (t.verified_by_name || '—') + ' | Operator sign-off captured',
    '   Verification notes: ' + (t.verification_notes || '—'),
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
    'Completed: ' + completed.length,
    'Outstanding: ' + outstanding.length,
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