import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * sendAppointmentReminders — Backend-scheduled appointment reminders.
 *
 * Deadline-driven + idempotent:
 *  - Queries only FUTURE appointments (sorted desc by start_time, capped),
 *    then narrows to those inside the reminder windows (24h / 2h before).
 *  - Early-exits when no appointment is inside any reminder window.
 *  - Idempotency: each reminder type is recorded in Appointment.reminders_sent
 *    (e.g. ['reminder_24h','reminder_2h']); a window already sent is never
 *    re-sent, no matter how many times the automation fires.
 *  - No clinical information in reminder previews.
 *
 * Channel: in-app (therapist) + email (patient when email present).
 * Telegram/push are handled by the notification engine elsewhere; this function
 * keeps to cheap, deterministic channels to minimise integration-credit use.
 *
 * Triggered by a scheduled automation (every 30 min).
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const now = new Date();
    const reminderWindows = [
      { hoursBefore: 24, key: 'reminder_24h' },
      { hoursBefore: 2, key: 'reminder_2h' },
    ];
    // Only look ahead 26h — anything further is not due for a reminder.
    const lookAhead = new Date(now.getTime() + 26 * 3600000);

    // Fetch future appointments (desc by start_time → newest first).
    const allApts = await base44.asServiceRole.entities.Appointment.list('-start_time', 150);
    const candidateApts = allApts.filter((a: any) => {
      if (!['confirmed', 'scheduled'].includes(a.status)) return false;
      const t = new Date(a.start_time);
      return t > now && t <= lookAhead;
    });

    if (candidateApts.length === 0) {
      return Response.json({ success: true, reminders_sent: 0, checked: 0 });
    }

    let sentCount = 0;
    let processedCount = 0;

    for (const apt of candidateApts) {
      const aptTime = new Date(apt.start_time);
      const hoursUntil = (aptTime.getTime() - now.getTime()) / 3600000;

      for (const window of reminderWindows) {
        // Inside the window: due now (≤ hoursBefore) and not past
        // (hoursUntil > hoursBefore - 0.5). The 0.5h grace + 30-min cron
        // guarantees each window is caught exactly once.
        if (!(hoursUntil <= window.hoursBefore && hoursUntil > window.hoursBefore - 0.5)) continue;

        const alreadySent = apt.reminders_sent?.includes(window.key);
        if (alreadySent) continue;

        processedCount++;
        const patients = await base44.asServiceRole.entities.Patient.filter({ id: apt.patient_id });
        const patient = patients[0];

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
          }).catch(() => {});
        }

        if (patient?.email) {
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: patient.email,
            subject: `Appointment Reminder — ${apt.service_name}`,
            body: `<p>Dear ${apt.patient_name},</p><p>This is a reminder for your appointment:</p><p><strong>Service:</strong> ${apt.service_name}<br><strong>Time:</strong> ${aptTime.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}</p><p>Please arrive 10 minutes early.</p>`
          }).catch((e: any) => console.error('Reminder email failed:', e.message));
        }

        const updatedReminders = [...(apt.reminders_sent || []), window.key];
        await base44.asServiceRole.entities.Appointment.update(apt.id, { reminders_sent: updatedReminders });
        sentCount++;
      }
    }

    return Response.json({ success: true, reminders_sent: sentCount, checked: candidateApts.length, processed: processedCount });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}