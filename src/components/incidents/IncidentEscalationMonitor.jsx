import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

export default function IncidentEscalationMonitor({ user }) {
  const [lastCheck, setLastCheck] = useState(Date.now());

  useEffect(() => {
    if (!user || !['admin', 'dispatcher', 'supervisor'].includes(user.role_type)) {
      return;
    }

    const checkEscalations = async () => {
      try {
        const incidents = await base44.entities.Incident.filter({
          status: { $in: ['reported', 'assigned', 'in_progress'] }
        });

        const now = new Date();
        const ESCALATION_THRESHOLD_MINUTES = 30;

        for (const incident of incidents) {
          const reportedAt = new Date(incident.reported_at);
          const minutesSinceReport = (now - reportedAt) / (1000 * 60);
          const shouldEscalate = 
            !incident.escalated && (
              incident.priority === 'critical' || 
              incident.priority === 'high' ||
              minutesSinceReport > ESCALATION_THRESHOLD_MINUTES
            );

          if (shouldEscalate) {
            await escalateIncident(incident, minutesSinceReport > ESCALATION_THRESHOLD_MINUTES ? 'timeout' : 'priority');
          }
        }
      } catch (error) {
        console.error('Escalation check failed:', error);
      }
    };

    const escalateIncident = async (incident, reason) => {
      try {
        await base44.entities.Incident.update(incident.id, {
          escalated: true,
          escalation_reason: reason,
          escalated_at: new Date().toISOString()
        });

        const supervisors = await base44.entities.User.filter({
          role_type: { $in: ['admin', 'dispatcher', 'supervisor'] }
        });

        const emailPromises = supervisors
          .filter(sup => sup.email && sup.id !== incident.guard_id)
          .map(supervisor =>
            base44.integrations.Core.SendEmail({
              to: supervisor.email,
              subject: `🚨 ESCALATED INCIDENT: ${incident.title}`,
              body: `
<h2 style="color: #dc2626;">⚠️ INCIDENT ESCALATION ALERT</h2>

<p><strong>Incident ID:</strong> ${incident.id}</p>
<p><strong>Title:</strong> ${incident.title}</p>
<p><strong>Priority:</strong> <span style="color: #dc2626; font-weight: bold;">${incident.priority?.toUpperCase()}</span></p>
<p><strong>Status:</strong> ${incident.status}</p>
<p><strong>Site:</strong> ${incident.site_name}</p>
<p><strong>Assigned Guard:</strong> ${incident.guard_name}</p>

<p><strong>Escalation Reason:</strong> ${
  reason === 'priority' 
    ? 'High/Critical Priority Incident' 
    : 'Incident unresolved for 30+ minutes'
}</p>

<p><strong>Reported:</strong> ${new Date(incident.reported_at).toLocaleString()}</p>
<p><strong>Time Elapsed:</strong> ${Math.round((new Date() - new Date(incident.reported_at)) / 60000)} minutes</p>

<h3>Description:</h3>
<p>${incident.description?.substring(0, 500)}...</p>

<p style="color: #dc2626; font-weight: bold;">This incident requires immediate attention and may need reassignment.</p>

<p>Log into SecureGuard to review and take action.</p>
              `
            }).catch(err => console.error(`Email failed for ${supervisor.email}:`, err))
          );

        await Promise.allSettled(emailPromises);

        await base44.entities.Alert.create({
          type: 'system',
          priority: 'critical',
          title: 'Incident Escalated',
          message: `Incident "${incident.title}" at ${incident.site_name} has been escalated. Reason: ${reason === 'priority' ? 'High/Critical Priority' : 'Unresolved for 30+ minutes'}. Immediate action required.`,
          status: 'active',
          metadata: {
            incident_id: incident.id,
            escalation_reason: reason,
            original_guard: incident.guard_name
          }
        });

        const guardUser = await base44.entities.User.get(incident.guard_id);
        if (guardUser?.current_workload >= 2) {
          await attemptReassignment(incident);
        }
      } catch (error) {
        console.error('Escalation failed:', error);
      }
    };

    const attemptReassignment = async (incident) => {
      try {
        const activeShifts = await base44.entities.Shift.filter({ status: 'active' });
        const availableGuards = [];

        for (const shift of activeShifts) {
          if (shift.guard_id === incident.guard_id) continue;

          const user = await base44.entities.User.get(shift.guard_id);
          if (user?.current_workload < 2 && shift.site_id === incident.site_id) {
            availableGuards.push({
              guard_id: user.id,
              guard_name: user.full_name,
              workload: user.current_workload || 0,
              shift_id: shift.id
            });
          }
        }

        if (availableGuards.length > 0) {
          availableGuards.sort((a, b) => a.workload - b.workload);
          const newGuard = availableGuards[0];

          await base44.entities.Incident.update(incident.id, {
            assigned_to: newGuard.guard_id,
            guard_name: newGuard.guard_name,
            status: 'assigned',
            reassigned: true,
            reassignment_reason: 'Automatic escalation - original guard overloaded'
          });

          await base44.entities.Alert.create({
            type: 'assignment',
            priority: 'high',
            title: 'Escalated Incident Assigned',
            message: `You have been assigned escalated incident "${incident.title}" at ${incident.site_name}. This requires immediate attention.`,
            guard_id: newGuard.guard_id,
            guard_name: newGuard.guard_name,
            status: 'active',
            metadata: { incident_id: incident.id, escalated: true }
          });

          const supervisors = await base44.entities.User.filter({
            role_type: { $in: ['admin', 'dispatcher', 'supervisor'] }
          });

          const reassignmentEmails = supervisors
            .filter(sup => sup.email)
            .map(supervisor =>
              base44.integrations.Core.SendEmail({
                to: supervisor.email,
                subject: `Incident Reassigned: ${incident.title}`,
                body: `
<h2>Incident Automatically Reassigned</h2>
<p><strong>Incident:</strong> ${incident.title}</p>
<p><strong>Original Guard:</strong> ${incident.guard_name} (Overloaded)</p>
<p><strong>New Guard:</strong> ${newGuard.guard_name}</p>
<p><strong>Site:</strong> ${incident.site_name}</p>
<p>The incident has been reassigned due to workload optimization.</p>
                `
              }).catch(err => console.error(`Reassignment email failed:`, err))
            );

          await Promise.allSettled(reassignmentEmails);
        }
      } catch (error) {
        console.error('Reassignment failed:', error);
      }
    };

    checkEscalations();
    const interval = setInterval(checkEscalations, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, lastCheck]);

  return null;
}