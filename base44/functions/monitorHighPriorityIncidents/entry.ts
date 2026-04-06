import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Get recent high priority incidents that are not resolved
    const incidents = await base44.asServiceRole.entities.Incident.filter({
      priority: "critical"
    });

    const unresolvedIncidents = incidents.filter(incident => {
      const reportedAt = new Date(incident.reported_at);
      const isRecent = reportedAt >= fiveMinutesAgo;
      const isUnresolved = incident.status !== "resolved" && incident.status !== "closed";
      return isRecent && isUnresolved;
    });

    const alertsCreated = [];

    for (const incident of unresolvedIncidents) {
      // Check if critical alert already exists
      const existingAlerts = await base44.asServiceRole.entities.Alert.filter({
        type: "critical_incident",
        metadata: { incident_id: incident.id },
        status: "active"
      });

      if (existingAlerts.length === 0) {
        const alert = await base44.asServiceRole.entities.Alert.create({
          type: "panic",
          priority: "critical",
          title: "🚨 Critical Incident Reported",
          message: `${incident.category.toUpperCase()}: ${incident.title} at ${incident.site_name}. Guard: ${incident.guard_name}`,
          guard_id: incident.guard_id,
          guard_name: incident.guard_name,
          site_id: incident.site_id,
          location: incident.location,
          status: "active",
          metadata: {
            incident_id: incident.id,
            category: incident.category,
            priority: incident.priority
          }
        });

        // Send immediate notifications to all dispatchers and admins
        const responders = await base44.asServiceRole.entities.User.list();
        const adminAndDispatch = responders.filter(u => 
          u.role_type === "admin" || u.role_type === "dispatcher"
        );

        for (const responder of adminAndDispatch) {
          try {
            // Send email
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: responder.email,
              subject: `🚨 CRITICAL INCIDENT - ${incident.category.toUpperCase()}`,
              body: `
CRITICAL INCIDENT ALERT

Type: ${incident.category.toUpperCase()}
Title: ${incident.title}
Description: ${incident.description || 'No description provided'}

Guard: ${incident.guard_name}
Site: ${incident.site_name}
Location: ${incident.location ? `${incident.location.lat}, ${incident.location.lng}` : 'Not available'}
Reported: ${new Date(incident.reported_at).toLocaleString()}

Status: ${incident.status}

IMMEDIATE ACTION REQUIRED - Log in to the system to respond.
              `
            });

            // Create in-app notification
            await base44.asServiceRole.entities.Notification.create({
              recipient_id: responder.id,
              recipient_name: responder.full_name,
              type: "incident_critical",
              priority: "critical",
              title: "Critical Incident Alert",
              message: `${incident.category}: ${incident.title} at ${incident.site_name}`,
              related_entity: "incident",
              related_id: incident.id,
              sent_via: ["in_app", "email"]
            });
          } catch (notifError) {
            console.error("Failed to send notification:", notifError);
          }
        }

        alertsCreated.push(alert);
      }
    }

    return Response.json({
      success: true,
      incidentsChecked: unresolvedIncidents.length,
      alertsCreated: alertsCreated.length,
      alerts: alertsCreated
    });

  } catch (error) {
    console.error("Error monitoring incidents:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});