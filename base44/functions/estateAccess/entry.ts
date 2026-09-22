import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { gwErr as err, resolveAdminRoles, resolveCustomerScope, checkModuleLicense, tenantQueryOf, inScopeOf, findRecord, auditLog } from '../../shared/tenantGateway.ts';

/**
 * estateAccess — the SOLE authorized data gateway for the ESTATE MANAGEMENT
 * module.
 *
 * WHY THIS EXISTS
 * ---------------
 * Estate entities previously allowed direct browser CRUD, with tenant
 * scoping delegated to RLS templates ({{user.data.customer_id}}). Session
 * tokens do not reliably carry custom User fields, so those branches can
 * resolve to null — producing either empty lists or cross-tenant exposure.
 * Following the proven siteAccess / attendanceAccess pattern, EVERY estate
 * read/write now resolves the caller and the tenant scope SERVER-SIDE:
 *
 *   Platform Admin  → oversight of all estate data (may narrow with customer_id)
 *   Reseller Admin  → their reseller's estate data (validated customer scope)
 *   Estate Manager / Customer Admin → their own customer's data (manage CRUD)
 *   Resident        → self-service: own bookings/tickets/laundry/orders,
 *                     read active venues, published announcements, open votes
 *   Vendor          → self-service: own vendor record's menu items, orders,
 *                     laundry jobs and assigned tickets
 *   Everyone else   → 403 (fail closed)
 *
 * ALL tenant ids (customer_id / reseller_id / resident_id / vendor_id /
 * unit_number / names) are stamped SERVER-SIDE from authoritative records —
 * client-supplied tenant ids are never trusted as scope. The ESTATE module
 * licence is enforced at API level (not just UI).
 *
 * Communication events are dispatched SERVER-SIDE through the estateNotify
 * gateway (branding, recipients, channels resolved there) — the frontend
 * never composes correspondence.
 */

const MODULE_KEY = 'ESTATE';
const MANAGER_ROLES = ['estate_manager', 'customer_admin'];
const BOOKING_ACTIVE_STATUSES = ['pending', 'approved', 'completed'];

export default async function main(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const caller = await resolveTenantCaller(base44);
  if (!caller) return err('Unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const { action, ...p } = body || {};
  const svc = base44.asServiceRole;
  const callerName = caller.display_name || caller.full_name || caller.email || 'Unknown';

  /* ── Server-side role resolution (User record wins over session claims) ── */
  const { isPlatform, isReseller } = resolveAdminRoles(caller);
  const isManager = !isPlatform && !isReseller
    && (MANAGER_ROLES.includes(caller.role_type) || caller.admin_level === 'customer');
  const isResident = caller.role_type === 'resident';
  const isVendor = caller.role_type === 'vendor';
  const isAdmin = isPlatform || isReseller || isManager;

  /* ── Tenant scope resolution (never trusts client tenant ids) ────────── */
  const scopeRes = await resolveCustomerScope(svc, caller, p, isPlatform, isReseller);
  if (scopeRes.error) return scopeRes.error;
  const scope = scopeRes.scope || { mode: 'none', customer_id: null, reseller_id: null };

  /* ── ESTATE module licence (API level, fail closed) ──────────────────── */
  const licRes = await checkModuleLicense(svc, isPlatform, scope, MODULE_KEY);
  const licensed = licRes.licensed;
  const reason = licRes.reason;
  const authorized = licensed && (isPlatform || isReseller || isManager || isResident || isVendor);
  const deny = () => err(reason || 'Not authorized for Estate Management', 403);

  /* ── Self profiles (lazy — resolved once, server-side) ────────────────── */
  let myResident = null;
  let myVendor = null;
  const loadSelf = async () => {
    if (isResident && !myResident) {
      const rows = await svc.entities.Resident.filter({ user_id: caller.id }).catch(() => []);
      myResident = (rows && rows[0]) || null;
    }
    if (isVendor && !myVendor) {
      const rows = await svc.entities.Vendor.filter({ user_id: caller.id }).catch(() => []);
      myVendor = (rows && rows[0]) || null;
    }
  };
  const selfName = () => (myResident && myResident.full_name) || callerName;
  const selfUnit = () => (myResident && myResident.unit_number) || '';
  const selfResidentIds = () => {
    const ids = [caller.id];
    if (myResident && myResident.id && !ids.includes(myResident.id)) ids.push(myResident.id);
    return ids;
  };

  const resolveResellerId = async () => {
    if (scope.reseller_id) return scope.reseller_id;
    if (scope.customer_id) {
      const cust = await svc.entities.Customer.get(scope.customer_id).catch(() => null);
      return (cust && cust.reseller_id) || null;
    }
    return null;
  };

  /* Tenant filter for manager/platform/reseller lists */
  const tenantQuery = (extra) => tenantQueryOf(scope, extra);

  /* Record is in the caller's manage scope */
  const inManageScope = (r) => inScopeOf(scope, r, isPlatform, isReseller);

  const find = (entityName, id) => findRecord(svc, entityName, id);

  const audit = (event_type, entity_name, entity_id, notes, rec) =>
    auditLog(svc, { callerId: caller.id, callerName, scope }, event_type, entity_name, entity_id, notes, rec);

  /* Server-side notification dispatch — failures NEVER fail the business op */
  const notify = async (payload) => {
    try { await base44.functions.invoke('estateNotify', payload); } catch (_) {}
  };

  /* Generic manager CRUD builder — validated per entity below */
  const manageCrud = async (entityName, listKey, eventPrefix, buildCreate, changesFilter) => {
    if (action === 'list_' + listKey) {
      if (!authorized || !(isAdmin)) return err('Forbidden', 403);
      const rows = await svc.entities[entityName].filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ [listKey]: rows || [] });
    }
    if (action === 'create_' + listKey) {
      if (!authorized || !isManager) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A customer scope is required.', 400);
      const reseller_id = await resolveResellerId();
      const data = await buildCreate(p.data || p, reseller_id);
      const created = await svc.entities[entityName].create(data);
      await audit(eventPrefix + '.created', entityName, created.id, 'created ' + entityName, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_' + listKey) {
      if (!authorized || !isManager) return err('Forbidden', 403);
      const rec = await find(entityName, p.id);
      if (!rec || !inManageScope(rec)) return err('Record not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      if (changesFilter) { const filtered = changesFilter(changes, rec); if (filtered) return filtered; }
      delete changes.customer_id; delete changes.reseller_id; delete changes.user_id;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities[entityName].update(rec.id, changes);
      await audit(eventPrefix + '.updated', entityName, rec.id, 'updated ' + entityName, updated);
      return Response.json({ success: true, record: updated });
    }
    if (action === 'delete_' + listKey) {
      if (!authorized || !isManager) return err('Forbidden', 403);
      const rec = await find(entityName, p.id);
      if (!rec || !inManageScope(rec)) return err('Record not found in your scope.', 404);
      await audit(eventPrefix + '.deleted', entityName, rec.id, 'deleted ' + entityName, rec);
      await svc.entities[entityName].delete(rec.id);
      return Response.json({ success: true });
    }
    return null; // not a crud action for this entity
  };

  try {
    /* ── Context ─────────────────────────────────────────────────────────── */
    if (action === 'get_context') {
      await loadSelf();
      return Response.json({
        authorized, reason: authorized ? null : reason, mode: scope.mode,
        customer_id: scope.customer_id, reseller_id: scope.reseller_id,
        is_platform_admin: isPlatform, is_manager: isManager,
        is_resident: isResident, is_vendor: isVendor,
        my_profile: isResident ? myResident : null,
        my_vendor: isVendor ? myVendor : null,
      });
    }

    /* ── Resident incident / maintenance reports (shared entities, server-
       stamped identity — Phase 9: the resident's name, unit, tenant ids and
       timestamps are populated SERVER-SIDE, never from client input). */
    if (action === 'create_resident_report') {
      if (!authorized || !(isResident || isManager)) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A customer scope is required.', 400);
      const type = String(p.report_type || '');
      if (!['incident', 'maintenance'].includes(type)) return err('report_type must be incident or maintenance.');
      await loadSelf();
      const d = p.data || {};
      const reseller_id = await resolveResellerId();
      const reported_at = new Date().toISOString();
      const reporterName = selfName();
      const siteName = `Resident — Unit ${selfUnit() || '—'}`;
      if (type === 'incident') {
        if (!d.title || !d.category || !d.description) return err('Title, category and description are required.');
        const created = await svc.entities.Incident.create({
          customer_id: scope.customer_id, reseller_id,
          title: String(d.title).trim(), description: String(d.description),
          category: d.category, priority: d.priority || 'medium', status: 'reported',
          guard_id: caller.id, guard_name: reporterName,
          site_id: 'resident', site_name: siteName, reported_at,
        });
        await audit('estate.resident_incident.created', 'Incident', created.id, 'resident incident report', created);
        return Response.json({ success: true, record: created, report_type: 'incident' });
      }
      if (!d.category || !d.description) return err('Category and description are required.');
      const created = await svc.entities.MaintenanceRequest.create({
        customer_id: scope.customer_id, reseller_id,
        title: d.title ? String(d.title).trim() : `${d.category} request`,
        description: String(d.description), category: d.category,
        urgency: d.urgency || 'medium', status: 'reported',
        guard_id: caller.id, guard_name: reporterName,
        site_id: 'resident', site_name: siteName, reported_at,
      });
      await audit('estate.resident_maintenance.created', 'MaintenanceRequest', created.id, 'resident maintenance report', created);
      return Response.json({ success: true, record: created, report_type: 'maintenance' });
    }
    if (action === 'list_my_reports') {
      if (!authorized || !isResident) return err('Forbidden', 403);
      const type = String(p.report_type || '');
      const entityName = type === 'maintenance' ? 'MaintenanceRequest' : 'Incident';
      await loadSelf();
      const rows = await svc.entities[entityName].filter({ customer_id: scope.customer_id, guard_id: caller.id }, '-created_date', 200).catch(() => []);
      return Response.json({ reports: rows || [] });
    }

    /* ── Residents (directory + onboarding/linking) ─────────────────────── */
    if (action === 'list_residents') {
      if (!authorized || !isAdmin) return err('Forbidden', 403);
      const rows = await svc.entities.Resident.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ residents: rows || [] });
    }
    if (action === 'create_resident') {
      if (!authorized || !isManager) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A customer scope is required.', 400);
      const d = p.data || {};
      if (!d.full_name || !d.unit_number) return err('Full name and unit number are required.');
      const reseller_id = await resolveResellerId();
      const created = await svc.entities.Resident.create({
        customer_id: scope.customer_id, reseller_id,
        full_name: String(d.full_name).trim(), email: d.email || null, phone: d.phone || null,
        id_number: d.id_number || null, unit_number: String(d.unit_number).trim(),
        estate_name: d.estate_name || null, status: d.status || 'active',
        move_in_date: d.move_in_date || null,
        emergency_contact_name: d.emergency_contact_name || null,
        emergency_contact_phone: d.emergency_contact_phone || null,
        notes: d.notes || null, profile_photo: d.profile_photo || null,
      });
      await audit('estate.resident.created', 'Resident', created.id, 'created resident ' + created.full_name, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_resident') {
      if (!authorized || !isManager) return err('Forbidden', 403);
      const rec = await find('Resident', p.id);
      if (!rec || !inManageScope(rec)) return err('Resident not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id;
      if (changes.user_id !== undefined) return err('Use link_resident_user to change the linked account.', 400);
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.Resident.update(rec.id, changes);
      await audit('estate.resident.updated', 'Resident', rec.id, 'updated resident', updated);
      return Response.json({ success: true, record: updated });
    }
    if (action === 'delete_resident') {
      if (!authorized || !isManager) return err('Forbidden', 403);
      const rec = await find('Resident', p.id);
      if (!rec || !inManageScope(rec)) return err('Resident not found in your scope.', 404);
      await audit('estate.resident.deleted', 'Resident', rec.id, 'deleted resident ' + rec.full_name, rec);
      await svc.entities.Resident.delete(rec.id);
      return Response.json({ success: true });
    }
    /* Controlled onboarding link: a resident profile is linked to exactly one
       User of the SAME tenant with the resident role — never a cross-tenant
       or elevated account. One link per user (unlink first to re-link). */
    if (action === 'link_resident_user') {
      if (!authorized || !isManager) return err('Forbidden', 403);
      if (!p.resident_id || !p.user_id) return err('resident_id and user_id are required.');
      const rec = await find('Resident', p.resident_id);
      if (!rec || !inManageScope(rec)) return err('Resident not found in your scope.', 404);
      const userRows = await svc.entities.User.filter({ id: String(p.user_id) }).catch(() => []);
      const user = (userRows && userRows[0]) || null;
      if (!user) return err('User not found.', 404);
      if (user.customer_id && scope.customer_id && user.customer_id !== scope.customer_id) {
        return err('That user belongs to another customer.', 403);
      }
      if (user.role_type && user.role_type !== 'resident') {
        return err('Only resident accounts can be linked to a resident profile.', 400);
      }
      const existing = await svc.entities.Resident.filter({ user_id: user.id }).catch(() => []);
      if ((existing || []).some((r) => r.id !== rec.id)) {
        return err('That user is already linked to another resident profile.', 409);
      }
      const updated = await svc.entities.Resident.update(rec.id, { user_id: user.id });
      await audit('estate.resident.linked', 'Resident', rec.id, 'linked resident profile to user ' + user.id, updated);
      return Response.json({ success: true, record: updated });
    }
    if (action === 'unlink_resident_user') {
      if (!authorized || !isManager) return err('Forbidden', 403);
      const rec = await find('Resident', p.id);
      if (!rec || !inManageScope(rec)) return err('Resident not found in your scope.', 404);
      const updated = await svc.entities.Resident.update(rec.id, { user_id: null });
      await audit('estate.resident.unlinked', 'Resident', rec.id, 'unlinked resident profile account', updated);
      return Response.json({ success: true, record: updated });
    }

    /* ── Properties (manage CRUD only) ──────────────────────────────────── */
    const propertyResult = await manageCrud('Property', 'properties', 'estate.property',
      async (d, reseller_id) => {
        if (!d.unit_number) throw new Error('Unit number is required.');
        return {
          customer_id: scope.customer_id, reseller_id, site_id: d.site_id || null, site_name: d.site_name || null,
          unit_number: String(d.unit_number).trim(), address: d.address || null,
          property_type: d.property_type || 'house', owner_name: d.owner_name || null,
          owner_email: d.owner_email || null, owner_phone: d.owner_phone || null,
          tenant_name: d.tenant_name || null, tenant_email: d.tenant_email || null,
          tenant_phone: d.tenant_phone || null, occupancy_status: d.occupancy_status || 'owner_occupied',
          bedrooms: d.bedrooms ?? null, bathrooms: d.bathrooms ?? null,
          floor_area_sqm: d.floor_area_sqm ?? null, notes: d.notes || null, status: d.status || 'active',
        };
      }, null);
    if (propertyResult) return propertyResult;

    /* ── Venues (managers CRUD; residents/vendors read active) ──────────── */
    if (action === 'list_venues') {
      if (!authorized) return deny();
      const rows = await svc.entities.Venue.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ venues: rows || [] });
    }
    const venueResult = await manageCrud('Venue', 'venues', 'estate.venue',
      async (d, reseller_id) => {
        if (!d.name || !d.category) throw new Error('Venue name and category are required.');
        return {
          customer_id: scope.customer_id, reseller_id, site_id: d.site_id || null,
          name: String(d.name).trim(), description: d.description || null, category: d.category,
          capacity: d.capacity ?? null, photos: Array.isArray(d.photos) ? d.photos : [],
          status: d.status || 'active', available_hours_start: d.available_hours_start || null,
          available_hours_end: d.available_hours_end || null,
          allows_multi_day: d.allows_multi_day === true, approval_mode: d.approval_mode || 'automatic',
          advance_booking_days: d.advance_booking_days ?? 90, rules: d.rules || null,
          amenities: Array.isArray(d.amenities) ? d.amenities : [],
          facility_questions: Array.isArray(d.facility_questions) ? d.facility_questions : [],
          blocked_periods: Array.isArray(d.blocked_periods) ? d.blocked_periods : [],
        };
      }, null);
    if (venueResult) return venueResult;

    /* ── Venue bookings ──────────────────────────────────────────────────── */
    if (action === 'list_bookings') {
      if (!authorized) return deny();
      if (isResident) {
        await loadSelf();
        const ids = selfResidentIds();
        const rows = await svc.entities.VenueBooking.filter({ customer_id: scope.customer_id }, '-created_date', 500).catch(() => []);
        return Response.json({ bookings: (rows || []).filter((b) => ids.includes(b.resident_id)) });
      }
      const rows = await svc.entities.VenueBooking.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ bookings: rows || [] });
    }
    /* Resident availability preview — busy time ranges only (no names). */
    if (action === 'venue_availability') {
      if (!authorized || !(isResident || isManager)) return err('Forbidden', 403);
      if (!p.venue_id || !p.date) return err('venue_id and date are required.');
      const venue = await find('Venue', p.venue_id);
      if (!venue || !inManageScope(venue)) return err('Venue not available.', 404);
      const existing = await svc.entities.VenueBooking.filter({ venue_id: venue.id }, '-created_date', 500).catch(() => []);
      const busy = (existing || []).filter((b) => BOOKING_ACTIVE_STATUSES.includes(b.status)).map((b) => {
        if (b.start_datetime && b.end_datetime) return { start: b.start_datetime.slice(11, 16), end: b.end_datetime.slice(11, 16) };
        if (b.booking_date === p.date && b.start_time && b.end_time) return { start: b.start_time, end: b.end_time };
        return null;
      }).filter(Boolean);
      return Response.json({ busy, blocked: (venue.blocked_periods || []).map((bp) => ({
        start: bp.start_datetime, end: bp.end_datetime, reason: bp.reason || null,
      })) });
    }
    if (action === 'create_booking') {
      if (!authorized || !(isResident || isManager)) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A customer scope is required.', 400);
      await loadSelf();
      const d = p.data || {};
      const venue = await find('Venue', d.venue_id);
      if (!venue || !inManageScope(venue) || venue.status !== 'active') {
        return err('Venue not available.', 404);
      }
      // Accept either a datetime pair or the legacy date + times. LOCAL
      // strings are preserved verbatim (never converted through UTC) so
      // booking_date / start_time / end_time always stay in estate time.
      let startStr = null;
      let endStr = null;
      if (d.start_datetime && d.end_datetime) {
        startStr = String(d.start_datetime);
        endStr = String(d.end_datetime);
      } else if (d.booking_date && d.start_time && d.end_time) {
        startStr = `${d.booking_date}T${d.start_time}:00`;
        endStr = `${d.booking_date}T${d.end_time}:00`;
      }
      const start = startStr ? new Date(startStr) : null;
      const end = endStr ? new Date(endStr) : null;
      if (!startStr || !endStr || isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        return err('Valid booking date, start and end times are required.');
      }
      // Advance booking window
      const advanceDays = venue.advance_booking_days ?? 90;
      if (start.getTime() > Date.now() + advanceDays * 86400000) {
        return err(`Bookings can only be made up to ${advanceDays} days in advance.`, 400);
      }
      if (!venue.allows_multi_day && start.toDateString() !== end.toDateString()) {
        return err('This venue does not allow multi-day bookings.', 400);
      }
      // Blocked periods
      for (const bp of (venue.blocked_periods || [])) {
        if (!bp.start_datetime || !bp.end_datetime) continue;
        if (start < new Date(bp.end_datetime) && end > new Date(bp.start_datetime)) {
          return err('Venue is unavailable for that period.', 409);
        }
      }
      // Collision with existing active bookings (datetime pair OR legacy
      // booking_date + start_time/end_time — both stored as local strings).
      const existing = await svc.entities.VenueBooking.filter({ venue_id: venue.id }, '-created_date', 500).catch(() => []);
      const bookRange = (b) => {
        if (b.start_datetime && b.end_datetime) return { s: new Date(b.start_datetime), e: new Date(b.end_datetime) };
        if (b.booking_date && b.start_time && b.end_time) {
          return { s: new Date(`${b.booking_date}T${b.start_time}:00`), e: new Date(`${b.booking_date}T${b.end_time}:00`) };
        }
        return null;
      };
      const clash = (existing || []).find((b) => {
        if (!BOOKING_ACTIVE_STATUSES.includes(b.status)) return false;
        const r = bookRange(b);
        return r && start < r.e && end > r.s;
      });
      if (clash) return err('That time slot is already booked.', 409);

      const reseller_id = await resolveResellerId();
      const residentId = isResident ? caller.id : (d.resident_id || caller.id);
      const created = await svc.entities.VenueBooking.create({
        customer_id: scope.customer_id, reseller_id, site_id: venue.site_id || null,
        venue_id: venue.id, venue_name: venue.name,
        resident_id: residentId, resident_name: selfName(), unit_number: selfUnit(),
        start_datetime: startStr, end_datetime: endStr,
        booking_date: d.booking_date || startStr.slice(0, 10),
        start_time: d.start_time || startStr.slice(11, 16),
        end_time: d.end_time || endStr.slice(11, 16),
        guest_count: Number(d.guest_count) || 1, purpose: d.purpose || null,
        status: venue.approval_mode === 'automatic' ? 'approved' : 'pending',
        approval_mode: venue.approval_mode || 'automatic',
        facility_answers: Array.isArray(d.facility_answers) ? d.facility_answers : [],
        special_requirements: d.special_requirements || null, notes: d.notes || null,
        collision_checked: true,
      });
      await audit('estate.booking.created', 'VenueBooking', created.id, 'booking for ' + venue.name, created);
      if (created.status === 'pending') await notify({ action: 'booking_request', booking_ids: [created.id] });
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_booking') {
      if (!authorized) return deny();
      const rec = await find('VenueBooking', p.id);
      if (!rec) return err('Booking not found.', 404);
      const inTenant = inManageScope(rec);
      await loadSelf();
      const own = isResident && selfResidentIds().includes(rec.resident_id);
      if (!inTenant && !own) return err('Booking not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};

      // Resident self-service: cancel own PENDING booking only.
      if (!inTenant && own) {
        if (Object.keys(changes).length !== 1 || changes.status !== 'cancelled') {
          return err('You can only cancel your own pending booking.', 403);
        }
        if (!['pending', 'approved'].includes(rec.status)) return err('This booking can no longer be cancelled.', 409);
        const updated = await svc.entities.VenueBooking.update(rec.id, { status: 'cancelled' });
        await notify({ action: 'booking_decision', booking_id: rec.id, decision: 'cancelled' });
        return Response.json({ success: true, record: updated });
      }
      if (!isManager && !isPlatform && !isReseller) return err('Forbidden', 403);
      delete changes.customer_id; delete changes.reseller_id; delete changes.resident_id;
      // Manager decision handling
      if (changes.status && ['approved', 'rejected', 'info_requested', 'cancelled', 'completed'].includes(changes.status)) {
        if (changes.status === 'approved') {
          changes.approved_by = caller.id; changes.approved_by_name = callerName;
          changes.approved_at = new Date().toISOString();
          if (rec.status !== 'pending' && rec.approval_mode === 'manager_approval') { /* allow re-approve */ }
        }
        if (rec.status === 'approved' && ['approved'].includes(changes.status)) { /* idempotent */ }
      }
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.VenueBooking.update(rec.id, changes);
      await audit('estate.booking.updated', 'VenueBooking', rec.id, 'updated booking', updated);
      if (['approved', 'rejected'].includes(changes.status)) {
        await notify({ action: 'booking_decision', booking_id: rec.id, decision: changes.status });
      } else if (changes.status === 'cancelled') {
        await notify({ action: 'booking_decision', booking_id: rec.id, decision: 'cancelled' });
      }
      return Response.json({ success: true, record: updated });
    }
    if (action === 'delete_booking') {
      if (!authorized || !isAdmin) return err('Forbidden', 403);
      const rec = await find('VenueBooking', p.id);
      if (!rec || !inManageScope(rec)) return err('Booking not found in your scope.', 404);
      await audit('estate.booking.deleted', 'VenueBooking', rec.id, 'deleted booking', rec);
      await svc.entities.VenueBooking.delete(rec.id);
      return Response.json({ success: true });
    }

    /* ── Announcements ──────────────────────────────────────────────────── */
    if (action === 'list_announcements') {
      if (!authorized) return deny();
      const rows = await svc.entities.Announcement.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      const visible = isResident || isVendor ? (rows || []).filter((a) => a.published) : (rows || []);
      return Response.json({ announcements: visible });
    }
    const announcementResult = await manageCrud('Announcement', 'announcements', 'estate.announcement',
      async (d, reseller_id) => {
        if (!d.title || !d.body) throw new Error('Title and body are required.');
        return {
          customer_id: scope.customer_id, reseller_id,
          title: String(d.title).trim(), body: String(d.body),
          category: d.category || 'news', priority: d.priority || 'normal',
          media: Array.isArray(d.media) ? d.media : [],
          target_audience: d.target_audience || 'all',
          target_units: Array.isArray(d.target_units) ? d.target_units : [],
          send_email: d.send_email === true, send_push: d.send_push !== false,
          // Draft on create — publishing is the single-intent publish_announcement
          // action, which also fires the server-side notification.
          published: false, published_at: null,
          created_by: caller.id, created_by_name: callerName,
        };
      },
      (changes) => {
        // Publishing/unpublishing never happens through generic update —
        // use the publish_announcement action.
        delete changes.published;
        delete changes.published_at;
        return null;
      });
    if (announcementResult) return announcementResult;
    /* Resident acknowledgement — appends ONLY the caller's own id to read_by. */
    if (action === 'acknowledge_announcement') {
      if (!authorized) return deny();
      if (!p.id) return err('An announcement id is required.');
      const rec = await find('Announcement', p.id);
      if (!rec || !inManageScope(rec) || !rec.published) return err('Announcement not found in your scope.', 404);
      const readBy = Array.isArray(rec.read_by) ? rec.read_by : [];
      if (!readBy.includes(caller.id)) {
        await svc.entities.Announcement.update(rec.id, { read_by: [...readBy, caller.id] });
      }
      return Response.json({ success: true });
    }

    /* publish_announcement — explicit publish action (single intent) */
    if (action === 'publish_announcement') {
      if (!authorized || !isManager) return err('Forbidden', 403);
      const rec = await find('Announcement', p.id);
      if (!rec || !inManageScope(rec)) return err('Announcement not found in your scope.', 404);
      if (!rec.published) {
        const updated = await svc.entities.Announcement.update(rec.id, { published: true, published_at: new Date().toISOString() });
        await audit('estate.announcement.published', 'Announcement', rec.id, 'published announcement', updated);
      }
      await notify({ action: 'publish_announcement', announcement_id: rec.id });
      return Response.json({ success: true });
    }

    /* ── Voting questions (ballots stay in castVote) ────────────────────── */
    if (action === 'list_questions') {
      if (!authorized) return deny();
      const rows = await svc.entities.VotingQuestion.filter(tenantQuery(p.filter || {}), '-created_date', 200).catch(() => []);
      const visible = isResident || isVendor ? (rows || []).filter((q) => q.status === 'open') : (rows || []);
      return Response.json({ questions: visible });
    }
    const voteResult = await manageCrud('VotingQuestion', 'questions', 'estate.vote',
      async (d, reseller_id) => {
        if (!d.title || !d.question_type) throw new Error('Title and question type are required.');
        const opts = Array.isArray(d.options) ? d.options.map((o) => ({ text: String(o.text || ''), votes: 0 })) : [];
        if (d.question_type !== 'yes_no' && opts.length < 2) throw new Error('At least two options are required.');
        return {
          customer_id: scope.customer_id, reseller_id, site_id: d.site_id || null,
          title: String(d.title).trim(), description: d.description || null,
          question_type: d.question_type, options: d.question_type === 'yes_no' ? [{ text: 'Yes', votes: 0 }, { text: 'No', votes: 0 }] : opts,
          status: d.status || 'draft', open_date: d.open_date || null, close_date: d.close_date || null,
          created_by_name: callerName,
        };
      }, null);
    if (voteResult) return voteResult;
    if (action === 'open_question') {
      if (!authorized || !isManager) return err('Forbidden', 403);
      const rec = await find('VotingQuestion', p.id);
      if (!rec || !inManageScope(rec)) return err('Vote not found in your scope.', 404);
      const updated = await svc.entities.VotingQuestion.update(rec.id, {
        status: 'open', open_date: rec.open_date || new Date().toISOString(),
      });
      await audit('estate.vote.opened', 'VotingQuestion', rec.id, 'opened vote', updated);
      await notify({ action: 'vote_opened', question_id: rec.id });
      return Response.json({ success: true, record: updated });
    }

    /* ── Service tickets ────────────────────────────────────────────────── */
    if (action === 'list_tickets') {
      if (!authorized) return deny();
      if (isResident) {
        await loadSelf();
        const ids = selfResidentIds();
        const rows = await svc.entities.ServiceTicket.filter({ customer_id: scope.customer_id }, '-created_date', 500).catch(() => []);
        return Response.json({ tickets: (rows || []).filter((t) => ids.includes(t.resident_id)) });
      }
      if (isVendor) {
        await loadSelf();
        const rows = await svc.entities.ServiceTicket.filter({ customer_id: scope.customer_id }, '-created_date', 500).catch(() => []);
        const vid = myVendor ? myVendor.id : '__none__';
        return Response.json({ tickets: (rows || []).filter((t) => t.vendor_id === vid) });
      }
      const rows = await svc.entities.ServiceTicket.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ tickets: rows || [] });
    }
    if (action === 'create_ticket') {
      if (!authorized || !(isResident || isManager)) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A customer scope is required.', 400);
      await loadSelf();
      const d = p.data || {};
      if (!d.title || !d.category) return err('Title and category are required.');
      const residentId = isResident ? caller.id : (d.resident_id || caller.id);
      const ticketNumber = 'EST-' + Date.now().toString(36).toUpperCase();
      const reseller_id = await resolveResellerId();
      const created = await svc.entities.ServiceTicket.create({
        customer_id: scope.customer_id, reseller_id, site_id: d.site_id || null,
        ticket_number: ticketNumber, resident_id: residentId, resident_name: selfName(),
        unit_number: selfUnit(), category: d.category, priority: d.priority || 'medium',
        title: String(d.title).trim(), description: d.description || null,
        media: Array.isArray(d.media) ? d.media : [], stage: 'submitted', status: 'open',
      });
      await audit('estate.ticket.created', 'ServiceTicket', created.id, 'created ticket ' + ticketNumber, created);
      await notify({ action: 'ticket_created', ticket_id: created.id });
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_ticket') {
      if (!authorized) return deny();
      const rec = await find('ServiceTicket', p.id);
      if (!rec) return err('Ticket not found.', 404);
      const inTenant = inManageScope(rec);
      await loadSelf();
      const ownResident = isResident && selfResidentIds().includes(rec.resident_id);
      const ownVendor = isVendor && myVendor && rec.vendor_id === myVendor.id;
      if (!inTenant && !ownResident && !ownVendor) return err('Ticket not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};

      if (!inTenant && ownResident) {
        // Resident: rate/feedback/reopen own ticket only.
        const allowed = {};
        if (changes.resident_rating !== undefined) allowed.resident_rating = Number(changes.resident_rating) || null;
        if (changes.resident_feedback !== undefined) allowed.resident_feedback = String(changes.resident_feedback);
        if (changes.status === 'reopened' && ['resolved', 'closed'].includes(rec.status)) {
          allowed.status = 'open'; allowed.stage = 'reopened';
        }
        if (!Object.keys(allowed).length) return err('You can only rate, give feedback on, or reopen your own ticket.', 403);
        const updated = await svc.entities.ServiceTicket.update(rec.id, allowed);
        return Response.json({ success: true, record: updated });
      }
      if (!inTenant && ownVendor) {
        // Vendor/contractor: update the contractor workflow fields of an
        // assigned ticket only — never reassign, escalate or close silently.
        const allowed = {};
        if (changes.contractor_status !== undefined) allowed.contractor_status = changes.contractor_status;
        if (changes.contractor_notes !== undefined) allowed.contractor_notes = String(changes.contractor_notes);
        if (Array.isArray(changes.contractor_photos)) allowed.contractor_photos = changes.contractor_photos;
        if (changes.materials_used !== undefined) allowed.materials_used = String(changes.materials_used);
        if (changes.outstanding_issues !== undefined) allowed.outstanding_issues = String(changes.outstanding_issues);
        if (changes.contractor_signature !== undefined) allowed.contractor_signature = changes.contractor_signature;
        if (!Object.keys(allowed).length) return err('Vendors can only update the contractor workflow fields.', 403);
        const updated = await svc.entities.ServiceTicket.update(rec.id, allowed);
        return Response.json({ success: true, record: updated });
      }
      if (!isAdmin) return err('Forbidden', 403);
      delete changes.customer_id; delete changes.reseller_id; delete changes.resident_id;
      if (Object.keys(changes).length) {
        if (['resolved', 'closed'].includes(changes.status) && !changes.resolved_at) {
          changes.resolved_at = new Date().toISOString();
        }
        const updated = await svc.entities.ServiceTicket.update(rec.id, changes);
        await audit('estate.ticket.updated', 'ServiceTicket', rec.id, 'updated ticket', updated);
        if (changes.status) await notify({ action: 'ticket_status', ticket_id: rec.id, status: changes.status });
        return Response.json({ success: true, record: updated });
      }
      return Response.json({ success: true, record: rec, unchanged: true });
    }
    if (action === 'delete_ticket') {
      if (!authorized || !isAdmin) return err('Forbidden', 403);
      const rec = await find('ServiceTicket', p.id);
      if (!rec || !inManageScope(rec)) return err('Ticket not found in your scope.', 404);
      await audit('estate.ticket.deleted', 'ServiceTicket', rec.id, 'deleted ticket', rec);
      await svc.entities.ServiceTicket.delete(rec.id);
      return Response.json({ success: true });
    }

    /* ── Vendors directory ─────────────────────────────────────────────── */
    if (action === 'list_vendors') {
      if (!authorized) return deny();
      const rows = await svc.entities.Vendor.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      const visible = (rows || []).filter((v) => isManager || isPlatform || isReseller || v.status === 'active');
      return Response.json({ vendors: visible });
    }
    const vendorResult = await manageCrud('Vendor', 'vendors', 'estate.vendor',
      async (d, reseller_id) => {
        if (!d.business_name || !d.category || !d.phone) throw new Error('Business name, category and phone are required.');
        return {
          customer_id: scope.customer_id, reseller_id, user_id: d.user_id || null,
          business_name: String(d.business_name).trim(), contact_name: d.contact_name || null,
          email: d.email || null, phone: String(d.phone).trim(), whatsapp: d.whatsapp || null,
          category: d.category, description: d.description || null, logo_url: d.logo_url || null,
          status: d.status || 'active', rating: d.rating ?? null, operating_hours: d.operating_hours || null,
          delivery_available: d.delivery_available === true, delivery_fee: d.delivery_fee || 0,
          minimum_order: d.minimum_order || 0, bank_account: d.bank_account || null, vat_number: d.vat_number || null,
        };
      }, null);
    if (vendorResult) return vendorResult;

    /* ── Menu items (vendor self-service for own vendor; managers CRUD) ──── */
    if (action === 'list_menu_items') {
      if (!authorized) return deny();
      await loadSelf();
      const f = p.filter || {};
      if (isVendor) {
        if (!myVendor) return Response.json({ menu_items: [] });
        const rows = await svc.entities.MenuItem.filter({ customer_id: scope.customer_id, vendor_id: myVendor.id }, '-created_date', 500).catch(() => []);
        return Response.json({ menu_items: rows || [] });
      }
      const rows = await svc.entities.MenuItem.filter(tenantQuery(f), '-created_date', 500).catch(() => []);
      return Response.json({ menu_items: rows || [] });
    }
    if (action === 'save_menu_item') {
      if (!authorized) return deny();
      await loadSelf();
      const d = p.data || {};
      let vendor = null;
      if (isVendor) {
        vendor = myVendor;
        if (!vendor) return err('No vendor profile is linked to your account.', 403);
      } else {
        vendor = await find('Vendor', d.vendor_id);
        if (!vendor || !inManageScope(vendor)) return err('Vendor not found in your scope.', 404);
      }
      if (!d.name || d.price === undefined) return err('Name and price are required.');
      const reseller_id = await resolveResellerId();
      const payload = {
        customer_id: scope.customer_id, reseller_id, vendor_id: vendor.id, vendor_name: vendor.business_name,
        category: d.category || vendor.category, item_category: d.item_category || null,
        name: String(d.name).trim(), description: d.description || null,
        price: Number(d.price) || 0, photo_url: d.photo_url || null,
        available: d.available !== false, preparation_time_minutes: d.preparation_time_minutes ?? null,
        allergens: Array.isArray(d.allergens) ? d.allergens : [], tags: Array.isArray(d.tags) ? d.tags : [],
      };
      if (d.id) {
        const rec = await find('MenuItem', d.id);
        if (!rec || rec.vendor_id !== vendor.id || !inManageScope(rec)) return err('Menu item not found in your scope.', 404);
        const updated = await svc.entities.MenuItem.update(rec.id, payload);
        return Response.json({ success: true, record: updated });
      }
      const created = await svc.entities.MenuItem.create(payload);
      await audit('estate.menu_item.created', 'MenuItem', created.id, 'created menu item', created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'delete_menu_item') {
      if (!authorized) return deny();
      await loadSelf();
      const rec = await find('MenuItem', p.id);
      if (!rec || !inManageScope(rec)) return err('Menu item not found in your scope.', 404);
      if (isVendor && (!myVendor || rec.vendor_id !== myVendor.id)) return err('Menu item not found in your scope.', 404);
      await svc.entities.MenuItem.delete(rec.id);
      return Response.json({ success: true });
    }

    /* ── Laundry requests ───────────────────────────────────────────────── */
    if (action === 'list_laundry') {
      if (!authorized) return deny();
      if (isResident) {
        await loadSelf();
        const ids = selfResidentIds();
        const rows = await svc.entities.LaundryRequest.filter({ customer_id: scope.customer_id }, '-created_date', 500).catch(() => []);
        return Response.json({ laundry: (rows || []).filter((l) => ids.includes(l.resident_id)) });
      }
      if (isVendor) {
        await loadSelf();
        const rows = await svc.entities.LaundryRequest.filter({ customer_id: scope.customer_id }, '-created_date', 500).catch(() => []);
        const vid = myVendor ? myVendor.id : '__none__';
        return Response.json({ laundry: (rows || []).filter((l) => l.vendor_id === vid) });
      }
      const rows = await svc.entities.LaundryRequest.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ laundry: rows || [] });
    }
    if (action === 'create_laundry') {
      if (!authorized || !(isResident || isManager)) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A customer scope is required.', 400);
      await loadSelf();
      const d = p.data || {};
      if (!d.pickup_date) return err('A pickup date is required.');
      let vendor = null;
      if (d.vendor_id) {
        vendor = await find('Vendor', d.vendor_id);
        if (!vendor || !inManageScope(vendor) || vendor.status !== 'active') return err('Vendor not available.', 404);
      }
      const reseller_id = await resolveResellerId();
      const created = await svc.entities.LaundryRequest.create({
        customer_id: scope.customer_id, reseller_id,
        resident_id: isResident ? caller.id : (d.resident_id || caller.id),
        resident_name: selfName(), unit_number: selfUnit(),
        vendor_id: vendor ? vendor.id : null, vendor_name: vendor ? vendor.business_name : null,
        pickup_date: d.pickup_date, pickup_time_slot: d.pickup_time_slot || null,
        delivery_date: d.delivery_date || null, delivery_time_slot: d.delivery_time_slot || null,
        items: Array.isArray(d.items) ? d.items : [],
        special_instructions: d.special_instructions || null, status: 'scheduled',
      });
      await audit('estate.laundry.created', 'LaundryRequest', created.id, 'laundry request created', created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_laundry') {
      if (!authorized) return deny();
      const rec = await find('LaundryRequest', p.id);
      if (!rec) return err('Laundry request not found.', 404);
      const inTenant = inManageScope(rec);
      await loadSelf();
      const ownResident = isResident && selfResidentIds().includes(rec.resident_id);
      const ownVendor = isVendor && myVendor && rec.vendor_id === myVendor.id;
      if (!inTenant && !ownResident && !ownVendor) return err('Laundry request not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      if (!inTenant && ownResident) {
        if (Object.keys(changes).length !== 1 || changes.status !== 'cancelled') {
          return err('You can only cancel your own laundry request.', 403);
        }
        if (!['scheduled', 'picked_up'].includes(rec.status)) return err('This request can no longer be cancelled.', 409);
        const updated = await svc.entities.LaundryRequest.update(rec.id, { status: 'cancelled' });
        return Response.json({ success: true, record: updated });
      }
      if (!inTenant && ownVendor) {
        const allowed = {};
        if (changes.status !== undefined) allowed.status = changes.status;
        if (changes.estimated_cost !== undefined) allowed.estimated_cost = Number(changes.estimated_cost) || null;
        if (changes.final_cost !== undefined) allowed.final_cost = Number(changes.final_cost) || null;
        if (!Object.keys(allowed).length) return err('Vendors can only update status and cost fields.', 403);
        const updated = await svc.entities.LaundryRequest.update(rec.id, allowed);
        return Response.json({ success: true, record: updated });
      }
      if (!isAdmin) return err('Forbidden', 403);
      delete changes.customer_id; delete changes.reseller_id; delete changes.resident_id;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.LaundryRequest.update(rec.id, changes);
      await audit('estate.laundry.updated', 'LaundryRequest', rec.id, 'updated laundry request', updated);
      return Response.json({ success: true, record: updated });
    }
    if (action === 'delete_laundry') {
      if (!authorized || !isAdmin) return err('Forbidden', 403);
      const rec = await find('LaundryRequest', p.id);
      if (!rec || !inManageScope(rec)) return err('Laundry request not found in your scope.', 404);
      await svc.entities.LaundryRequest.delete(rec.id);
      return Response.json({ success: true });
    }

    /* ── Orders ─────────────────────────────────────────────────────────── */
    if (action === 'list_orders') {
      if (!authorized) return deny();
      if (isResident) {
        await loadSelf();
        const ids = selfResidentIds();
        const rows = await svc.entities.Order.filter({ customer_id: scope.customer_id }, '-created_date', 500).catch(() => []);
        return Response.json({ orders: (rows || []).filter((o) => ids.includes(o.resident_id)) });
      }
      if (isVendor) {
        await loadSelf();
        const rows = await svc.entities.Order.filter({ customer_id: scope.customer_id }, '-created_date', 500).catch(() => []);
        const vid = myVendor ? myVendor.id : '__none__';
        return Response.json({ orders: (rows || []).filter((o) => o.vendor_id === vid) });
      }
      const rows = await svc.entities.Order.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ orders: rows || [] });
    }
    if (action === 'create_order') {
      if (!authorized || !(isResident || isManager)) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A customer scope is required.', 400);
      await loadSelf();
      const d = p.data || {};
      if (!d.vendor_id || !Array.isArray(d.items) || !d.items.length) return err('Vendor and at least one item are required.');
      const vendor = await find('Vendor', d.vendor_id);
      if (!vendor || !inManageScope(vendor) || vendor.status !== 'active') return err('Vendor not available.', 404);
      const items = d.items.map((it) => ({
        item_id: it.item_id || null, item_name: String(it.item_name || ''),
        quantity: Number(it.quantity) || 1, unit_price: Number(it.unit_price) || 0, notes: it.notes || null,
      }));
      // Totals are ALWAYS computed server-side from submitted items.
      const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
      const delivery_fee = d.delivery_address ? (vendor.delivery_fee || 0) : 0;
      const reseller_id = await resolveResellerId();
      const created = await svc.entities.Order.create({
        customer_id: scope.customer_id, reseller_id,
        resident_id: isResident ? caller.id : (d.resident_id || caller.id),
        resident_name: selfName(), unit_number: selfUnit(),
        vendor_id: vendor.id, vendor_name: vendor.business_name,
        order_type: d.order_type || vendor.category, items,
        subtotal, delivery_fee, total: subtotal + delivery_fee,
        status: 'pending', delivery_address: d.delivery_address || null,
        delivery_notes: d.delivery_notes || null,
        estimated_delivery: d.estimated_delivery || null, placed_at: new Date().toISOString(),
      });
      await audit('estate.order.created', 'Order', created.id, 'order placed with ' + vendor.business_name, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_order') {
      if (!authorized) return deny();
      const rec = await find('Order', p.id);
      if (!rec) return err('Order not found.', 404);
      const inTenant = inManageScope(rec);
      await loadSelf();
      const ownResident = isResident && selfResidentIds().includes(rec.resident_id);
      const ownVendor = isVendor && myVendor && rec.vendor_id === myVendor.id;
      if (!inTenant && !ownResident && !ownVendor) return err('Order not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      if (!inTenant && ownResident) {
        if (Object.keys(changes).length !== 1 || changes.status !== 'cancelled') {
          return err('You can only cancel your own pending order.', 403);
        }
        if (!['pending', 'confirmed'].includes(rec.status)) return err('This order can no longer be cancelled.', 409);
        const updated = await svc.entities.Order.update(rec.id, { status: 'cancelled' });
        return Response.json({ success: true, record: updated });
      }
      if (!inTenant && ownVendor) {
        const allowed = {};
        if (changes.status !== undefined) allowed.status = changes.status;
        if (changes.estimated_delivery !== undefined) allowed.estimated_delivery = changes.estimated_delivery;
        if (changes.completed_at !== undefined) allowed.completed_at = changes.completed_at;
        if (!Object.keys(allowed).length) return err('Vendors can only update order status and delivery times.', 403);
        const updated = await svc.entities.Order.update(rec.id, allowed);
        return Response.json({ success: true, record: updated });
      }
      if (!isAdmin) return err('Forbidden', 403);
      delete changes.customer_id; delete changes.reseller_id; delete changes.resident_id;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.Order.update(rec.id, changes);
      await audit('estate.order.updated', 'Order', rec.id, 'updated order', updated);
      return Response.json({ success: true, record: updated });
    }
    if (action === 'delete_order') {
      if (!authorized || !isAdmin) return err('Forbidden', 403);
      const rec = await find('Order', p.id);
      if (!rec || !inManageScope(rec)) return err('Order not found in your scope.', 404);
      await svc.entities.Order.delete(rec.id);
      return Response.json({ success: true });
    }

    return err('Unknown action.');
  } catch (e) {
    return Response.json({ error: (e && e.message) || 'Estate gateway error.' }, { status: 500 });
  }
}