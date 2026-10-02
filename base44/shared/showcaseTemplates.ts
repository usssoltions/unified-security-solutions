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
import { resolveCommunicationBrand, buildBrandedEmail, buildBrandedTelegram } from './brandedCommunication.ts';
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
  { template_id: 'alarm_dispatch', label: 'Alarm Dispatch — Response Instruction', module: 'OPERATIONS', channel: 'email', scenario: 'A control-room alarm dispatch with response instructions.', needs: ['Alert'] },
  { template_id: 'shift_schedule_summary', label: 'Shift Schedule Summary', module: 'OPERATIONS', channel: 'email', scenario: 'Scheduled shifts for the coming days, sent to guards.', needs: ['Shift'] },
  { template_id: 'shift_handover', label: 'Shift Handover Notice', module: 'OPERATIONS', channel: 'email', scenario: 'End-of-shift handover summary delivered to the incoming guard.', needs: ['ShiftHandover'] },
  { template_id: 'task_deadline_report', label: 'Task Completion (Deadline) Report', module: 'TASK_SCHEDULING', channel: 'email', scenario: 'The authoritative deadline report for a scheduled task batch.', needs: ['TaskBatch', 'OperationalTask'] },
  { template_id: 'task_list_telegram', label: 'New Task List — Telegram', module: 'TASK_SCHEDULING', channel: 'telegram', scenario: 'The Telegram message announcing a new task list.', needs: ['TaskBatch'] },
  { template_id: 'ob_overdue_escalation', label: 'OB Check Overdue Escalation', module: 'TASK_SCHEDULING', channel: 'email', scenario: 'A Digital Occurrence Book check past due, escalated to supervisors.', needs: ['OBOccurrence'] },
  { template_id: 'daily_access_report', label: 'Daily Access Control Report', module: 'ACCESS', channel: 'email', scenario: 'The branded daily access report (entries, exits, denials) for one site.', needs: ['AccessLog', 'Site'] },
  { template_id: 'visitor_registration', label: 'Visitor Registration Notice', module: 'ESTATE', channel: 'email', scenario: 'A resident-linked visitor registration notification.', needs: ['AccessLog'] },
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
      return { primary: first(records.Alert || []) };
    case 'shift_schedule_summary':
      return { primary: first(records.Shift || []) };
    case 'shift_handover':
      return { primary: first(records.ShiftHandover || []) };
    case 'task_deadline_report':
      return { primary: first(records.TaskBatch || []), tasks: records.OperationalTask || [] };
    case 'task_list_telegram':
      return { primary: first(records.TaskBatch || []) };
    case 'ob_overdue_escalation':
      return { primary: first(records.OBOccurrence || []) };
    case 'daily_access_report':
      return { primary: first(records.Site || []), logs: records.AccessLog || [] };
    case 'visitor_registration':
      return { primary: first(records.AccessLog || [], (l) => l.person_type === 'visitor') || first(records.AccessLog || []) };
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
      const out = buildTransactionalEmail({
        brand,
        title: `Incident Reported: ${p.title || 'Security Incident'}`,
        severity: p.priority || 'medium',
        preheader: DEMO_LABEL,
        intro: `An incident has been reported at ${p.site_name || 'site'} and requires administrative attention.`,
        details: [
          detail('Incident', p.incident_number || p.id),
          detail('Site', p.site_name),
          detail('Category', p.category),
          detail('Priority', p.priority),
          detail('Reported by', p.guard_name),
          detail('Reported at', p.reported_at || p.created_date),
          detail('Location', p.location ? `${p.location.lat?.toFixed?.(5)}, ${p.location.lng?.toFixed?.(5)}` : null),
        ],
        bodyLines: [p.description].filter(Boolean),
        cta: { label: 'Open Incident', url: CTA('/AdminIncidents') },
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | Incident reported — ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'incident_critical_escalation': {
      if (!p) return null;
      const out = buildTransactionalEmail({
        brand,
        title: `CRITICAL INCIDENT ESCALATION: ${p.title || 'Security Incident'}`,
        severity: 'critical',
        preheader: DEMO_LABEL,
        intro: `This critical incident has been escalated after exceeding its response window.`,
        details: [
          detail('Incident', p.incident_number || p.id),
          detail('Site', p.site_name),
          detail('Priority', p.priority),
          detail('Reported by', p.guard_name),
          detail('Reported at', p.reported_at || p.created_date),
          detail('Escalation reason', p.escalation_reason || 'priority'),
        ],
        bodyLines: [p.description].filter(Boolean),
        cta: { label: 'Open Incident', url: CTA('/AdminIncidents') },
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | CRITICAL incident escalation — ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'maintenance_reported': {
      if (!p) return null;
      const out = buildTransactionalEmail({
        brand,
        title: `Maintenance Request: ${p.title || 'Fault Reported'}`,
        severity: p.urgency || 'medium',
        preheader: DEMO_LABEL,
        intro: `A maintenance request has been logged at ${p.site_name || 'site'}.`,
        details: [
          detail('Request', p.request_number || p.id),
          detail('Site', p.site_name),
          detail('Category', p.category),
          detail('Urgency', p.urgency),
          detail('Reported by', p.guard_name),
          detail('Reported at', p.reported_at || p.created_date),
        ],
        bodyLines: [p.description].filter(Boolean),
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | Maintenance reported — ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'maintenance_completed': {
      if (!p) return null;
      const out = buildTransactionalEmail({
        brand,
        title: `Maintenance Completed: ${p.title || 'Request'}`,
        severity: 'low',
        preheader: DEMO_LABEL,
        intro: `A previously reported maintenance request has been completed and closed.`,
        details: [
          detail('Request', p.request_number || p.id),
          detail('Site', p.site_name),
          detail('Category', p.category),
          detail('Completed by', p.completed_by_name || p.assigned_to_name),
          detail('Completed at', p.completed_at),
        ],
        bodyLines: [p.completion_notes].filter(Boolean),
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | Maintenance completed — ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
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
      const out = buildBrandedEmail({
        brand,
        heading: `Alarm Dispatch: ${p.title || p.alarm_type || 'Alarm Activation'}`,
        greeting: 'Response instruction for the on-duty guard.',
        details: [
          detail('Alarm', p.id),
          detail('Site', p.site_name || p.site_id),
          detail('Type', p.alarm_type || p.type),
          detail('Priority', p.priority),
          detail('Dispatched at', p.dispatched_at || p.created_date),
        ],
        closing: DEMO_FOOTER,
      });
      return { subject: `DEMO | Alarm dispatch — ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'shift_schedule_summary': {
      if (!p) return null;
      const out = buildBrandedEmail({
        brand,
        heading: 'Your Upcoming Shift Schedule',
        greeting: 'Here is a summary of scheduled shifts for the coming days.',
        details: [
          detail('Site', p.site_name),
          detail('Guard', p.guard_name),
          detail('Start', p.start_time),
          detail('End', p.end_time),
          detail('Status', p.status),
        ],
        closing: DEMO_FOOTER,
      });
      return { subject: `DEMO | Shift schedule summary — ${ctx.customerName}`, html: out.html, text: out.text, demo_record_ids: ids };
    }
    case 'shift_handover': {
      if (!p) return null;
      const out = buildBrandedEmail({
        brand,
        heading: 'Shift Handover',
        greeting: `Handover from ${p.outgoing_guard_name || 'outgoing guard'} to ${p.incoming_guard_name || 'incoming guard'}.`,
        details: [
          detail('Site', p.site_name || p.site_id),
          detail('Outgoing guard', p.outgoing_guard_name),
          detail('Incoming guard', p.incoming_guard_name),
          detail('Handover at', p.handover_at || p.created_date),
        ],
        bodyLines: [p.summary, p.notes].filter(Boolean),
        closing: DEMO_FOOTER,
      });
      return { subject: `DEMO | Shift handover — ${p.site_name || 'site'}`, html: out.html, text: out.text, demo_record_ids: ids };
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
      const text = buildBrandedTelegram({
        brand,
        heading: `New Task List: ${p.title}`,
        greeting: `${(p.task_definitions || []).length} tasks scheduled for ${p.scheduled_date || 'today'}.`,
        details: [
          detail('Control room', p.control_room_name),
          detail('Window', [p.active_start_time, p.deadline_time].filter(Boolean).join(' – ')),
          detail('Supervisor', p.primary_supervisor_name),
        ],
        closing: DEMO_LABEL,
      });
      return { subject: `DEMO | New task list (Telegram) — ${p.title}`, html: `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px">${text.replace(/[<>&]/g, (c: string) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' } as any)[c])}</pre>`, text, demo_record_ids: ids };
    }
    case 'ob_overdue_escalation': {
      if (!p) return null;
      const out = buildTransactionalEmail({
        brand,
        title: `OB Check Overdue: ${p.title}`,
        severity: 'high',
        preheader: DEMO_LABEL,
        intro: `A scheduled Digital Occurrence Book check passed its due time and was not completed. Supervisors have been escalated.`,
        details: [
          detail('OB reference', p.ob_reference),
          detail('Site', p.site_name || 'Overall'),
          detail('Control room', p.control_room_name),
          detail('Due at', p.due_at),
          detail('Slot', p.slot_label),
          detail('Status', p.status),
        ],
        bodyLines: [p.instructions].filter(Boolean),
        footerNote: DEMO_FOOTER,
      });
      return { subject: `DEMO | OB check overdue — ${p.ob_reference || p.title}`, html: out.html, text: out.text, demo_record_ids: ids };
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
      const out = buildTransactionalEmail({
        brand,
        title: 'Visitor Registration',
        severity: 'low',
        preheader: DEMO_LABEL,
        intro: `A visitor entry has been registered at ${p.site_name || 'site'}.`,
        details: [
          detail('Visitor', p.person_name),
          detail('Mobile', p.person_phone),
          detail('Site', p.site_name),
          detail('Unit / destination', p.unit_number || p.destination),
          detail('Entry time', p.entry_time || p.timestamp),
          detail('Scan method', p.scan_method),
        ],
        footerNote: DEMO_FOOTER,
      } as any);
      return { subject: `DEMO | Visitor registration — ${p.person_name || 'visitor'}`, html: out.html, text: out.text, demo_record_ids: ids };
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