import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";

export default function AutoReportScheduler({ user }) {
  useEffect(() => {
    if (!user || (user.role_type !== "admin" && user.role_type !== "dispatcher")) {
      return;
    }

    const checkAndSendReports = async () => {
      try {
        const schedules = await base44.entities.ReportSchedule.filter({
          status: "active"
        });

        for (const schedule of schedules) {
          const shouldSend = checkIfShouldSend(schedule);
          
          if (shouldSend) {
            await sendReport(schedule);
          }
        }
      } catch (error) {
        console.error("Error checking scheduled reports:", error);
      }
    };

    const checkIfShouldSend = (schedule) => {
      const now = new Date();
      const lastSent = schedule.last_sent ? new Date(schedule.last_sent) : null;

      if (schedule.frequency === "realtime") {
        return false; // Realtime reports are sent immediately when created
      }

      // Check if we already sent today
      if (lastSent) {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const lastSentDate = new Date(lastSent.getFullYear(), lastSent.getMonth(), lastSent.getDate());
        
        if (schedule.frequency === "daily" && lastSentDate >= today) {
          return false;
        }
        
        if (schedule.frequency === "weekly") {
          const daysSinceLastSent = Math.floor((now - lastSent) / (1000 * 60 * 60 * 24));
          if (daysSinceLastSent < 7) return false;
        }
        
        if (schedule.frequency === "monthly") {
          if (lastSent.getMonth() === now.getMonth() && lastSent.getFullYear() === now.getFullYear()) {
            return false;
          }
        }
      }

      // Check if it's the right time
      if (schedule.send_time) {
        const [hours, minutes] = schedule.send_time.split(':');
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        
        // Send if we're within 5 minutes of scheduled time
        if (Math.abs(currentHour - parseInt(hours)) > 0 || Math.abs(currentMinute - parseInt(minutes)) > 5) {
          return false;
        }
      }

      return true;
    };

    const sendReport = async (schedule) => {
      try {
        const reportData = await generateReportData(schedule);
        const reportMessage = formatReportMessage(schedule, reportData);

        // Send to email recipients
        if (schedule.email_recipients && schedule.email_recipients.length > 0) {
          for (const email of schedule.email_recipients) {
            try {
              await base44.integrations.Core.SendEmail({
                to: email,
                subject: `${schedule.name} - ${new Date().toLocaleDateString()}`,
                body: reportMessage
              });
            } catch (error) {
              console.error(`Failed to send email to ${email}:`, error);
            }
          }
        }

        // Send to WhatsApp recipients (open URLs)
        if (schedule.whatsapp_recipients && schedule.whatsapp_recipients.length > 0) {
          for (const contact of schedule.whatsapp_recipients) {
            try {
              const cleanPhone = contact.phone.replace(/\D/g, '');
              const message = encodeURIComponent(reportMessage);
              console.log(`WhatsApp report ready for ${contact.name}: https://wa.me/${cleanPhone}?text=${message}`);
            } catch (error) {
              console.error(`Failed to prepare WhatsApp for ${contact.name}:`, error);
            }
          }
        }

        // Update last_sent timestamp
        await base44.entities.ReportSchedule.update(schedule.id, {
          last_sent: new Date().toISOString()
        });

        console.log(`✅ Report sent: ${schedule.name}`);
      } catch (error) {
        console.error(`Failed to send report ${schedule.name}:`, error);
      }
    };

    const generateReportData = async (schedule) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const data = {};

      try {
        const incidents = await base44.entities.Incident.list();
        data.incidents = incidents.filter(inc => {
          const incDate = new Date(inc.reported_at);
          return incDate >= today && incDate < tomorrow;
        });

        const shifts = await base44.entities.Shift.list();
        data.shifts = shifts.filter(shift => {
          const shiftDate = new Date(shift.start_time);
          return shiftDate >= today && shiftDate < tomorrow;
        });

        const maintenance = await base44.entities.MaintenanceRequest.list();
        data.maintenance = maintenance.filter(req => {
          const reqDate = new Date(req.reported_at);
          return reqDate >= today && reqDate < tomorrow;
        });

        const patrols = await base44.entities.PatrolLog.list();
        data.patrols = patrols.filter(patrol => {
          const patrolDate = new Date(patrol.timestamp);
          return patrolDate >= today && patrolDate < tomorrow;
        });
      } catch (error) {
        console.error('Error fetching report data:', error);
      }

      return data;
    };

    const formatReportMessage = (schedule, data) => {
      const date = new Date().toLocaleDateString();
      
      let message = `📊 ${schedule.name}\n`;
      message += `📅 Date: ${date}\n\n`;
      
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
        message += `  🔄 Active: ${activeShifts}\n\n`;
      }

      if (schedule.report_type === 'daily_activity' || schedule.report_type === 'maintenance') {
        message += `🔧 Maintenance Requests: ${data.maintenance?.length || 0}\n\n`;
      }

      if (schedule.report_type === 'patrol_coverage') {
        message += `🚶 Patrol Checkpoints: ${data.patrols?.length || 0}\n\n`;
      }

      message += `\n---\nGenerated by SecureGuard System\n${new Date().toLocaleString()}`;

      return message;
    };

    // Check immediately on load
    checkAndSendReports();

    // Then check every 5 minutes
    const interval = setInterval(checkAndSendReports, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user]);

  return null; // This component doesn't render anything
}