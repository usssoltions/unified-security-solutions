/**
 * attendanceApi — client wrapper for the attendanceAccess backend gateway.
 *
 * ALL Attendance Register data access goes through the server-side gateway,
 * which resolves the caller's tenant from their User record (never from
 * client-supplied tenant ids, never from JWT custom claims) and enforces the
 * ATTENDANCE_REGISTER module licence. The Attendance entities carry no
 * {{user.data.*}} RLS rules — direct client access is platform-admin-only.
 *
 * Platform admins may narrow their oversight scope by visiting an Attendance
 * page with ?customer_id=<id> — the wrapper forwards it transparently; the
 * server 403s it for any account not entitled to that customer.
 */
import { base44 } from "@/api/base44Client";

export async function attendanceCall(action, params = {}) {
  const urlParams = new URLSearchParams(window.location.search);
  const payload = { action, ...params };
  const cid = params.customer_id ?? urlParams.get("customer_id");
  const rid = params.reseller_id ?? urlParams.get("reseller_id");
  if (cid) payload.customer_id = cid;
  if (rid) payload.reseller_id = rid;

  const res = await base44.functions.invoke("attendanceAccess", payload);
  const d = res?.data !== undefined ? res.data : res;
  if (d?.error) throw new Error(d.error);
  return d;
}

/** Fetch signatures for a set of record ids (scoped server-side).
 * Signatures are large base64 PNGs (~25KB each) — a big register fetched in
 * ONE response risks an oversized payload being cut short, which silently
 * blanks signature cells for whoever exports (a client saw only the first
 * row's signature). Fetch in small batches, then retry any record that came
 * back missing one-by-one so a transient loss never leaves a blank cell. */
export async function fetchSignatures(recordIds) {
  if (!recordIds?.length) return {};
  const sigs = {};
  const CHUNK = 8;
  const chunks = [];
  for (let i = 0; i < recordIds.length; i += CHUNK) chunks.push(recordIds.slice(i, i + CHUNK));
  for (const chunk of chunks) {
    const res = await attendanceCall("get_signatures", { record_ids: chunk });
    Object.assign(sigs, res?.signatures || {});
  }
  const missing = recordIds.filter((id) => !sigs[id]);
  for (const id of missing) {
    try {
      const res = await attendanceCall("get_signatures", { record_ids: [id] });
      if (res?.signatures?.[id]) sigs[id] = res.signatures[id];
    } catch (_) { /* leave blank — reported for follow-up, never fabricated */ }
  }
  return sigs;
}

/** Merge signatures into records for PDF generation. */
export async function withSignatures(records) {
  const sigs = await fetchSignatures(records.map(r => r.id));
  return records.map(r => ({ ...r, signature_data_url: sigs[r.id] }));
}