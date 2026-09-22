import { useEffect, useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { fetchTenantUsers } from "@/lib/tenantLookups";
import { getUserDisplayName } from "@/lib/userDisplayName";

export default function IncidentEscalationMonitor({ user }) {
  const [lastCheck, setLastCheck] = useState(Date.now());

  useEffect(() => {
    if (!user || !['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'].includes(user.role_type)) {
      return;
    }

    const checkEscalations = async () => {
      try {
        const incidents = await base44.entities.Incident.filter({
          status: { $in: ['reported', 'assigned', 'in_progress'] }
        });

        if (!Array.isArray(incidents)) return;

        const now = new Date();
        const ESCALATION_THRESHOLD_MINUTES = 30;
        
        // Categories that should be escalated (exclude reports/routine items)
        const escalatableCategories = [
          'fire', 'theft', 'vandalism', 'medical', 'trespassing', 
          'suspicious_activity', 'equipment_failure', 'safety_hazard', 'other'
        ];

        for (const incident of incidents) {
          // Skip if not an escalatable category (e.g., routine reports)
          if (!escalatableCategories.includes(incident.category)) {
            continue;
          }

          const reportedAt = new Date(incident.reported_at);
          const minutesSinceReport = (now - reportedAt) / (1000 * 60);
          // Require at least 5 minutes before escalating even critical/high incidents
          // to avoid immediately escalating freshly reported incidents
          const minMinutesBeforeEscalation = incident.priority === 'critical' ? 5 : 10;
          const shouldEscalate =
            !incident.escalated &&
            minutesSinceReport >= minMinutesBeforeEscalation &&
            (
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

        // SERVER-AUTHORITATIVE branded dispatch — recipients, tenant scope,
        // branding and delivery auditing are resolved server-side from the
        // Incident record (sendIncidentEscalationNotice). No client-composed
        // email remains on this path.
        await base44.functions.invoke("sendIncidentEscalationNotice", {
          kind: "escalation",
          incident_id: incident.id,
          reason
        });

        await base44.entities.Alert.create({
          customer_id: incident?.customer_id || undefined,
          reseller_id: incident?.reseller_id || undefined,
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
        if (!Array.isArray(activeShifts)) return;

        // Filter shifts at the same site first — avoid per-shift User.get() calls
        const sameSiteShifts = activeShifts.filter(
          s => s.guard_id !== incident.guard_id && s.site_id === incident.site_id
        );
        if (sameSiteShifts.length === 0) return;

        // Fetch all guards in one batch instead of one-by-one
        const guardIds = [...new Set(sameSiteShifts.map(s => s.guard_id))];
        // Tenant-scoped user list via the getTenantUsers gateway.
        const allUsers = await fetchTenantUsers();
        const guardsMap = Object.fromEntries(
          (Array.isArray(allUsers) ? allUsers : []).map(u => [u.id, u])
        );

        const availableGuards = [];
        for (const shift of sameSiteShifts) {
          const user = guardsMap[shift.guard_id];
          if (user && (user.current_workload || 0) < 2) {
            availableGuards.push({
              guard_id: user.id,
              guard_name: getUserDisplayName(user),
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
            customer_id: incident?.customer_id || undefined,
            reseller_id: incident?.reseller_id || undefined,
            type: 'assignment',
            priority: 'high',
            title: 'Escalated Incident Assigned',
            message: `You have been assigned escalated incident "${incident.title}" at ${incident.site_name}. This requires immediate attention.`,
            guard_id: newGuard.guard_id,
            guard_name: newGuard.guard_name,
            status: 'active',
            metadata: { incident_id: incident.id, escalated: true }
          });

          // SERVER-AUTHORITATIVE branded dispatch (see escalation path).
          await base44.functions.invoke("sendIncidentEscalationNotice", {
            kind: "reassignment",
            incident_id: incident.id,
            original_guard_name: incident.guard_name,
            new_guard_name: newGuard.guard_name
          });
        }
      } catch (error) {
        console.error('Reassignment failed:', error);
      }
    };

    // Delay initial check by 30s to avoid startup rate limits
    const initialTimeout = setTimeout(checkEscalations, 30000);
    const interval = setInterval(checkEscalations, 10 * 60 * 1000); // every 10 min

    return () => { clearTimeout(initialTimeout); clearInterval(interval); };
  }, [user, lastCheck]);

  return null;
}