import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { resolveCommunicationBrand, buildBrandedEmail } from '../../shared/brandedCommunication.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authenticate the caller — scheduled report generation and distribution
    // is an admin-only operation.
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role_type !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { schedule_id } = await req.json();

    if (!schedule_id) {
      return Response.json({ error: 'schedule_id is required' }, { status: 400 });
    }

    // Get the schedule
    const schedule = await base44.asServiceRole.entities.ReportSchedule.get(schedule_id);

    if (!schedule || schedule.status !== 'active') {
      return Response.json({ error: 'Schedule not found or inactive' }, { status: 404 });
    }

    // ── TENANT SCOPE (server-side, mandatory) ─────────────────────────────
    // The schedule's CREATOR's authoritative tenant owns this report: it can
    // only ever contain records from that tenant (or the platform-managed
    // pool for a platform creator). The previous implementation pulled
    // platform-wide data into every schedule's report — a cross-tenant data
    // leak into explicitly-configured recipient inboxes.
    let scopeCid = null;
    let scopeRid = null;
    try {
      if (schedule.created_by_id) {
        const creatorRows = await base44.asServiceRole.entities.User.filter({ id: String(schedule.created_by_id) });
        const creator = (creatorRows && creatorRows[0]) || null;
        scopeCid = creator?.customer_id || null;
        scopeRid = creator?.reseller_id || null;
      }
    } catch (_) { /* unresolvable scope fails CLOSED below via scopeMatch */ }

    // TENANT BRANDING — resolved from the report's OWN tenant scope
    // (customer → reseller → USS platform default). No hard-coded identity.
    const brand = await resolveCommunicationBrand(base44.asServiceRole, {
      customer_id: scopeCid, reseller_id: scopeRid });

    // Generate report data based on report_type — TENANT SCOPED
    const reportData = await generateReportData(base44, scopeCid);

    // Format report message
    const reportMessage = formatReportMessage(schedule, reportData);

    // ONE shared branded email renderer (branded header/footer, tenant logo,
    // colours, support contact) with the plain-text report as alternative.
    const reportDetails = [
      { label: 'Report', value: schedule.name },
      { label: 'Date', value: new Date().toLocaleDateString('en-ZA') },
      { label: 'Incidents', value: String(reportData.incidents?.length || 0) },
      { label: 'Shifts', value: String(reportData.shifts?.length || 0) },
      { label: 'Maintenance Requests', value: String(reportData.maintenance?.length || 0) },
      { label: 'Patrol Checkpoints', value: String(reportData.patrols?.length || 0) },
    ];
    const brandTpl = buildBrandedEmail({
      brand,
      heading: schedule.name,
      greeting: 'Hello,',
      intro: 'Your scheduled report is ready.',
      details: reportDetails,
      closing: reportMessage.replace(/\n/g, '<br/>'),
    });

    // Send to the schedule's EXPLICITLY CONFIGURED email recipients
    if (schedule.email_recipients && schedule.email_recipients.length > 0) {
      for (const email of schedule.email_recipients) {
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            from_name: brand.brand_name,
            to: email,
            subject: `${schedule.name} - ${new Date().toLocaleDateString('en-ZA')}`,
            html: brandTpl.html,
            text: brandTpl.text,
          });
        } catch (error) {
          // DELIVERY AUDIT — a failed report email is never silently dropped.
          console.error(`Failed to send email to ${email}:`, error);
          await base44.asServiceRole.entities.NotificationDelivery.create({
            event_key: `scheduled_report:${schedule_id}`,
            channel: 'email',
            status: 'failed',
            customer_id: scopeCid || undefined,
            reseller_id: scopeRid || undefined,
            recipient_address: email,
            send_time: new Date().toISOString(),
            provider_response: String(error?.message || error).slice(0, 500),
          }).catch(() => {});
        }
      }
    }

    // WHATSAPP — NOT SUPPORTED for scheduled distribution. There is no
    // WhatsApp API integration (a wa.me URL is only a manual deep link, and
    // merely logging it previously produced a false "whatsapp_count sent").
    // Truthful delivery state: scheduled reports are delivered by EMAIL
    // only; configured WhatsApp recipients are reported as SKIPPED.
    const whatsappSkipped = (schedule.whatsapp_recipients || []).length;

    // Update last_sent timestamp
    await base44.asServiceRole.entities.ReportSchedule.update(schedule_id, {
      last_sent: new Date().toISOString()
    });

    return Response.json({
      success: true,
      message: 'Report sent successfully',
      email_count: schedule.email_recipients?.length || 0,
      // TRUTHFUL DELIVERY — WhatsApp is not an automated channel.
      whatsapp_count: 0,
      whatsapp_skipped: whatsappSkipped,
    });

  } catch (error) {
    console.error('Error sending scheduled report:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function generateReportData(base44, scopeCid) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const data = {};

  // TENANT SCOPE MATCH — customer scope: only that customer's records;
  // no customer scope (platform creator): only unscoped legacy records.
  const scopeMatch = (rec) =>
    scopeCid ? rec.customer_id === scopeCid : (!rec.customer_id && !rec.reseller_id);

  try {
    // Get incidents
    const incidents = await base44.asServiceRole.entities.Incident.list();
    data.incidents = incidents.filter(inc => {
      const incDate = new Date(inc.reported_at);
      return scopeMatch(inc) && incDate >= today && incDate < tomorrow;
    });

    // Get shifts
    const shifts = await base44.asServiceRole.entities.Shift.list();
    data.shifts = shifts.filter(shift => {
      const shiftDate = new Date(shift.start_time);
      return scopeMatch(shift) && shiftDate >= today && shiftDate < tomorrow;
    });

    // Get maintenance requests
    const maintenance = await base44.asServiceRole.entities.MaintenanceRequest.list();
    data.maintenance = maintenance.filter(req => {
      const reqDate = new Date(req.reported_at);
      return scopeMatch(req) && reqDate >= today && reqDate < tomorrow;
    });

    // Get patrol logs
    const patrols = await base44.asServiceRole.entities.PatrolLog.list();
    data.patrols = patrols.filter(patrol => {
      const patrolDate = new Date(patrol.timestamp);
      return scopeMatch(patrol) && patrolDate >= today && patrolDate < tomorrow;
    });

  } catch (error) {
    console.error('Error fetching report data:', error);
  }

  return data;
}

function formatReportMessage(schedule, data) {
  const date = new Date().toLocaleDateString('en-ZA');

  let message = `📊 ${schedule.name}\n`;
  message += `📅 Date: ${date}\n`;
  message += `\n`;

  if (schedule.report_type === 'daily_activity' || schedule.report_type === 'incidents') {
    message += `🚨 Incidents: ${data.incidents?.length || 0}\n`;
    if (data.incidents && data.incidents.length > 0) {
      data.incidents.slice(0, 5).forEach(inc => {
        message += `  • ${inc.title} - ${inc.priority}\n`;
      });
    }
    message += `\n`;
  }

  if (schedule.report_type === 'daily_activity' || schedule.report_type === 'shift_attendance') {
    message += `👮 Shifts: ${data.shifts?.length || 0}\n`;
    const completedShifts = data.shifts?.filter(s => s.status === 'completed').length || 0;
    const activeShifts = data.shifts?.filter(s => s.status === 'active').length || 0;
    message += `  ✅ Completed: ${completedShifts}\n`;
    message += `  🔄 Active: ${activeShifts}\n`;
    message += `\n`;
  }

  if (schedule.report_type === 'daily_activity' || schedule.report_type === 'maintenance') {
    message += `🔧 Maintenance Requests: ${data.maintenance?.length || 0}\n`;
    message += `\n`;
  }

  if (schedule.report_type === 'patrol_coverage') {
    message += `🚶 Patrol Checkpoints: ${data.patrols?.length || 0}\n`;
    message += `\n`;
  }

  message += `\n---\n`;
  message += `Generated: ${new Date().toLocaleString('en-ZA')}`;

  return message;
}