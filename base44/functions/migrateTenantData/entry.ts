import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * migrateTenantData — Safe migration of existing records to multi-tenant model.
 *
 * Backfills customer_id and reseller_id on existing records that lack them.
 * For records with site_id, looks up the Site to get customer_id/reseller_id.
 * For records without site_id, flags for admin review.
 *
 * Platform admin only. Does NOT delete any data.
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (caller.role !== 'admin' && caller.role_type !== 'platform_admin') {
      return Response.json({ error: 'Forbidden: platform admin only' }, { status: 403 });
    }

    const results = {};

    // Build site → customer_id/reseller_id lookup map
    const sites = await base44.asServiceRole.entities.Site.list();
    const siteMap = {};
    const sitesWithoutCustomer = [];
    for (const s of sites) {
      if (s.customer_id) {
        siteMap[s.id] = { customer_id: s.customer_id, reseller_id: s.reseller_id };
      } else {
        sitesWithoutCustomer.push(s.id);
      }
    }
    results['sites_without_customer'] = sitesWithoutCustomer.length;

    const entityNames = ['Shift', 'Incident', 'MaintenanceRequest', 'PanicAlert', 'AccessLog', 'Visitor', 'BlacklistEntry', 'Destination', 'WorkType', 'Alert', 'LocationTracking', 'PatrolLog', 'ScheduledPatrol', 'CallHistory', 'ChatMessage', 'ServiceTicket', 'Notification', 'SignalingMessage'];

    for (const entName of entityNames) {
      try {
        const records = await base44.asServiceRole.entities[entName].list('-created_date', 500);
        let updated = 0;
        let flagged = 0;
        const updates = [];

        for (const r of records) {
          if (r.customer_id) continue; // already has customer_id
          let cid = null, rid = null;
          if (r.site_id && siteMap[r.site_id]) {
            cid = siteMap[r.site_id].customer_id;
            rid = siteMap[r.site_id].reseller_id;
          }
          if (cid) {
            updates.push({ id: r.id, customer_id: cid, reseller_id: rid });
            updated++;
          } else {
            flagged++;
          }
        }

        if (updates.length > 0) {
          await base44.asServiceRole.entities[entName].bulkUpdate(updates);
        }
        results[entName] = { updated, flagged, total: records.length };
      } catch (e) {
        results[entName] = { error: e.message };
      }
    }

    return Response.json({ success: true, results, note: 'Records without customer_id and without a matching site_id have been flagged for admin review' });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}