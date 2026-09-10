/* ── SHARED PLATFORM SERVICE ────────────────────────────────────────────────
 * accountLifecycle — THE ONE server-side account lifecycle service.
 *
 * Every user account lifecycle action (removal request, approval, rejection,
 * cancellation, suspension, deactivation, reactivation, final account removal
 * and PII cleanup) routes through this module via the accountLifecycle backend
 * function. No module may implement its own deletion/deactivation logic.
 *
 * CORE PRINCIPLE — four separate concerns, never cascaded:
 *   1. USER ACCOUNT / LOGIN             (may be removed on approved removal)
 *   2. ORGANISATION MEMBERSHIP          (references pulled, entity untouched)
 *   3. OPERATIONAL HISTORY              (NEVER deleted or rewritten)
 *   4. CUSTOMER / RESELLER ENTITY       (NEVER deleted with a user's login)
 *
 * APPROVAL HIERARCHY (server-side, fail closed):
 *   staff / guards / operators / supervisors  → Customer Administrator
 *   Customer Administrator                    → another authorised Customer
 *     Administrator, Reseller Administrator or Platform Administrator
 *   Reseller staff                            → Reseller Administrator
 *   Reseller Administrator                    → another Reseller Administrator
 *     or Platform Administrator
 *   Platform staff / administrators           → another Platform Administrator
 *
 * Operational records (shifts, patrols, tasks, incidents, panics, attendance,
 * access logs, sign-offs, signatures, reports) carry their own historical
 * identity snapshots — they are NEVER rewritten when an account is removed.
 * ──────────────────────────────────────────────────────────────────────────── */

export const TENANT_ADMIN_ROLES = ['customer_admin', 'practice_admin', 'estate_manager'];
export const PANIC_ACTIVE_STATUSES = ['active', 'acknowledged', 'assigned', 'accepted'];
export const SHIFT_ACTIVE_STATUSES = ['open', 'active'];
export const TASK_BLOCKER_STATUSES = ['assigned', 'in_progress', 'reopened', 'new', 'acknowledged', 'awaiting'];

export function isPlatformAdminUser(u) {
  return !!u && (u.role === 'admin' || u.role_type === 'platform_admin' || u.admin_level === 'platform');
}

export function isResellerAdminUser(u) {
  return !!u && !isPlatformAdminUser(u) && (u.role_type === 'reseller_admin' || u.admin_level === 'reseller');
}

export function isTenantAdminUser(u) {
  return !!u && !isPlatformAdminUser(u) && !isResellerAdminUser(u) &&
    (TENANT_ADMIN_ROLES.includes(u.role_type) || u.admin_level === 'customer');
}

/* Enumerate users (service role). Never trusted for scoping decisions beyond
 * membership counts and approver resolution, both of which are cross-checked
 * server-side. */
export async function listUsers(svc) {
  try {
    const users = await svc.entities.User.list('-created_date', 500);
    if (Array.isArray(users)) return users;
  } catch (e) {}
  try {
    const users = await svc.entities.User.filter({});
    if (Array.isArray(users)) return users;
  } catch (e) {}
  return [];
}

/* Approval-hierarchy validation. Returns a human-readable error string when
 * the CALLER is not authorised to act on the TARGET user, else null.
 * Cross-tenant attempts always fail closed here (surfaced as 403). */
export function resolveAuthorityError(caller, target) {
  if (isPlatformAdminUser(caller)) return null;
  if (isPlatformAdminUser(target)) {
    return 'Platform administrator accounts can only be managed by another authorised Platform Administrator';
  }
  if (isResellerAdminUser(caller)) {
    if (!target.reseller_id || target.reseller_id !== caller.reseller_id) {
      return 'Forbidden: cross-tenant account lifecycle actions are not permitted';
    }
    return null; // staff, customer users and other reseller admins within the reseller
  }
  if (isTenantAdminUser(caller)) {
    if (isResellerAdminUser(target)) {
      return 'Reseller Administrator accounts can only be managed by another Reseller Administrator or a Platform Administrator';
    }
    if (!target.customer_id || target.customer_id !== caller.customer_id) {
      return 'Forbidden: cross-tenant account lifecycle actions are not permitted';
    }
    return null; // staff + other authorised tenant administrators of the same customer
  }
  return 'Forbidden: only authorised administrators can perform account lifecycle actions';
}

/* Last-admin protection. Returns an error string when removing the target
 * would administratively orphan their tenant, reseller or the platform. */
export async function findLastAdminViolation(svc, target) {
  const users = (await listUsers(svc)).filter(u => u.user_status !== 'inactive' && u.id !== target.id);
  if (isPlatformAdminUser(target)) {
    const count = users.filter(isPlatformAdminUser).length;
    if (count < 1) return 'Another Platform Administrator must be assigned before this account can be removed.';
    return null;
  }
  if (isResellerAdminUser(target)) {
    const count = users.filter(u => isResellerAdminUser(u) && u.reseller_id === target.reseller_id).length;
    if (count < 1) return 'Another Reseller Administrator must be assigned before this account can be removed.';
    return null;
  }
  if (isTenantAdminUser(target)) {
    const count = users.filter(u => isTenantAdminUser(u) && u.customer_id === target.customer_id).length;
    if (count < 1) return 'Another administrator must be assigned before this account can be removed.';
    return null;
  }
  return null;
}

/* Operational dependency scan. BLOCKING dependencies refuse removal (they need
 * a human decision — reassignment, completion or cancellation); RESOLVABLE
 * dependencies are safely auto-resolved at removal (membership references
 * pulled, future schedule cancelled — completed history always preserved). */
export async function collectDependencies(svc, target) {
  const id = target.id;
  const [panicsOwn, panicsAssigned, shifts, tasks, patrols, roomOps, roomSups, resellerRows] = await Promise.all([
    svc.entities.PanicAlert.filter({ user_id: id }, '-activated_at', 100).catch(() => []),
    svc.entities.PanicAlert.filter({ assigned_to: id }, '-activated_at', 100).catch(() => []),
    svc.entities.Shift.filter({ guard_id: id }, '-start_time', 200).catch(() => []),
    svc.entities.OperationalTask.filter({ assigned_to: id }, '-updated_date', 200).catch(() => []),
    svc.entities.ScheduledPatrol.filter({ guard_id: id }, '-scheduled_start', 200).catch(() => []),
    svc.entities.ControlRoom.filter({ operator_user_ids: id }).catch(() => []),
    svc.entities.ControlRoom.filter({ supervisor_user_ids: id }).catch(() => []),
    svc.entities.Reseller.filter({ members: id }).catch(() => []),
  ]);

  const blockers = [];
  const resolvable = [];

  const activePanics = (panicsOwn || []).concat(panicsAssigned || [])
    .filter(p => PANIC_ACTIVE_STATUSES.includes(p.status));
  if (activePanics.length) {
    blockers.push(`${activePanics.length} active panic alert(s) must be resolved first`);
  }

  const activeShifts = (shifts || []).filter(s => SHIFT_ACTIVE_STATUSES.includes(s.status));
  if (activeShifts.length) {
    blockers.push(`${activeShifts.length} active/open shift(s) — end or reassign the shift before removal`);
  }

  const openTasks = (tasks || []).filter(t =>
    !t.archived && (TASK_BLOCKER_STATUSES.includes(t.status) || (t.status === 'overdue' && !t.completed_at)));
  if (openTasks.length) {
    blockers.push(`${openTasks.length} incomplete assigned task(s) — reassign, complete or cancel them first`);
  }

  const activePatrols = (patrols || []).filter(p => ['active', 'due'].includes(p.status));
  if (activePatrols.length) {
    blockers.push(`${activePatrols.length} active/due patrol(s) — complete or reassign them first`);
  }

  const futureShifts = (shifts || []).filter(s =>
    s.status === 'scheduled' && s.start_time && new Date(s.start_time) > new Date());
  if (futureShifts.length) {
    resolvable.push(`${futureShifts.length} future scheduled shift(s) will be cancelled`);
  }
  if ((roomOps || []).length) {
    resolvable.push(`Control Room operator membership in ${(roomOps || []).length} room(s) will be removed`);
  }
  if ((roomSups || []).length) {
    resolvable.push(`Control Room supervisor membership in ${(roomSups || []).length} room(s) will be removed`);
  }
  if ((resellerRows || []).length) {
    resolvable.push(`Reseller membership in ${(resellerRows || []).length} reseller organisation(s) will be removed`);
  }

  const parts = [];
  if (blockers.length) parts.push(`Blocking: ${blockers.join('; ')}`);
  if (resolvable.length) parts.push(`Auto-resolved at removal: ${resolvable.join('; ')}`);
  if (!parts.length) parts.push('No operational dependencies found');

  return { blockers, resolvable, futureShifts, roomOps, roomSups, resellerRows, summary: parts.join('. ') };
}

/* FINAL ACCOUNT REMOVAL — executed ONLY after approval + validation.
 * Removes authentication and personal data; pulls membership references;
 * preserves every operational/audit record and tenant entity. The platform-
 * native User.delete (Dashboard → Users → Remove User equivalent) is the
 * authoritative last step. */
export async function performAccountRemoval(svc, target) {
  const nowIso = new Date().toISOString();
  const id = target.id;

  // Personal channel mappings + session artefacts (this user only)
  await svc.entities.TelegramEnrollment.updateMany(
    { user_id: id, status: { $in: ['pending', 'completed'] } },
    { $set: { status: 'revoked', telegram_chat_id: '', telegram_username: '', telegram_first_name: '', telegram_last_name: '' } }
  ).catch(() => {});

  await svc.entities.PushRegistration.updateMany(
    { user_id: id, status: 'active' },
    { $set: { status: 'inactive', push_enabled: false, unregistered_at: nowIso, unregistered_reason: 'account_removed' } }
  ).catch(() => {});

  await svc.entities.Notification.deleteMany({ recipient_id: id }).catch(() => {});

  await svc.entities.PendingTenantScope.updateMany(
    { email: String(target.email || '').trim().toLowerCase(), status: 'pending' },
    { $set: { status: 'cancelled', cancelled_at: nowIso, cancelled_by: id } }
  ).catch(() => {});

  // Organisation membership references — entities themselves are NEVER deleted
  await svc.entities.Reseller.updateMany({ members: id }, { $pull: { members: id } }).catch(() => {});
  await svc.entities.ControlRoom.updateMany({ operator_user_ids: id }, { $pull: { operator_user_ids: id } }).catch(() => {});
  await svc.entities.ControlRoom.updateMany({ supervisor_user_ids: id }, { $pull: { supervisor_user_ids: id } }).catch(() => {});

  // Future operational schedule — cancelled (completed history untouched)
  const shifts = await svc.entities.Shift.filter({ guard_id: id, status: 'scheduled' }, '-start_time', 200).catch(() => []);
  const future = (shifts || []).filter(s => s.start_time && new Date(s.start_time) > new Date());
  for (const s of future) {
    await svc.entities.Shift.update(s.id, {
      status: 'cancelled',
      notes: `${s.notes ? s.notes + ' ' : ''}[Cancelled — account removal: user removed from future schedule]`,
    }).catch(() => {});
  }

  // THE ACCOUNT — platform-native deletion, authoritative last step
  await svc.entities.User.delete(id);
  return { removed: true, cancelledFutureShifts: future.length };
}

/* Distinct account states — suspension (temporary, reversible), deactivation
 * (login disabled, account/history retained) and removal are NOT the same
 * operation. */
export async function applySuspension(svc, target) {
  return svc.entities.User.update(target.id, { user_status: 'suspended' });
}

export async function applyDeactivation(svc, target) {
  return svc.entities.User.update(target.id, {
    user_status: 'inactive',
    stay_awake_enabled: false,
    is_clocked_in: false,
    custom_contacts: [...(target.custom_contacts || []), {
      name: '__DEACTIVATED__',
      phone: new Date().toISOString(),
      role: 'deactivated_by',
    }],
  });
}

export async function applyReactivation(svc, target) {
  return svc.entities.User.update(target.id, {
    user_status: 'active',
    custom_contacts: (target.custom_contacts || []).filter(c => c && c.name !== '__DEACTIVATED__'),
  });
}

/* Resolve the authorised approver(s) for a target user, narrowest scope first:
 * same-customer tenant admins → same-reseller reseller admins → platform
 * administrators. Never includes the target themselves. */
export async function resolveApprovers(svc, target) {
  const users = (await listUsers(svc))
    .filter(u => u.id !== target.id && u.user_status !== 'inactive');
  if (target.customer_id) {
    const tenantAdmins = users.filter(u => isTenantAdminUser(u) && u.customer_id === target.customer_id);
    if (tenantAdmins.length) return tenantAdmins;
  }
  if (target.reseller_id) {
    const resellerAdmins = users.filter(u => isResellerAdminUser(u) && u.reseller_id === target.reseller_id);
    if (resellerAdmins.length) return resellerAdmins;
  }
  return users.filter(isPlatformAdminUser);
}

/* Organisation display name snapshot (entity never modified). */
export async function resolveOrganisationName(svc, target) {
  try {
    if (target.customer_id) {
      const c = await svc.entities.Customer.get(target.customer_id);
      if (c) return c.name;
    }
  } catch (e) {}
  try {
    if (target.reseller_id) {
      const r = await svc.entities.Reseller.get(target.reseller_id);
      if (r) return r.name;
    }
  } catch (e) {}
  return null;
}

/* Audit — account lifecycle events carry actor, target, tenant, timestamp. */
export async function auditAccountEvent(svc, eventType, actor, target, notes) {
  const record = {
    event_type: eventType,
    user_id: actor.id,
    user_name: actor.display_name || actor.full_name || actor.email || '—',
    entity_name: 'User',
    entity_id: target.id,
    action: eventType,
    notes,
  };
  if (target.customer_id) record.customer_id = target.customer_id;
  if (target.reseller_id) record.reseller_id = target.reseller_id;
  await svc.entities.PlatformAuditLog.create(record).catch(() => {});
}

/* Informational notifications (existing Notification architecture — in-app
 * records + best-effort email; NEVER loud/emergency alerts). */
export async function notifyUsers(svc, recipients, title, message, actionUrl) {
  for (const r of (recipients || []).slice(0, 20)) {
    await svc.entities.Notification.create({
      recipient_id: r.id,
      recipient_name: r.display_name || r.full_name || r.email,
      type: 'system',
      priority: 'medium',
      title,
      message,
      action_url: actionUrl,
      sent_via: ['in_app'],
    }).catch(() => {});
    if (r.email) {
      await svc.integrations.Core.SendEmail({ to: r.email, subject: title, body: message }).catch(() => {});
    }
  }
}