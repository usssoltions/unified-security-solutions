import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const now = new Date();
    const graceMinutes = 15; // Allow 15 minutes late
    const checkTimeStart = new Date(now.getTime() - graceMinutes * 60000);
    
    // Get all scheduled shifts that should have started
    const shifts = await base44.asServiceRole.entities.Shift.filter({
      status: 'scheduled'
    });
    
    const missedShifts = [];
    
    for (const shift of shifts) {
      const shiftStart = new Date(shift.start_time);
      
      // Check if shift start time has passed (with grace period)
      if (shiftStart < checkTimeStart) {
        // This shift should have been clocked in
        if (!shift.clock_in || !shift.clock_in.timestamp) {
          missedShifts.push(shift);
          
          // Update shift status
          await base44.asServiceRole.entities.Shift.update(shift.id, {
            status: 'missed'
          });
          
          // Get all admins and supervisors
          const allUsers = await base44.asServiceRole.entities.User.filter({});
          const recipients = allUsers.filter(u => 
            u.role_type === 'admin' || 
            u.role_type === 'supervisor' ||
            u.role_type === 'dispatcher'
          );
          
          const title = '⚠️ Missed Clock-In Alert';
          const message = `${shift.guard_name} failed to clock in for shift at ${shift.site_name}. Scheduled start: ${shiftStart.toLocaleString()}`;
          
          // Create alert
          await base44.asServiceRole.entities.Alert.create({
            type: 'missed_checkin',
            priority: 'high',
            title: title,
            message: message,
            guard_id: shift.guard_id,
            guard_name: shift.guard_name,
            site_id: shift.site_id,
            shift_id: shift.id,
            status: 'active'
          });
          
          // Notify all recipients
          const notificationPromises = recipients.map(recipient =>
            base44.asServiceRole.functions.invoke('sendPushNotification', {
              userId: recipient.id,
              title: title,
              message: message,
              type: 'ATTENDANCE',
              priority: 'high',
              data: {
                shiftId: shift.id,
                guardId: shift.guard_id,
                related_entity: 'shift',
                related_id: shift.id
              },
              channels: ['push', 'email', 'whatsapp']
            })
          );
          
          // Send to customer emails
          const customerEmails = Deno.env.get('CUSTOMER_EMAILS')?.split(',') || [];
          for (const email of customerEmails) {
            if (email.trim()) {
              notificationPromises.push(
                base44.asServiceRole.integrations.Core.SendEmail({
                  from_name: 'Unified Security Solutions',
                  to: email.trim(),
                  subject: '⚠️ Missed Clock-In Alert',
                  body: `
                    <h2>Missed Clock-In Alert</h2>
                    <p><strong>Guard:</strong> ${shift.guard_name}</p>
                    <p><strong>Site:</strong> ${shift.site_name}</p>
                    <p><strong>Scheduled Start:</strong> ${shiftStart.toLocaleString()}</p>
                    <p><strong>Status:</strong> Did not clock in</p>
                    <br>
                    <p>Immediate follow-up required.</p>
                  `
                })
              );
            }
          }
          
          await Promise.all(notificationPromises);
        }
      }
    }
    
    // Check for missed clock-outs
    const activeShifts = await base44.asServiceRole.entities.Shift.filter({
      status: 'active'
    });
    
    const missedClockOuts = [];
    
    for (const shift of activeShifts) {
      const shiftEnd = new Date(shift.end_time);
      
      // Check if shift end time has passed
      if (shiftEnd < checkTimeStart) {
        if (!shift.clock_out || !shift.clock_out.timestamp) {
          missedClockOuts.push(shift);
          
          // Get all admins
          const allUsers = await base44.asServiceRole.entities.User.filter({});
          const recipients = allUsers.filter(u => 
            u.role_type === 'admin' || 
            u.role_type === 'supervisor'
          );
          
          const title = '⚠️ Missed Clock-Out Alert';
          const message = `${shift.guard_name} failed to clock out from shift at ${shift.site_name}. Scheduled end: ${shiftEnd.toLocaleString()}`;
          
          // Notify
          const notificationPromises = recipients.map(recipient =>
            base44.asServiceRole.functions.invoke('sendPushNotification', {
              userId: recipient.id,
              title: title,
              message: message,
              type: 'ATTENDANCE',
              priority: 'high',
              data: {
                shiftId: shift.id,
                guardId: shift.guard_id
              },
              channels: ['push', 'email']
            })
          );
          
          await Promise.all(notificationPromises);
        }
      }
    }
    
    return Response.json({ 
      success: true,
      missedClockIns: missedShifts.length,
      missedClockOuts: missedClockOuts.length
    });
  } catch (error) {
    console.error('Attendance monitoring error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});