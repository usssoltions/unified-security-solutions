/**
 * managePanic
 *
 * Handles the Panic lifecycle: acknowledge, assign, accept, resolve, cancel,
 * escalate. Uses asServiceRole for all cross-user/notification work.
 *
 * AUTHORIZATION (server-side, enforced here — NOT just RLS):
 *   - Platform Admin (built-in role 'admin', OR role_type 'platform_admin',
 *     OR admin_level 'platform') may manage ANY panic across all tenants
 *     (emergency oversight).
 *   - Every other operational user may only manage panics inside their own
 *     tenant scope: the panic's customer_id matches the caller's customer_id,
 *     or the panic's reseller_id matches the caller's reseller_id, or it is
 *     their own panic (panic.user_id === caller.id). A reseller admin can
 *     never manage another reseller's panic; a customer admin can never
 *     manage another customer's panic.
 *
 * Each operation appends an activity_log entry, writes a PlatformAuditLog
 * entry, and notifies the relevant parties (tenant-scoped).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { secrets } from 'base44:runtime';
import { buildPanicEmail, esc } from '../../shared/panicEmailTemplate.ts';
import { sendTaskTelegramDeduped } from '../../shared/taskNotifications.ts';

// Post-module-split responder authority: control_room_operator and
// customer_admin are the primary operational responders of a modern tenant
// (the legacy roles remain for migrated tenants). The pre-split omission of
// these two roles also blocked authorised responders from acknowledging
// panics (403 "Not authorized to acknowledge panics").
const OPERATIONAL_ROLES = ['admin', 'platform_admin', 'dispatcher', 'supervisor', 'estate_manager', 'management', 'practice_admin', 'customer_admin', 'control_room_operator'];

function isPlatformAdminCaller(user) {
  return !!user && (
    user.role_type === 'admin' ||
    user.role_type === 'platform_admin' ||
    user.admin_level === 'platform'
  );
}

/** A non-platform caller may only manage a panic in their own tenant scope. */
function callerCanManagePanic(user, panic) {
  if (isPlatformAdminCaller(user)) return true;
  if (!panic) return false;
  if (panic.user_id === user.id) return true;           // own panic
  if (panic.assigned_to === user.id) return true;        // assigned responder
  if (user.customer_id && panic.customer_id && panic.customer_id === user.customer_id) return true;
  if (user.reseller_id && panic.reseller_id && panic.reseller_id === user.reseller_id) return true;
  return false;
}

const sastTime = (iso) =>
  new Date(iso).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });

// Friendly role labels — never expose raw role keys in customer-facing text.
const ROLE_LABELS = {
  control_room_operator: 'Control Room Operator',
  customer_admin: 'Customer Administrator',
  reseller_admin: 'Reseller Administrator',
  guard: 'Security Guard',
  dispatcher: 'Dispatcher',
  supervisor: 'Supervisor',
  admin: 'Platform Administrator',
  platform_admin: 'Platform Administrator',
  practice_admin: 'Practice Administrator',
  estate_manager: 'Estate Manager',
  management: 'Management',
};
const roleLabel = (r) => ROLE_LABELS[r || ''] || r || 'user';

async function audit(base44, user, panic, action, notes) {
  try {
    await base44.asServiceRole.entities.PlatformAuditLog.create({
      event_type: `panic.${action}`,
      user_id: user.id,
      user_name: user.display_name || user.full_name || user.email,
      customer_id: panic?.customer_id || null,
      reseller_id: panic?.reseller_id || null,
      module_key: 'OPERATIONS',
      entity_name: 'PanicAlert',
      entity_id: panic?.id || null,
      action,
      new_values: notes || null,
      notes: `Panic ${action}`,
    });
  } catch (e) {
    console.error('Panic audit log failed:', e);
  }
}

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

    // Server-side tenant authorization. This is the authoritative gate — RLS
    // is a secondary defence. A non-platform user managing a panic outside
    // their tenant is forbidden regardless of how they obtained the panicId.
    if (!callerCanManagePanic(user, panic)) {
      return Response.json({ error: 'Forbidden — panic is outside your tenant scope' }, { status: 403 });
    }

    const isPlatformSender = isPlatformAdminCaller(user);
    // Tenant scope for recipient resolution — notifications only reach
    // management in the panic's own tenant. Platform admins notify across
    // all tenants.
    const panicTenantFilter = isPlatformSender
      ? {}
      : (panic.customer_id
          ? { customer_id: panic.customer_id }
          : (panic.reseller_id
              ? { reseller_id: panic.reseller_id }
              : { id: user.id }));

    const nowIso = new Date().toISOString();
    const userName = user.display_name || user.full_name || user.email;
    const isOperational = OPERATIONAL_ROLES.includes(user.role_type) || isPlatformSender;
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
        // ADDITIVE display snapshot only — the sender overlay shows the
        // responder's role. Null on records acknowledged before this field
        // existed; no acknowledgement logic, routing or idempotency changes.
        updateFields.acknowledged_by_role = user.role_type || null;
        logEntry.action = 'acknowledged';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'acknowledged';
        logEntry.notes = `Acknowledged by ${userName}`;
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
        {
          const allUsers = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
          notifyUserIds = allUsers.filter(u => OPERATIONAL_ROLES.includes(u.role_type)).map(u => u.id);
          notifyUserIds.push(panic.user_id);
        }
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
        // Resolved panics must never escalate further.
        updateFields.escalated = false;
        logEntry.action = 'resolved';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'resolved';
        logEntry.notes = resolutionNotes;
        // notifyUserIds is NOT recomputed from the tenant here — resolve
        // recipients come from the original delivery audit in the dispatch
        // section below (authoritative, no broad re-resolution).
        notifyTitle = `✓ PANIC resolved — ${panic.user_name}`;
        notifyMessage = `The PANIC alert from ${panic.user_name} has been resolved by ${userName}. Notes: ${resolutionNotes}`;
        // RECIPIENT SAFETY: resolve/cancel recipients are resolved AFTER the
        // status write from the AUTHORITATIVE original panic delivery audit
        // (see dispatch) — never broad tenant re-resolution.
        sendEmailToUser = false;
        break;

      case 'cancel':
        // ACCIDENTAL CANCEL — ORIGINATOR ONLY, NO ROLE BYPASS. Cancellation
        // withdraws the emergency itself and is reserved STRICTLY to the
        // ORIGINAL SENDER: panic.user_id === caller.id, with NO exception for
        // any role — not platform admin, not tenant admin, not responder.
        // Emergency administrative intervention uses RESOLVE, never CANCEL.
        if (panic.user_id !== user.id) {
          return Response.json({ error: 'Forbidden — only the original panic sender may cancel a panic' }, { status: 403 });
        }
        // Cancel is available only while the panic is still open — a resolved
        // or already-cancelled panic can never be cancelled again.
        if (['resolved', 'cancelled'].includes(panic.status)) {
          return Response.json({ error: 'Panic already closed — cancellation not permitted' }, { status: 409 });
        }
        updateFields.status = 'cancelled';
        updateFields.resolved_by = user.id;
        updateFields.resolved_by_name = userName;
        updateFields.resolved_at = nowIso;
        updateFields.resolution_notes = 'Cancelled by user';
        updateFields.escalated = false;
        logEntry.action = 'cancelled';
        logEntry.from_status = panic.status;
        logEntry.to_status = 'cancelled';
        logEntry.notes = `Cancelled by originator ${userName}`;
        // notifyUserIds is NOT recomputed from the tenant here — cancel
        // recipients come from the original delivery audit in the dispatch
        // section below (authoritative, no broad re-resolution).
        notifyTitle = `PANIC cancelled — ${panic.user_name}`;
        notifyMessage = `The PANIC alert from ${panic.user_name} has been cancelled by the originating user.`;
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
        {
          const allUsersEsc = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
          notifyUserIds = allUsersEsc.filter(u => OPERATIONAL_ROLES.includes(u.role_type)).map(u => u.id);
        }
        notifyTitle = `🚨 PANIC UNACKNOWLEDGED — ESCALATION #${updateFields.escalation_count}`;
        notifyMessage = `PANIC alert from ${panic.user_name} at ${panic.site_name || 'unknown site'} remains UNACKNOWLEDGED. This is escalation #${updateFields.escalation_count}. RESPOND IMMEDIATELY.`;
        sendEmailToUser = true;
        break;

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Terminal/handled states cancel further deadline-driven escalation so a
    // handled panic is never escalated by a later sweep.
    if (['acknowledged', 'resolved', 'cancelled'].includes(updateFields.status)) {
      updateFields.next_escalation_at = null;
    }
    updateFields.activity_log = [...(panic.activity_log || []), logEntry];

    await base44.asServiceRole.entities.PanicAlert.update(panicId, updateFields);

    // Audit every lifecycle action (platform-wide audit, service-role write).
    await audit(base44, user, { ...panic, id: panicId }, action, logEntry.notes);

    // ── NOTIFICATION DISPATCH ─────────────────────────────────────────────
    // LIFECYCLE RECIPIENT SAFETY: resolve/cancel never re-resolve broad
    // tenant recipients. The AUTHORITATIVE original alert recipients are
    // recovered from the original panic delivery audit (the in-app
    // Notification records created at activation — related_entity 'panic',
    // related_id = this panic), plus the panic sender for resolve. No
    // unrelated customer / reseller / control room / platform admin can
    // ever receive a lifecycle update.
    let lifecycleRecipientIds: string[] = [];
    if (action === 'resolve' || action === 'cancel') {
      const auditNotifs = (await base44.asServiceRole.entities.Notification
        .filter({ related_entity: 'panic', related_id: panicId }).catch(() => [])) || [];
      lifecycleRecipientIds = Array.from(new Set(
        auditNotifs.map((n: any) => n?.recipient_id).filter(Boolean)
      ));
      if (action === 'resolve' && panic.user_id && !lifecycleRecipientIds.includes(panic.user_id)) {
        lifecycleRecipientIds.push(panic.user_id);
      }
    }

    // LIFECYCLE PARITY TELEGRAM — deterministic event keys with the SAME
    // physical event_key + telegram_chat_id same-chat dedupe as panic
    // activation (one logical lifecycle event = ONE physical message per
    // chat; per-user in-app/email/audit records stay separate).
    const lifecycleTelegram =
      action === 'acknowledge' ? {
        key: `panic_acknowledged:${panicId}`,
        text: [
          '✓ *PANIC ACKNOWLEDGED*',
          '',
          'Your emergency alert has been acknowledged.',
          '',
          `Acknowledged by: ${userName} (${roleLabel(user.role_type)})`,
          `Time: ${sastTime(nowIso)} (SAST)`,
          `Reference: ${panic.panic_number}`,
        ].join('\n'),
      } :
      action === 'resolve' ? {
        key: `panic_resolved:${panicId}`,
        text: [
          '✅ *PANIC RESOLVED*',
          '',
          `Person: ${panic.user_name}`,
          `Resolved by: ${userName} (${roleLabel(user.role_type)})`,
          `Resolved: ${sastTime(nowIso)} (SAST)`,
          `Reference: ${panic.panic_number}`,
          `Resolution: ${resolutionNotes}`,
        ].join('\n'),
      } :
      action === 'cancel' ? {
        key: `panic_cancelled:${panicId}`,
        text: [
          '🚫 *PANIC CANCELLED*',
          '',
          'The emergency alert was cancelled by the originating user.',
          '',
          `Person: ${panic.user_name}`,
          `Cancelled by: ${userName}`,
          `Cancelled: ${sastTime(nowIso)} (SAST)`,
          `Reference: ${panic.panic_number}`,
        ].join('\n'),
      } : null;

    const targetIds = Array.from(new Set([...notifyUserIds, ...lifecycleRecipientIds]));
    if (targetIds.length > 0) {
      const allUsers = await base44.asServiceRole.entities.User.filter(panicTenantFilter);
      const targets = allUsers.filter(u => targetIds.includes(u.id));
      // Audit recipients may sit outside the caller's tenant filter (e.g. a
      // platform-sender panic) — resolve them explicitly by id so the
      // AUTHORITATIVE recipients are never silently dropped.
      const foundIds = new Set(targets.map(t => t.id));
      for (const id of targetIds.filter(i => !foundIds.has(i))) {
        try {
          const extra = await base44.asServiceRole.entities.User.get(id);
          if (extra) targets.push(extra);
        } catch (_) {}
      }

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
            action_url: '/PanicManagement',
            sent_via: ['in_app']
          });

          // EMAIL — branded panic template. Acknowledge keeps the existing
          // verified sender email byte-identical (no lifecycle override);
          // resolve/cancel email the authoritative original recipients
          // (+ sender) with the SAME branded template rendered as a
          // lifecycle CLOSURE — never a new emergency activation.
          const sendLifecycleEmail = action === 'resolve' || action === 'cancel';
          if ((sendEmailToUser || sendLifecycleEmail) && target.email) {
            const emailBody = buildPanicEmail({
              userName: panic.user_name, userRole: panic.user_role, badgeNumber: panic.badge_number,
              siteName: panic.site_name, panicNumber: panic.panic_number, activatedAt: panic.activated_at,
              location: panic.location, gpsAccuracy: panic.gps_accuracy,
              notes: action === 'resolve' ? resolutionNotes : panic.notes,
              status: updateFields.status || panic.status,
              isEscalation: action === 'escalate',
              lifecycleAction: sendLifecycleEmail ? action : undefined,
              responderName: sendLifecycleEmail ? userName : undefined,
              lifecycleAt: sendLifecycleEmail ? nowIso : undefined,
            });
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: target.email,
              from_name: 'USS EMERGENCY',
              subject: notifyTitle,
              body: emailBody
            }).catch(e => console.error(`Panic workflow email failed for ${target.email}:`, e));
          }

          // TELEGRAM (lifecycle parity) — the SENDER for acknowledge; the
          // authoritative original recipients (+ sender) for resolve/cancel.
          // Same verified Telegram mapping and event_key + chat dedupe as
          // panic activation; failure is fully isolated from in-app/email.
          if (lifecycleTelegram && target.telegram_connected && target.telegram_notifications_enabled !== false && target.telegram_chat_id) {
            await sendTaskTelegramDeduped(base44.asServiceRole, secrets, lifecycleTelegram.key, target.telegram_chat_id, lifecycleTelegram.text)
              .catch(e => console.error(`Panic lifecycle telegram failed for ${target.id}:`, e));
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