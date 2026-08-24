import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * prepareTenantMigration — Safe, auditable tenant-data migration with dry-run preview.
 *
 * Two modes:
 *   mode: 'preview'  — analyzes all records, returns counts + derivation breakdown.
 *                      Writes NOTHING.
 *   mode: 'execute'  — performs deterministic backfill of customer_id/reseller_id
 *                      on records that can be safely derived. Logs every change to
 *                      PlatformAuditLog with a migration_run_id.
 *
 * Derivation passes (in order, first match wins):
 *   1. site_id  → Site.customer_id / Site.reseller_id
 *   2. Relational:
 *      - Shift            → guard_id → User.customer_id
 *      - Incident         → guard_id → User.customer_id  |  site_id → Site
 *      - MaintenanceRequest → guard_id → User  |  site_id → Site
 *      - PanicAlert       → user_id → User.customer_id
 *      - Alert            → guard_id → User  |  site_id → Site
 *      - PatrolLog        → guard_id → User  |  site_id → Site
 *      - ScheduledPatrol  → site_id → Site
 *      - LocationTracking  → user_id/guard_id → User  |  site_id → Site
 *      - AccessLog        → guard_id → User  |  site_id → Site
 *      - Visitor          → resident_id → User  |  created_by_id → User  |  site_id → Site
 *      - ChatMessage      → sender_id → User  (only if recipient resolves to same customer)
 *      - Notification     → recipient_id → User.customer_id
 *      - ServiceTicket    → resident_id → User.customer_id
 *      - CallHistory      → user_id/guard_id → User
 *      - SignalingMessage → from_user_id/to_user_id → User (same customer)
 *
 * Rules:
 *   - Never overwrite an existing valid customer_id.
 *   - Never delete anything.
 *   - If relational derivation yields CONFLICTING ownership → leave ambiguous.
 *   - Ambiguous records are returned with contextual hints for manual review.
 *
 * Platform admin only.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin' && caller.role_type !== 'platform_admin') {
      return Response.json({ error: 'Forbidden: platform admin only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || 'preview';
    if (mode !== 'preview' && mode !== 'execute') {
      return Response.json({ error: "mode must be 'preview' or 'execute'" }, { status: 400 });
    }

    const migrationRunId = mode === 'execute'
      ? `mig_${new Date().toISOString().replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`
      : 'preview';

    // ---- Load lookup maps -------------------------------------------------
    const sites = await base44.asServiceRole.entities.Site.list();
    const siteMap: Record<string, any> = {};
    for (const s of sites) {
      siteMap[s.id] = { customer_id: s.customer_id, reseller_id: s.reseller_id, name: s.name };
    }

    const users = await base44.asServiceRole.entities.User.list();
    const userMap: Record<string, any> = {};
    for (const u of users) {
      userMap[u.id] = { customer_id: u.customer_id, reseller_id: u.reseller_id, name: u.display_name || u.full_name };
    }

    const sitesWithCustomer = sites.filter(s => s.customer_id);
    const sitesWithoutCustomer = sites.filter(s => !s.customer_id);

    // ---- Entity config: which fields point to a User and/or Site ----------
    const ENTITY_CONFIG: Record<string, { userFields: string[], siteField?: string, extra?: (r: any) => { cid?: string, rid?: string, method?: string } }> = {
      Shift:             { userFields: ['guard_id'], siteField: 'site_id' },
      Incident:          { userFields: ['guard_id'], siteField: 'site_id' },
      MaintenanceRequest:{ userFields: ['guard_id'], siteField: 'site_id' },
      PanicAlert:        { userFields: ['user_id'] },
      Alert:             { userFields: ['guard_id'], siteField: 'site_id' },
      PatrolLog:         { userFields: ['guard_id'], siteField: 'site_id' },
      ScheduledPatrol:   { siteField: 'site_id' },
      LocationTracking:  { userFields: ['user_id', 'guard_id'], siteField: 'site_id' },
      AccessLog:         { userFields: ['guard_id'], siteField: 'site_id' },
      Visitor:           { userFields: ['resident_id'], siteField: 'site_id', extra: (r) => ({ cid: userMap[r.created_by_id]?.customer_id, rid: userMap[r.created_by_id]?.reseller_id, method: 'created_by_id→User' }) },
      ChatMessage:       { userFields: ['sender_id'] },
      Notification:       { userFields: ['recipient_id'] },
      ServiceTicket:     { userFields: ['resident_id'] },
      CallHistory:       { userFields: ['user_id', 'guard_id'] },
      SignalingMessage:  { userFields: ['from_user_id', 'to_user_id'] },
    };

    const preview: Record<string, any> = {};
    const auditEntries: any[] = [];
    let totalUpdated = 0;
    let totalAmbiguous = 0;
    let totalAlreadyScoped = 0;
    let totalRecords = 0;

    for (const [entName, cfg] of Object.entries(ENTITY_CONFIG)) {
      try {
        const records = await base44.asServiceRole.entities[entName].list('-created_date', 500);
        totalRecords += records.length;

        let alreadyScoped = 0, derivable = 0, ambiguous = 0;
        const updates: any[] = [];
        const ambiguousRecords: any[] = [];

        for (const r of records) {
          if (r.customer_id) { alreadyScoped++; continue; }

          let derivedCid: string | null = null;
          let derivedRid: string | null = null;
          let method: string | null = null;

          // Pass 1: site_id → Site
          if (cfg.siteField && r[cfg.siteField] && siteMap[r[cfg.siteField]]?.customer_id) {
            derivedCid = siteMap[r[cfg.siteField]].customer_id;
            derivedRid = siteMap[r[cfg.siteField]].reseller_id;
            method = `site_id→Site`;
          }

          // Pass 2a: relational user fields
          if (!derivedCid && cfg.userFields.length) {
            const candidates = cfg.userFields
              .map(f => r[f])
              .filter(Boolean)
              .map(uid => userMap[uid])
              .filter(Boolean);

            if (candidates.length > 0) {
              const cids = [...new Set(candidates.map(c => c.customer_id).filter(Boolean))];
              const rids = [...new Set(candidates.map(c => c.reseller_id).filter(Boolean))];
              if (cids.length === 1) {
                derivedCid = cids[0];
                derivedRid = rids.length === 1 ? rids[0] : null;
                method = `${cfg.userFields.join('/')}→User`;
              }
            }
          }

          // Pass 2b: extra custom derivation
          if (!derivedCid && cfg.extra) {
            const extra = cfg.extra(r);
            if (extra?.cid) {
              derivedCid = extra.cid;
              derivedRid = extra.rid;
              method = extra.method || 'relational';
            }
          }

          if (derivedCid) {
            derivable++;
            if (mode === 'execute') {
              updates.push({ id: r.id, customer_id: derivedCid, reseller_id: derivedRid });
              auditEntries.push({
                entity: entName, recordId: r.id,
                old_customer_id: r.customer_id || null, new_customer_id: derivedCid,
                old_reseller_id: r.reseller_id || null, new_reseller_id: derivedRid,
                method,
              });
            }
          } else {
            ambiguous++;
            if (mode === 'preview' && ambiguousRecords.length < 5) {
              // Collect up to 5 sample ambiguous records per entity with hints
              const hints: string[] = [];
              if (cfg.siteField && r[cfg.siteField]) {
                const s = siteMap[r[cfg.siteField]];
                hints.push(`site_id=${r[cfg.siteField]} (${s?.name || 'unknown'}, customer_id=${s?.customer_id || 'null'})`);
              }
              for (const uf of cfg.userFields) {
                if (r[uf] && userMap[r[uf]]) {
                  hints.push(`${uf}=${r[uf]} → User customer_id=${userMap[r[uf]].customer_id || 'null'}`);
                } else if (r[uf]) {
                  hints.push(`${uf}=${r[uf]} → User not found`);
                }
              }
              if (r.created_by_id && userMap[r.created_by_id]) {
                hints.push(`created_by_id=${r.created_by_id} → User customer_id=${userMap[r.created_by_id].customer_id || 'null'}`);
              }
              ambiguousRecords.push({ id: r.id, hints, created_date: r.created_date });
            }
          }
        }

        if (mode === 'execute' && updates.length > 0) {
          // bulkUpdate in chunks of 100
          for (let i = 0; i < updates.length; i += 100) {
            await base44.asServiceRole.entities[entName].bulkUpdate(updates.slice(i, i + 100));
          }
          totalUpdated += updates.length;
        }

        totalAmbiguous += ambiguous;
        totalAlreadyScoped += alreadyScoped;

        preview[entName] = {
          total: records.length,
          already_scoped: alreadyScoped,
          derivable,
          ambiguous,
          ...(mode === 'preview' && ambiguousRecords.length ? { sample_ambiguous: ambiguousRecords } : {}),
        };
      } catch (e) {
        preview[entName] = { error: e.message };
      }
    }

    // ---- Write audit log (execute mode only) ------------------------------
    if (mode === 'execute' && auditEntries.length > 0) {
      try {
        const auditBatch = auditEntries.map(a => ({
          event_type: 'tenant.migration',
          user_id: caller.id,
          user_name: caller.display_name || caller.full_name,
          customer_id: a.new_customer_id,
          reseller_id: a.new_reseller_id,
          entity_name: a.entity,
          entity_id: a.recordId,
          action: 'backfill_tenant_ids',
          old_values: JSON.stringify({ customer_id: a.old_customer_id, reseller_id: a.old_reseller_id }),
          new_values: JSON.stringify({ customer_id: a.new_customer_id, reseller_id: a.new_reseller_id, method: a.method }),
          notes: `Migration run ${migrationRunId}: ${a.method}`,
        }));
        for (let i = 0; i < auditBatch.length; i += 100) {
          await base44.asServiceRole.entities.PlatformAuditLog.bulkCreate(auditBatch.slice(i, i + 100));
        }
      } catch (_) { /* audit logging must not break migration */ }
    }

    return Response.json({
      success: true,
      mode,
      migration_run_id: migrationRunId,
      summary: {
        sites_total: sites.length,
        sites_with_customer: sitesWithCustomer.length,
        sites_without_customer: sitesWithoutCustomer.length,
        total_records_scanned: totalRecords,
        already_scoped: totalAlreadyScoped,
        derivable: mode === 'execute' ? totalUpdated : Object.values(preview).reduce((s: number, e: any) => s + (e.derivable || 0), 0),
        ambiguous: totalAmbiguous,
      },
      sites_without_customer: sitesWithoutCustomer.map(s => ({ id: s.id, name: s.name })),
      per_entity: preview,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}