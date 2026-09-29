/**
 * Shared OPERATIONAL USER licensing — the SECOND, fully independent customer
 * entitlement (Customer.operational_user_limit), deliberately separate from
 * device licensing (deviceLicensing.ts): operational users are PEOPLE who
 * actually operate the security/access-control system; devices are physical
 * app installations. One never affects the other.
 *
 * SLOT LIFECYCLE (all counts are DERIVED from live records, never stored, so
 * lifecycle transitions release slots automatically and audit history is
 * never deleted to free a slot):
 *   ACTIVE licensed operational user        = one slot
 *   VALID PENDING operational invitation   = one slot (no mass-invite bypass)
 *   cancelled/expired invitation            = slot released
 *   deactivated / access-removed user       = slot released
 *
 * CONCURRENCY: enforceOperationalUserLimit runs the entitlement check AND the
 * scope mutation inside one per-customer CAS mutex (Customer.user_lock_token,
 * same transaction-safe pattern as the device licence mutex), so two
 * simultaneous invitations can never both take the final slot.
 */
import { loadCustomerById } from './deviceLicensing.ts';

/** Roles that actually OPERATE the security/access-control system, from the
 * authoritative module role catalogue (shared/tenantRoles.ts, mirrored in
 * src/lib/roleCatalog.js): guards, dispatchers and control-room operators.
 * Administrative roles (customer_admin, practice_admin, estate_manager) do
 * NOT consume an operational-user slot — administration is not operation. */
export const OPERATIONAL_USER_ROLES = ['guard', 'dispatcher', 'control_room_operator'];

export const isOperationalRole = (r: any): boolean =>
  OPERATIONAL_USER_ROLES.includes(String(r || '').trim().toLowerCase());

/** Canonical USER LIMIT REACHED text (displayed verbatim by the UI). */
export const USER_LIMIT_REACHED_MESSAGE =
  'This customer has reached the maximum number of licensed operational users allowed for the account. Please contact your platform administrator to increase the user allowance.';

/** Valid operational-user limit: a true integer >= 1 (no decimals, no strings, no blanks). */
export function parseOperationalUserLimit(raw: any): { ok: true; value: number } | { ok: false; code: string; error: string } {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {
      ok: false, code: 'missing_operational_user_limit',
      error: 'Allowed Operational Users is required. Enter the number of licensed operational users for this customer (minimum 1).',
    };
  }
  const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    return { ok: false, code: 'invalid_operational_user_limit', error: 'Allowed Operational Users must be a whole number (no decimals or text).' };
  }
  if (num < 1) {
    return { ok: false, code: 'invalid_operational_user_limit', error: 'Allowed Operational Users must be at least 1.' };
  }
  return { ok: true, value: num };
}

/** An ACTIVE licensed operational user of a customer (user_status defaults to
 * 'active' per the User schema when unset). */
export function isOperationalActiveUser(u: any): boolean {
  return !!u && !!u.customer_id && isOperationalRole(u.role_type)
    && (u.user_status == null || u.user_status === 'active');
}

export async function countActiveOperationalUsers(svc: any, customerId: string): Promise<number> {
  const rows = await svc.entities.User.filter({ customer_id: String(customerId) }).catch(() => []);
  return (rows || []).filter(isOperationalActiveUser).length;
}

export function isOperationalPendingScope(s: any): boolean {
  return !!s && s.status === 'pending' && isOperationalRole(s.role_type);
}

export async function countPendingOperationalInvitations(svc: any, customerId: string): Promise<number> {
  const rows = await svc.entities.PendingTenantScope.filter({ customer_id: String(customerId) }).catch(() => []);
  return (rows || []).filter(isOperationalPendingScope).length;
}

/** Current operational-user licence usage (active + valid pending invitations). */
export async function operationalUsage(svc: any, customerId: string) {
  const [active, pending] = await Promise.all([
    countActiveOperationalUsers(svc, customerId),
    countPendingOperationalInvitations(svc, customerId),
  ]);
  return { active, pending, used: active + pending };
}

const USER_LOCK_TTL_MS = 15000;

/** Per-customer operational-slot mutex via CAS on Customer.user_lock_token
 *  (null→token acquire, stale-lock steal after user_lock_expires_at). */
export async function withUserLock<T>(svc: any, customerId: string, fn: () => Promise<T>):
  Promise<T | { lock_error: 'lock_timeout' }> {
  const token = crypto.randomUUID();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let acquired = false;
  for (let i = 0; i < 40 && !acquired; i++) {
    const cust = await loadCustomerById(svc, customerId);
    if (!cust) break;
    const held = cust.user_lock_token || null;
    const expired = !cust.user_lock_expires_at ||
      new Date(cust.user_lock_expires_at).getTime() < Date.now();
    if (held && !expired) { await sleep(150); continue; }
    const filter = held ? { id: customerId, user_lock_token: held } : { id: customerId, user_lock_token: null };
    await svc.entities.Customer.updateMany(filter, {
      $set: { user_lock_token: token, user_lock_expires_at: new Date(Date.now() + USER_LOCK_TTL_MS).toISOString() },
    }).catch(() => {});
    const again = await loadCustomerById(svc, customerId);
    if (again?.user_lock_token === token) { acquired = true; break; }
    await sleep(120);
  }
  if (!acquired) return { lock_error: 'lock_timeout' };
  try {
    return await fn();
  } finally {
    await svc.entities.Customer.updateMany({ id: customerId, user_lock_token: token }, {
      $set: { user_lock_token: null, user_lock_expires_at: null },
    }).catch(() => {});
  }
}

/**
 * Enforce the operational-user entitlement around an invitation MUTATION.
 * Check + mutation run inside ONE mutex hold (atomic). If the invited
 * identity already holds a slot at this customer — an active operational
 * user being re-scoped, or a pending invitation being updated — the
 * mutation is idempotent and consumes no additional slot. Legacy customers
 * without a configured allowance are NOT blocked (flagged for configuration
 * elsewhere); non-operational roles never touch the entitlement.
 *
 * `mutate()` MUST perform the scope mutation (create/update) and is only
 * invoked when a slot is (or already was) available.
 */
export async function enforceOperationalUserLimit(
  svc: any,
  opts: {
    customer: any;              // Customer record (null → no enforcement)
    roleType: string;
    email: string;              // normalized (trim + lowercase) by the caller
    existingUser?: any;         // User record for this email, when one exists
    mutate: () => Promise<any>; // performs the scope mutation
  },
): Promise<{ blocked?: boolean; used?: number; limit?: number; lock_error?: string; result?: any }> {
  const limit = opts.customer ? opts.customer.operational_user_limit : null;
  if (limit == null || !isOperationalRole(opts.roleType)) {
    return { result: await opts.mutate() };
  }
  const inner = await withUserLock(svc, String(opts.customer.id), async () => {
    const alreadyActiveHere = !!(opts.existingUser && isOperationalActiveUser(opts.existingUser)
      && String(opts.existingUser.customer_id) === String(opts.customer.id));
    let alreadyPendingHere = false;
    if (!alreadyActiveHere) {
      try {
        const rows = await svc.entities.PendingTenantScope.filter({ email: opts.email }).catch(() => []);
        const pending = (rows || []).find((s: any) => s.status === 'pending');
        alreadyPendingHere = !!pending && String(pending.customer_id || '') === String(opts.customer.id);
      } catch (_) { alreadyPendingHere = false; }
    }
    if (!alreadyActiveHere && !alreadyPendingHere) {
      const usage = await operationalUsage(svc, String(opts.customer.id));
      if (usage.used >= limit) {
        return { blocked: true, used: usage.used, limit };
      }
    }
    const result = await opts.mutate();
    return { result };
  });
  return inner as any;
}