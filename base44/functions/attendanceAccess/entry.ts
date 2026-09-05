import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * attendanceAccess — the SOLE authorized data gateway for the Attendance
 * Register module.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Attendance entities deliberately carry NO {{user.data.*}} RLS rules:
 * session tokens do not reliably expose custom User fields (customer_id /
 * reseller_id), so template-based tenant scoping is unproven on this platform.
 * Instead, this function resolves the caller's tenant SERVER-SIDE from their
 * User record (the exact proven pattern used by getTenantUsers for the
 * reseller/customer consoles) and performs every read/write on the caller's
 * behalf with full authorization:
 *
 *   Platform Admin  → oversight of all data (may narrow with customer_id)
 *   Reseller Admin  → their reseller's data (requires the reseller's
 *                     ATTENDANCE_REGISTER master licence)
 *   Customer Admin  → their own customer's data (practice_admin, estate
 *                     manager, admin_level 'customer', customer_admin)
 *   Attendance Staff→ their own customer's data (register + read)
 *   Everyone else   → 403 (fail closed)
 *
 * Direct client access to the Attendance entities is restricted by RLS to
 * platform admins only — tenant users MUST go through this gateway, which
 * enforces the ATTENDANCE_REGISTER module licence at API level.
 *
 * Module design constraints honoured here: no notifications, no automations,
 * no background processes. This function runs only when an authorized user
 * is actively using the module (zero idle integration-credit cost).
 */

const MODULE_KEY = 'ATTENDANCE_REGISTER';

// Fixed official dropdown options — DO NOT modify these values (they mirror
// the supplied official Attendance Register form). Seeding is idempotent.
const DEFAULT_MEDICAL_CENTRES = [
  'Alec', 'First Choice', 'Pro-Health', 'Exxaro', 'Enaex',
  'Sasolburg', 'Wohsa', 'Seriti New Denmark', 'Seriti Kriel',
];
const DEFAULT_ASSESSMENT_TYPES = [
  'Test', 'Retest (3d)', 'Retest (2w)', 'Retest (4w)',
  'Retest (6w)', 'FCE', 'Interview (Roaming)', 'Interview (Not Roaming)',
];

const CUSTOMER_ADMIN_ROLES = ['admin', 'practice_admin', 'estate_manager', 'customer_admin'];
const ID_TYPES = ['sa_id', 'drivers_licence', 'passport', 'other'];
const OPTION_TYPES = ['medical_centre', 'assessment_type'];

function err(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export default async function main(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const caller = await base44.auth.me().catch(() => null);
  if (!caller) return err('Unauthorized', 401);

  const body = await req.json().catch(() => ({}));
  const { action, ...params } = body || {};

  const callerName = caller.full_name || caller.display_name || caller.email || 'Unknown';

  // ── Role resolution (server-side, from the User record — not JWT claims) ──
  const isPlatformAdmin =
    caller.role === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
  const isResellerAdmin =
    !isPlatformAdmin && (caller.role_type === 'reseller_admin' || caller.admin_level === 'reseller');
  const isCustomerAdmin =
    !isPlatformAdmin && !isResellerAdmin &&
    (caller.admin_level === 'customer' || CUSTOMER_ADMIN_ROLES.includes(caller.role_type));
  const isAttendanceStaff = caller.role_type === 'attendance_staff';

  // Only these roles may use the Attendance module at all. Everyone else
  // (guards, therapists, reception, residents…) is denied — fail closed.
  const canWrite = isPlatformAdmin || isResellerAdmin || isCustomerAdmin || isAttendanceStaff;
  // Attendance staff may register attendance but NEVER manage dropdown options.
  const canManageOptions = canWrite && !isAttendanceStaff;
  // Worker/Patient profile MANAGEMENT (archive / restore / permanent delete)
  // — admins and above only, NEVER attendance staff.
  const canManageWorkers = canWrite && !isAttendanceStaff;

  // ── Tenant scope resolution ────────────────────────────────────────────────
  let scope;
  if (isPlatformAdmin) {
    scope = {
      mode: 'platform',
      customer_id: params.customer_id || null,
      reseller_id: params.reseller_id || caller.reseller_id || null,
    };
  } else if (isResellerAdmin) {
    scope = { mode: 'reseller', customer_id: caller.customer_id || null, reseller_id: caller.reseller_id };
    if (params.customer_id && params.customer_id !== scope.customer_id) {
      const cust = await base44.asServiceRole.entities.Customer.get(params.customer_id).catch(() => null);
      if (!cust || cust.reseller_id !== scope.reseller_id) return err('Forbidden', 403);
      scope.customer_id = params.customer_id;
    }
  } else if (caller.customer_id) {
    if (params.customer_id && params.customer_id !== caller.customer_id) return err('Forbidden', 403);
    scope = { mode: 'customer', customer_id: caller.customer_id, reseller_id: caller.reseller_id || null };
  } else {
    scope = { mode: 'none', customer_id: null, reseller_id: null };
  }

  // ── Module licence check (API-level, not just UI) ───────────────────────────
  let moduleLicensed = true;
  let moduleReason: string | null = null;
  if (!isPlatformAdmin) {
    if (scope.mode === 'reseller' && !scope.customer_id) {
      const lic = await base44.asServiceRole.entities.ResellerEntitlement
        .filter({ reseller_id: scope.reseller_id, module_key: MODULE_KEY });
      if (!lic.some((l) => l.enabled && (!l.status || l.status === 'active'))) {
        moduleLicensed = false;
        moduleReason = 'Attendance Register is not licensed for this reseller.';
      }
    } else if (scope.customer_id) {
      const ents = await base44.asServiceRole.entities.ModuleEntitlement
        .filter({ customer_id: scope.customer_id, module_key: MODULE_KEY });
      if (!ents.some((e) => e.enabled && (!e.status || e.status === 'active'))) {
        moduleLicensed = false;
        moduleReason = 'Attendance Register is not enabled for this customer.';
      }
    } else {
      moduleLicensed = false;
      moduleReason = 'This account has no tenant scope for the Attendance Register.';
    }
  }
  const authorized = canWrite && moduleLicensed;

  const requireAuthorized = (): Response | null => (authorized ? null : err(moduleReason || 'Not authorized', 403));

  // Records query for the resolved scope.
  const scopeQuery = () => {
    const q: Record<string, any> = {};
    if (scope.customer_id) q.customer_id = scope.customer_id;
    else if (scope.reseller_id) q.reseller_id = scope.reseller_id;
    return q; // platform admin with no scope → oversight of all
  };

  // Reseller id to stamp on records (derived from the Customer record when
  // the caller's own record does not carry it).
  const resolveResellerId = async (): Promise<string | null> => {
    if (scope.reseller_id) return scope.reseller_id;
    if (scope.customer_id) {
      const cust = await base44.asServiceRole.entities.Customer.get(scope.customer_id).catch(() => null);
      return cust?.reseller_id || null;
    }
    return null;
  };

  // Security-sensitive management actions are recorded in PlatformAuditLog.
  const writeAudit = (event_type: string, entity_id: string, action: string, notes: string, worker: any = null) =>
    base44.asServiceRole.entities.PlatformAuditLog.create({
      event_type,
      user_id: caller.id,
      user_name: callerName,
      customer_id: worker?.customer_id || scope.customer_id || null,
      reseller_id: worker?.reseller_id || scope.reseller_id || null,
      entity_name: 'AttendanceWorker',
      entity_id,
      action,
      notes,
    }).catch(() => null);

  // ── Idempotent seeding of the fixed official options (per customer) ───────
  const seedDefaults = async (): Promise<void> => {
    if (!scope.customer_id) return;
    const existing = await base44.asServiceRole.entities.AttendanceDropdownOption
      .filter({ customer_id: scope.customer_id });
    const toCreate: any[] = [];
    if (!existing.some((o) => o.option_type === 'medical_centre')) {
      DEFAULT_MEDICAL_CENTRES.forEach((label, i) =>
        toCreate.push({ customer_id: scope.customer_id, reseller_id: scope.reseller_id, option_type: 'medical_centre', label, sort_order: i, active: true, is_default: true }));
    }
    if (!existing.some((o) => o.option_type === 'assessment_type')) {
      DEFAULT_ASSESSMENT_TYPES.forEach((label, i) =>
        toCreate.push({ customer_id: scope.customer_id, reseller_id: scope.reseller_id, option_type: 'assessment_type', label, sort_order: i, active: true, is_default: true }));
    }
    if (toCreate.length > 0) await base44.asServiceRole.entities.AttendanceDropdownOption.bulkCreate(toCreate);
  };

  try {
    switch (action) {
      // ── Context for pages (never throws — pages render a friendly state) ──
      case 'get_context': {
        return Response.json({
          authorized,
          reason: authorized ? null : (moduleReason || 'Your role does not have access to the Attendance Register.'),
          mode: scope.mode,
          customer_id: scope.customer_id,
          reseller_id: scope.reseller_id,
          is_platform_admin: isPlatformAdmin,
          can_register: authorized,
          can_manage_options: authorized && canManageOptions,
          can_manage_workers: authorized && canManageWorkers,
        });
      }

      // ── Dropdown options ────────────────────────────────────────────────────
      case 'list_options': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!scope.customer_id) {
          // Platform/reseller-wide view without a customer selected: show the
          // fixed official defaults (read-only; no records exist to manage).
          return Response.json({ options: [], medicalCentres: DEFAULT_MEDICAL_CENTRES, assessmentTypes: DEFAULT_ASSESSMENT_TYPES });
        }
        await seedDefaults();
        const options = await base44.asServiceRole.entities.AttendanceDropdownOption
          .filter({ customer_id: scope.customer_id });
        const sortFn = (a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999);
        const mc = options.filter((o) => o.option_type === 'medical_centre' && o.active).sort(sortFn).map((o) => o.label);
        const at = options.filter((o) => o.option_type === 'assessment_type' && o.active).sort(sortFn).map((o) => o.label);
        return Response.json({
          options,
          medicalCentres: mc.length ? mc : DEFAULT_MEDICAL_CENTRES,
          assessmentTypes: at.length ? at : DEFAULT_ASSESSMENT_TYPES,
        });
      }

      case 'reset_defaults': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!canManageOptions) return err('Only authorized admins may manage Attendance options.', 403);
        if (!scope.customer_id) return err('A customer scope is required to reset options.', 400);
        await seedDefaults();
        return Response.json({ success: true });
      }

      case 'save_option': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!canManageOptions) return err('Only authorized admins may manage Attendance options.', 403);
        if (!scope.customer_id) return err('A customer scope is required to add options.', 400);
        const { option_type, label } = params;
        if (!OPTION_TYPES.includes(option_type)) return err('Invalid option type.');
        if (!label || !String(label).trim()) return err('A label is required.');
        const reseller_id = await resolveResellerId();
        const created = await base44.asServiceRole.entities.AttendanceDropdownOption.create({
          customer_id: scope.customer_id,
          reseller_id,
          option_type,
          label: String(label).trim(),
          active: true,
          sort_order: 999,
        });
        return Response.json({ success: true, option: created });
      }

      case 'update_option': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!canManageOptions) return err('Only authorized admins may manage Attendance options.', 403);
        if (!scope.customer_id) return err('A customer scope is required to manage options.', 400);
        const opt = await base44.asServiceRole.entities.AttendanceDropdownOption.get(params.id).catch(() => null);
        if (!opt || opt.customer_id !== scope.customer_id) return err('Option not found.', 404);
        const updates: Record<string, any> = {};
        if (params.label !== undefined) {
          if (!String(params.label).trim()) return err('A label is required.');
          updates.label = String(params.label).trim();
        }
        if (params.active !== undefined) updates.active = !!params.active;
        if (Object.keys(updates).length === 0) return err('Nothing to update.');
        await base44.asServiceRole.entities.AttendanceDropdownOption.update(opt.id, updates);
        return Response.json({ success: true });
      }

      // ── Workers ──────────────────────────────────────────────────────────────
      case 'list_workers': {
        const denied = requireAuthorized();
        if (denied) return denied;
        const q = scopeQuery();
        if (params.active_only) q.status = 'active';
        const workers = await base44.asServiceRole.entities.AttendanceWorker.filter(q, '-created_date', 1000);
        return Response.json({ workers: workers || [] });
      }

      case 'find_worker': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!params.id_number) return Response.json({ worker: null });
        const q = { ...scopeQuery(), id_number: String(params.id_number).trim() };
        // Archived profiles are excluded from new-attendance lookup unless
        // explicitly requested.
        if (!params.include_archived) q.status = 'active';
        const found = await base44.asServiceRole.entities.AttendanceWorker.filter(q, '-created_date', 5);
        return Response.json({ worker: found && found.length > 0 ? found[0] : null });
      }

      // ── Worker / Patient directory: create + update (profile flows) ─────────
      // Tenant ids are stamped SERVER-SIDE from the resolved scope — the
      // client never supplies customer/reseller ids for a new profile.
      case 'create_worker': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!scope.customer_id) {
          return err('A customer scope is required. Pass ?customer_id=… when acting as platform oversight.', 400);
        }
        const w = params.worker || {};
        const idNumber = String(w.id_number || '').trim();
        if (!w.surname || !idNumber || !w.company || !w.job_description || !w.cellphone) {
          return err('Surname, ID number, company, job description and cellphone are required.');
        }
        const idType = ID_TYPES.includes(w.id_type) ? w.id_type : 'sa_id';
        // SERVER-SIDE duplicate prevention: one profile per ID/document number
        // per customer. If the person already exists, return the existing
        // profile — the UI offers to open it. A duplicate is never created.
        const dupe = await base44.asServiceRole.entities.AttendanceWorker
          .filter({ customer_id: scope.customer_id, id_number: idNumber }, '-created_date', 5);
        if (dupe && dupe.length > 0) {
          return Response.json({ success: false, duplicate: true, worker: dupe[0] });
        }
        const reseller_id = await resolveResellerId();
        const ts = new Date().toISOString();
        const worker = await base44.asServiceRole.entities.AttendanceWorker.create({
          customer_id: scope.customer_id,
          reseller_id,
          surname: w.surname,
          initials: w.initials || '',
          first_names: w.first_names || '',
          id_number: idNumber,
          id_type: idType,
          company: w.company,
          job_description: w.job_description,
          cellphone: w.cellphone,
          id_front_url: w.id_front_url || null,
          id_back_url: w.id_back_url || null,
          id_captured_at: w.id_front_url ? ts : null,
          id_captured_by_id: w.id_front_url ? caller.id : null,
          id_captured_by_name: w.id_front_url ? callerName : null,
          created_by_name: callerName,
          status: 'active',
        });
        return Response.json({ success: true, worker_id: worker.id, worker });
      }

      case 'update_worker': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!params.worker_id) return err('A worker id is required.');
        const worker = await base44.asServiceRole.entities.AttendanceWorker.get(params.worker_id).catch(() => null);
        if (!worker) return err('Worker not found in your scope.', 404);
        const inScope = scope.customer_id
          ? worker.customer_id === scope.customer_id
          : scope.reseller_id ? worker.reseller_id === scope.reseller_id : true;
        if (!inScope) return err('Worker not found in your scope.', 404);

        const w = params.worker || {};
        const updates: Record<string, any> = {};

        if (w.id_number !== undefined) {
          const idNumber = String(w.id_number).trim();
          if (!idNumber) return err('The ID / document number cannot be empty.');
          if (idNumber !== worker.id_number) {
            // Dedup key change: refuse if the new ID number belongs to another
            // profile in the same tenant.
            const dupe = await base44.asServiceRole.entities.AttendanceWorker
              .filter({ customer_id: worker.customer_id, id_number: idNumber }, '-created_date', 5);
            if (dupe && dupe.some((d) => d.id !== worker.id)) {
              return err('Another profile with this ID number already exists for this customer.');
            }
          }
          updates.id_number = idNumber;
        }
        if (w.id_type !== undefined && ID_TYPES.includes(w.id_type)) updates.id_type = w.id_type;
        if (w.surname !== undefined) {
          if (!String(w.surname).trim()) return err('Surname is required.');
          updates.surname = w.surname;
        }
        if (w.initials !== undefined) updates.initials = w.initials || '';
        if (w.first_names !== undefined) updates.first_names = w.first_names || '';
        if (w.company !== undefined) {
          if (!String(w.company).trim()) return err('Company is required.');
          updates.company = w.company;
        }
        if (w.job_description !== undefined) {
          if (!String(w.job_description).trim()) return err('Job description is required.');
          updates.job_description = w.job_description;
        }
        if (w.cellphone !== undefined) {
          if (!String(w.cellphone).trim()) return err('Cellphone is required.');
          updates.cellphone = w.cellphone;
        }
        if (w.id_front_url && w.id_front_url !== worker.id_front_url) {
          const ts = new Date().toISOString();
          updates.id_front_url = w.id_front_url;
          updates.id_back_url = w.id_back_url || null;
          updates.id_captured_at = ts;
          updates.id_captured_by_id = caller.id;
          updates.id_captured_by_name = callerName;
          updates.id_updated_at = ts;
        }

        if (Object.keys(updates).length === 0) return err('Nothing to update.');
        updates.updated_by_name = callerName;
        await base44.asServiceRole.entities.AttendanceWorker.update(worker.id, updates);
        return Response.json({ success: true, worker: { ...worker, ...updates } });
      }

      // ── Worker / Patient lifecycle management (admins only, never staff) ──
      // Archive / Restore / Permanent Delete. Tenant scope is enforced from
      // the caller's resolved scope — a client-supplied id from another
      // tenant fails closed with 404.
      case 'archive_worker':
      case 'restore_worker':
      case 'delete_worker': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!canManageWorkers) return err('Only authorized admins may manage worker / patient profiles.', 403);
        if (!params.worker_id) return err('A worker id is required.');

        const worker = await base44.asServiceRole.entities.AttendanceWorker.get(params.worker_id).catch(() => null);
        if (!worker) return err('Worker not found in your scope.', 404);
        const inScope = scope.customer_id
          ? worker.customer_id === scope.customer_id
          : scope.reseller_id ? worker.reseller_id === scope.reseller_id : true;
        if (!inScope) return err('Worker not found in your scope.', 404);

        // Inspect ALL references before any destructive action. Attendance
        // records (each with its own per-visit signature) are the only
        // dependent records; ID-document images belong to the profile itself.
        const recs = await base44.asServiceRole.entities.AttendanceRecord
          .filter({ worker_id: worker.id }, '-attendance_date', 3000)
          .catch(() => []);

        if (action === 'archive_worker') {
          if (worker.status === 'inactive') return err('This profile is already archived.');
          await base44.asServiceRole.entities.AttendanceWorker.update(worker.id, {
            status: 'inactive', updated_by_name: callerName,
          });
          await writeAudit('worker.archived', worker.id, 'archive',
            `Archived worker/patient ${worker.id_number} — ${recs.length} attendance records remain intact.`, worker);
          return Response.json({ success: true });
        }

        if (action === 'restore_worker') {
          if (worker.status !== 'inactive') return err('This profile is not archived.');
          await base44.asServiceRole.entities.AttendanceWorker.update(worker.id, {
            status: 'active', updated_by_name: callerName,
          });
          await writeAudit('worker.restored', worker.id, 'restore',
            `Restored worker/patient ${worker.id_number} to active.`, worker);
          return Response.json({ success: true });
        }

        // Permanent delete — removes the profile record together with its
        // ID-document image references. Attendance records are SELF-CONTAINED
        // (each keeps its own surname/initials/ID/company/job/medical centre/
        // assessment/signature snapshots), so historical registers, PDF/Excel
        // exports and signatures are unaffected by the profile's removal.
        // Guard: a profile WITH history may only be permanently deleted from
        // the ARCHIVED management flow (archive first, then delete) — never
        // straight from the active list.
        if (recs.length > 0 && worker.status !== 'inactive') {
          return err('This profile has historical attendance records. Archive it first — the attendance history and reports will remain unchanged.', 409);
        }
        await base44.asServiceRole.entities.AttendanceWorker.delete(worker.id);
        await writeAudit('worker.deleted', worker.id, 'delete',
          `Permanently deleted worker/patient ${worker.id_number} — ${recs.length} historical attendance records remain intact.`, worker);
        return Response.json({ success: true, attendance_records_kept: recs.length });
      }

      // ── Register one attendance (worker upsert + record, one transaction) ────
      case 'register_attendance': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!scope.customer_id) {
          return err('A customer scope is required. Pass ?customer_id=… when acting as platform oversight.', 400);
        }

        const rec = params.record || {};
        const sig = params.signature_data_url;
        // One attendance = one fresh signature. Server-enforced.
        if (!sig || !String(sig).startsWith('data:image')) {
          return err('A fresh electronic signature is required for every attendance.');
        }
        if (!rec.attendance_date || !rec.attendance_time) return err('Attendance date and time are required.');
        if (!rec.medical_centre || !rec.assessment_type) return err('Medical Centre and Assessment Type are required.');

        const reseller_id = await resolveResellerId();
        let worker: any = null;

        if (params.existing_worker_id) {
          worker = await base44.asServiceRole.entities.AttendanceWorker.get(params.existing_worker_id).catch(() => null);
          if (!worker || worker.customer_id !== scope.customer_id) return err('Worker not found in your scope.', 404);
          const updates: Record<string, any> = {};
          if (worker.status === 'inactive') updates.status = 'active';
          const wu = params.worker_updates || {};
          if (wu.company !== undefined && wu.company !== worker.company) updates.company = wu.company;
          if (wu.job_description !== undefined && wu.job_description !== worker.job_description) updates.job_description = wu.job_description;
          if (wu.cellphone !== undefined && wu.cellphone !== worker.cellphone) updates.cellphone = wu.cellphone;
          if (wu.id_front_url && wu.id_front_url !== worker.id_front_url) {
            const ts = rec.attendance_timestamp || new Date().toISOString();
            updates.id_front_url = wu.id_front_url;
            updates.id_back_url = wu.id_back_url || null;
            updates.id_captured_at = ts;
            updates.id_captured_by_id = caller.id;
            updates.id_captured_by_name = callerName;
            updates.id_updated_at = ts;
          }
          if (Object.keys(updates).length > 0) {
            updates.updated_by_name = callerName;
            await base44.asServiceRole.entities.AttendanceWorker.update(worker.id, updates);
          }
        } else {
          const w = params.worker || {};
          const idNumber = String(w.id_number || '').trim();
          if (!w.surname || !idNumber || !w.company || !w.job_description || !w.cellphone) {
            return err('Surname, ID number, company, job description and cellphone are required.');
          }
          const idType = ID_TYPES.includes(w.id_type) ? w.id_type : 'sa_id';
          // Deduplication: an existing profile for this ID number is reused
          // (same tenant) so a duplicate worker can never be created.
          const dupe = await base44.asServiceRole.entities.AttendanceWorker
            .filter({ customer_id: scope.customer_id, id_number: idNumber }, '-created_date', 5);
          if (dupe && dupe.length > 0) {
            worker = dupe[0];
            // An archived profile attending again is restored to active —
            // archived profiles are excluded from lookup, so a reuse here
            // means the person is present in person again.
            if (worker.status === 'inactive') {
              await base44.asServiceRole.entities.AttendanceWorker.update(worker.id, {
                status: 'active', updated_by_name: callerName,
              });
            }
          } else {
            const ts = rec.attendance_timestamp || new Date().toISOString();
            worker = await base44.asServiceRole.entities.AttendanceWorker.create({
              customer_id: scope.customer_id,
              reseller_id,
              surname: w.surname,
              initials: w.initials || '',
              first_names: w.first_names || '',
              id_number: idNumber,
              id_type: idType,
              company: w.company,
              job_description: w.job_description,
              cellphone: w.cellphone,
              id_front_url: w.id_front_url || null,
              id_back_url: w.id_back_url || null,
              id_captured_at: w.id_front_url ? ts : null,
              id_captured_by_id: w.id_front_url ? caller.id : null,
              id_captured_by_name: w.id_front_url ? callerName : null,
              created_by_name: callerName,
              status: 'active',
            });
          }
        }

        // Historical snapshot fields come from the validated input — profile
        // edits never rewrite past attendance records.
        const created = await base44.asServiceRole.entities.AttendanceRecord.create({
          customer_id: scope.customer_id,
          reseller_id,
          worker_id: worker.id,
          attendance_date: rec.attendance_date,
          attendance_time: rec.attendance_time,
          attendance_timestamp: rec.attendance_timestamp || new Date().toISOString(),
          surname_snapshot: params.worker?.surname ?? worker.surname,
          initials_snapshot: params.worker?.initials ?? worker.initials,
          id_number_snapshot: params.worker?.id_number ?? worker.id_number,
          id_type_snapshot: params.worker?.id_type ?? worker.id_type,
          company_snapshot: params.worker?.company ?? worker.company,
          job_description_snapshot: params.worker?.job_description ?? worker.job_description,
          cellphone_snapshot: params.worker?.cellphone ?? worker.cellphone,
          medical_centre: rec.medical_centre,
          additional_information: rec.additional_information || '',
          assessment_type: rec.assessment_type,
          signature_data_url: sig,
          captured_by_id: caller.id,
          captured_by_name: callerName,
        });

        return Response.json({ success: true, worker_id: worker.id, record_id: created.id });
      }

      // ── Records ─────────────────────────────────────────────────────────────
      case 'list_records': {
        const denied = requireAuthorized();
        if (denied) return denied;
        const records = await base44.asServiceRole.entities.AttendanceRecord
          .filter(scopeQuery(), '-attendance_date', 3000);
        let out = records || [];
        if (params.from) out = out.filter((r) => (r.attendance_date || '') >= params.from);
        if (params.to) out = out.filter((r) => (r.attendance_date || '') <= params.to);
        out.sort((a, b) => {
          const d = (a.attendance_date || '').localeCompare(b.attendance_date || '');
          return d !== 0 ? d : (a.attendance_time || '').localeCompare(b.attendance_time || '');
        });
        // Signatures are large (base64 PNGs) — strip them from list responses.
        // PDF generation fetches them explicitly via get_signatures.
        out = out.map((r) => {
          const { signature_data_url, ...rest } = r;
          return rest;
        });
        return Response.json({ records: out });
      }

      // ── Controlled attendance-record deletion (admins only, never staff) ──
      // For legitimate cleanup (e.g. setup/test records before handover).
      // Deletes ONLY the single selected AttendanceRecord — its inline
      // signature (signature_data_url) is removed together with the record.
      // Worker/patient profiles, users and all other records are untouched.
      // One record per call; no bulk delete. Cross-tenant ids fail closed.
      case 'delete_attendance_record': {
        const denied = requireAuthorized();
        if (denied) return denied;
        if (!canManageWorkers) return err('Only authorized administrators may delete attendance records.', 403);
        if (!params.record_id) return err('An attendance record id is required.');

        const rec = await base44.asServiceRole.entities.AttendanceRecord.get(params.record_id).catch(() => null);
        if (!rec) return err('Attendance record not found in your scope.', 404);
        const inScope = scope.customer_id
          ? rec.customer_id === scope.customer_id
          : scope.reseller_id ? rec.reseller_id === scope.reseller_id : true;
        if (!inScope) return err('Attendance record not found in your scope.', 404);

        await base44.asServiceRole.entities.AttendanceRecord.delete(rec.id);
        await base44.asServiceRole.entities.PlatformAuditLog.create({
          event_type: 'attendance.record_deleted',
          user_id: caller.id,
          user_name: callerName,
          customer_id: rec.customer_id || scope.customer_id || null,
          reseller_id: rec.reseller_id || scope.reseller_id || null,
          entity_name: 'AttendanceRecord',
          entity_id: rec.id,
          action: 'delete',
          notes: `Deleted attendance for ${rec.surname_snapshot || 'unknown'}${rec.initials_snapshot ? ', ' + rec.initials_snapshot : ''} (ID ${rec.id_number_snapshot || '—'}) on ${rec.attendance_date} ${rec.attendance_time} at ${rec.medical_centre || '—'} (${rec.assessment_type || '—'}). Signature removed with the record.`,
        }).catch(() => null);
        return Response.json({ success: true });
      }

      case 'get_signatures': {
        const denied = requireAuthorized();
        if (denied) return denied;
        const ids = Array.isArray(params.record_ids) ? params.record_ids : [];
        if (ids.length === 0) return Response.json({ signatures: {} });
        const q: Record<string, any> = { id: { $in: ids } };
        if (scope.customer_id) q.customer_id = scope.customer_id;
        else if (scope.reseller_id) q.reseller_id = scope.reseller_id;
        const recs = await base44.asServiceRole.entities.AttendanceRecord.filter(q, '-attendance_date', Math.min(ids.length, 1000));
        const signatures: Record<string, string> = {};
        (recs || []).forEach((r) => { if (r.signature_data_url) signatures[r.id] = r.signature_data_url; });
        return Response.json({ signatures });
      }

      default:
        return err('Unknown action.');
    }
  } catch (e) {
    return Response.json({ error: e?.message || 'Attendance gateway error.' }, { status: 500 });
  }
}