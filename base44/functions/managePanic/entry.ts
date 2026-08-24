/**
 * managePanic
 *
 * Handles the Panic lifecycle: acknowledge, assign, accept, resolve, cancel,
 * escalate. All operations verify the caller's role before updating. Each
 * operation appends an activity_log entry and notifies the relevant parties
 * (in-app Notification + email where appropriate). Uses asServiceRole so
 * cross-user notifications always succeed regardless of the caller's RLS.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildPanicEmail, esc } from '../../shared/panicEmailTemplate.ts';

const OPERATIONAL_ROLES = ['admin', 'dispatcher', 'supervisor', 'estate_manager', 'management'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { panicId, action, assigneeId, assigneeName, resolutionNotes } = body;

    if (!panicId || !action) {
      return Response.json({ error: 'panicId and action required' }, { status: 400 });
    }

    const panic = await base44.asServiceRole.entities.PanicAlert.get(panicId);
    if (!panic) {
      return Response.json({ error: 'Panic not found' }, { status: 404 });
    }

    // Tenant scope for recipient resolution — a panic lifecycle notification
    // only reaches management in the panic's own tenant. Platform admins
    // (explicit) notify across all tenants.
    const panicPlatformSender =
      user.role_type === 'platform_admin' || user.admin_level === 'platform';
    const panicTenantFilter = panicPlatformSender
      ? {}
      : (panic.customer_id
          ? { customer_id: panic.customer_id }
          : (panic.reseller_id
              ? { reseller_id: panic.reseller_id }
              : { id: user.id }));

    const nowIso = new Date().toISOString();
    const userName = user.display_name || user.full_name;
    const isOperational = OPERATIONAL_ROLES.includes(user.role_type);
    const updateFields: Record<string, any> = {};
    const logEntry: Record<string, any> = {
      timestamp: nowIso,
      by_user_id: user.id,
      by_user_name: userName,
    };

    let notifyUserIds: string[] = [];
    let notifyTitle = '';
    let notifyMessage = '';
    let sendEmailToUser = false;

    switch (action) {
      case 'acknowledge':
        if (!isOperational) {
          return Response.json({ error: 'Not authorized to acknowledge panics' }, { status: 403 });
        }
        updateFields.status = 'acknowledged';
        updateFields.acknowledged_by = user.id;
        updateFields.acknowledged_by_name = userName;
        updateFields.acknowledged_at = nowIso;
        logEntry.action = 'acknowledged';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'acknowledged';
        logEntry.notes = `Acknowledged by ${userName}`;
        // Notify the originator that their panic was acknowledged
        notifyUserIds = [panic.user_id];
        notifyTitle = '✓ Your Panic has been acknowledged';
        notifyMessage = `Your PANIC alert has been acknowledged by ${userName} (${user.role_type}). Help is on the way.`;
        sendEmailToUser = true;
        break;

      case 'assign':
        if (!isOperational) {
          return Response.json({ error: 'Not authorized to assign panics' }, { status: 403 });
        }
        if (!assigneeId || !assigneeName) {
          return Response.json({ error: 'assigneeId and assigneeName required' }, { status: 400 });
        }
        updateFields.status = 'assigned';
        updateFields.assigned_to = assigneeId;
        updateFields.assigned_to_name = assigneeName;
        updateFields.assigned_by = user.id;
        updateFields.assigned_by_name = userName;
        updateFields.assigned_at = nowIso;
        logEntry.action = 'assigned';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'assigned';
        logEntry.notes = `Assigned to ${assigneeName} by ${userName}`;
        // Notify the assignee
        notifyUserIds = [assigneeId];
        notifyTitle = `🚨 PANIC assigned to you — ${panic.user_name}`;
        notifyMessage = `A PANIC alert from ${panic.user_name} at ${panic.site_name || 'unknown site'} has been assigned to you. Please respond immediately.`;
        sendEmailToUser = true;
        break;

      case 'accept':
        if (panic.assigned_to !== user.id && !isOperational) {
          return Response.json({ error: 'Not authorized to accept this panic' }, { status: 403 });
        }
        updateFields.status = 'accepted';
        updateFields.accepted_by = user.id;
        updateFields.accepted_by_name = userName;
        updateFields.accepted_at = nowIso;
        logEntry.action = 'accepted';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'accepted';
        logEntry.notes = `Accepted by ${userName}`;
        // Notify operational roles + originator (panic-tenant-scoped)
        const allUsers = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
        notifyUserIds = allUsers.filter(u => OPERATIONAL_ROLES.includes(u.role_type)).map(u => u.id);
        notifyUserIds.push(panic.user_id);
        notifyTitle = `✓ PANIC accepted — ${userName} is responding`;
        notifyMessage = `${userName} has accepted the PANIC alert from ${panic.user_name} and is responding.`;
        sendEmailToUser = false;
        break;

      case 'resolve':
        if (!isOperational && panic.user_id !== user.id) {
          return Response.json({ error: 'Not authorized to resolve this panic' }, { status: 403 });
        }
        if (!resolutionNotes || resolutionNotes.trim().length < 5) {
          return Response.json({ error: 'Resolution notes required (min 5 characters)' }, { status: 400 });
        }
        updateFields.status = 'resolved';
        updateFields.resolved_by = user.id;
        updateFields.resolved_by_name = userName;
        updateFields.resolved_at = nowIso;
        updateFields.resolution_notes = resolutionNotes;
        logEntry.action = 'resolved';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'resolved';
        logEntry.notes = resolutionNotes;
        const allUsersResolve = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
        notifyUserIds = allUsersResolve.filter(u => OPERATIONAL_ROLES.includes(u.role_type)).map(u => u.id);
        if (!notifyUserIds.includes(panic.user_id)) notifyUserIds.push(panic.user_id);
        notifyTitle = `✓ PANIC resolved — ${panic.user_name}`;
        notifyMessage = `The PANIC alert from ${panic.user_name} has been resolved by ${userName}. Notes: ${resolutionNotes}`;
        sendEmailToUser = false;
        break;

      case 'cancel':
        if (panic.user_id !== user.id && !isOperational) {
          return Response.json({ error: 'Not authorized to cancel this panic' }, { status: 403 });
        }
        updateFields.status = 'cancelled';
        updateFields.resolved_by = user.id;
        updateFields.resolved_by_name = userName;
        updateFields.resolved_at = nowIso;
        updateFields.resolution_notes = 'Cancelled by user';
        logEntry.action = 'cancelled';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'cancelled';
        logEntry.notes = 'Cancelled by activator/management';
        const allUsersCancel = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
        notifyUserIds = allUsersCancel.filter(u => OPERATIONAL_ROLES.includes(u.role_type)).map(u => u.id);
        notifyTitle = `PANIC cancelled — ${panic.user_name}`;
        notifyMessage = `The PANIC alert from ${panic.user_name} has been cancelled.`;
        sendEmailToUser = false;
        break;

      case 'escalate':
        if (!isOperational) {
          return Response.json({ error: 'Not authorized to escalate panics' }, { status: 403 });
        }
        updateFields.escalated = true;
        updateFields.escalated_at = nowIso;
        updateFields.escalation_count = (panic.escalation_count || 0) + 1;
        logEntry.action = 'escalated';
        logEntry.from_status = panic.status;
        logEntry.to_status = panic.status;
        logEntry.notes = `Escalation #${updateFields.escalation_count} — panic remains unacknowledged`;
        const allUsersEsc = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
        notifyUserIds = allUsersEsc.filter(u => OPERATIONAL_ROLES.includes(u.role_type)).map(u => u.id);
        notifyTitle = `🚨 PANIC UNACKNOWLEDGED — ESCALATION #${updateFields.escalation_count}`;
        notifyMessage = `PANIC alert from ${panic.user_name} at ${panic.site_name || 'unknown site'} remains UNACKNOWLEDGED. This is escalation #${updateFields.escalation_count}. RESPOND IMMEDIATELY.`;
        sendEmailToUser = true;
        break;

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    updateFields.activity_log = [...(panic.activity_log || []), logEntry];

    await base44.asServiceRole.entities.PanicAlert.update(panicId, updateFields);

    // Dispatch notifications to relevant parties (panic-tenant-scoped lookup)
    if (notifyUserIds.length > 0) {
      const allUsers = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
      const targets = allUsers.filter(u => notifyUserIds.includes(u.id));

      await Promise.allSettled(targets.map(async (target) => {
        try {
          await base44.asServiceRole.entities.Notification.create({
            recipient_id: target.id,
            recipient_name: target.full_name,
            type: 'system',
            priority: action === 'resolve' || action === 'cancel' ? 'high' : 'critical',
            title: notifyTitle,
            message: notifyMessage,
            read: false,
            related_entity: 'panic',
            related_id: panicId,
            action_url: target.id === panic.user_id ? '/PanicManagement' : '/PanicManagement',
            sent_via: ['in_app']
          });

          if (sendEmailToUser && target.email) {
            const emailBody = buildPanicEmail({
              userName: panic.user_name, userRole: panic.user_role, badgeNumber: panic.badge_number,
              siteName: panic.site_name, panicNumber: panic.panic_number, activatedAt: panic.activated_at,
              location: updateFields.location || panic.location, gpsAccuracy: panic.gps_accuracy,
              notes: panic.notes, status: updateFields.status || panic.status,
              isEscalation: action === 'escalate'
            });
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: target.email,
              from_name: 'USS EMERGENCY',
              subject: notifyTitle,
              body: emailBody
            }).catch(e => console.error(`Panic workflow email failed for ${target.email}:`, e));
          }
        } catch (e) {
          console.error(`Panic workflow notification failed for ${target.id}:`, e);
        }
      }));
    }

    return Response.json({
      success: true,
      action: action,
      status: updateFields.status || panic.status
    });

  } catch (error) {
    console.error('Manage panic error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});