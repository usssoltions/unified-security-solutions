import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { HOSPITALITY_WORKFLOW_ID } from '../../shared/gridGateWorkflow.ts';

/**
 * hospitalityEvidenceUpload — the ONLY way GRID GATE evidence photos enter
 * storage. The SERVER performs the private upload and records the trusted
 * ownership (customer + site from the authorised site record, upload session
 * = submit_token, uploader = authenticated caller) in HospitalityEvidence.
 * Multipart fields: file, site_id, submit_token, kind.
 */
const MAX_BYTES = 8 * 1024 * 1024;
const isPlatform = (u: any) => u.role_type === 'platform_admin' || u.admin_level === 'platform' || u.role === 'admin';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file');
    const site_id = String(form.get('site_id') || '');
    const submit_token = String(form.get('submit_token') || '');
    const kind = String(form.get('kind') || '') || null;
    if (!(file instanceof File) || !site_id || !submit_token) {
      return Response.json({ error: 'file, site_id and submit_token are required' }, { status: 400 });
    }
    if (!String(file.type || '').startsWith('image/')) return Response.json({ error: 'Only photos are accepted' }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: 'Photo is too large' }, { status: 400 });

    const site = ((await base44.asServiceRole.entities.Site.filter({ id: site_id }).catch(() => [])) || [])[0];
    if (!site) return Response.json({ error: 'Site not found' }, { status: 404 });
    if (site.access_workflow !== HOSPITALITY_WORKFLOW_ID) {
      return Response.json({ error: 'This site does not use the GRID GATE Hospitality workflow', code: 'wrong_workflow' }, { status: 400 });
    }
    if (!isPlatform(caller)) {
      if (!caller.customer_id || site.customer_id !== caller.customer_id) {
        return Response.json({ error: 'This site does not belong to your customer', code: 'forbidden_site_tenant' }, { status: 403 });
      }
      if (caller.site_id && String(caller.site_id) !== site_id) {
        return Response.json({ error: 'This site is not assigned to you', code: 'forbidden_site' }, { status: 403 });
      }
    }

    const up = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
    const file_uri = up?.file_uri;
    if (!file_uri) return Response.json({ error: 'Upload failed' }, { status: 500 });

    await base44.asServiceRole.entities.HospitalityEvidence.create({
      file_uri,
      customer_id: site.customer_id,
      reseller_id: site.reseller_id || null,
      site_id,
      submit_token,
      visit_id: null,
      kind,
      uploaded_by_id: caller.id,
      uploaded_by_name: caller.display_name || caller.full_name || '',
      content_type: file.type || null,
      size_bytes: file.size,
    });
    return Response.json({ file_uri });
  } catch (error) {
    return Response.json({ error: (error as any).message }, { status: 500 });
  }
}