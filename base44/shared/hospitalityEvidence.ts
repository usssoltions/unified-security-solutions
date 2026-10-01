/**
 * hospitalityEvidence — TRUSTED evidence ownership for GRID GATE.
 *
 * A resolvable private uri proves existence, not ownership. Ownership comes
 * ONLY from a HospitalityEvidence record, which is created exclusively by
 * the hospitalityEvidenceUpload gateway AFTER it performed the private
 * upload itself (so the uri -> customer/site/upload-session association is
 * server-authoritative, never caller metadata).
 */

export const PRIVATE_URI_PREFIX = 'mp/private/';

async function ownershipRecord(svc: any, uri: string) {
  const rows = (await svc.entities.HospitalityEvidence.filter({ file_uri: String(uri) }).catch(() => [])) || [];
  return rows[0] || null;
}

/** Every uri must have an ownership record for exactly this customer + site,
 * and belong to this submission's upload session (submit_token) or already
 * be bound to this same visit. */
export async function verifyEvidenceOwnership(svc: any, uris: string[], ctx: {
  customer_id: string | null; site_id: string; submit_token: string | null; visit_id: string;
}): Promise<{ ok: boolean; reason?: string }> {
  for (const uri of uris) {
    if (!String(uri).startsWith(PRIVATE_URI_PREFIX)) return { ok: false, reason: 'not_private_app_file' };
    const rec = await ownershipRecord(svc, uri);
    if (!rec) return { ok: false, reason: 'no_ownership_record' };
    if (!ctx.customer_id || rec.customer_id !== ctx.customer_id || rec.site_id !== ctx.site_id) {
      return { ok: false, reason: 'owned_by_other_scope' };
    }
    const sessionOk = rec.visit_id ? rec.visit_id === ctx.visit_id
      : (!!ctx.submit_token && rec.submit_token === ctx.submit_token);
    if (!sessionOk) return { ok: false, reason: 'other_upload_session' };
    try {
      await svc.integrations.Core.CreateFileSignedUrl({ file_uri: uri, expires_in: 60 });
    } catch (_) { return { ok: false, reason: 'file_missing' }; }
  }
  return { ok: true };
}

/** Bind evidence to the visit (atomic once-only). */
export async function bindEvidence(svc: any, uris: string[], visit_id: string) {
  for (const uri of uris) {
    await svc.entities.HospitalityEvidence.updateMany(
      { file_uri: String(uri), visit_id: null }, { $set: { visit_id } },
    ).catch(() => null);
  }
}

/** Sign a uri for an authorised viewer ONLY when its ownership record
 * matches the visit — otherwise null (shown as "unverified evidence"). */
export async function signOwnedEvidence(svc: any, visit: any, uri: any, expires = 300): Promise<string | null> {
  if (!uri) return null;
  const rec = await ownershipRecord(svc, uri);
  if (!rec || rec.customer_id !== visit.customer_id || rec.site_id !== visit.site_id) return null;
  if (rec.visit_id ? rec.visit_id !== visit.id : rec.submit_token !== visit.submit_token) return null;
  try {
    const s = await svc.integrations.Core.CreateFileSignedUrl({ file_uri: uri, expires_in: expires });
    return s?.signed_url || null;
  } catch (_) { return null; }
}