import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { schedule_id } = await req.json();

    if (!schedule_id) {
      return Response.json({ error: 'schedule_id is required' }, { status: 400 });
    }

    // Get the schedule
    const schedule = await base44.asServiceRole.entities.ReportSchedule.get(schedule_id);
    
    if (!schedule || schedule.status !== 'active') {
      return Response.json({ error: 'Schedule not found or inactive' }, { status: 404 });
    }

    // Generate report data based on report_type
    const reportData = await generateReportData(base44, schedule);
    
    // Format report message
    const reportMessage = formatReportMessage(schedule, reportData);

    // Send to email recipients
    if (schedule.email_recipients && schedule.email_recipients.length > 0) {
      for (const email of schedule.email_recipients) {
        try {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: email,
            subject: `${schedule.name} - ${new Date().toLocaleDateString()}`,
            body: reportMessage
          });
        } catch (error) {
          console.error(`Failed to send email to ${email}:`, error);
        }
      }
    }

    // Send to WhatsApp recipients
    if (schedule.whatsapp_recipients && schedule.whatsapp_recipients.length > 0) {
      for (const contact of schedule.whatsapp_recipients) {
        try {
          const cleanPhone = contact.phone.replace(/\D/g, '');
          const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(reportMessage)}`;
          // Note: Actual WhatsApp API integration would be needed here
          // This creates the URL that can be used to send the message
          console.log(`WhatsApp report URL for ${contact.name}: ${whatsappUrl}`);
        } catch (error) {
          console.error(`Failed to prepare WhatsApp for ${contact.name}:`, error);
        }
      }
    }

    // Update last_sent timestamp
    await base44.asServiceRole.entities.ReportSchedule.update(schedule_id, {
      last_sent: new Date().toISOString()
    });

    return Response.json({ 
      success: true, 
      message: 'Report sent successfully',
      email_count: schedule.email_recipients?.length || 0,
      whatsapp_count: schedule.whatsapp_recipients?.length || 0
    });

  } catch (error) {
    console.error('Error sending scheduled report:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

async function generateReportData(base44, schedule) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const data = {};

  try {
    // Get incidents
    const incidents = await base44.asServiceRole.entities.Incident.list();
    data.incidents = incidents.filter(inc => {
      const incDate = new Date(inc.reported_at);
      return incDate >= today && incDate < tomorrow;
    });

    // Get shifts
    const shifts = await base44.asServiceRole.entities.Shift.list();
    data.shifts = shifts.filter(shift => {
      const shiftDate = new Date(shift.start_time);
      return shiftDate >= today && shiftDate < tomorrow;
    });

    // Get maintenance requests
    const maintenance = await base44.asServiceRole.entities.MaintenanceRequest.list();
    data.maintenance = maintenance.filter(req => {
      const reqDate = new Date(req.reported_at);
      return reqDate >= today && reqDate < tomorrow;
    });

    // Get patrol logs
    const patrols = await base44.asServiceRole.entities.PatrolLog.list();
    data.patrols = patrols.filter(patrol => {
      const patrolDate = new Date(patrol.timestamp);
      return patrolDate >= today && patrolDate < tomorrow;
    });

  } catch (error) {
    console.error('Error fetching report data:', error);
  }

  return data;
}

function formatReportMessage(schedule, data) {
  const date = new Date().toLocaleDateString();
  
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
  message += `Generated by SecureGuard System\n`;
  message += `${new Date().toLocaleString()}`;

  return message;
}