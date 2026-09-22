import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';
import { gwErr as err, resolveAdminRoles, resolveCustomerScope, checkModuleLicense, tenantQueryOf, inScopeOf, findRecord, auditLog } from '../../shared/tenantGateway.ts';

/**
 * medicalAccess — the SOLE authorized data gateway for the MEDICAL module
 * (OCCUPATIONAL_THERAPY), following the proven estateAccess pattern.
 *
 * WHY THIS EXISTS
 * ---------------
 * RLS tenant branches (customer_id match) only enforce TENANT isolation.
 * They do NOT enforce ROLE authorization (which medical role may act) or
 * RECORD OWNERSHIP (which patient/session an actor may touch). Clinical and
 * patient data must never be accessible merely because the caller shares the
 * customer_id. This gateway resolves role + tenant + ownership SERVER-SIDE:
 *
 *   Platform admin   → explicit oversight, every action audited
 *   Reseller admin   → their reseller's practices (validated customer scope)
 *   Practice admin   → their practice: full clinical + admin management
 *   Therapist        → clinical: patients/services/templates practice-wide,
 *                      sessions/notes/assessments/reports OWN records only
 *   Reception        → demographics + appointments + check-in + consents.
 *                      ZERO clinical access (no sessions, notes, assessments,
 *                      raw reports, verifications beyond check-in capture)
 *   Employer user    → own employees' demographics, their appointments and
 *                      RELEASED employer-facing reports only. Never clinical
 *                      notes, private assessments, unrelated patients.
 *   Everyone else    → 403, fail closed — guards, residents, vendors,
 *                      estate managers, dispatchers, attendance staff, and
 *                      generic operational roles have ZERO clinical access.
 *
 * All tenant ids and record ownership are stamped server-side from
 * authoritative records — client-supplied ids are never trusted as scope.
 * Deletion of clinical records (patients, sessions, notes, assessments,
 * reports, consents, verifications) is NOT offered through this gateway —
 * clinical preservation; deactivation happens via status fields.
 */
const MODULE_KEY = 'OCCUPATIONAL_THERAPY';

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
  const isPracticeAdmin = !isPlatform && !isReseller && (caller.role_type === 'practice_admin' || caller.admin_level === 'customer');
  const isTherapist = !isPlatform && !isReseller && caller.role_type === 'therapist';
  const isReception = !isPlatform && !isReseller && caller.role_type === 'reception';
  const myEmployerId = caller.employer_id || (caller.data && caller.data.employer_id) || null;
  const isEmployer = !isPlatform && !isReseller && !isPracticeAdmin && !isTherapist && !isReception
    && caller.role_type === 'employer_user' && !!myEmployerId;

  /* Practice staff = practice admin, therapist, reception (module licensed). */
  const isStaff = isPracticeAdmin || isTherapist || isReception;
  const isClinical = isPracticeAdmin || isTherapist;
  const isAdmin = isPlatform || isReseller || isPracticeAdmin;
  if (!isPlatform && !isReseller && !isStaff && !isEmployer) {
    return err('Not authorized for the medical module.', 403);
  }

  /* ── Tenant scope resolution (never trusts client tenant ids) ─────────── */
  const scopeRes = await resolveCustomerScope(svc, caller, p, isPlatform, isReseller);
  if (scopeRes.error) return scopeRes.error;
  let scope = scopeRes.scope;
  if (!scope && isEmployer) {
    // Employer users act through their employer record's practice tenant.
    const emp = await findRecord(svc, 'Employer', myEmployerId);
    if (!emp || !emp.customer_id) return err('Not authorized for the medical module.', 403);
    scope = { mode: 'employer', customer_id: emp.customer_id, reseller_id: emp.reseller_id || null, employer_id: emp.id };
  }
  if (!scope) return err('This account has no tenant scope for the medical module.', 403);

  /* ── Module licence (API level, fail closed) ────────────────────────────── */
  const { licensed, reason } = await checkModuleLicense(svc, isPlatform, scope, MODULE_KEY);
  if (!licensed) return err(reason || 'Not authorized for the medical module.', 403);

  const resellerIdOf = async () => {
    if (scope.reseller_id) return scope.reseller_id;
    if (scope.customer_id) {
      const cust = await svc.entities.Customer.get(scope.customer_id).catch(() => null);
      return (cust && cust.reseller_id) || null;
    }
    return null;
  };
  const tenantQuery = (extra) => tenantQueryOf(scope, extra);
  /* In-scope: same practice tenant (platform/reseller/manage scope). */
  const inScope = (r) => inScopeOf(scope, r, isPlatform, isReseller);
  const find = (entityName, id) => findRecord(svc, entityName, id);
  const audit = (event_type, entity_name, entity_id, notes, rec) =>
    auditLog(svc, { callerId: caller.id, callerName, scope }, event_type, entity_name, entity_id, notes, rec);

  /* ── Field-level privacy: employer users see a sanitized projection ───── */
  const sanitizePatientForEmployer = (pt) => ({
    id: pt.id, first_names: pt.first_names, surname: pt.surname, preferred_name: pt.preferred_name || null,
    employee_number: pt.employee_number || null, department: pt.department || null,
    job_title: pt.job_title || null, occupation: pt.occupation || null,
    employer_id: pt.employer_id || null, employer_name: pt.employer_name || null,
    status: pt.status || 'active',
    identity_verified: pt.identity_verified === true,
  });
  const sanitizeAppointmentForEmployer = (a) => {
    const out = { ...a };
    delete out.notes; delete out.referral_notes; delete out.referral_document_url;
    return out;
  };

  /* Ownership filters by role. */
  const patientVisible = (pt) => {
    if (isEmployer) return pt.employer_id === scope.employer_id;
    return true; // staff/tenant/oversight — practice scope (see list query)
  };
  const therapistOwns = (rec) => isPracticeAdmin || isAdmin || (isTherapist && rec && rec.therapist_id === caller.id);

  /* Employer users may only act on records belonging to their own employer. */
  const employerGuard = (rec, field = 'employer_id') => {
    if (!isEmployer) return true;
    return rec && rec[field] === scope.employer_id;
  };

  try {
    /* ── Context ─────────────────────────────────────────────────────────── */
    if (action === 'get_context') {
      return Response.json({
        authorized: true, mode: scope.mode,
        customer_id: scope.customer_id, reseller_id: scope.reseller_id,
        employer_id: scope.employer_id || null,
        is_platform_admin: isPlatform, is_reseller_admin: isReseller,
        is_practice_admin: isPracticeAdmin, is_therapist: isTherapist,
        is_reception: isReception, is_employer: isEmployer,
        my_name: callerName,
      });
    }

    /* ── Patients ────────────────────────────────────────────────────────── */
    if (action === 'list_patients') {
      let rows;
      if (isEmployer) {
        rows = await svc.entities.Patient.filter({ customer_id: scope.customer_id, employer_id: scope.employer_id, ...(p.filter || {}) }, '-created_date', 500).catch(() => []);
        return Response.json({ patients: (rows || []).map(sanitizePatientForEmployer) });
      }
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      rows = await svc.entities.Patient.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ patients: rows || [] });
    }
    if (action === 'get_patient') {
      const rec = await find('Patient', p.id);
      if (!rec || !inScope(rec) || !patientVisible(rec)) return err('Patient not found in your scope.', 404);
      return Response.json({ patient: isEmployer ? sanitizePatientForEmployer(rec) : rec });
    }
    if (action === 'create_patient') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      if (!scope.customer_id) return err('A practice tenant is required.', 400);
      const d = p.data || {};
      if (!d.first_names || !d.surname) return err('First names and surname are required.');
      // Employer must belong to the same practice.
      if (d.employer_id) {
        const emp = await find('Employer', d.employer_id);
        if (!emp || !inScope(emp)) return err('Employer not found in your practice.', 404);
        d.employer_name = emp.company_name;
      }
      const created = await svc.entities.Patient.create({
        customer_id: scope.customer_id, reseller_id: await resellerIdOf(),
        first_names: String(d.first_names).trim(), surname: String(d.surname).trim(),
        preferred_name: d.preferred_name || null, sa_id_number: d.sa_id_number || null,
        date_of_birth: d.date_of_birth || null, gender: d.gender || 'unspecified',
        mobile: d.mobile || null, email: d.email || null, address: d.address || null,
        employer_id: d.employer_id || null, employer_name: d.employer_name || null,
        employee_number: d.employee_number || null, department: d.department || null,
        job_title: d.job_title || null, occupation: d.occupation || null,
        supervisor_name: d.supervisor_name || null, supervisor_contact: d.supervisor_contact || null,
        medical_aid_name: d.medical_aid_name || null, medical_aid_number: d.medical_aid_number || null,
        referral_source: d.referral_source || 'self', referral_notes: d.referral_notes || null,
        referral_document_url: d.referral_document_url || null,
        emergency_contact_name: d.emergency_contact_name || null,
        emergency_contact_phone: d.emergency_contact_phone || null,
        id_scan_url: d.id_scan_url || null, photo_url: d.photo_url || null,
        identity_verified: false, identity_verification_status: 'pending',
        status: d.status || 'active', notes: d.notes || null,
      });
      await audit('medical.patient.created', 'Patient', created.id, 'registered patient ' + created.first_names + ' ' + created.surname, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_patient') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const rec = await find('Patient', p.id);
      if (!rec || !inScope(rec)) return err('Patient not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id; delete changes.identity_verified;
      if (changes.employer_id !== undefined) {
        if (changes.employer_id) {
          const emp = await find('Employer', changes.employer_id);
          if (!emp || !inScope(emp)) return err('Employer not found in your practice.', 404);
          changes.employer_name = emp.company_name;
        } else { changes.employer_name = null; }
      }
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.Patient.update(rec.id, changes);
      await audit('medical.patient.updated', 'Patient', rec.id, 'updated patient demographics', updated);
      return Response.json({ success: true, record: updated });
    }

    /* ── Identity verification (check-in capture; clinical reads) ───────── */
    if (action === 'create_verification') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      const patient = await find('Patient', d.patient_id);
      if (!patient || !inScope(patient)) return err('Patient not found in your scope.', 404);
      if (!d.result || !['verified', 'failed', 'manual_review'].includes(d.result)) return err('A verification result is required.');
      const created = await svc.entities.PatientIdentityVerification.create({
        customer_id: scope.customer_id, reseller_id: patient.reseller_id || await resellerIdOf(),
        patient_id: patient.id, patient_name: (patient.first_names || '') + ' ' + (patient.surname || ''),
        document_type: d.document_type || null, document_scan_url: d.document_scan_url || null,
        document_photo_url: d.document_photo_url || null, realtime_photo_url: d.realtime_photo_url || null,
        result: d.result, failure_reason: d.failure_reason || null,
        verifier_id: caller.id, verifier_name: callerName,
        verified_at: d.result === 'verified' ? new Date().toISOString() : null,
        location_name: d.location_name || null, notes: d.notes || null, scan_data: d.scan_data || null,
      });
      if (d.result === 'verified') {
        await svc.entities.Patient.update(patient.id, { identity_verified: true, identity_verification_status: 'verified' });
      } else if (d.result === 'failed') {
        await svc.entities.Patient.update(patient.id, { identity_verified: false, identity_verification_status: 'failed' });
      }
      await audit('medical.verification.created', 'PatientIdentityVerification', created.id, 'identity verification (' + d.result + ')', created);
      return Response.json({ success: true, record: created });
    }

    /* ── Private medical attachments ──────────────────────────────────────────
     * Medical media is NEVER stored as a permanent public URL. Uploads go to
     * PRIVATE storage through this gateway after content validation
     * (magic bytes + declared MIME + extension + size; active content such
     * as HTML/SVG/executables is rejected outright). Every view/download
     * requires an authorized get_medical_file call that revalidates role,
     * tenant, patient relationship and (for employer users) the LIVE report
     * release state at access time, then mints a SHORT-LIVED signed URL.
     * Storage ids and signed URLs are never written to notifications or
     * audit notes. Access is invalidated via the registry (status
     * 'revoked') or automatically by report state changes, checked live on
     * every access. RETENTION: clinical preservation — no deletion through
     * this gateway; revoked files become inaccessible but are retained. */
    if (action === 'upload_medical_file') {
      if (isEmployer) return err('Forbidden', 403);
      const d = p.data || {};
      const CATEGORY_ACCESS: Record<string, string> = {
        identity_verification: 'staff',   // reception, therapist, practice admin
        patient_document: 'staff',        // referral documents, ID scans
        clinical_attachment: 'clinical', // session/assessment/note media
        report_file: 'clinical',          // generated report PDFs
      };
      const cat = CATEGORY_ACCESS[d.category] ? d.category : null;
      if (!cat) return err('Unknown medical file category.', 400);
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      if (CATEGORY_ACCESS[cat] === 'clinical' && !isClinical && !isAdmin) return err('Forbidden', 403);
      const patient = d.patient_id ? await find('Patient', d.patient_id) : null;
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      // Ownership: clinical attachments and report files must reference the
      // caller's own clinical record.
      if (cat === 'clinical_attachment' && d.entity_type === 'Session' && d.entity_id) {
        const s = await find('Session', d.entity_id);
        if (!s || !inScope(s) || !therapistOwns(s)) return err('Session not found in your scope.', 404);
      }
      if (cat === 'report_file' && d.entity_id) {
        const r = await find('MedicalReport', d.entity_id);
        if (!r || !inScope(r) || !therapistOwns(r)) return err('Report not found in your scope.', 404);
      }
      // ── Content acquisition: base64 in-payload, or a restricted source URL
      // (the shared DocumentScanner's temporary capture) fetched SERVER-side.
      // Only this platform's own upload storage may serve as a source.
      let bytes: Uint8Array | null = null;
      let declaredType = String(d.content_type || '').toLowerCase();
      let filename = String(d.filename || '').toLowerCase().replace(/[^a-z0-9._-]/g, '_');
      const MAX_BYTES = 5 * 1024 * 1024;
      if (d.content_base64) {
        try {
          const b64 = String(d.content_base64).split(',').pop() || '';
          const bin = atob(b64);
          bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } catch (_) { return err('Invalid file content.', 400); }
      } else if (d.source_url) {
        let host = '';
        try { host = new URL(String(d.source_url)).host; } catch (_) { return err('Unsupported file source.', 400); }
        if (!/(\.|^)(([a-z0-9-]+\.)?base44\.app)$/i.test(host) && !/\.base44\.app$/i.test(host)) {
          return err('Unsupported file source.', 400);
        }
        const res = await fetch(String(d.source_url)).catch(() => null);
        if (!res || !res.ok) return err('The file source could not be read.', 400);
        bytes = new Uint8Array(await res.arrayBuffer());
        declaredType = (res.headers.get('content-type') || '').split(';')[0].toLowerCase().trim();
      }
      if (!bytes || !bytes.length) return err('No file content was provided.', 400);
      if (bytes.length > MAX_BYTES) return err('The file is too large (limit 5 MB).', 413);
      // ── Validation: MAGIC BYTES first, then declared MIME, then extension.
      // Only passive media is accepted — executables, HTML, SVG and other
      // active content can never match a signature below.
      const MAGIC: Array<{ type: string; ext: string; sig: number[]; riff?: string }> = [
        { type: 'image/jpeg', ext: '.jpg', sig: [0xFF, 0xD8, 0xFF] },
        { type: 'image/png', ext: '.png', sig: [0x89, 0x50, 0x4E, 0x47] },
        { type: 'image/webp', ext: '.webp', sig: [0x52, 0x49, 0x46, 0x46], riff: 'WEBP' },
        { type: 'application/pdf', ext: '.pdf', sig: [0x25, 0x50, 0x44, 0x46] },
      ];
      let detected: { type: string; ext: string } | null = null;
      for (const m of MAGIC) {
        if (m.sig.every((b, i) => bytes![i] === b)) {
          if (m.riff) {
            const tag = String.fromCharCode(...Array.from(bytes!.slice(8, 12)));
            if (tag !== m.riff) continue;
          }
          detected = { type: m.type, ext: m.ext }; break;
        }
      }
      if (!detected) {
        return err('Unsupported or dangerous file type. Only JPEG, PNG, WebP images and PDF documents are accepted.', 415);
      }
      if (declaredType && declaredType !== detected.type) {
        return err('The file content does not match its declared type.', 415);
      }
      filename = (filename && filename.endsWith(detected.ext)) || (detected.type === 'image/jpeg' && filename.endsWith('.jpeg'))
        ? filename : 'medical_file' + detected.ext;
      // ── PRIVATE storage (never public).
      const Core = ((svc as any).integrations && (svc as any).integrations.Core)
        || ((base44 as any).integrations && (base44 as any).integrations.Core) || null;
      if (!Core) return err('Secure file storage is unavailable. Please try again.', 500);
      const fileObj = new File([bytes], filename, { type: detected.type });
      const up = await Core.UploadPrivateFile({ file: fileObj }).catch(() => null);
      if (!up || !up.file_uri) return err('The file could not be stored. Please try again.', 500);
      const registry = await svc.entities.MedicalFile.create({
        customer_id: scope.customer_id, reseller_id: patient.reseller_id || await resellerIdOf(),
        file_uri: up.file_uri, category: cat, content_type: detected.type,
        size_bytes: bytes.length, patient_id: patient.id,
        entity_type: d.entity_type || null, entity_id: d.entity_id || null,
        purpose: String(d.purpose || cat).slice(0, 120),
        uploaded_by_id: caller.id, uploaded_by_name: callerName,
        uploaded_at: new Date().toISOString(), status: 'active',
      }).catch(() => null);
      if (!registry) return err('The file registry entry could not be created.', 500);
      // Short-lived signed URL for immediate in-session display only.
      let signed_url: string | null = null;
      try {
        const s = await Core.CreateFileSignedUrl({ file_uri: up.file_uri, expires_in: 300 });
        signed_url = (s && s.signed_url) || null;
      } catch (_) { /* display link optional */ }
      await audit('medical.file.uploaded', 'MedicalFile', registry.id, 'uploaded medical file (' + cat + ')', null);
      return Response.json({ success: true, file_id: registry.id, file_uri: up.file_uri, signed_url, signed_expires_in: 300 });
    }
    if (action === 'get_medical_file') {
      const rec = p.file_id
        ? await find('MedicalFile', p.file_id)
        : (p.file_uri ? ((await svc.entities.MedicalFile.filter({ file_uri: String(p.file_uri) }).catch(() => [])) || [])[0] : null);
      if (!rec || !inScope(rec)) return err('File not found.', 404);
      if (rec.status !== 'active') return err('Access to this file has been revoked.', 403);
      // ── Category-based authorization, revalidated AT ACCESS TIME.
      if (isEmployer) {
        // Employer users: ONLY files of reports explicitly released to THEIR
        // employer — checked live, so a withdrawn report immediately loses
        // access without any migration.
        if (rec.category !== 'report_file' || !rec.entity_id) return err('Forbidden', 403);
        const rpt = await find('MedicalReport', rec.entity_id);
        if (!rpt || rpt.employer_id !== scope.employer_id || rpt.status !== 'released' || rpt.shared_with_employer !== true) {
          return err('This file has not been released to you.', 403);
        }
      } else if (rec.category === 'report_file') {
        const rpt = rec.entity_id ? await find('MedicalReport', rec.entity_id) : null;
        if (!rpt || !inScope(rpt) || !therapistOwns(rpt)) return err('File not found.', 404);
      } else if (rec.category === 'clinical_attachment') {
        if (!isClinical && !isAdmin) return err('Forbidden', 403);
        if (rec.entity_type === 'Session' && rec.entity_id) {
          const s = await find('Session', rec.entity_id);
          if (!s || !inScope(s) || !therapistOwns(s)) return err('File not found.', 404);
        }
      } else {
        // identity_verification / patient_document: practice staff only
        // (reception included for check-in duties); everyone else fail closed.
        if (!isStaff && !isAdmin) return err('Forbidden', 403);
      }
      const Core = ((svc as any).integrations && (svc as any).integrations.Core)
        || ((base44 as any).integrations && (base44 as any).integrations.Core) || null;
      if (!Core) return err('Secure file storage is unavailable. Please try again.', 500);
      const ttl = Number(p.expires_in) > 0 && Number(p.expires_in) <= 300 ? Math.floor(Number(p.expires_in)) : 300;
      const s = await Core.CreateFileSignedUrl({ file_uri: rec.file_uri, expires_in: ttl }).catch(() => null);
      if (!s || !s.signed_url) return err('The file could not be opened. Please try again.', 500);
      await audit('medical.file.accessed', 'MedicalFile', rec.id, 'accessed medical file (' + rec.category + ')', null);
      return Response.json({ success: true, signed_url: s.signed_url, expires_in: ttl });
    }
    if (action === 'list_medical_files') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const patient = p.patient_id ? await find('Patient', p.patient_id) : null;
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      const rows = (await svc.entities.MedicalFile.filter({ customer_id: scope.customer_id, patient_id: patient.id }, '-created_date', 200).catch(() => [])) || [];
      // Reception never sees clinical attachments or report files.
      const visible = isClinical || isAdmin
        ? rows
        : rows.filter((f: any) => f.category !== 'clinical_attachment' && f.category !== 'report_file');
      return Response.json({ files: visible });
    }
    if (action === 'revoke_medical_file') {
      if (!isPracticeAdmin && !isPlatform && !isReseller) return err('Forbidden', 403);
      const rec = await find('MedicalFile', p.id);
      if (!rec || !inScope(rec)) return err('File not found.', 404);
      const updated = await svc.entities.MedicalFile.update(rec.id, {
        status: 'revoked', revoked_by_id: caller.id, revoked_by_name: callerName,
        revoked_at: new Date().toISOString(),
      });
      await audit('medical.file.revoked', 'MedicalFile', rec.id, 'revoked medical file access', null);
      return Response.json({ success: true, record: updated });
    }
    if (action === 'list_verifications') {
      if (!isClinical && !isReception && !isAdmin) return err('Forbidden', 403);
      const patient = p.patient_id ? await find('Patient', p.patient_id) : null;
      if (p.patient_id && (!patient || !inScope(patient))) return err('Patient not found in your scope.', 404);
      const q = tenantQuery(p.patient_id ? { patient_id: String(p.patient_id) } : (p.filter || {}));
      const rows = await svc.entities.PatientIdentityVerification.filter(q, '-created_date', 200).catch(() => []);
      return Response.json({ verifications: rows || [] });
    }

    /* ── Employers ───────────────────────────────────────────────────────── */
    if (action === 'list_employers') {
      if (isEmployer) {
        const emp = await find('Employer', scope.employer_id);
        return Response.json({ employers: emp ? [emp] : [] });
      }
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const rows = await svc.entities.Employer.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ employers: rows || [] });
    }
    if (action === 'get_employer') {
      const rec = await find('Employer', p.id);
      if (!rec) return err('Employer not found.', 404);
      if (isEmployer && rec.id !== scope.employer_id) return err('Employer not found in your scope.', 404);
      if (!isEmployer && !inScope(rec)) return err('Employer not found in your scope.', 404);
      return Response.json({ employer: rec });
    }
    if (action === 'create_employer') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      if (!d.company_name) return err('Company name is required.');
      const created = await svc.entities.Employer.create({
        customer_id: scope.customer_id, reseller_id: await resellerIdOf(),
        company_name: String(d.company_name).trim(), registration_number: d.registration_number || null,
        vat_number: d.vat_number || null, physical_address: d.physical_address || null,
        postal_address: d.postal_address || null, industry: d.industry || null,
        primary_contact_name: d.primary_contact_name || null,
        primary_contact_email: d.primary_contact_email || null,
        primary_contact_phone: d.primary_contact_phone || null,
        primary_contact_mobile: d.primary_contact_mobile || null,
        hr_contact_name: d.hr_contact_name || null, hr_contact_phone: d.hr_contact_phone || null,
        hr_contact_email: d.hr_contact_email || null,
        claim_reference_number: d.claim_reference_number || null,
        departments: Array.isArray(d.departments) ? d.departments : [],
        documents: Array.isArray(d.documents) ? d.documents : [],
        notification_preferences: d.notification_preferences || {},
        communication_permissions: d.communication_permissions || {},
        reporting_permissions: d.reporting_permissions || {},
        status: d.status || 'active', notes: d.notes || null,
      });
      await audit('medical.employer.created', 'Employer', created.id, 'registered employer ' + created.company_name, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_employer') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const rec = await find('Employer', p.id);
      if (!rec || !inScope(rec)) return err('Employer not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.Employer.update(rec.id, changes);
      await audit('medical.employer.updated', 'Employer', rec.id, 'updated employer', updated);
      return Response.json({ success: true, record: updated });
    }

    /* ── Services ─────────────────────────────────────────────────────────── */
    if (action === 'list_services') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const rows = await svc.entities.MedicalService.filter(tenantQuery(p.filter || {}), 'sort_order', 200).catch(() => []);
      return Response.json({ services: rows || [] });
    }
    if (action === 'get_service') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const rec = await find('MedicalService', p.id);
      if (!rec || !inScope(rec)) return err('Service not found in your scope.', 404);
      return Response.json({ service: rec });
    }
    if (action === 'create_service') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      if (!d.name) return err('Service name is required.');
      const created = await svc.entities.MedicalService.create({
        customer_id: scope.customer_id, reseller_id: await resellerIdOf(),
        name: String(d.name).trim(), category: d.category || 'clinical',
        description: d.description || null,
        default_duration_minutes: d.default_duration_minutes ?? 60,
        price: d.price ?? null, required_documents: Array.isArray(d.required_documents) ? d.required_documents : [],
        assessment_template_id: d.assessment_template_id || null,
        employer_visible: d.employer_visible !== false,
        reminder_rules: d.reminder_rules || {}, notification_rules: d.notification_rules || {},
        available_days: Array.isArray(d.available_days) ? d.available_days : ['mon', 'tue', 'wed', 'thu', 'fri'],
        available_hours_start: d.available_hours_start || null,
        available_hours_end: d.available_hours_end || null,
        active: d.active !== false, sort_order: d.sort_order ?? 0,
      });
      await audit('medical.service.created', 'MedicalService', created.id, 'created service ' + created.name, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_service') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const rec = await find('MedicalService', p.id);
      if (!rec || !inScope(rec)) return err('Service not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.MedicalService.update(rec.id, changes);
      await audit('medical.service.updated', 'MedicalService', rec.id, 'updated service', updated);
      return Response.json({ success: true, record: updated });
    }

    /* ── Appointments (staff manage; employer sees own only) ─────────────── */
    if (action === 'list_appointments') {
      let rows;
      if (isEmployer) {
        rows = await svc.entities.Appointment.filter({ customer_id: scope.customer_id, employer_id: scope.employer_id, ...(p.filter || {}) }, '-created_date', 500).catch(() => []);
        return Response.json({ appointments: (rows || []).map(sanitizeAppointmentForEmployer) });
      }
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      rows = await svc.entities.Appointment.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ appointments: rows || [] });
    }
    if (action === 'create_appointment') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      const patient = await find('Patient', d.patient_id);
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      const service = await find('MedicalService', d.service_id);
      if (!service || !inScope(service)) return err('Service not found in your practice.', 404);
      let therapist = null;
      if (d.therapist_id) {
        const therapistRows = await svc.entities.User.filter({ id: String(d.therapist_id) }).catch(() => []);
        therapist = (therapistRows && therapistRows[0]) || null;
        if (!therapist) return err('Therapist not found.', 404);
        if (therapist.customer_id && scope.customer_id && therapist.customer_id !== scope.customer_id) {
          return err('Therapist does not belong to this practice.', 403);
        }
      }
      if (!d.start_time || !d.end_time) return err('Appointment start and end times are required.');
      const created = await svc.entities.Appointment.create({
        customer_id: scope.customer_id, reseller_id: patient.reseller_id || await resellerIdOf(),
        patient_id: patient.id, patient_name: (patient.first_names || '') + ' ' + (patient.surname || ''),
        employer_id: patient.employer_id || null, employer_name: patient.employer_name || null,
        service_id: service.id, service_name: service.name,
        therapist_id: therapist ? therapist.id : null,
        therapist_name: therapist ? (therapist.full_name || therapist.display_name || '') : null,
        start_time: d.start_time, end_time: d.end_time,
        duration_minutes: d.duration_minutes ?? service.default_duration_minutes ?? 60,
        booking_source: d.booking_source || 'reception', status: d.status || 'requested',
        notes: d.notes || null, referral_notes: d.referral_notes || null,
        referral_document_url: d.referral_document_url || null,
      });
      await audit('medical.appointment.created', 'Appointment', created.id, 'booked appointment for ' + created.patient_name, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_appointment') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const rec = await find('Appointment', p.id);
      if (!rec || !inScope(rec)) return err('Appointment not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id; delete changes.patient_id;
      delete changes.employer_id; delete changes.service_id; delete changes.calendar_event_id;
      // The session link is written ONLY by create_session's atomic claim —
      // a client can never point an appointment at an arbitrary session.
      delete changes.session_id;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.Appointment.update(rec.id, changes);
      await audit('medical.appointment.updated', 'Appointment', rec.id, 'updated appointment (status ' + (changes.status || rec.status) + ')', updated);
      return Response.json({ success: true, record: updated });
    }

    /* ── Sessions (clinical — reception and employers have ZERO access) ──── */
    if (action === 'list_sessions') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rows = await svc.entities.Session.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      const visible = (rows || []).filter((s) => therapistOwns(s));
      return Response.json({ sessions: visible });
    }
    if (action === 'get_session') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rec = await find('Session', p.id);
      if (!rec || !inScope(rec) || !therapistOwns(rec)) return err('Session not found in your scope.', 404);
      return Response.json({ session: rec });
    }
    if (action === 'create_session') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      const appointment = await find('Appointment', d.appointment_id);
      if (!appointment || !inScope(appointment)) return err('Appointment not found in your practice.', 404);
      if (appointment.status === 'cancelled') return err('A cancelled appointment cannot start a session.', 409);
      // IDEMPOTENCY — exactly ONE session per appointment: duplicate taps,
      // retries and concurrent calls resume instead of duplicating.
      if (appointment.session_id) {
        const linked = await find('Session', appointment.session_id);
        if (linked && inScope(linked) && therapistOwns(linked)) {
          if (appointment.status !== 'in_session') {
            await svc.entities.Appointment.update(appointment.id, { status: 'in_session' });
          }
          return Response.json({ success: true, record: linked, created: false });
        }
      }
      const orphan = await svc.entities.Session.filter({ appointment_id: appointment.id }).catch(() => []);
      if (orphan && orphan.length > 0 && inScope(orphan[0]) && therapistOwns(orphan[0])) {
        await svc.entities.Appointment.update(appointment.id, { status: 'in_session', session_id: orphan[0].id });
        return Response.json({ success: true, record: orphan[0], created: false });
      }
      const patient = await find('Patient', d.patient_id || appointment.patient_id);
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      // The appointment must belong to the same patient — server-verified.
      if (String(patient.id) !== String(appointment.patient_id)) {
        return err('The appointment does not belong to this patient.', 409);
      }
      const therapistId = isTherapist ? caller.id : (d.therapist_id || appointment.therapist_id || caller.id);
      if (isTherapist && therapistId !== caller.id) return err('Therapists may only open their own sessions.', 403);
      if (therapistId && !isTherapist) {
        // A practice admin assigning a therapist must pick one from THIS practice.
        const tRows = await svc.entities.User.filter({ id: String(therapistId) }).catch(() => []);
        const t = (tRows && tRows[0]) || null;
        if (!t) return err('Therapist not found.', 404);
        if (t.customer_id && scope.customer_id && t.customer_id !== scope.customer_id) {
          return err('Therapist does not belong to this practice.', 403);
        }
      }
      // A patient cannot have conflicting ACTIVE sessions in the practice.
      const active = await svc.entities.Session.filter({ customer_id: scope.customer_id, patient_id: patient.id, status: 'in_progress' }).catch(() => []);
      if ((active || []).length > 0) return err('This patient already has an active session.', 409);
      const service = await find('MedicalService', d.service_id || appointment.service_id);
      // ── RESERVE-THEN-CREATE (no duplicate session can ever be written) ──
      // One session per appointment is enforced by a compare-and-swap
      // RESERVATION taken on the appointment BEFORE the session record is
      // created. The deterministic token 'medical-session:<appointment_id>:
      // <ts>:<caller_id>' occupies the appointment's session_id slot, so no
      // concurrent request can pass the claim. Only after the session exists
      // is the reservation exchanged for the real session id (CAS from the
      // token). A reservation whose create step crashed (partial failure) is
      // recoverable: it can be stolen after 2 minutes. Stronger than
      // create-then-claim — a losing duplicate session is never written,
      // so no orphan can remain after any partial failure.
      const RESERVE_PREFIX = 'medical-session:';
      const existing = appointment.session_id;
      if (existing) {
        if (!String(existing).startsWith(RESERVE_PREFIX)) {
          // A real session is already linked — idempotent return of the winner.
          const winner = await find('Session', existing);
          if (winner && inScope(winner) && therapistOwns(winner)) {
            return Response.json({ success: true, record: winner, created: false });
          }
          return err('A session was already started for this appointment.', 409);
        }
        const ts = Number(String(existing).split(':')[2]) || 0;
        if (Date.now() - ts < 2 * 60 * 1000) {
          return err('A session is already being started for this appointment.', 409);
        }
      }
      const token = RESERVE_PREFIX + appointment.id + ':' + Date.now() + ':' + caller.id;
      const claim = await svc.entities.Appointment.updateMany(
        existing
          ? { id: appointment.id, session_id: existing }  // steal the stale reservation
          : { id: appointment.id, session_id: null },
        { $set: { status: 'in_session', session_id: token } }
      );
      if (!claim || !claim.updated) {
        // Lost the claim race — return the actual state.
        const raced = await find('Appointment', appointment.id);
        if (raced && raced.session_id && !String(raced.session_id).startsWith(RESERVE_PREFIX)) {
          const winner = await find('Session', raced.session_id);
          if (winner && inScope(winner) && therapistOwns(winner)) {
            return Response.json({ success: true, record: winner, created: false });
          }
        }
        return err('A session was already started for this appointment.', 409);
      }
      let created;
      try {
        created = await svc.entities.Session.create({
          customer_id: scope.customer_id, reseller_id: patient.reseller_id || await resellerIdOf(),
          appointment_id: appointment.id, patient_id: patient.id,
          patient_name: (patient.first_names || '') + ' ' + (patient.surname || ''),
          employer_id: patient.employer_id || null, employer_name: patient.employer_name || null,
          service_id: service ? service.id : null, service_name: service ? service.name : (appointment.service_name || null),
          therapist_id: therapistId,
          therapist_name: isTherapist ? callerName : (d.therapist_name || appointment.therapist_name || null),
          assessment_template_id: d.assessment_template_id || null,
          actual_start_time: d.actual_start_time || new Date().toISOString(),
          status: 'in_progress',
        });
      } catch (e) {
        // Session creation failed after the reservation — release it so the
        // appointment is never stranded in 'in_session' with a dead token.
        await svc.entities.Appointment.updateMany(
          { id: appointment.id, session_id: token },
          { $set: { session_id: null, status: appointment.status } }
        ).catch(() => {});
        throw e;
      }
      // Exchange the reservation for the real session id (CAS from our token).
      const link = await svc.entities.Appointment.updateMany(
        { id: appointment.id, session_id: token },
        { $set: { session_id: created.id } }
      );
      if (!link || !link.updated) {
        // Reservation was stolen after the stale timeout — remove the
        // orphaned session; no duplicate remains.
        await svc.entities.Session.delete(created.id).catch(() => {});
        const raced = await find('Appointment', appointment.id);
        if (raced && raced.session_id && !String(raced.session_id).startsWith(RESERVE_PREFIX)) {
          const winner = await find('Session', raced.session_id);
          if (winner && inScope(winner) && therapistOwns(winner)) {
            return Response.json({ success: true, record: winner, created: false });
          }
        }
        return err('A session was already started for this appointment.', 409);
      }
      await audit('medical.session.created', 'Session', created.id, 'started clinical session', created);
      return Response.json({ success: true, record: created, created: true });
    }
    if (action === 'update_session') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rec = await find('Session', p.id);
      if (!rec || !inScope(rec) || !therapistOwns(rec)) return err('Session not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id; delete changes.patient_id;
      delete changes.therapist_id; delete changes.appointment_id;
      // Completion identity is stamped server-side, never client-supplied.
      delete changes.completion_user_id; delete changes.completion_user_name; delete changes.completed_at;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const prevStatus = rec.status || 'in_progress';
      if (changes.status !== undefined && changes.status !== prevStatus) {
        const SESSION_TRANSITIONS = {
          in_progress: ['completed', 'cancelled'],
          completed: ['in_progress'], // reopen — owner therapist or practice admin only
          cancelled: [],              // cancelled is final
        };
        if (!(SESSION_TRANSITIONS[prevStatus] || []).includes(changes.status)) {
          return err('Invalid session transition: ' + prevStatus + ' → ' + changes.status + '.', 409);
        }
        if (changes.status === 'completed') {
          changes.actual_end_time = changes.actual_end_time || new Date().toISOString();
          changes.completed_at = new Date().toISOString();
          changes.completion_user_id = caller.id;
          changes.completion_user_name = callerName;
          if (rec.actual_start_time) {
            changes.duration_minutes = changes.duration_minutes
              ?? Math.max(0, Math.round((new Date(changes.actual_end_time).getTime() - new Date(rec.actual_start_time).getTime()) / 60000));
          }
        }
      }
      const updated = await svc.entities.Session.update(rec.id, changes);
      await audit('medical.session.updated', 'Session', rec.id,
        'updated session (' + prevStatus + (changes.status && changes.status !== prevStatus ? ' → ' + changes.status : '') + ')'
        + (p.reason ? ' (reason: ' + p.reason + ')' : ''), updated);
      return Response.json({ success: true, record: updated });
    }

    /* ── Clinical notes (clinical only — NEVER reception/employer) ─────────── */
    if (action === 'list_notes') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      let rows = await svc.entities.ClinicalNote.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      rows = rows || [];
      let visible = isPracticeAdmin || isAdmin ? rows : rows.filter((n) => n.therapist_id === caller.id);
      // Restricted notes: author or practice admin only.
      visible = visible.filter((n) => !n.is_restricted || n.therapist_id === caller.id || isPracticeAdmin || isAdmin);
      return Response.json({ notes: visible });
    }
    if (action === 'create_note') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      const patient = await find('Patient', d.patient_id);
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      if (!d.content) return err('Note content is required.');
      const created = await svc.entities.ClinicalNote.create({
        customer_id: scope.customer_id, reseller_id: patient.reseller_id || await resellerIdOf(),
        patient_id: patient.id, patient_name: (patient.first_names || '') + ' ' + (patient.surname || ''),
        session_id: d.session_id || null, therapist_id: caller.id, therapist_name: callerName,
        note_type: d.note_type || 'general', content: String(d.content),
        created_at_note: new Date().toISOString(),
        is_restricted: d.is_restricted === true, status: 'active',
      });
      await audit('medical.note.created', 'ClinicalNote', created.id, 'created clinical note', created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_note') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rec = await find('ClinicalNote', p.id);
      if (!rec || !inScope(rec)) return err('Note not found in your scope.', 404);
      if (rec.therapist_id !== caller.id && !isPracticeAdmin && !isAdmin) {
        return err('Only the author or a practice administrator may amend a note.', 403);
      }
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id; delete changes.therapist_id;
      // Amendments preserve history — previous content is appended, never lost.
      if (changes.content !== undefined && changes.content !== rec.content) {
        const history = Array.isArray(rec.amendment_history) ? rec.amendment_history : [];
        history.push({
          timestamp: new Date().toISOString(), edited_by_id: caller.id, edited_by_name: callerName,
          previous_content: rec.content, reason: changes.reason || 'amended',
        });
        changes.amendment_history = history;
        delete changes.reason;
      }
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.ClinicalNote.update(rec.id, changes);
      await audit('medical.note.updated', 'ClinicalNote', rec.id, 'amended clinical note', updated);
      return Response.json({ success: true, record: updated });
    }

    /* ── Assessments (clinical only — NEVER reception/employer) ───────────── */
    if (action === 'list_assessments') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rows = await svc.entities.Assessment.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ assessments: (rows || []).filter((a) => therapistOwns(a)) });
    }
    if (action === 'get_assessment') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rec = await find('Assessment', p.id);
      if (!rec || !inScope(rec) || !therapistOwns(rec)) return err('Assessment not found in your scope.', 404);
      return Response.json({ assessment: rec });
    }
    if (action === 'save_assessment') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      const payload = {
        session_id: d.session_id || null,
        therapist_id: isTherapist ? caller.id : (d.therapist_id || caller.id),
        template_id: d.template_id || null, template_name: d.template_name || null,
        template_version: d.template_version ?? null,
        service_id: d.service_id || null, service_name: d.service_name || null,
        responses: Array.isArray(d.responses) ? d.responses : [],
        calculated_scores: d.calculated_scores || {},
        findings: d.findings || null, recommendations: d.recommendations || null,
        completed_at: d.completed_at || null,
        completed_by_id: caller.id, completed_by_name: callerName,
        status: d.status || 'in_progress',
        report_id: d.report_id || undefined,
      };
      if (d.id) {
        const rec = await find('Assessment', d.id);
        if (!rec || !inScope(rec) || !therapistOwns(rec)) return err('Assessment not found in your scope.', 404);
        // UPDATE: only explicitly-provided fields change — a targeted update
        // (e.g. linking report_id) never clobbers existing responses.
        const patient = await find('Patient', d.patient_id || rec.patient_id);
        if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
        const changes = {
          customer_id: rec.customer_id, patient_id: patient.id,
          patient_name: (patient.first_names || '') + ' ' + (patient.surname || ''),
          employer_id: patient.employer_id || null, employer_name: patient.employer_name || null,
        };
        for (const k of Object.keys(payload)) {
          if (d[k] !== undefined) changes[k] = payload[k];
        }
        const updated = await svc.entities.Assessment.update(rec.id, changes);
        await audit('medical.assessment.updated', 'Assessment', rec.id, 'updated assessment', updated);
        return Response.json({ success: true, record: updated });
      }
      const patient = await find('Patient', d.patient_id);
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      const created = await svc.entities.Assessment.create({
        ...payload,
        customer_id: scope.customer_id, reseller_id: patient.reseller_id || await resellerIdOf(),
        patient_id: patient.id,
        patient_name: (patient.first_names || '') + ' ' + (patient.surname || ''),
        employer_id: patient.employer_id || null, employer_name: patient.employer_name || null,
      });
      await audit('medical.assessment.created', 'Assessment', created.id, 'created assessment', created);
      return Response.json({ success: true, record: created });
    }

    /* ── Assessment templates (clinical read; practice admin manage) ─────── */
    if (action === 'list_templates') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rows = await svc.entities.AssessmentTemplate.filter(tenantQuery(p.filter || {}), '-created_date', 200).catch(() => []);
      return Response.json({ templates: rows || [] });
    }
    if (action === 'get_template') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rec = await find('AssessmentTemplate', p.id);
      if (!rec || !inScope(rec)) return err('Template not found in your scope.', 404);
      return Response.json({ template: rec });
    }
    if (action === 'create_template') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      if (!d.name) return err('Template name is required.');
      let service = null;
      if (d.service_id) {
        service = await find('MedicalService', d.service_id);
        if (!service || !inScope(service)) return err('Service not found in your practice.', 404);
      }
      const created = await svc.entities.AssessmentTemplate.create({
        customer_id: scope.customer_id, reseller_id: await resellerIdOf(),
        name: String(d.name).trim(), service_id: service ? service.id : null,
        service_name: service ? service.name : null,
        description: d.description || null,
        sections: Array.isArray(d.sections) ? d.sections : [],
        recommendation_fields: Array.isArray(d.recommendation_fields) ? d.recommendation_fields : [],
        version: d.version ?? 1, active: d.active !== false,
      });
      await audit('medical.template.created', 'AssessmentTemplate', created.id, 'created assessment template', created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_template') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const rec = await find('AssessmentTemplate', p.id);
      if (!rec || !inScope(rec)) return err('Template not found in your scope.', 404);
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      delete changes.customer_id; delete changes.reseller_id;
      if (!Object.keys(changes).length) return Response.json({ success: true, record: rec, unchanged: true });
      const updated = await svc.entities.AssessmentTemplate.update(rec.id, changes);
      await audit('medical.template.updated', 'AssessmentTemplate', rec.id, 'updated assessment template', updated);
      return Response.json({ success: true, record: updated });
    }
    if (action === 'delete_template') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const rec = await find('AssessmentTemplate', p.id);
      if (!rec || !inScope(rec)) return err('Template not found in your scope.', 404);
      // Used templates are deactivated, never deleted (versioned history).
      const used = await svc.entities.Assessment.filter({ assessment_template_id: rec.id }).catch(() => []);
      if ((used || []).length) {
        await svc.entities.AssessmentTemplate.update(rec.id, { active: false });
        await audit('medical.template.deactivated', 'AssessmentTemplate', rec.id, 'deactivated in-use template', null);
        return Response.json({ success: true, deactivated: true });
      }
      await svc.entities.AssessmentTemplate.delete(rec.id);
      await audit('medical.template.deleted', 'AssessmentTemplate', rec.id, 'deleted unused template', rec);
      return Response.json({ success: true });
    }

    /* ── Medical reports ─────────────────────────────────────────────────── */
    if (action === 'list_reports') {
      if (isEmployer) {
        // Employer users see ONLY released employer-facing reports for their
        // own employer — never internal clinical or draft reports.
        const rows = await svc.entities.MedicalReport.filter({ customer_id: scope.customer_id, employer_id: scope.employer_id }, '-created_date', 500).catch(() => []);
        const released = (rows || []).filter((r) => r.shared_with_employer === true || (r.report_type === 'employer_release' && r.status === 'released'));
        return Response.json({ reports: released });
      }
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rows = await svc.entities.MedicalReport.filter(tenantQuery(p.filter || {}), '-created_date', 500).catch(() => []);
      return Response.json({ reports: (rows || []).filter((r) => therapistOwns(r)) });
    }
    if (action === 'create_report') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      const session = await find('Session', d.session_id);
      if (!session || !inScope(session) || !therapistOwns(session)) return err('Session not found in your scope.', 404);
      const patient = await find('Patient', d.patient_id || session.patient_id);
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      const count = (await svc.entities.MedicalReport.filter({ customer_id: scope.customer_id }).catch(() => [])).length;
      const created = await svc.entities.MedicalReport.create({
        customer_id: scope.customer_id, reseller_id: session.reseller_id || await resellerIdOf(),
        report_number: 'MR-' + String(Date.now()).slice(-8) + '-' + String(count + 1).padStart(3, '0'),
        session_id: session.id, assessment_id: d.assessment_id || session.assessment_id || null,
        patient_id: patient.id, patient_name: session.patient_name || ((patient.first_names || '') + ' ' + (patient.surname || '')),
        employer_id: session.employer_id || null, employer_name: session.employer_name || null,
        service_id: session.service_id || null, service_name: session.service_name || null,
        therapist_id: session.therapist_id, therapist_name: session.therapist_name || null,
        assessment_date: session.actual_start_time || null,
        report_type: d.report_type || 'internal_clinical',
        findings: d.findings || null, recommendations: d.recommendations || null,
        work_capacity: d.work_capacity || null, restrictions: d.restrictions || null,
        return_to_work_recommendations: d.return_to_work_recommendations || null,
        accommodation_recommendations: d.accommodation_recommendations || null,
        follow_up: d.follow_up || null,
        status: 'draft', shared_with_employer: false,
        generated_at: new Date().toISOString(), generated_by_id: caller.id, generated_by_name: callerName,
      });
      await audit('medical.report.created', 'MedicalReport', created.id, 'generated report ' + created.report_number, created);
      return Response.json({ success: true, record: created });
    }
    if (action === 'update_report') {
      if (!isClinical && !isAdmin) return err('Forbidden', 403);
      const rec = await find('MedicalReport', p.id);
      if (!rec || !inScope(rec) || !therapistOwns(rec)) return err('Report not found in your scope.', 404);
      // RELEASED / ARCHIVED reports are IMMUTABLE — released content changes
      // only through a separately authorized, audit-logged new version.
      if (rec.shared_with_employer === true || rec.status === 'released' || rec.status === 'archived') {
        return err('This report is finalized and cannot be edited.', 409);
      }
      // WHITELIST: clinical content + status only. Patient, employer, session,
      // therapist identity, tenant, report type, report number and share fields
      // are authoritative server-side and can NEVER be client-supplied.
      const ALLOWED_CONTENT = ['findings', 'recommendations', 'work_capacity', 'restrictions',
        'return_to_work_recommendations', 'accommodation_recommendations', 'follow_up'];
      const changes = (p.changes && typeof p.changes === 'object') ? { ...p.changes } : {};
      const content = {};
      for (const k of Object.keys(changes)) if (ALLOWED_CONTENT.includes(k)) content[k] = changes[k];
      const prev = rec.status || 'draft';
      const next = changes.status;
      if (next !== undefined && next !== prev) {
        const TRANSITIONS = {
          draft: ['pending_approval'],
          pending_approval: ['approved', 'draft'], // 'draft' = returned for changes (reason required)
          approved: [],   // release happens ONLY via share_report
          released: [],
          archived: [],
        };
        if (!(TRANSITIONS[prev] || []).includes(next)) {
          return err('Invalid report transition: ' + prev + ' → ' + next + '.', 409);
        }
        if (next === 'approved') {
          // Independent approval: an authorized approver who is NOT the author.
          if (!isPracticeAdmin && !isAdmin) return err('Only a practice administrator may approve reports.', 403);
          if (caller.id === rec.generated_by_id || caller.id === rec.therapist_id) {
            return err('The report author may not approve their own report.', 403);
          }
        }
        if (next === 'draft') {
          if (!String(p.reason || '').trim()) return err('A reason is required to return a report.', 400);
        }
        content.status = next;
      }
      if (!Object.keys(content).length) return Response.json({ success: true, record: rec, unchanged: true });
      if (content.status !== undefined && content.status !== prev) {
        // Compare-and-swap on the previous state: concurrent approvals/returns/
        // releases can never produce inconsistent states — exactly one wins.
        const entry = {
          timestamp: new Date().toISOString(), actor_id: caller.id, actor_name: callerName,
          from_status: prev, to_status: content.status, reason: String(p.reason || '').trim() || null,
        };
        await svc.entities.MedicalReport.updateMany(
          { id: rec.id, status: prev },
          { $set: content, $push: { transition_history: entry } }
        );
        const after = await find('MedicalReport', rec.id);
        if (!after || (after.status || 'draft') !== content.status) {
          return err('The report was changed by another user. Reload and retry.', 409);
        }
        await audit('medical.report.transition', 'MedicalReport', rec.id,
          prev + ' → ' + content.status + (entry.reason ? ' (reason: ' + entry.reason + ')' : ''), after);
        return Response.json({ success: true, record: after });
      }
      const updated = await svc.entities.MedicalReport.update(rec.id, content);
      await audit('medical.report.updated', 'MedicalReport', rec.id, 'updated report content', updated);
      return Response.json({ success: true, record: updated });
    }
    /* Employer release — explicit, audited, practice-admin-only decision. */
    if (action === 'share_report') {
      if (!isPracticeAdmin && !isAdmin) return err('Forbidden', 403);
      const rec = await find('MedicalReport', p.id);
      if (!rec || !inScope(rec)) return err('Report not found in your scope.', 404);
      if (!rec.employer_id) return err('This report has no employer to share with.', 400);
      if (rec.shared_with_employer === true) {
        // Idempotent — concurrent/repeat releases never duplicate the audit.
        return Response.json({ success: true, record: rec, idempotent: true });
      }
      if (rec.status !== 'approved') return err('Only approved reports may be released to an employer.', 409);
      const recipientName = String(p.recipient_name || '').trim();
      if (!recipientName) return err('A recipient name is required for the release audit.', 400);
      // Compare-and-swap: exactly one concurrent release can win.
      const entry = {
        timestamp: new Date().toISOString(), actor_id: caller.id, actor_name: callerName,
        from_status: 'approved', to_status: 'released', reason: 'released to employer: ' + recipientName,
      };
      await svc.entities.MedicalReport.updateMany(
        { id: rec.id, status: 'approved', shared_with_employer: { $ne: true } },
        { $set: {
            report_type: rec.report_type === 'internal_clinical' ? 'employer_release' : rec.report_type,
            status: 'released',
            shared_with_employer: true, shared_at: new Date().toISOString(),
            shared_by_id: caller.id, shared_by_name: callerName,
            shared_recipient_name: recipientName,
          },
          $push: { transition_history: entry } }
      );
      const after = await find('MedicalReport', rec.id);
      if (!after || after.shared_with_employer !== true) {
        return err('The report was changed by another user. Reload and retry.', 409);
      }
      await audit('medical.report.shared', 'MedicalReport', rec.id, 'released report to employer (recipient: ' + recipientName + ')', after);
      return Response.json({ success: true, record: after });
    }

    /* ── Consent records (staff capture; employer none) ───────────────────── */
    if (action === 'list_consents') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const q = tenantQuery(p.patient_id ? { patient_id: String(p.patient_id) } : (p.filter || {}));
      const rows = await svc.entities.ConsentRecord.filter(q, '-created_date', 500).catch(() => []);
      return Response.json({ consents: rows || [] });
    }
    if (action === 'create_consent') {
      if (!isStaff && !isAdmin) return err('Forbidden', 403);
      const d = p.data || {};
      const patient = await find('Patient', d.patient_id);
      if (!patient || !inScope(patient)) return err('Patient not found in your practice.', 404);
      if (!d.consent_type || !d.result) return err('Consent type and result are required.');
      const created = await svc.entities.ConsentRecord.create({
        customer_id: scope.customer_id, reseller_id: patient.reseller_id || await resellerIdOf(),
        patient_id: patient.id, patient_name: (patient.first_names || '') + ' ' + (patient.surname || ''),
        consent_type: d.consent_type, consent_text_version: d.consent_text_version || null,
        consent_text_hash: d.consent_text_hash || null, result: d.result,
        captured_by_id: caller.id, captured_by_name: callerName,
        captured_at: new Date().toISOString(),
        signature_data: d.signature_data || null, notes: d.notes || null,
      });
      await audit('medical.consent.created', 'ConsentRecord', created.id, 'captured consent (' + d.consent_type + ', ' + d.result + ')', created);
      return Response.json({ success: true, record: created });
    }

    return err('Unknown action.');
  } catch (e) {
    return Response.json({ error: (e && e.message) || 'Medical gateway error.' }, { status: 500 });
  }
}