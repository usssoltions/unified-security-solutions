import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get shifts starting in the next 2-3 hours
    const now = new Date();
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    // Fetch all scheduled shifts
    const shifts = await base44.asServiceRole.entities.Shift.filter({
      status: 'scheduled'
    });

    // Filter shifts starting in 2-3 hours that haven't been reminded
    const upcomingShifts = shifts.filter(shift => {
      const startTime = new Date(shift.start_time);
      return startTime >= twoHoursFromNow && startTime <= threeHoursFromNow;
    });

    // Get all users to match guards
    const allUsers = await base44.asServiceRole.entities.User.filter({});

    // Send reminders
    const reminderPromises = upcomingShifts.map(async (shift) => {
      const guard = allUsers.find(u => u.id === shift.guard_id);
      if (!guard) return null;

      return base44.asServiceRole.functions.invoke('sendShiftNotification', {
        shiftId: shift.id,
        guardId: shift.guard_id,
        guardEmail: guard.email,
        guardName: shift.guard_name,
        siteName: shift.site_name,
        startTime: shift.start_time,
        endTime: shift.end_time,
        notificationType: 'reminder'
      });
    });

    await Promise.all(reminderPromises.filter(Boolean));

    return Response.json({ 
      success: true, 
      remindersSent: upcomingShifts.length
    });
  } catch (error) {
    console.error('Error sending shift reminders:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});