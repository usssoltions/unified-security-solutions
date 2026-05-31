/**
 * monitorHighPriorityIncidents
 * 
 * NOW triggered as an entity automation (on Incident create/update),
 * NOT on a schedule. This eliminates all polling credit costs.
 * 
 * Only fires when incident priority === 'critical' and notification hasn't been sent yet.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    // Entity automation payload: { event, data, old_data }
    const incident = body.data;
    if (!incident) {
      return Response.json({ skipped: true, reason: 'No incident data' });
    }

    // Only act on critical priority incidents that haven't been notified yet
    if (incident.priority !== 'critical') {
      return Response.json({ skipped: true, reason: 'Not critical priority' });
    }

    if (incident.notification_sent === true) {
      return Response.json({ skipped: true, reason: 'Notification already sent' });
    }

    // Get all admins and dispatchers in one query
    const allUsers = await base44.asServiceRole.entities.User.list();
    const recipients = allUsers.filter(u =>
      u.role_type === 'admin' || u.role_type === 'dispatcher'
    );

    if (recipients.length === 0) {
      return Response.json({ skipped: true, reason: 'No admins/dispatchers found' });
    }

    const subject = `🚨 CRITICAL INCIDENT - ${(incident.category || '').toUpperCase()} at ${incident.site_name}`;
    const emailBody = `CRITICAL INCIDENT ALERT

Type: ${(incident.category || '').toUpperCase()}
Title: ${incident.title}
Description: ${incident.description || 'No description provided'}

Guard: ${incident.guard_name}
Site: ${incident.site_name}
Location: ${incident.location ? `${incident.location.lat}, ${incident.location.lng}` : 'Not available'}
Reported: ${new Date(incident.reported_at || incident.created_date).toLocaleString('en-ZA')}
Status: ${incident.status}

IMMEDIATE ACTION REQUIRED — Log in to respond.`;

    // Send all notifications in parallel — one batch, not per-admin loops
    const notifPromises = recipients.map(admin =>
      base44.asServiceRole.entities.Notification.create({
        recipient_id: admin.id,
        recipient_name: admin.full_name,
        type: 'incident_critical',
        priority: 'critical',
        title: `🚨 Critical Incident: ${incident.title}`,
        message: `${incident.category}: ${incident.title} at ${incident.site_name} — ${incident.guard_name}`,
        read: false,
        related_entity: 'incident',
        related_id: incident.id,
        sent_via: ['in_app', 'email'],
      }).catch(() => {})
    );

    const emailPromises = recipients
      .filter(u => u.email)
      .map(admin =>
        base44.asServiceRole.integrations.Core.SendEmail({
          to: admin.email,
          subject,
          body: emailBody,
        }).catch(() => {})
      );

    await Promise.all([...notifPromises, ...emailPromises]);

    // Mark notification as sent to prevent duplicates
    await base44.asServiceRole.entities.Incident.update(incident.id, {
      notification_sent: true,
    });

    return Response.json({
      success: true,
      notified: recipients.length,
    });

  } catch (error) {
    console.error('monitorHighPriorityIncidents error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});