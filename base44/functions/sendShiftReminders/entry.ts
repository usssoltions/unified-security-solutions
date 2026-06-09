import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    // Only fetch scheduled/accepted shifts that haven't had a reminder sent yet
    const shifts = await base44.asServiceRole.entities.Shift.filter({ status: 'scheduled' });
    const acceptedShifts = await base44.asServiceRole.entities.Shift.filter({ status: 'accepted' });
    const allCandidates = [...shifts, ...acceptedShifts];

    // Only shifts starting in 2-3 hours, with a guard, and reminder NOT already sent
    const upcomingShifts = allCandidates.filter(shift => {
      if (!shift.guard_id) return false;
      if (shift.reminder_sent) return false; // skip if already reminded
      const startTime = new Date(shift.start_time);
      return startTime >= twoHoursFromNow && startTime <= threeHoursFromNow;
    });

    // Exit early if no shifts due — zero integration calls
    if (upcomingShifts.length === 0) {
      return Response.json({ success: true, remindersSent: 0, reason: 'No upcoming shifts in window' });
    }

    // Fetch only the guards we actually need
    const guardIds = [...new Set(upcomingShifts.map(s => s.guard_id))];
    const allUsers = await base44.asServiceRole.entities.User.list();
    const guardMap = Object.fromEntries(allUsers.filter(u => guardIds.includes(u.id)).map(u => [u.id, u]));

    // Send email + mark shift so it never gets reminded again
    const reminderPromises = upcomingShifts.map(async (shift) => {
      const guard = guardMap[shift.guard_id];
      if (!guard?.email) return null;

      await base44.asServiceRole.integrations.Core.SendEmail({
        from_name: 'SecureGuard',
        to: guard.email,
        subject: `⏰ Shift Reminder — ${shift.site_name}`,
        body: `
Hi ${shift.guard_name || guard.full_name},

This is a reminder that your shift starts in approximately 2 hours.

Site: ${shift.site_name}
Start: ${new Date(shift.start_time).toLocaleString('en-ZA')}
End:   ${new Date(shift.end_time).toLocaleString('en-ZA')}

Please ensure you arrive on time and clock in via the SecureGuard app.

– SecureGuard System
        `.trim()
      }).catch(err => console.error(`Reminder failed for ${guard.email}:`, err.message));

      // Mark shift so this reminder is never sent again
      await base44.asServiceRole.entities.Shift.update(shift.id, { reminder_sent: true })
        .catch(() => {});
    });

    await Promise.all(reminderPromises.filter(Boolean));

    return Response.json({ success: true, remindersSent: upcomingShifts.length });
  } catch (error) {
    console.error('Error sending shift reminders:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});