/**
 * SIMULATED-RECORD SUPPRESSION — shared server-side guard for every
 * automation/dispatch path that can process demo (seed) or technical-test
 * records and produce external correspondence (email, push, Telegram,
 * in-app alerts) about them.
 *
 * PROVENANCE RULES:
 *  - A record is treated as a DEMO-SEED record when it carries a non-empty
 *    `demo_batch_id` that is REGISTERED in the DemoSeedRecord ledger
 *    (kind 'batch') for the record's own tenant. The ledger is written
 *    exclusively by the demoSeed gateway (service role / platform admins),
 *    so an ordinary user cannot register a batch and therefore cannot
 *    suppress alerts on genuine records by copying demo flags. Copying an
 *    existing batch id can at most silence correspondence about records in
 *    that same demo tenant — never another customer's alerts.
 *  - `is_test === true` ALONE suppresses only where the flag is set
 *    exclusively by platform-internal tooling (opts.allowFlagOnly — e.g. the
 *    stay-awake self-test fixtures). On user-visible workflow correspondence
 *    (incidents/maintenance/patrols/shifts) a bare is_test flag does NOT
 *    suppress: a client-set flag must never silence a genuine alert.
 *  - A flagged record whose batch registration cannot be verified FAILS
 *    CLOSED (suppressed) — demo provenance always errs on the side of
 *    silence.
 *  - Callers record a NotificationDelivery audit row with skip_reason
 *    'SIMULATED_RECORD_SUPPRESSED' where a send attempt would otherwise have
 *    occurred, so every suppression remains traceable.
 */

export function hasDemoFlags(rec: any): boolean {
  if (!rec) return false;
  if (rec.is_test === true) return true;
  const b = rec.demo_batch_id;
  return typeof b === 'string' ? b.trim() !== '' : b != null;
}

/**
 * Ledger-validated suppression decision for one record.
 *  - No flags  -> false (genuine record; normal notification behaviour).
 *  - batch id  -> true only when the batch is registered in the ledger and
 *                 belongs to the record's tenant (fail closed otherwise).
 *  - is_test only -> true only when opts.allowFlagOnly is set.
 */
export async function isSimulatedRecord(
  svc: any,
  rec: any,
  opts?: { allowFlagOnly?: boolean },
): Promise<boolean> {
  if (!rec) return false;
  const isTest = rec.is_test === true;
  const rawBatch = rec.demo_batch_id;
  const batchId = typeof rawBatch === 'string' ? rawBatch.trim() : (rawBatch ? String(rawBatch) : '');
  if (!isTest && !batchId) return false;
  if (!batchId) return opts?.allowFlagOnly === true;
  try {
    const rows = await svc.entities.DemoSeedRecord.filter({ batch_id: batchId, kind: 'batch' });
    const batch = rows && rows[0];
    if (!batch) return true; // flagged but unregistered — fail closed
    if (batch.customer_id && rec.customer_id &&
        String(batch.customer_id) !== String(rec.customer_id)) return false;
    return true;
  } catch (_) {
    return true; // ledger unavailable — fail closed for flagged records
  }
}

/** Standard audit row for a suppressed correspondence attempt. */
export function suppressionAuditRow(rec: any, eventType: string, extra: Record<string, any> = {}): Record<string, any> {
  return {
    channel: 'email',
    send_time: new Date().toISOString(),
    event_type: eventType,
    event_key: `${eventType}_suppressed:${(rec && rec.id) || 'unknown'}`,
    reference_id: rec && rec.id ? String(rec.id) : undefined,
    customer_id: (rec && rec.customer_id) || undefined,
    reseller_id: (rec && rec.reseller_id) || undefined,
    delivery_mode: 'production',
    status: 'skipped',
    skip_reason: 'SIMULATED_RECORD_SUPPRESSED',
    retries: 0,
    ...extra,
  };
}