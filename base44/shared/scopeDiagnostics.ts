/**
 * scopeDiagnostics — shared email near-match helpers for the invitation /
 * tenant-scope pipeline. Used by inviteTenantUser (prevent mistyped
 * invitation addresses), applyMyPendingScope (diagnose blocked sign-ups)
 * and getTenantUsers (surface incomplete accounts to the administering
 * admin). Pure functions — no I/O, no tenant data access.
 *
 * The observed "Account Setup Incomplete" defect class is an authenticated
 * account whose email was never queued a PendingTenantScope: either a direct
 * sign-up, or an invitation addressed to a MISTYPED address (e.g.
 * redops1@… invited but redoops1@… used to sign up). A conservative
 * near-match test makes both diagnosable without ever auto-applying a scope
 * to a different address — scope application remains exact-email only.
 */

export function normaliseEmail(v: any): string {
  return String(v || '').trim().toLowerCase();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * True when two DIFFERENT email addresses look like the same intended
 * address with a typo — the failure classes observed in production:
 *  - identical local part, different domain (typo'd domain: "dolutions")
 *  - same domain, local parts within edit distance 2 or a prefix of each
 *    other ("redoops" vs "redops")
 * Local parts shorter than 3 characters are never near-matched (too noisy).
 */
export function emailsNearMatch(a: string, b: string): boolean {
  const ea = normaliseEmail(a), eb = normaliseEmail(b);
  if (!ea || !eb || ea === eb || !ea.includes('@') || !eb.includes('@')) return false;
  const [la, da] = ea.split('@');
  const [lb, db] = eb.split('@');
  if (!la || !lb || !da || !db) return false;
  if (la === lb && da !== db) return true;
  if (da === db && la !== lb && la.length >= 3 && lb.length >= 3) {
    if (la.startsWith(lb) || lb.startsWith(la)) return true;
    if (levenshtein(la, lb) <= 2) return true;
  }
  return false;
}