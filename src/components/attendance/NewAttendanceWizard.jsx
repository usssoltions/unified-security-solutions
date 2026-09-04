/**
 * New Attendance Wizard — 6-step guided flow.
 *
 * Steps: Scan → Worker Details → ID Document → Attendance Details → Signature → Review & Confirm
 *
 * Reuses the EXISTING Barkoder DocumentScanner. No parallel scanner, no jsQR fallback.
 */
import React, { useState, useEffect, useRef } from "react";
import { attendanceCall } from "@/lib/attendanceApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ScanLine, User, FileText, ClipboardList, PenTool, CheckCircle2,
  ChevronRight, ChevronLeft, Loader2, AlertCircle, RefreshCw,
  IdCard, Building2, Phone, Briefcase, Eye
} from "lucide-react";
import DocumentScanner from "@/components/documents/DocumentScanner";
import AttendanceSignaturePad from "./AttendanceSignaturePad";
import IdDocCapture from "./IdDocCapture";
import { idTypeLabel, formatDisplayName } from "@/lib/attendanceDropdowns";
import { uploadOptimizedImage } from "@/lib/imageOptimize";
import { todayISO, localTimeStr } from "@/lib/attendanceDropdowns";

const STEPS = [
  { id: 1, label: "Scan Document", icon: ScanLine },
  { id: 2, label: "Worker Details", icon: User },
  { id: 3, label: "ID Document", icon: IdCard },
  { id: 4, label: "Attendance Details", icon: ClipboardList },
  { id: 5, label: "Signature", icon: PenTool },
  { id: 6, label: "Review & Confirm", icon: CheckCircle2 },
];

function StepIndicator({ currentStep }) {
  return (
    <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const done = currentStep > step.id;
        const active = currentStep === step.id;
        return (
          <React.Fragment key={step.id}>
            <div className={`flex flex-col items-center gap-1 shrink-0 ${active ? "opacity-100" : done ? "opacity-80" : "opacity-40"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition
                ${active ? "bg-[var(--brand-primary)] text-white" : done ? "bg-[var(--brand-accent)] text-slate-900" : "bg-slate-700 text-slate-400"}`}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : step.id}
              </div>
              <span className={`text-xs whitespace-nowrap ${active ? "text-[var(--brand-link)] font-medium" : done ? "text-[var(--brand-accent)]" : "text-slate-500"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 min-w-[12px] mx-1 mb-4 rounded ${done ? "bg-[var(--brand-accent)]" : "bg-slate-700"}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default function NewAttendanceWizard({
  user, customerId, medicalCentres, assessmentTypes, onSuccess, onCancel
}) {
  const [step, setStep] = useState(1);
  const [showScanner, setShowScanner] = useState(false);

  // Worker/profile state
  const [scannedFields, setScannedFields] = useState(null);
  // Driver's Licence scans do not reliably provide full first names — when
  // true, the operator must enter them manually before continuing.
  const [licenceMissingFirstNames, setLicenceMissingFirstNames] = useState(false);
  const [existingWorker, setExistingWorker] = useState(null); // null=unknown, false=new, {...}=found
  const [workerLookupDone, setWorkerLookupDone] = useState(false);

  // Form fields for profile
  const [surname, setSurname] = useState("");
  const [initials, setInitials] = useState("");
  const [firstNames, setFirstNames] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [idType, setIdType] = useState("sa_id");
  const [company, setCompany] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [cellphone, setCellphone] = useState("");

  // ID doc
  const [idFrontUrl, setIdFrontUrl] = useState(null);
  const [idBackUrl, setIdBackUrl] = useState(null);

  // Attendance detail fields
  const [medicalCentre, setMedicalCentre] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [assessmentType, setAssessmentType] = useState("");

  // Signature
  const [signatureDataUrl, setSignatureDataUrl] = useState(null);

  // Submit state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const saveRef = useRef(false);

  // ── Step 1: Scan ──────────────────────────────────────────────────────────
  const handleScanAccept = async ({ mappedFields, resolvedProfileId }) => {
    setShowScanner(false);
    const mf = mappedFields;
    if (!mf) { setStep(2); return; }

    const sn = mf.surname || "";
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
               : resolvedProfileId === "passport_mr" ? "passport"
               : "sa_id";

    setLicenceMissingFirstNames(licenceScan && !fn.trim());
    setSurname(sn);
    setInitials(ini.toUpperCase());
    setFirstNames(fn);
    setIdNumber(idn);
    setIdType(idt);
    setScannedFields(mf);

    if (idn) {
      try {
        // Server-side tenant-scoped lookup via the attendanceAccess gateway
        const res = await attendanceCall("find_worker", { id_number: idn });
        const w = res?.worker;
        if (w) {
          setExistingWorker(w);
          setSurname(w.surname || sn);
          setInitials(w.initials || ini.toUpperCase());
          setFirstNames(w.first_names || fn);
          setCompany(w.company || "");
          setJobDescription(w.job_description || "");
          setCellphone(w.cellphone || "");
          setIdFrontUrl(w.id_front_url || null);
          setIdBackUrl(w.id_back_url || null);
          setLicenceMissingFirstNames(false);
        } else {
          setExistingWorker(false);
        }
      } catch {
        setExistingWorker(false);
      }
    } else {
      setExistingWorker(false);
    }
    setWorkerLookupDone(true);
    setStep(2);
  };

  const handleManualEntry = () => {
    setShowScanner(false);
    setExistingWorker(false);
    setLicenceMissingFirstNames(false);
    setWorkerLookupDone(true);
    setStep(2);
  };

  // ── Step 3: ID Doc — skip for existing worker if doc present ─────────────
  const skipIdDoc = existingWorker && (existingWorker.id_front_url);

  // ── Step 6: Save ─────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (saveRef.current || saving) return;
    saveRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const now = new Date();
      const dateStr = todayISO();
      const timeStr = localTimeStr(now);
      const ts = now.toISOString();

      // Server-side transaction via the attendanceAccess gateway: worker
      // upsert + attendance record with tenant ids forced server-side
      // (never trusted from the client), dedup and signature enforcement.
      const workerUpdates = {};
      if (existingWorker && existingWorker.id) {
        if (company !== existingWorker.company) workerUpdates.company = company;
        if (jobDescription !== existingWorker.job_description) workerUpdates.job_description = jobDescription;
        if (cellphone !== existingWorker.cellphone) workerUpdates.cellphone = cellphone;
        if (idFrontUrl && idFrontUrl !== existingWorker.id_front_url) {
          workerUpdates.id_front_url = idFrontUrl;
          workerUpdates.id_back_url = idBackUrl || null;
        }
      }

      const res = await attendanceCall("register_attendance", {
        existing_worker_id: existingWorker?.id || null,
        worker: {
          surname, initials, first_names: firstNames, id_number: idNumber, id_type: idType,
          company, job_description: jobDescription, cellphone,
        },
        worker_updates: workerUpdates,
        record: {
          attendance_date: dateStr,
          attendance_time: timeStr,
          attendance_timestamp: ts,
          medical_centre: medicalCentre,
          additional_information: additionalInfo,
          assessment_type: assessmentType,
        },
        signature_data_url: signatureDataUrl,
      });

      onSuccess({
        workerName: formatDisplayName({ surname, initials }),
        attendanceTime: timeStr,
        workerId: res?.worker_id,
      });
    } catch (e) {
      setSaveError("Failed to save attendance. Please try again.");
      saveRef.current = false;
    } finally {
      setSaving(false);
    }
  };

  // ── Validation ────────────────────────────────────────────────────────────
  // Driver's Licence scan without reliable full first names: the operator
  // cannot continue until First Names is completed manually.
  const firstNamesRequired = licenceMissingFirstNames && idType === "drivers_licence" && !firstNames.trim();
  const step2Valid = surname.trim() && idNumber.trim() && company.trim() && jobDescription.trim() && cellphone.trim() && !firstNamesRequired;
  const step4Valid = medicalCentre && assessmentType;

  const goNext = () => {
    if (step === 2 && skipIdDoc) { setStep(4); return; }
    setStep(s => s + 1);
  };
  const goBack = () => {
    if (step === 4 && skipIdDoc) { setStep(2); return; }
    setStep(s => Math.max(1, s - 1));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (showScanner) {
    return (
      <DocumentScanner
        documentType="auto"
        caller="attendance_register"
        onClose={handleManualEntry}
        onAccept={handleScanAccept}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-2">
      <StepIndicator currentStep={step} />

      {/* ── STEP 1: Scan ── */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-white text-xl font-bold">Scan Identification Document</h2>
          <p className="text-slate-400 text-sm">Scan the worker's/patient's South African ID, Driver's Licence or Passport using the Barkoder scanner.</p>
          <Button onClick={() => setShowScanner(true)} variant="brand" className="w-full h-16 text-lg">
            <ScanLine className="w-6 h-6 mr-3" /> Scan Document
          </Button>
          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-700" />
            <span className="text-slate-500 text-xs">or</span>
            <div className="flex-1 h-px bg-slate-700" />
          </div>
          <Button variant="outline" onClick={handleManualEntry} className="w-full h-12 border-slate-600 text-slate-300">
            Enter details manually
          </Button>
          <Button variant="ghost" onClick={onCancel} className="w-full text-slate-500">Cancel</Button>
        </div>
      )}

      {/* ── STEP 2: Worker Details ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-white text-xl font-bold">Worker / Patient Details</h2>
            {existingWorker && <Badge className="bg-amber-500 text-white text-xs">Existing Profile</Badge>}
            {existingWorker === false && <Badge className="bg-[var(--brand-primary)] text-white text-xs">New Worker</Badge>}
          </div>
          {existingWorker && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
              <p className="text-amber-300 text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Existing Worker/Patient Found
              </p>
              <p className="text-slate-300 text-xs mt-1">Profile on file. Review and update any changed details below.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Surname *</label>
              <Input value={surname} onChange={e => setSurname(e.target.value)} placeholder="Surname"
                className="bg-slate-900 border-slate-700 text-white" />
            </div>
            <div>
              <label className="text-slate-400 text-xs mb-1 block">Initials *</label>
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
            <Button variant="outline" onClick={goBack} className="flex-1 border-slate-600 text-slate-300 h-12">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button onClick={goNext} disabled={!step2Valid} variant="brand" className="flex-1 h-12">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 3: ID Document ── */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-white text-xl font-bold">Identification Document</h2>
          {existingWorker && existingWorker.id_front_url && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 space-y-2">
              <p className="text-emerald-300 text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Document on file
              </p>
              {existingWorker.id_captured_at && (
                <p className="text-slate-400 text-xs">
                  Last captured: {new Date(existingWorker.id_captured_at).toLocaleDateString("en-ZA")}
                </p>
              )}
              <div className="flex gap-2">
                <img src={existingWorker.id_front_url} alt="ID Front" className="h-24 rounded-lg object-cover border border-slate-700" />
                {existingWorker.id_back_url && (
                  <img src={existingWorker.id_back_url} alt="ID Back" className="h-24 rounded-lg object-cover border border-slate-700" />
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => { setIdFrontUrl(null); setIdBackUrl(null); }}
                className="border-amber-500/50 text-amber-400 text-xs">
                Replace / Update Document Photos
              </Button>
            </div>
          )}
          {(!existingWorker || !existingWorker.id_front_url || !idFrontUrl) && (
            <IdDocCapture
              idType={idType}
              onComplete={({ frontUrl, backUrl }) => { setIdFrontUrl(frontUrl); setIdBackUrl(backUrl); goNext(); }}
              onSkip={goNext}
            />
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={goBack} className="flex-1 border-slate-600 text-slate-300 h-12">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            {(existingWorker?.id_front_url) && (
              <Button onClick={goNext} variant="brand" className="flex-1 h-12">
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── STEP 4: Attendance Details ── */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-white text-xl font-bold">Attendance Details</h2>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Medical Centre *</label>
            <select value={medicalCentre} onChange={e => setMedicalCentre(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-3 text-sm">
              <option value="">Select Medical Centre…</option>
              {medicalCentres.map(mc => <option key={mc} value={mc}>{mc}</option>)}
            </select>
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Assessment Type *</label>
            <select value={assessmentType} onChange={e => setAssessmentType(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-3 text-sm">
              <option value="">Select Assessment Type…</option>
              {assessmentTypes.map(at => <option key={at} value={at}>{at}</option>)}
            </select>
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Additional Information</label>
            <textarea value={additionalInfo} onChange={e => setAdditionalInfo(e.target.value)}
              placeholder="Any additional notes…" rows={3}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-3 py-2 text-sm resize-none" />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" onClick={goBack} className="flex-1 border-slate-600 text-slate-300 h-12">
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            <Button onClick={goNext} disabled={!step4Valid} variant="brand" className="flex-1 h-12">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* ── STEP 5: Signature ── */}
      {step === 5 && (
        <div className="space-y-4">
          <h2 className="text-white text-xl font-bold">Electronic Signature</h2>
          <AttendanceSignaturePad
            onAccept={(dataUrl) => { setSignatureDataUrl(dataUrl); setStep(6); }}
            onCancel={goBack}
          />
        </div>
      )}

      {/* ── STEP 6: Review & Confirm ── */}
      {step === 6 && (
        <div className="space-y-4">
          <h2 className="text-white text-xl font-bold">Review Attendance</h2>
          <div className="bg-[var(--surface-card)] rounded-2xl border border-[var(--border-default)] divide-y divide-slate-700/50">
            {[
              ["Surname, Initials", `${surname}${initials ? ", " + initials : ""}`],
              ["ID / Passport Number", idNumber],
              ["Document Type", idTypeLabel(idType)],
              ["Company / Customer", company],
              ["Job Description", jobDescription],
              ["Cellphone Number", cellphone],
              ["Medical Centre", medicalCentre],
              ["Assessment Type", assessmentType],
              ["Additional Information", additionalInfo || "—"],
            ].map(([label, val]) => (
              <div key={label} className="flex items-start gap-3 px-4 py-3">
                <span className="text-slate-400 text-sm w-44 shrink-0">{label}</span>
                <span className="text-white text-sm font-medium flex-1">{val || "—"}</span>
              </div>
            ))}
          </div>
          {signatureDataUrl && (
            <div className="bg-[var(--surface-card)] rounded-xl border border-[var(--border-default)] p-3">
              <p className="text-slate-400 text-xs mb-2">Signature Preview</p>
              <img src={signatureDataUrl} alt="Signature" className="h-16 bg-white rounded-lg border border-slate-600" />
            </div>
          )}
          {saveError && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 flex items-center gap-2 text-rose-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" /> {saveError}
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={goBack} disabled={saving} className="flex-1 border-slate-600 text-slate-300 h-12">
              <ChevronLeft className="w-4 h-4 mr-1" /> Edit
            </Button>
            <Button onClick={handleConfirm} disabled={saving} variant="brand" className="flex-1 h-14 text-base">
              {saving ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
              {saving ? "Saving…" : "Confirm Attendance"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}