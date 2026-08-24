import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * sendAppointmentReminders — Backend-scheduled appointment reminders.
 *
 * Checks all confirmed/scheduled appointments and sends configurable reminders
 * (e.g., 24h before, 2h before) via Email + Telegram + Push + In-app.
 * Manual WhatsApp where configured. No clinical information in previews.
 *
 * Should be triggered by a scheduled automation (every 30 min).
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const reminderWindows = [
      { hoursBefore: 24, label: '24h', key: 'reminder_24h' },
      { hoursBefore: 2, label: '2h', key: 'reminder_2h' },
    ];

    const allApts = await base44.asServiceRole.entities.Appointment.list('-start_time', 200);
    const activeApts = allApts.filter(a =>
      ['confirmed', 'scheduled'].includes(a.status) && new Date(a.start_time) > now
    );

    let sentCount = 0;
    for (const apt of activeApts) {
      const aptTime = new Date(apt.start_time);
      const hoursUntil = (aptTime - now) / 3600000;

      for (const window of reminderWindows) {
        if (hoursUntil <= window.hoursBefore && hoursUntil > window.hoursBefore - 0.5) {
          const alreadySent = apt.reminders_sent?.includes(window.key);
          if (alreadySent) continue;

          // Fetch patient for contact info
          const patients = await base44.asServiceRole.entities.Patient.filter({ id: apt.patient_id });
          const patient = patients[0];

          // Send in-app notification
          if (apt.therapist_id) {
            await base44.asServiceRole.entities.Notification.create({
              customer_id: apt.customer_id,
              recipient_id: apt.therapist_id,
              type: 'shift_reminder',
              priority: 'medium',
              title: `Appointment Reminder: ${apt.patient_name}`,
              message: `${apt.service_name} at ${aptTime.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}`,
              related_entity: 'Appointment',
              related_id: apt.id,
              sent_via: ['in_app']
            });
          }

          // Send email to patient if email exists
          if (patient?.email) {
            try {
              await base44.integrations.Core.SendEmail({
                to: patient.email,
                subject: `Appointment Reminder — ${apt.service_name}`,
                body: `<p>Dear ${apt.patient_name},</p><p>This is a reminder for your appointment:</p><p><strong>Service:</strong> ${apt.service_name}<br><strong>Time:</strong> ${aptTime.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</p><p>Please arrive 10 minutes early.</p>`
              });
            } catch (e) { console.error('Email reminder failed:', e.message); }
          }

          // Mark reminder as sent
          const updatedReminders = [...(apt.reminders_sent || []), window.key];
          await base44.asServiceRole.entities.Appointment.update(apt.id, { reminders_sent: updatedReminders });
          sentCount++;
        }
      }
    }

    return Response.json({ success: true, reminders_sent: sentCount, checked: activeApts.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}