/**
 * showcaseTemplates — Report & Notification Showcase template engine.
 *
 * INERT BY DESIGN: every builder here RENDERS example content from a
 * customer's demo-seeded records using the platform's REAL shared template
 * builders (the same builders the live dispatch paths use). Nothing here
 * sends, mutates operational records, completes tasks, activates schedules,
 * triggers gate actions or invokes escalation workflows. Delivery is done
 * exclusively by the reportShowcase gateway as an explicit platform-admin
 * action, to recipients validated against that customer's ShowcaseConfig.
 *
 * Every example carries the DEMONSTRATION — NO ACTION REQUIRED label and a
 * 'DEMO |' subject prefix.
 */
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram, formatSastDate, formatSastTime, escHtml } from './brandedCommunication.ts';
import { buildTransactionalEmail, renderTransactionalShell } from './transactionalEmail.ts';
import { buildPanicEmailAsyncFull } from './panicEmailTemplate.ts';
import {
  computeReportingPeriod, makeZonedFormatters,
  buildDailyAccessModel, renderDailyAccessEmailBody,
} from './dailyAccessReport.ts';
import {
  deadlineReport, newTaskListNotification,
} from './taskReportContent.ts';
import { DEFAULT_DEPLOYMENT_URL, appUrlFor } from './appUrl.ts';
import { buildStartOfShiftReportEmail, haversineMetres } from './startOfShiftReport.ts';
import { escalationEmailHtml } from './obCore.ts';

const CTA = (path: string) => appUrlFor(DEFAULT_DEPLOYMENT_URL, path);

export const DEMO_LABEL = 'DEMONSTRATION — NO ACTION REQUIRED';
export const DEMO_FOOTER =
  'DEMONSTRATION — NO ACTION REQUIRED. Rendered from simulated demo data in a seeded demonstration environment. Not a live operational notification.';

export interface ShowcaseTemplateSpec {
  template_id: string;
  label: string;
  module: string;
  channel: string;
  scenario: string;
  needs: string[];
}

export const SHOWCASE_TEMPLATE_CATALOG: ShowcaseTemplateSpec[] = [
  { template_id: 'incident_reported', label: 'Incident Reported — Administrator Alert', module: 'OPERATIONS', channel: 'email', scenario: 'A guard reports an incident; tenant administrators are alerted.', needs: ['Incident'] },
  { template_id: 'incident_critical_escalation', label: 'Critical Incident Escalation', module: 'OPERATIONS', channel: 'email', scenario: 'A critical incident is escalated to oversight after the response window.', needs: ['Incident'] },
  { template_id: 'maintenance_reported', label: 'Maintenance Reported — Administrator Alert', module: 'OPERATIONS', channel: 'email', scenario: 'A guard logs a maintenance fault; administrators are alerted.', needs: ['MaintenanceRequest'] },
  { template_id: 'maintenance_completed', label: 'Maintenance Completed — Closure Notice', module: 'OPERATIONS', channel: 'email', scenario: 'An assigned maintenance request is completed and closed out.', needs: ['MaintenanceRequest'] },
  { template_id: 'panic_alert', label: 'Panic Alert — Emergency Email', module: 'COMPLETE_SECURITY', channel: 'email', scenario: 'A panic activation and its full lifecycle (resolved drill).', needs: ['PanicAlert'] },
  { template_id: 'alarm_dispatch', label: 'Alarm Dispatch — Response Instruction', module: 'OPERATIONS', channel: 'email', scenario: 'A control-room alarm dispatch with response instructions.', needs: ['AlarmResponse'] },
  { template_id: 'shift_schedule_summary', label: 'Shift Schedule Summary', module: 'OPERATIONS', channel: 'email', scenario: 'Scheduled shifts for the coming days, sent to guards.', needs: ['Shift'] },
  { template_id: 'shift_handover', label: 'Shift Handover Notice', module: 'OPERATIONS', channel: 'email', scenario: 'End-of-shift handover summary delivered to the incoming guard.', needs: ['ShiftHandover', 'Shift'] },
  { template_id: 'start_of_shift_report', label: 'Start of Shift Report', module: 'OPERATIONS', channel: 'email', scenario: 'The Start of Shift report for the officer: shift & clock-in, post details, observations, geofence, evidence and signature.', needs: ['ShiftHandover', 'Shift', 'Site'] },
  { template_id: 'task_deadline_report', label: 'Task Completion (Deadline) Report', module: 'TASK_SCHEDULING', channel: 'email', scenario: 'The authoritative deadline report for a scheduled task batch.', needs: ['TaskBatch', 'OperationalTask'] },
  { template_id: 'task_list_telegram', label: 'New Task List — Telegram', module: 'TASK_SCHEDULING', channel: 'telegram', scenario: 'The Telegram message announcing a new task list.', needs: ['TaskBatch'] },
  { template_id: 'ob_overdue_escalation', label: 'OB Check Overdue Escalation', module: 'TASK_SCHEDULING', channel: 'email', scenario: 'A Digital Occurrence Book check past due, escalated to supervisors.', needs: ['OBOccurrence'] },
  { template_id: 'daily_access_report', label: 'Daily Access Control Report', module: 'ACCESS', channel: 'email', scenario: 'The branded daily access report (entries, exits, denials) for one site.', needs: ['AccessLog', 'Site'] },
  { template_id: 'visitor_registration', label: 'Visitor Registration Notice', module: 'ESTATE', channel: 'email', scenario: 'A resident-linked visitor registration notification.', needs: ['Visitor'] },
  { template_id: 'laundry_request', label: 'Laundry Request — Administrator Alert', module: 'ESTATE', channel: 'email', scenario: 'A resident laundry request is submitted to administrators.', needs: ['LaundryRequest'] },
  // ── REAL REPORT EXPORTS (actual downloadable attachments) ────────────────
  { template_id: 'hospitality_visits_report', label: 'Hospitality Visits Report (GRID GATE) — PDF', module: 'ACCESS', channel: 'email', scenario: 'The branded downloadable Hospitality Visits PDF (primary + secondary logos, GRID GATE branding) built from demo visits.', needs: ['HospitalityVisit', 'AccessLog'] },
  { template_id: 'daily_activity_report', label: 'Daily Activity Report — PDF', module: 'OPERATIONS', channel: 'email', scenario: 'The downloadable daily activity PDF (incidents, maintenance, patrols, shifts) built from the busiest demo day.', needs: ['Incident', 'MaintenanceRequest', 'PatrolLog', 'Shift'] },
  { template_id: 'monthly_incident_report', label: 'Monthly Incident Analysis Report — PDF', module: 'REPORTING_CORE', channel: 'email', scenario: 'The downloadable monthly incident analysis PDF built from demo incidents.', needs: ['Incident'] },
  { template_id: 'monthly_maintenance_report', label: 'Monthly Maintenance Analysis Report — PDF', module: 'REPORTING_CORE', channel: 'email', scenario: 'The downloadable monthly maintenance analysis PDF built from demo maintenance requests.', needs: ['MaintenanceRequest'] },
];

const DEMO = { subjectPrefix: 'DEMO | ' };

function first(recs: any[], pred?: (r: any) => boolean): any {
  const list = recs || [];
  if (pred) { const m = list.find(pred); if (m) return m; }
  return list[0] || null;
}

function detail(label: string, value: any) {
  return value == null || value === '' ? null : { label, value };
}

/** Locates one representative demo record per template. */
function pickExample(template_id: string, records: Record<string, any[]>) {
  switch (template_id) {
    case 'incident_reported':
      return { primary: first(records.Incident || []) };
    case 'incident_critical_escalation':
      return { primary: first(records.Incident || [], (r) => r.priority === 'critical') || first(records.Incident || []) };
    case 'maintenance_reported':
      return { primary: first(records.MaintenanceRequest || [], (r) => r.status !== 'completed') || first(records.MaintenanceRequest || []) };
    case 'maintenance_completed':
      return { primary: first(records.MaintenanceRequest || [], (r) => r.status === 'completed') || first(records.MaintenanceRequest || []) };
    case 'panic_alert':
      return { primary: first(records.PanicAlert || []) };
    case 'alarm_dispatch':
      return { primary: first(records.AlarmResponse || []) };
    case 'shift_schedule_summary':
      return { primary: first(records.Shift || []) };
    case 'shift_handover':
      return { primary: first(records.ShiftHandover || [], (r: any) => r.outgoing_guard_signature && r.special_instructions) || first(records.ShiftHandover || []) };
    case 'start_of_shift_report':
      return { primary: first(records.ShiftHandover || [], (r: any) => r.outgoing_guard_signature && r.special_instructions) || null };
    case 'visitor_registration':
      return { primary: first(records.Visitor || []) };
    case 'task_deadline_report':
      return { primary: first(records.TaskBatch || []), tasks: records.OperationalTask || [] };
    case 'task_list_telegram':
      return { primary: first(records.TaskBatch || []) };
    case 'ob_overdue_escalation':
      return { primary: first(records.OBOccurrence || []) };
    case 'daily_access_report':
      return { primary: first(records.Site || []), logs: records.AccessLog || [] };
    case 'laundry_request':
      return { primary: first(records.LaundryRequest || []) };
    default:
      return {};
  }
}

/** Renders ONE inert example for a template. Returns null when no suitable demo data exists. */
export async function buildTemplateExample(
  svc: any,
  t: ShowcaseTemplateSpec,
  ctx: { customer_id: string; customerName: string; brand: any; records: Record<string, any[]> },
): Promise<{ subject: string; html: string; text: string; demo_record_ids: string[]; attachments?: any[] } | null> {
  const picked = pickExample(t.template_id, ctx.records);
  const p = picked.primary;
  const brand = ctx.brand;
  const records = ctx.records;
  const ids = p?.id ? [p.id] : [];

  switch (t.template_id) {
    case 'incident_reported': {
      if (!p) return null;
      const loc = p.location && Number.isFinite(Number(p.location.lat)) && Number.isFinite(Number(p.location.lng)) ? p.location : null;
      const googleMapsUrl = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
      const out = buildTransactionalEmail({
        brand,
        title: `New Incident — ${String(p.category || 'Incident').toUpperCase()}`,
        severity: p.priority || 'medium',
        preheader: DEMO_LABEL,
        intro: 'A new incident has been reported and requires review. Immediate attention is required.',
        details: [
          detail('Reference', p.incident_number || p.id),
          detail('Category', String(p.category || 'N/A').toUpperCase()),
          detail('Priority', String(p.priority || 'medium').toUpperCase()),
          detail('Site', p.site_name || 'N/A'),
          detail('Guard', [p.guard_name || 'Unknown Guard', p.badge_number ? 'Badge: ' + p.badge_number : null].filter(Boolean).join(' — ')),
          detail('Reported', new Date(p.reported_at || p.created_date).toLocaleString('en-ZA')),
          googleMapsUrl ? detail('Location', googleMapsUrl) : null,
          (p.media || []).length ? detail('Attachments', String(p.media.length) + ' media attachment(s)') : null,
        ].filter(Boolean),
        bodyLines: ['Description: ' + (p.description || 'No description provided.')],
        cta: googleMapsUrl ? { label: 'View on Google Maps', url: googleMapsUrl } : null,
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | 🚨 New Incident — ${String(p.category || 'N/A').toUpperCase()} at ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'incident_critical_escalation': {
      if (!p) return null;
      const escReason = p.escalation_reason === 'priority' ? 'High/Critical Priority Incident' : 'Incident unresolved for 30+ minutes';
      const out = buildTransactionalEmail({
        brand,
        title: `CRITICAL INCIDENT ESCALATION: ${p.title || 'Security Incident'}`,
        severity: 'critical',
        preheader: DEMO_LABEL,
        intro: 'This critical incident has been escalated after exceeding its response window.',
        details: [
          detail('Incident', p.incident_number || p.id),
          detail('Title', p.title),
          detail('Priority', String(p.priority || 'high').toUpperCase()),
          detail('Status', p.status || 'N/A'),
          detail('Site', p.site_name || 'N/A'),
          detail('Assigned Guard', p.assigned_to_name || p.guard_name || '—'),
          detail('Escalation reason', escReason),
          detail('Reported', new Date(p.reported_at || p.created_date).toLocaleString('en-ZA')),
        ],
        bodyLines: ['Description: ' + String(p.description || 'No description provided.').slice(0, 500)],
        cta: { label: 'Open Incident', url: CTA('/AdminIncidents') },
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | CRITICAL incident escalation — ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'maintenance_reported': {
      if (!p) return null;
      const loc = p.location && Number.isFinite(Number(p.location.lat)) && Number.isFinite(Number(p.location.lng)) ? p.location : null;
      const googleMapsUrl = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
      const out = buildTransactionalEmail({
        brand,
        title: 'Maintenance Request',
        severity: p.urgency || 'medium',
        preheader: DEMO_LABEL,
        intro: 'A new maintenance request has been submitted. Review & action required.',
        details: [
          detail('Type', String(p.category || 'maintenance').replace(/_/g, ' ')),
          detail('Site', p.site_name || 'N/A'),
          detail('Guard', p.guard_name || 'N/A'),
          detail('Reported', new Date(p.reported_at || p.created_date).toLocaleString('en-ZA')),
          googleMapsUrl ? detail('Location', googleMapsUrl) : null,
        ].filter(Boolean),
        bodyLines: ['Details: ' + (p.description || p.title || 'No details provided.')],
        cta: googleMapsUrl ? { label: 'View on Google Maps', url: googleMapsUrl } : null,
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | Maintenance Request — ${String(p.category || 'maintenance').replace(/_/g, ' ')} at ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'maintenance_completed': {
      if (!p) return null;
      const loc = p.location && Number.isFinite(Number(p.location.lat)) && Number.isFinite(Number(p.location.lng)) ? p.location : null;
      const googleMapsUrl = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
      const out = buildTransactionalEmail({
        brand,
        title: `✅ MAINTENANCE TASK COMPLETED — ${p.title || String(p.category || 'Maintenance').replace(/_/g, ' ')}`,
        severity: 'low',
        preheader: DEMO_LABEL,
        intro: `Maintenance workflow update at ${p.site_name || 'site'}.`,
        details: [
          detail('Reference', p.request_number || p.id),
          detail('Category', String(p.category || 'N/A').replace(/_/g, ' ').toUpperCase()),
          detail('Urgency', String(p.urgency || 'medium').toUpperCase()),
          detail('Site', p.site_name || 'N/A'),
          detail('Completed by', p.completed_by_name || p.assigned_to_name || 'N/A'),
          detail('Completed at', p.completed_at ? new Date(p.completed_at).toLocaleString('en-ZA') : null),
          p.follow_up_required ? detail('Follow-up', 'Required') : null,
          googleMapsUrl ? detail('Location', googleMapsUrl) : null,
        ].filter(Boolean),
        bodyLines: [
          p.completion_notes ? 'Completion notes: ' + p.completion_notes : null,
          p.recommendations ? 'Recommendations: ' + p.recommendations : null,
          'Please review this maintenance request in the app.',
        ].filter(Boolean),
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | ✅ MAINTENANCE TASK COMPLETED — ${String(p.category || 'Maintenance').replace(/_/g, ' ')} at ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'panic_alert': {
      if (!p) return null;
      const panic = await buildPanicEmailAsyncFull(svc, {
        userName: p.user_name || p.activated_by_name || 'Demo Guard',
        userRole: p.user_role || 'Security Guard',
        badgeNumber: p.badge_number || undefined,
        siteName: p.site_name || ctx.siteName || undefined,
        customerName: ctx.customerName,
        brand,
        panicNumber: p.panic_number || p.reference || p.id,
        activatedAt: p.activated_at || p.created_date,
        location: p.location || null,
        notes: p.notes || undefined,
        status: p.status || 'resolved',
        brandName: brand?.brand_name,
      });
      const text = `DEMO | PANIC ALERT ${p.panic_number || p.id} — ${p.site_name || ''}\nStatus: ${p.status || 'resolved'}\n${DEMO_FOOTER}`;
      return { subject: `DEMO | PANIC ALERT — ${p.site_name || 'site'} (${p.status || 'resolved'})`, html: panic.html, text, demo_record_ids: ids };
    }
    case 'alarm_dispatch': {
      if (!p) return null;
      const alarmTypeLabel = String(p.alarm_type || p.type || 'alarm').replace(/_/g, ' ').toUpperCase();
      const out = buildBrandedEmail({
        brand,
        heading: `Alarm Response Assigned — ${alarmTypeLabel}`,
        greeting: `Dear ${p.assigned_to_name || 'Guard'},`,
        intro: 'You have been dispatched to respond to an alarm. Open the app to acknowledge the dispatch and get directions.',
        details: [
          detail('Alarm Type', String(p.alarm_type || p.type || '—').replace(/_/g, ' ')),
          detail('Address', p.address || '—'),
          detail('Client', p.client_name || '—'),
          detail('Priority', p.priority || 'high'),
          detail('Dispatched By', p.dispatched_by_name || '—'),
          detail('Dispatched at', p.dispatched_at ? new Date(p.dispatched_at).toLocaleString('en-ZA') : null),
        ],
        closing: DEMO_FOOTER,
      });
      return { subject: `DEMO | 🚨 ALARM RESPONSE ASSIGNED — ${alarmTypeLabel}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'shift_schedule_summary': {
      const all = (records.Shift || []).filter((s: any) => s.demo_batch_id && !s.is_test && s.guard_name);
      if (!all.length) return null;
      // Production groups the shared shifts per guard and emails one table per
      // guard — render the schedule of the guard with the most demo shifts.
      const byGuard: Record<string, any[]> = {};
      for (const s of all) (byGuard[s.guard_name] ||= []).push(s);
      const guardName = Object.keys(byGuard).sort((a: string, b: string) => byGuard[b].length - byGuard[a].length)[0];
      const guardShifts = byGuard[guardName].slice(0, 5);
      const out = buildTransactionalEmail({
        brand,
        title: `Your Shift Schedule — ${guardShifts.length} Shift${guardShifts.length > 1 ? 's' : ''}`,
        severity: 'medium',
        preheader: DEMO_LABEL,
        intro: `Dear ${guardName}, you have been scheduled for the shifts below. Please review the details and arrive on time.`,
        details: guardShifts.map((s: any) => ({
          label: formatSastDate(s.start_time) + ' — ' + (s.site_name || 'Site'),
          value: formatSastTime(s.start_time) + ' to ' + formatSastTime(s.end_time),
        })),
        bodyLines: ['Please acknowledge these shifts in the app. Contact your supervisor for any changes.'],
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | Your Shift Schedule — ${guardShifts.length} Shifts`, html: out.html, text: out.text, demo_record_ids: guardShifts.map((s: any) => s.id) };
    }
    case 'shift_handover': {
      if (!p) return null;
      // Mirrors the real End of Shift handover email (sendShiftHandoverNotification).
      const submittedAt = p.handover_at || p.signed_at || p.created_date;
      const ss = p.site_status || {};
      const check = (k: string, label: string) => (ss[k] ? '✅' : '⬜') + ' ' + label;
      const media = p.media_attachments || [];
      const photos = media.filter((m: any) => m && m.type === 'photo' && m.url);
      const videos = media.filter((m: any) => m && m.type === 'video' && m.url);
      const incidents = p.incidents_during_shift || [];
      const maintenance = p.maintenance_issues || [];
      const outstanding = p.outstanding_tasks || [];
      const block = (bg: string, border: string, color: string, title: string, itemsHtml: string) =>
        `<div style="background: ${bg}; border: 2px solid ${border}; border-radius: 12px; padding: 20px; margin-bottom: 15px;"><h3 style="color: ${color}; margin: 0 0 10px 0; font-size: 16px;">${title}</h3>${itemsHtml}</div>`;
      const incidentBlock = incidents.length ? block('#fff5f5', '#fecaca', '#b91c1c', `🚨 Incidents During Shift (${incidents.length})`,
        incidents.map((inc: any, i: number) => `<p style="color:#7f1d1d;margin:4px 0;font-size:14px;">${i + 1}. <strong>${escHtml(String(inc.summary || 'Incident').slice(0, 200))}</strong> — Status: ${escHtml(inc.status || 'Unknown')}</p>`).join('')) : '';
      const maintenanceBlock = maintenance.length ? block('#fffbeb', '#fde68a', '#b45309', `🔧 Maintenance Issues (${maintenance.length})`,
        maintenance.map((m: any, i: number) => `<p style="color:#92400e;margin:4px 0;font-size:14px;">${i + 1}. ${escHtml(String(m.issue || 'Issue').slice(0, 200))}${m.location ? ' — Location: ' + escHtml(m.location) : ''}${m.urgency ? ' (' + escHtml(m.urgency) + ')' : ''}</p>`).join('')) : '';
      const outstandingBlock = outstanding.length ? block('#eff6ff', '#bfdbfe', '#1d4ed8', `📌 Outstanding Tasks (${outstanding.length})`,
        outstanding.map((t: any, i: number) => `<p style="color:#1e40af;margin:4px 0;font-size:14px;">${i + 1}. ${escHtml(String(t.task || 'Task').slice(0, 200))}${t.priority ? ' (Priority: ' + escHtml(t.priority) + ')' : ''}</p>`).join('')) : '';
      const photosBlock = photos.length ? block('#ffffff', '#e2e8f0', '#0c4a6e', `📷 Handover Evidence (${photos.length})`,
        photos.map((ph: any) => `<img src="${escHtml(ph.url)}" alt="Evidence" style="max-width:100%;height:auto;border-radius:8px;margin:8px 0;" />`).join('')) : '';
      const videosBlock = videos.length ? block('#ffffff', '#e2e8f0', '#0c4a6e', `🎬 Video Evidence (${videos.length})`,
        videos.map((v: any) => `<p style="margin:4px 0;"><a href="${escHtml(v.url)}" target="_blank" style="color:#0ea5e9;">▶️ Open Video</a></p>`).join('')) : '';
      const row = (label: string, value: string) =>
        `<tr><td style="padding:6px 0;color:#64748b;font-weight:bold;width:190px;font-size:13px;">${escHtml(label)}</td><td style="padding:6px 0;color:#1e293b;font-size:14px;">${escHtml(value)}</td></tr>`;
      const summaryTable = `<table style="width:100%;border-collapse:collapse;">${[
        row('Outgoing Guard', p.outgoing_guard_name || 'Guard'),
        row('Incoming Guard', p.incoming_guard_name || 'Not yet assigned'),
        row('Site', p.site_name || 'Unknown'),
        row('Submitted', new Date(submittedAt).toLocaleString('en-ZA')),
        row('Site Status', [check('all_secure', 'All Secure'), check('gates_locked', 'Gates Locked'), check('alarms_armed', 'Alarms Armed'), check('lights_functional', 'Lights Functional'), check('cameras_operational', 'Cameras Operational'), check('perimeter_secure', 'Perimeter Secure')].join(' | ')),
      ].join('')}</table>`;
      const bodyHtml = [
        `<div style="background:#ffffff;border:2px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:15px;">${summaryTable}</div>`,
        incidentBlock, maintenanceBlock, outstandingBlock,
        p.special_instructions ? block('#f0fdf4', '#bbf7d0', '#15803d', '📝 Special Instructions', `<p style="color:#166534;margin:0;font-size:14px;white-space:pre-wrap;">${escHtml(p.special_instructions)}</p>`) : '',
        p.notes ? block('#f8fafc', '#e2e8f0', '#0c4a6e', 'ℹ️ Notes', `<p style="color:#334155;margin:0;font-size:14px;white-space:pre-wrap;">${escHtml(p.notes)}</p>`) : '',
        photosBlock, videosBlock,
      ].filter(Boolean).join('');
      const html = renderTransactionalShell({
        brand,
        title: `🤝 Shift Handover — ${p.site_name || 'Site'}`,
        preheader: DEMO_LABEL,
        bodyHtml,
        footerNote: DEMO_FOOTER,
      });
      const text = `DEMO | 🤝 Shift Handover — ${p.site_name || 'Site'}\n\nOutgoing Guard: ${p.outgoing_guard_name || 'Guard'}\nIncoming Guard: ${p.incoming_guard_name || 'Not yet assigned'}\nSite: ${p.site_name || 'Unknown'}\nSubmitted: ${new Date(submittedAt).toLocaleString('en-ZA')}\n\n${DEMO_FOOTER}`;
      return { subject: `DEMO | 🤝 Shift Handover — ${p.site_name || 'Site'}`, html, text, demo_record_ids: ids };
    }
    case 'task_deadline_report': {
      if (!p) return null;
      const batchTasks = (picked.tasks || []).filter((tk: any) => tk.batch_id === p.id);
      const raw: any = deadlineReport(p, batchTasks, ctx.customerName, brand, brand?.brand_name);
      const html = typeof raw === 'string' ? raw : (raw?.emailHtml || raw?.html || '');
      const text = typeof raw === 'string' ? raw : (raw?.emailBody || `DEMO | Task Completion Report — ${p.title}\n${DEMO_FOOTER}`);
      return { subject: raw?.subject || `DEMO | Task Completion Report — ${p.title}`, html, text, demo_record_ids: [p.id, ...batchTasks.slice(0, 5).map((tk: any) => tk.id)].filter(Boolean) };
    }
    case 'task_list_telegram': {
      if (!p) return null;
      // EXACT production Telegram rendering (newTaskListNotification).
      const taskCount = (records.OperationalTask || []).filter((tk: any) => tk.batch_id === p.id).length || (p.task_definitions || []).length;
      const raw: any = newTaskListNotification(p, taskCount, ctx.customerName, brand, brand?.brand_name);
      const text = `${raw.telegramText}\n\n${DEMO_LABEL}`;
      return { subject: `DEMO | ${raw.subject}`, html: `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px">${text.replace(/[<>&]/g, (c: string) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c])}</pre>`, text, demo_record_ids: ids };
    }
    case 'ob_overdue_escalation': {
      if (!p) return null;
      // EXACT production escalation rendering (obCore.escalationEmailHtml —
      // the same builder the OB sweep's supervisor escalation uses).
      const raw = escalationEmailHtml(p, brand, brand?.brand_name);
      const html = raw + `<p style="font-family:Arial,sans-serif;max-width:640px;margin:8px auto 0;font-size:12px;color:#64748b">${escHtml(DEMO_FOOTER)}</p>`;
      const subject = `DEMO | [OB ESCALATION] ${p.title || 'OB check'} — ${p.operating_date || ''}`;
      return { subject, html, text: `${subject}\n${DEMO_FOOTER}`, demo_record_ids: ids };
    }
    case 'start_of_shift_report': {
      if (!p) return null;
      const shift = (records.Shift || []).find((s: any) => s.id === p.shift_id) || null;
      let site = (records.Site || []).find((s: any) => s.id === p.site_id) || null;
      // Sites are shared platform records (never demo-flagged) — resolve the
      // site directly when the demo loader did not include it.
      if (!site && p.site_id && svc) {
        try { const g = await svc.entities.Site.get(p.site_id); site = g?.data ?? g; } catch (_) { site = null; }
      }
      // The demo record stores the Start of Shift instructions in the same
      // combined text the production form composes — parse the structured
      // reportData back out for the REAL shared builder.
      const si = String(p.special_instructions || '');
      const grab = (key: string, stop: string[]) => {
        const idx = si.indexOf(key + ':');
        if (idx < 0) return '';
        const rest = si.slice(idx + key.length + 1);
        let end = rest.length;
        for (const nk of stop) { const i = rest.indexOf(nk); if (i >= 0 && i < end) end = i; }
        return rest.slice(0, end).trim();
      };
      const observations = (p.key_activities || []).map((ka: any) => {
        const m = /^(.*?) at (\d{1,2}:\d{2}): (.*)$/.exec(String(ka || ''));
        return m ? { type: m[1].trim(), time: m[2], comments: m[3].trim() } : { type: 'Observation', time: '', comments: String(ka || '') };
      });
      // Sample geofence evidence — coordinates near the demo site, never
      // presented as a live capture (labelled in the report's own notes).
      const siteLoc = site && site.location && Number.isFinite(Number(site.location.lat)) && !(Number(site.location.lat) === 0 && Number(site.location.lng) === 0) ? site.location : null;
      const sampleGps = siteLoc ? { lat: Number(siteLoc.lat) + 0.0003, lng: Number(siteLoc.lng) + 0.0002 } : null;
      const distanceMetres = siteLoc && sampleGps ? haversineMetres(siteLoc, sampleGps) : null;
      const geofenceRadius = site && Number.isFinite(Number(site.geofence_radius)) ? Number(site.geofence_radius) : null;
      const submittedAt = p.signed_at || p.handover_at || p.created_date;
      const out = buildStartOfShiftReportEmail({
        brand, site, siteName: p.site_name || 'Unknown',
        guardName: p.outgoing_guard_name || 'Demo Guard',
        badgeNumber: 'DP-4401 (sample)',
        clientName: ctx.customerName,
        shift,
        reportData: {
          shift_post: grab('SHIFT/POST', ['\nSPECIAL INSTRUCTIONS']),
          special_instructions: grab('SPECIAL INSTRUCTIONS', ['\nPOST ITEMS RECEIVED']),
          post_items_received: grab('POST ITEMS RECEIVED', ['\nRELIEVING OFFICER']),
          relieving_officer: grab('RELIEVING OFFICER', ['\nADDITIONAL NOTES']),
          additional_notes: si.indexOf('ADDITIONAL NOTES:') >= 0 ? si.slice(si.indexOf('ADDITIONAL NOTES:') + 'ADDITIONAL NOTES:'.length).trim() : '',
          observations,
          signature: p.outgoing_guard_signature || null,
        },
        media: p.media_attachments || [],
        submittedAt,
        location: sampleGps, distanceMetres,
        withinFence: distanceMetres != null && geofenceRadius ? distanceMetres <= geofenceRadius : null,
        geofenceRadius, siteGpsValid: !!siteLoc,
        reportLink: CTA('/StartOfShiftHistory'),
        preheader: DEMO_LABEL, footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | ${out.subject}`, html: out.emailHtml, text: `${out.text}\n\n${DEMO_LABEL}`, demo_record_ids: ids };
    }
    case 'daily_access_report': {
      let logs = picked.logs || [];
      if (!logs.length) return null;
      // Coherent single-site report: group by the logs' own site and take the
      // largest group (Sites are shared platform records — never demo-flagged).
      const bySite: Record<string, any[]> = {};
      for (const l of logs) {
        const key = l.site_name || l.site_id || 'unknown';
        (bySite[key] ||= []).push(l);
      }
      const siteKey = Object.keys(bySite).sort((a, b) => bySite[b].length - bySite[a].length)[0];
      logs = bySite[siteKey];
      const siteName = logs[0]?.site_name || siteKey;
      const anchorMs = Math.max(...logs.map((l: any) => new Date(l.entry_time || l.timestamp || l.created_date).getTime() || 0).filter(Boolean));
      const period = computeReportingPeriod(anchorMs, 'Africa/Johannesburg');
      const fmt = makeZonedFormatters('Africa/Johannesburg');
      const stillInside = logs.filter((l: any) => l.status === 'inside');
      const exited = logs.filter((l: any) => l.status === 'exited');
      const denied = logs.filter((l: any) => l.status === 'denied' || l.status === 'blacklisted');
      const model = buildDailyAccessModel({
        period, fmt, stillInside, exited, denied, devices: [],
        customerName: ctx.customerName, siteName,
        generatedAtMs: Date.now(),
      });
      const body = renderDailyAccessEmailBody(model);
      const html = renderTransactionalShell({
        brand,
        title: `Daily Access Control Report — ${siteName}`,
        preheader: DEMO_LABEL,
        bodyHtml: body,
        footerNote: DEMO_FOOTER,
        timezone: 'Africa/Johannesburg',
      });
      const text = `DEMO | Daily Access Control Report — ${siteName}\n${DEMO_FOOTER}`;
      const siteSafe = String(siteName).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Site';
      const logIds = logs.slice(0, 10).map((l: any) => l.id);
      // REAL downloadable report files (the same shared generators the live
      // dispatch path uses) — built at send time from these demo logs.
      const attachments = [
        { filename: `DEMO_Daily_Access_Report_${siteSafe}.pdf`, generator: 'daily_access_pdf', record_ids: logIds },
        { filename: `DEMO_Daily_Access_Report_${siteSafe}.csv`, generator: 'daily_access_csv', record_ids: logIds },
      ];
      return { subject: `DEMO | Daily Access Control Report — ${siteName}`, html, text, demo_record_ids: logIds, attachments };
    }
    case 'visitor_registration': {
      if (!p) return null;
      // Mirrors the real visitor pre-registration email
      // (sendVisitorRegistrationNotification), rendered from the demo Visitor.
      const dateRange = p.valid_from && p.valid_until
        ? `${new Date(p.valid_from).toLocaleDateString('en-ZA')} – ${new Date(p.valid_until).toLocaleDateString('en-ZA')}`
        : 'Open';
      const out = buildTransactionalEmail({
        brand,
        title: `Visitor Pre-Registered — ${p.visitor_name || 'Unknown'}`,
        severity: 'low',
        preheader: DEMO_LABEL,
        intro: `${p.visitor_name || 'A visitor'} has been pre-registered${p.unit_number ? ` for Unit ${p.unit_number}` : ''}.`,
        details: [
          detail('Visitor', p.visitor_name),
          detail('ID / Licence', p.visitor_id_number),
          detail('Vehicle', p.vehicle_registration),
          detail('Phone', p.phone || p.visitor_phone),
          detail('Host', p.resident_name || 'Simulated Resident (sample)'),
          detail('Valid', dateRange),
          detail('QR pass', p.qr_code),
          detail('OTP', p.otp_code),
        ],
        bodyLines: ['The visitor will present their QR code at the gate for scanning.'],
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | Visitor Pre-Registered — ${p.visitor_name || 'visitor'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'laundry_request': {
      if (!p) return null;
      const out = buildTransactionalEmail({
        brand,
        title: `Laundry Request — ${p.request_number || p.id}`,
        severity: 'low',
        preheader: DEMO_LABEL,
        intro: 'A resident laundry request has been submitted.',
        details: [
          detail('Resident', p.resident_name),
          detail('Unit', p.unit_number),
          detail('Collection', p.collection_date),
          detail('Delivery', p.delivery_date),
          detail('Items', p.items_count),
          detail('Status', p.status),
        ],
        bodyLines: [p.notes].filter(Boolean),
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | Laundry request — ${p.resident_name || p.unit_number || ''}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    // ── REAL REPORT EXPORTS — the pack item is the branded email cover for a
    // downloadable report; the ATTACHMENT itself is built at send time by the
    // same shared generator the production dispatch path uses (showcaseDelivery).
    // Items return null when their demo data is missing — never a stub.
    case 'hospitality_visits_report': {
      const visits = (records.HospitalityVisit || []).filter((v: any) => v.demo_batch_id && !v.is_test);
      if (!visits.length) return null;
      const names = [...new Set(visits.map((v: any) => v.site_name).filter(Boolean))] as string[];
      const siteBit = names.length === 1 ? names[0] : `${names.length} demo sites`;
      const out = buildTransactionalEmail({
        brand,
        title: 'Hospitality Visits Report (GRID GATE)',
        severity: 'medium',
        preheader: DEMO_LABEL,
        intro: `The branded downloadable Hospitality Visits PDF covering demo visits at ${siteBit} — primary and secondary logos applied, evidence photos and identity numbers deliberately excluded.`,
        details: [
          detail('Demo visits', String(visits.length)),
          detail('Sites', names.length ? names.join(', ') : '—'),
          detail('Format', 'PDF attachment (landscape A4)'),
        ],
        footerNote: DEMO_FOOTER,
      });
      const html = out.html;
      const ids = visits.slice(0, 20).map((v: any) => v.id);
      return {
        subject: `DEMO | Hospitality Visits Report — ${siteBit}`,
        html, text: `DEMO | Hospitality Visits Report — ${siteBit}\n${DEMO_FOOTER}`,
        demo_record_ids: ids,
        attachments: [{ filename: 'DEMO_Hospitality_Visits_Report.pdf', generator: 'hospitality_visits_pdf', record_ids: ids }],
      };
    }
    case 'daily_activity_report': {
      const incidents = (records.Incident || []).filter((i: any) => i.demo_batch_id && !i.is_test);
      const maintenance = (records.MaintenanceRequest || []).filter((m: any) => m.demo_batch_id && !m.is_test);
      const patrols = (records.PatrolLog || []).filter((l: any) => l.demo_batch_id && !l.is_test);
      const shifts = (records.Shift || []).filter((s: any) => s.demo_batch_id && !s.is_test);
      if (!incidents.length && !maintenance.length && !patrols.length && !shifts.length) return null;
      // Pick the busiest SAST demo day across all four activity sources.
      const dayOf = (iso: any) => {
        const d = new Date(iso); if (isNaN(d.getTime())) return null;
        return new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
      };
      const buckets: Record<string, Record<string, any[]>> = {};
      const put = (list: any[], kind: string, tsField: string) => {
        for (const r of list) { const d = dayOf(r[tsField] || r.created_date); if (!d) continue; (buckets[d] ||= { Incident: [], MaintenanceRequest: [], PatrolLog: [], Shift: [] })[kind].push(r); }
      };
      put(incidents, 'Incident', 'reported_at');
      put(maintenance, 'MaintenanceRequest', 'reported_at');
      put(patrols, 'PatrolLog', 'timestamp');
      for (const s of shifts.filter((s: any) => s.clock_in?.timestamp)) { const d = dayOf(s.clock_in.timestamp); if (d) (buckets[d] ||= { Incident: [], MaintenanceRequest: [], PatrolLog: [], Shift: [] }).Shift.push(s); }
      const scored = Object.entries(buckets).map(([day, b]) => [day, b, b.Incident.length + b.MaintenanceRequest.length + b.PatrolLog.length + b.Shift.length] as const);
      if (!scored.length) return null;
      scored.sort((a, b) => (b[2] as number) - (a[2] as number));
      const [day, b] = scored[0];
      const cap = (a: any[]) => a.slice(0, 60).map((r: any) => r.id);
      const record_ids = { Incident: cap(b.Incident), MaintenanceRequest: cap(b.MaintenanceRequest), PatrolLog: cap(b.PatrolLog), Shift: cap(b.Shift) };
      const out = buildTransactionalEmail({
        brand,
        title: 'Daily Activity Report',
        severity: 'medium',
        preheader: DEMO_LABEL,
        intro: `The downloadable daily activity PDF for the demo operating day ${day} — incidents, maintenance, patrol scans and worked shifts, branded to the tenant.`,
        details: [
          detail('Operating day', day),
          detail('Incidents', String(b.Incident.length)),
          detail('Maintenance', String(b.MaintenanceRequest.length)),
          detail('Checkpoint scans', String(b.PatrolLog.length)),
        ],
        footerNote: DEMO_FOOTER,
      });
      const html = out.html;
      return {
        subject: `DEMO | Daily Activity Report — ${day}`,
        html, text: `DEMO | Daily Activity Report — ${day}\n${DEMO_FOOTER}`,
        demo_record_ids: [...new Set([...record_ids.Incident, ...record_ids.MaintenanceRequest, ...record_ids.PatrolLog, ...record_ids.Shift])].slice(0, 20),
        attachments: [{ filename: `DEMO_Daily_Activity_Report_${day}.pdf`, generator: 'daily_activity_pdf', date: day, record_ids }],
      };
    }
    case 'monthly_incident_report': {
      const incidents = (records.Incident || []).filter((i: any) => i.demo_batch_id && !i.is_test && (i.reported_at || i.created_date));
      if (!incidents.length) return null;
      const sastKey = (iso: any) => { const d = new Date(iso); if (isNaN(d.getTime())) return null; const s = new Date(d.getTime() + 2 * 3600e3); return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}`; };
      const keys = [...new Set(incidents.map((i: any) => sastKey(i.reported_at || i.created_date)).filter(Boolean))] as string[];
      if (!keys.length) return null;
      const currentKey = keys.sort()[keys.length - 1];
      const month = incidents.filter((i: any) => sastKey(i.reported_at || i.created_date) === currentKey);
      const label = new Date(`${currentKey}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const ids = month.slice(0, 60).map((i: any) => i.id);
      const out = buildTransactionalEmail({
        brand,
        title: 'Monthly Incident Analysis Report',
        severity: 'medium',
        preheader: DEMO_LABEL,
        intro: `The downloadable monthly incident analysis PDF for ${label}, built from the seeded demo incidents — comparative metrics, category and priority breakdowns, incident log and recommendations.`,
        details: [detail('Month', label), detail('Demo incidents', String(month.length))],
        footerNote: DEMO_FOOTER,
      });
      const html = out.html;
      return {
        subject: `DEMO | Monthly Incident Analysis — ${label}`,
        html, text: `DEMO | Monthly Incident Analysis — ${label}\n${DEMO_FOOTER}`,
        demo_record_ids: ids.slice(0, 20),
        attachments: [{ filename: `DEMO_Monthly_Incident_Report_${currentKey}.pdf`, generator: 'monthly_incident_pdf', record_ids: ids }],
      };
    }
    case 'monthly_maintenance_report': {
      const reqs = (records.MaintenanceRequest || []).filter((m: any) => m.demo_batch_id && !m.is_test && (m.reported_at || m.created_date));
      if (!reqs.length) return null;
      const sastKey = (iso: any) => { const d = new Date(iso); if (isNaN(d.getTime())) return null; const s = new Date(d.getTime() + 2 * 3600e3); return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}`; };
      const keys = [...new Set(reqs.map((m: any) => sastKey(m.reported_at || m.created_date)).filter(Boolean))] as string[];
      if (!keys.length) return null;
      const currentKey = keys.sort()[keys.length - 1];
      const month = reqs.filter((m: any) => sastKey(m.reported_at || m.created_date) === currentKey);
      const label = new Date(`${currentKey}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const ids = month.slice(0, 60).map((m: any) => m.id);
      const out = buildTransactionalEmail({
        brand,
        title: 'Monthly Maintenance Analysis Report',
        severity: 'medium',
        preheader: DEMO_LABEL,
        intro: `The downloadable monthly maintenance analysis PDF for ${label}, built from the seeded demo maintenance requests — comparative metrics, category and urgency breakdowns, request log and recommendations.`,
        details: [detail('Month', label), detail('Demo requests', String(month.length))],
        footerNote: DEMO_FOOTER,
      });
      const html = out.html;
      return {
        subject: `DEMO | Monthly Maintenance Analysis — ${label}`,
        html, text: `DEMO | Monthly Maintenance Analysis — ${label}\n${DEMO_FOOTER}`,
        demo_record_ids: ids.slice(0, 20),
        attachments: [{ filename: `DEMO_Monthly_Maintenance_Report_${currentKey}.pdf`, generator: 'monthly_maintenance_pdf', record_ids: ids }],
      };
    }
    default:
      return null;
  }
}

/** SHA-256 content fingerprint of a pack's selection + contents + branding. */
export async function computePackFingerprint(packLike: { selections: any[]; contents: any[]; branding_snapshot: any }): Promise<string> {
  const canonical = JSON.stringify({
    s: packLike.selections, c: packLike.contents, b: packLike.branding_snapshot,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}