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

/** Fetch signatures for a set of record ids (scoped server-side). */
export async function fetchSignatures(recordIds) {
  if (!recordIds?.length) return {};
  const res = await attendanceCall("get_signatures", { record_ids: recordIds });
  return res?.signatures || {};
}

/** Merge signatures into records for PDF generation. */
export async function withSignatures(records) {
  const sigs = await fetchSignatures(records.map(r => r.id));
  return records.map(r => ({ ...r, signature_data_url: sigs[r.id] }));
}