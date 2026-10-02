/**
 * showcaseAttachmentProbe — ISOLATED PLATFORM-ADMIN-ONLY diagnostic for the
 * Report & Notification Showcase attachment freezing. Builds ONE attachment
 * with the real shared generator and reports the exact failure (message +
 * stack) or the byte size; with upload=true it also performs the SAME private
 * upload the freeze step does and reports its result. NO email, NO records
 * changed (an uploaded probe file is left in private storage for inspection).
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { buildMonthlyIncidentPdf, buildMonthlyMaintenancePdf } from '../../shared/opsReportPdfs.ts';
import { resolveCommunicationBrand } from '../../shared/brandedCommunication.ts';
import { freezeItemAttachments } from '../../shared/showcaseDelivery.ts';

function isPlatformAdmin(user: any): boolean {
  return user?.role === 'admin' || user?.role_type === 'platform_admin' || user?.admin_level === 'platform';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const svc = base44.asServiceRole;
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPlatformAdmin(user)) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const kind = body.kind === 'maintenance' ? 'maintenance' : 'incident';
    const entity = kind === 'incident' ? 'Incident' : 'MaintenanceRequest';
    const ids: string[] = Array.isArray(body.record_ids) ? body.record_ids : [];

    let brand: any = null;
    try { brand = (await resolveCommunicationBrand(svc, { customer_id: String(body.customer_id || ''), reseller_id: null })); } catch (_) {}

    const records: any[] = [];
    for (const id of ids) {
      const r = await (svc.entities as any)[entity].get(id).catch(() => null);
      if (r) records.push((r as any).data ?? r);
    }

    let result: any;
    let built: any = null;
    try {
      built = kind === 'incident'
        ? buildMonthlyIncidentPdf({ records, brand })
        : buildMonthlyMaintenancePdf({ records, brand });
      result = {
        ok: true,
        bytes: (built as any).bytes?.length ?? null,
        bytes_is_uint8: (built as any).bytes instanceof Uint8Array,
        period: (built as any).period ?? null,
        stats_keys: Object.keys((built as any).stats || {}),
      };
    } catch (e: any) {
      result = { ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 600) };
    }

    let upload: any = null;
    if (body.upload === true && built?.bytes) {
      try {
        const file = new File([built.bytes], `probe-${kind}-report.pdf`, { type: 'application/pdf' });
        const up = await svc.integrations.Core.UploadPrivateFile({ file });
        upload = { ok: true, file_uri: up?.file_uri || up?.data?.file_uri || null };
      } catch (e: any) {
        upload = { ok: false, error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 600) };
      }
    }
    let freeze: any = null;
    if (body.freeze === true && ids.length) {
      try {
        const frozen = await freezeItemAttachments(svc, {
          attachments: [{ filename: `probe_${kind}_report.pdf`, generator: `monthly_${kind}_pdf`, record_ids: ids }],
        }, brand, 'Probe');
        freeze = frozen[0] || null;
      } catch (e: any) {
        freeze = { error: String(e?.message || e) };
      }
    }
    return Response.json({ kind, brand_name: brand?.brand_name || null, record_count: records.length, result, upload, freeze });
  } catch (e: any) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
});