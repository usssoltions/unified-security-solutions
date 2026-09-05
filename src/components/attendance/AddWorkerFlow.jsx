/**
 * AddWorkerFlow — create or edit a Worker / Patient profile from the
 * Workers / Patients directory (Attendance Register).
 *
 * Create: Scan Document (the EXISTING Barkoder/SecureScan DocumentScanner —
 * no second scanner implementation) or Enter Manually → Details →
 * ID Document photo → Review & Confirm.
 * Edit: opens at Details with the stored profile prefilled.
 *
 * Duplicate prevention is enforced SERVER-SIDE by the attendanceAccess
 * gateway (create_worker): if the ID/document number already exists in the
 * customer's directory, the existing profile is returned and offered for
 * opening — a duplicate is never created. Tenant scoping is resolved entirely
 * server-side; the operator never enters tenant/customer ids.
 */
import React, { useState } from "react";
import { attendanceCall } from "@/lib/attendanceApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ScanLine, CheckCircle2, ChevronLeft, ChevronRight, AlertCircle,
  Loader2, Eye
} from "lucide-react";
import DocumentScanner from "@/components/documents/DocumentScanner";
import IdDocCapture from "./IdDocCapture";
import { idTypeLabel, formatDisplayName } from "@/lib/attendanceDropdowns";

export default function AddWorkerFlow({ mode = "create", worker = null, onDone, onCancel }) {
  const isEdit = mode === "edit";
  // 1 = choose (scan/manual), 2 = details, 3 = ID document, 4 = review
  const [step, setStep] = useState(isEdit ? 2 : 1);
  const [showScanner, setShowScanner] = useState(false);

  const [surname, setSurname] = useState(worker?.surname || "");
  const [initials, setInitials] = useState(worker?.initials || "");
  const [firstNames, setFirstNames] = useState(worker?.first_names || "");
  const [idNumber, setIdNumber] = useState(worker?.id_number || "");
  const [idType, setIdType] = useState(worker?.id_type || "sa_id");
  const [company, setCompany] = useState(worker?.company || "");
  const [jobDescription, setJobDescription] = useState(worker?.job_description || "");
  const [cellphone, setCellphone] = useState(worker?.cellphone || "");
  const [idFrontUrl, setIdFrontUrl] = useState(worker?.id_front_url || null);
  const [idBackUrl, setIdBackUrl] = useState(worker?.id_back_url || null);

  const [existing, setExisting] = useState(null); // duplicate found via lookup
  // Driver's Licence scans do not reliably provide full first names — when
  // true, the operator must enter them manually before continuing.
  const [licenceMissingFirstNames, setLicenceMissingFirstNames] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // ── Duplicate lookup (advisory — the server enforces it on save) ──────────
  const lookupExisting = async (idn) => {
    if (!idn) { setExisting(null); return; }
    try {
      const res = await attendanceCall("find_worker", { id_number: idn });
      setExisting(res?.worker || null);
      if (res?.worker) setLicenceMissingFirstNames(false);
    } catch { setExisting(null); }
  };

  // ── Scan accept: populate reliably decoded fields for review ──────────────
  const handleScanAccept = ({ mappedFields, resolvedProfileId }) => {
    setShowScanner(false);
    const mf = mappedFields;
    if (!mf) { setStep(2); return; }
    // Driver's Licence scans do NOT reliably provide full first names — never
    // substitute surname/visitor name/initials. Only a dedicated, reliable
    // first-names value may auto-fill; otherwise First Names stays blank and
    // the operator enters it manually. SA ID and Passport mapping unchanged.
    const licenceScan = resolvedProfileId === "drivers_licence";
    const fn = licenceScan
      ? (mf.first_names || "")
      : (mf.first_names || mf.visitor_name || "");
    const ini = mf.initials || (fn ? fn.split(" ").map(w => w[0]).join("") : "");
    const idn = mf.visitor_id_number || mf.driver_licence_number || "";
    const idt = resolvedProfileId === "drivers_licence" ? "drivers_licence"
      : resolvedProfileId === "sa_id" ? "sa_id"
      : resolvedProfileId === "passport_mr" ? "passport" : "sa_id";
    setLicenceMissingFirstNames(licenceScan && !fn.trim());
    setSurname(mf.surname || "");
    setInitials(ini.toUpperCase());
    setFirstNames(fn);
    setIdNumber(idn);
    setIdType(idt);
    setStep(2);
    if (idn) lookupExisting(idn);
  };

  // ── Validation (same required fields as the attendance wizard) ────────────
  // Driver's Licence scan without reliable full first names: the operator
  // cannot continue until First Names is completed manually.
  const firstNamesRequired = licenceMissingFirstNames && idType === "drivers_licence" && !firstNames.trim();
  const detailsValid = surname.trim() && idNumber.trim() && company.trim()
    && jobDescription.trim() && cellphone.trim() && !firstNamesRequired;

  const goNextFromDetails = () => {
    if (!isEdit) lookupExisting(idNumber.trim());
    setStep(3);
  };

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        surname, initials, first_names: firstNames, id_number: idNumber, id_type: idType,
        company, job_description: jobDescription, cellphone,
        id_front_url: idFrontUrl, id_back_url: idBackUrl,
      };
      if (isEdit) {
        const res = await attendanceCall("update_worker", { worker_id: worker.id, worker: payload });
        onDone?.(res?.worker || { ...worker, ...payload });
      } else {
        const res = await attendanceCall("create_worker", { worker: payload });
        if (res?.duplicate) {
          // Server rejected the duplicate and returned the existing profile.
          setExisting(res.worker);
          setStep(2);
          return;
        }
        onDone?.(res?.worker);
      }
    } catch (e) {
      setSaveError(e?.message || "Failed to save. Please check the details and try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (showScanner) {
    return (
      <DocumentScanner
        documentType="auto"
        caller="attendance_register"
        onClose={() => setShowScanner(false)}
        onAccept={handleScanAccept}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-white text-xl font-bold flex-1">
          {isEdit ? "Edit Worker / Patient" : "Register Worker / Patient"}
        </h2>
        <Button variant="ghost" onClick={onCancel} className="text-slate-500">Cancel</Button>
      </div>

      {/* ── STEP 1: Scan or Enter Manually ── */}
      {step === 1 && (
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">
            Scan the worker's/patient's South African ID, Driver's Licence or Passport using SecureScan,
            or enter the details manually.
          </p>
          <Button onClick={() => setShowScanner(true)} variant="brand" className="w-full h-16 text-lg">
            <ScanLine className="w-6 h-6 mr-3" /> Scan Document
          </Button>
          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-slate-500 text-xs">or</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>
          <Button variant="outline" onClick={() => setStep(2)} className="w-full h-12 border-slate-600 text-slate-300">
            Enter Manually
          </Button>
        </div>
      )}

      {/* ── STEP 2: Details ── */}
      {step === 2 && (
        <div className="space-y-4">
          {existing && !isEdit && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 space-y-2">
              <p className="text-amber-300 text-sm font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" /> A profile with this ID number already exists
              </p>
              <p className="text-slate-300 text-xs">
                {formatDisplayName(existing)} · {existing.id_number} · {idTypeLabel(existing.id_type)} · {existing.company || "—"}
              </p>
              <p className="text-slate-400 text-xs">
                A duplicate profile cannot be created. Open the existing profile below, or correct the ID number if it was captured incorrectly.
              </p>
              <Button size="sm" variant="outline" onClick={() => onDone?.(existing, "existing")}
                className="border-amber-500/50 text-amber-300 hover:bg-amber-500/10">
                <Eye className="w-3.5 h-3.5 mr-1.5" /> Open Existing Profile
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Surname *</label>
              <Input value={surname} onChange={e => setSurname(e.target.value)} placeholder="Surname"
                className="bg-slate-900 border-slate-700 text-white" />
            </div>
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Initials</label>
              <Input value={initials} onChange={e => setInitials(e.target.value.toUpperCase())} placeholder="e.g. J A"
                className="bg-slate-900 border-slate-700 text-white uppercase" />
            </div>
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">
              First Names{firstNamesRequired ? " *" : ""}
            </label>
            <Input value={firstNames} onChange={e => setFirstNames(e.target.value)}
              placeholder={firstNamesRequired ? "Enter the person's full first names" : "First names (optional)"}
              className="bg-slate-900 border-slate-700 text-white" />
            {firstNamesRequired && (
              <p className="text-amber-400 text-xs mt-1">
                Full first names are not available from this licence scan. Please enter the person's full first names.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs mb-1 block">ID / Passport Number *</label>
              <Input value={idNumber} onChange={e => setIdNumber(e.target.value)} placeholder="ID number"
                className="bg-slate-900 border-slate-700 text-white font-mono" />
            </div>
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Document Type</label>
              <select value={idType} onChange={e => setIdType(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm">
                <option value="sa_id">SA ID</option>
                <option value="drivers_licence">Driver's Licence</option>
                <option value="passport">Passport</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Company / Customer *</label>
            <Input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company or employer name"
              className="bg-slate-900 border-slate-700 text-white" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Job Description *</label>
            <Input value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="Job title / description"
              className="bg-slate-900 border-slate-700 text-white" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Cellphone Number *</label>
            <Input value={cellphone} onChange={e => setCellphone(e.target.value)} placeholder="+27 xx xxx xxxx" type="tel"
              className="bg-slate-900 border-slate-700 text-white" />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={step === 1 ? onCancel : () => setStep(1)} hidden={isEdit}
              className="flex-1 border-slate-600 text-slate-300 h-12">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button onClick={goNextFromDetails} disabled={!detailsValid}
              variant="brand" className="flex-1 h-12">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: ID Document (the DOCUMENT image, not a portrait) ── */}
      {step === 3 && (
        <div className="space-y-4">
          {idFrontUrl ? (
            <>
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 space-y-2">
                <p className="text-emerald-300 text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" /> Document photo on file
                </p>
                <div className="flex gap-2">
                  <img src={idFrontUrl} alt="ID Front" className="h-24 rounded-lg object-contain border border-[var(--border-default)] bg-[var(--surface-base)]" />
                  {idBackUrl && <img src={idBackUrl} alt="ID Back" className="h-24 rounded-lg object-contain border border-[var(--border-default)] bg-[var(--surface-base)]" />}
                </div>
                <Button variant="outline" size="sm"
                  onClick={() => { setIdFrontUrl(null); setIdBackUrl(null); }}
                  className="border-amber-500/50 text-amber-400 text-xs">
                  Replace / Update Document Photos
                </Button>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep(2)} className="flex-1 border-slate-600 text-slate-300 h-12">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back
                </Button>
                <Button onClick={() => setStep(4)} variant="brand" className="flex-1 h-12">
                  Continue <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </>
          ) : (
            <>
              <IdDocCapture idType={idType}
                onComplete={({ frontUrl, backUrl }) => { setIdFrontUrl(frontUrl); setIdBackUrl(backUrl); setStep(4); }}
                onSkip={() => setStep(4)} />
              <Button variant="ghost" onClick={() => setStep(2)} className="text-slate-500">
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            </>
          )}
        </div>
      )}

      {/* ── STEP 4: Review & Confirm ── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] divide-y divide-slate-700/50">
            {[
              ["Surname, Initials", `${surname}${initials ? ", " + initials : ""}`],
              ["First Names", firstNames],
              ["ID / Passport Number", idNumber],
              ["Document Type", idTypeLabel(idType)],
              ["Company / Customer", company],
              ["Job Description", jobDescription],
              ["Cellphone Number", cellphone],
              ["ID Document Photos", idFrontUrl ? (idBackUrl ? "Front + Back captured" : "Front captured") : "None captured"],
            ].map(([label, val]) => (
              <div key={label} className="flex items-start gap-3 px-4 py-3">
                <span className="text-slate-400 text-sm w-44 shrink-0">{label}</span>
                <span className="text-white text-sm font-medium flex-1">{val || "—"}</span>
              </div>
            ))}
          </div>
          {saveError && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 flex items-start gap-2 text-rose-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {saveError}
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(3)} disabled={saving}
              className="flex-1 border-slate-600 text-slate-300 h-12">
              <ChevronLeft className="w-4 h-4 mr-1" /> Edit
            </Button>
            <Button onClick={handleConfirm} disabled={saving}
              variant="brand" className="flex-1 h-14 text-base">
              {saving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Profile"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}