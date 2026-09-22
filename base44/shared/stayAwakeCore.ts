/**
 * stayAwakeCore — SHARED pure decision core for the server-authoritative
 * Stay Awake (fatigue check) lifecycle. The stayAwakeService gateway and the
 * stayAwakeSelfTest lifecycle evidence suite BOTH execute these validators
 * and CAS expressions — the self-test therefore proves the exact rules the
 * live path runs, with no duplicated logic and no test backdoor in
 * production code.
 *
 * STATE MACHINE: sent → acknowledged (own guard, before deadline, CAS-atomic)
 *                    | missed (atomic CAS: id + status 'sent' + expired stored deadline)
 *                    | cancelled (shift ended / clock-out / reassignment / disabled)
 *
 * NEXT-CHALLENGE POLICY (documented): after a timely acknowledgement the next
 * prompt is due one configured interval after the RESPONSE time; after a
 * missed or cancelled prompt one interval after that prompt's alert time (a
 * miss never creates a rapid loop — the full configured interval always
 * elapses before the next challenge); with no prior prompt, one interval
 * after clock-in. Offline periods, app restarts and sweep retries never
 * change this: the reference is always the stored response_time/alert_time,
 * re-read fresh from the authoritative record at every sweep.
 */
export const RESPONSE_TIMEOUT_SECONDS = 60;
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 120;
export const MANAGEMENT_ROLES = ['admin', 'dispatcher', 'supervisor', 'management', 'customer_admin', 'control_room_operator'];

export const isPlatformUser = (u: any) =>
  u?.role_type === 'admin' || u?.role_type === 'platform_admin' || u?.admin_level === 'platform';

export function clampInterval(minutes: any): number {
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(Number(minutes) || 30)));
}

/**
 * evaluateAck — PURE acknowledgement classification. The caller must be the
 * prompt's own guard, the prompt must still be 'sent', the server deadline
 * must not have passed, and the LIVE shift must still be an active clocked-in
 * shift assigned to the same guard. The CAS update remains the authority for
 * the transition itself — this only classifies.
 */
export function evaluateAck({ log, callerId, shift, now }: any): any {
  if (!log) return { error: 'NOT_FOUND' };
  if (log.guard_id !== callerId) return { error: 'FORBIDDEN' };
  if (log.status === 'acknowledged') return { ok: true, already: true };
  if (log.status !== 'sent') return { error: 'PROMPT_NO_LONGER_ACTIVE', status: log.status };
  if (log.expires_at && new Date(log.expires_at) < now) return { error: 'PROMPT_EXPIRED' };
  const shiftValid = shift &&
    shift.status === 'active' &&
    shift.guard_id === log.guard_id &&
    shift.clock_in?.timestamp &&
    !shift.clock_out?.timestamp;
  if (!shiftValid) return { error: 'SHIFT_NO_LONGER_ACTIVE' };
  return {
    ok: true,
    responseSeconds: Math.max(0, Math.round((now - new Date(log.alert_time)) / 1000)),
  };
}

/**
 * classifyAckStale — classify a LOST CAS race (updated: 0) from the fresh
 * authoritative record: idempotent replay, late (documented rule), inactive
 * (cancelled/missed), or unknown.
 */
export function classifyAckStale({ fresh, now }: any): string {
  if (fresh && fresh.status === 'acknowledged') return 'already';
  if (fresh && fresh.expires_at && new Date(fresh.expires_at) < now) return 'expired';
  if (fresh) return 'inactive';
  return 'unknown';
}

// ── ATOMIC CAS EXPRESSIONS — single source of truth for the live gateway AND
//    the lifecycle self-test. updateMany(query, set) is a conditional update:
//    it reports { updated: N }; a worker whose conditions no longer match
//    updates ZERO rows and must proceed as an idempotent no-op. ──
export const ackCas = {
  query: ({ logId, callerId, nowIso }: any) => ({
    id: logId,
    status: 'sent',
    guard_id: callerId,
    expires_at: { $gte: nowIso },
  }),
  set: ({ nowIso, responseSeconds, location }: any) => ({
    $set: {
      status: 'acknowledged',
      response_time: nowIso,
      response_method: 'button',
      response_time_seconds: responseSeconds,
      ...(location ? { location } : {}),
    },
  }),
};

export const missedCas = {
  query: ({ logId, nowIso }: any) => ({
    id: logId,
    status: 'sent',
    expires_at: { $lte: nowIso },
  }),
  set: ({ nowIso }: any) => ({ $set: { status: 'missed', missed_at: nowIso } }),
};

/**
 * isEscalationRecipient — same-tenant authorized management (or platform
 * oversight); suspended/inactive accounts are excluded. UNCUSTOMERED records
 * (no customer scope) FAIL CLOSED to platform oversight ONLY: tenant users
 * never receive an alert whose tenant scope could not be resolved.
 */
export function isEscalationRecipient(u: any, scope: any): boolean {
  return MANAGEMENT_ROLES.includes(u.role_type) &&
    (!u.status || (u.status !== 'suspended' && u.status !== 'inactive')) &&
    (isPlatformUser(u) || (scope.customer_id ? u.customer_id === scope.customer_id : false));
}

// ── DETERMINISTIC IDEMPOTENCY/EVENT KEYS — exactly one escalation per
//    recipient per challenge on every channel, across any number of sweep
//    retries or concurrent monitor executions. ──
export const promptPushEventKey = (logId: string) => 'stayawake_prompt:' + logId;
export const missedEventKey = (logId: string) => 'stayawake_missed:' + logId;
export const missedEmailIdemKey = (logId: string, recipientKey: string) => 'stay_awake_missed:' + logId + ':' + recipientKey;

/** nextChallengeReference — the documented next-challenge policy (header). */
export function nextChallengeReference({ latest, clockInTimestamp }: any): Date {
  if (latest) return new Date(latest.response_time || latest.alert_time);
  return new Date(clockInTimestamp);
}