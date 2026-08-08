import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Car, User, QrCode, LogIn, LogOut, CheckCircle2, XCircle,
  Search, Fingerprint, CreditCard, X, Settings, ShieldCheck,
  MapPin, Calendar, Clock, IdCard, AlertCircle, Home,
} from "lucide-react";
import DocumentScanner from "@/components/documents/DocumentScanner";
import VisitorCard from "@/components/access/VisitorCard";
import PurposeStep from "@/components/access/PurposeStep";
import StepCard from "@/components/access/StepCard";
import { resolveOrCreateVisitor, getGPS, getDeviceDescriptor, countPreviousVisits, findActiveInsideRecords, checkBlacklist } from "@/lib/accessVisitor";
import ExitConfirmModal from "@/components/access/ExitConfirmModal";
import OverrideModal from "@/components/access/OverrideModal";
import { can, PERMISSIONS } from "@/lib/permissions";

const MODES = [
  { id: "vehicle", label: "Vehicle Entry", icon: Car, desc: "Licence → Disc → Visit/Work" },
  { id: "pedestrian", label: "Pedestrian Entry", icon: User, desc: "ID / Licence → Visit/Work" },
  { id: "qr", label: "QR Pass", icon: QrCode, desc: "Resident / Visitor QR" },
];

const GATES = ["Main Gate", "Secondary Gate", "Pedestrian Gate", "Delivery Gate", "Emergency Gate"];
const eventBg = { entry: "bg-emerald-500/10 border-emerald-500/30", exit: "bg-amber-500/10 border-amber-500/30", denied: "bg-rose-500/10 border-rose-500/30" };
const eventBadge = { entry: "bg-emerald-600", exit: "bg-amber-600", denied: "bg-rose-600" };

// Evaluate an expected-visitor pass against its status + validity window.
// Returns { valid: boolean, label?, message? }.
function evaluateVisitorPass(visitor) {
  if (!visitor) {
    return { valid: false, label: "UNKNOWN OR INVALID VISITOR PASS", message: "QR decoded but no matching active visitor record was found." };
  }
  const now = Date.now();
  if (visitor.status === "denied") {
    return { valid: false, label: "VISITOR PASS CANCELLED", message: "This visitor pass was cancelled by the host." };
  }
  if (visitor.status === "expired") {
    return { valid: false, label: "VISITOR PASS EXPIRED", message: "This visitor pass has expired." };
  }
  if (visitor.status === "entered") {
    return { valid: false, label: "VISITOR PASS ALREADY USED", message: "This visitor has already entered the estate." };
  }
  if (visitor.status === "exited") {
    return { valid: false, label: "VISITOR PASS ALREADY USED", message: "This visitor has already entered and exited the estate." };
  }
  if (visitor.valid_until && new Date(visitor.valid_until).getTime() < now) {
    return { valid: false, label: "VISITOR PASS EXPIRED", message: `This pass expired on ${new Date(visitor.valid_until).toLocaleString("en-ZA")}.` };
  }
  // A pass is "not yet valid" only if its expected calendar date is strictly
  // in the future. Same-day early arrivals are allowed — the expected arrival
  // time is informational, not a hard gate (a visitor arriving before their
  // ETA is normal and must still see their visitor details card).
  if (visitor.valid_from) {
    const vf = new Date(visitor.valid_from);
    const startOfValidFrom = new Date(vf.getFullYear(), vf.getMonth(), vf.getDate());
    const startOfToday = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate());
    if (startOfValidFrom.getTime() > startOfToday.getTime()) {
      return { valid: false, label: "VISITOR PASS NOT YET VALID", message: `This pass is valid from ${new Date(visitor.valid_from).toLocaleString("en-ZA")}.` };
    }
  }
  return { valid: true };
}

export default function AccessControl() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState(null);
  const [step, setStep] = useState("idle");
  const [scanning, setScanning] = useState(false);
  const [scanProfile, setScanProfile] = useState("auto");
  const [gate, setGate] = useState("Main Gate");
  const [eventType, setEventType] = useState("entry");
  const [pendingVisitor, setPendingVisitor] = useState(null);
  const [pendingMeta, setPendingMeta] = useState(null);
  const [licenceScan, setLicenceScan] = useState(null);
  const [discFields, setDiscFields] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeRecord, setActiveRecord] = useState(null);
  const [exitCandidates, setExitCandidates] = useState([]);
  const [manualExitTarget, setManualExitTarget] = useState(null);
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [qrVisitor, setQrVisitor] = useState(null);
  const [qrPayload, setQrPayload] = useState(null);
  const [qrStatus, setQrStatus] = useState(null);
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser).catch(() => {}); }, []);

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["access_logs_recent"],
    queryFn: () => base44.entities.AccessLog.list("-timestamp", 30),
    refetchInterval: 10000,
  });
  useEffect(() => {
    const unsub = base44.entities.AccessLog.subscribe(() => qc.invalidateQueries(["access_logs_recent"]));
    return unsub;
  }, []);

  const { data: destinations = [] } = useQuery({
    queryKey: ["destinations"],
    queryFn: () => base44.entities.Destination.list(),
  });
  const { data: workTypes = [] } = useQuery({
    queryKey: ["work_types"],
    queryFn: () => base44.entities.WorkType.list(),
  });

  const resetWorkflow = () => {
    setMode(null); setStep("idle"); setPendingVisitor(null); setPendingMeta(null);
    setLicenceScan(null); setDiscFields(null);
    setActiveRecord(null); setExitCandidates([]);
    setQrVisitor(null); setQrPayload(null);
    setQrStatus(null);
  };

  const startMode = (m) => {
    resetWorkflow(); setResult(null);
    setMode(m);
    setStep(m === "vehicle" ? "licence" : m === "pedestrian" ? "id" : "qr");
  };

  const openScanner = (profileId) => { setScanProfile(profileId); setScanning(true); };

  // Exit flow: resolve the visitor, then find their active "inside" record(s).
  const beginExitForVisitor = async (visitor, scan) => {
    const candidates = await findActiveInsideRecords(visitor?.id);
    setLicenceScan(scan);
    if (!candidates.length) {
      setResult({
        flagged: true, flag_reason: "No active entry found for this visitor",
        person_name: visitor?.visitor_name || "Unknown", person_type: "visitor",
        event_type: "exit", status: "denied", gate_name: gate, timestamp: new Date().toISOString(),
      });
      resetWorkflow();
      setTimeout(() => setResult(null), 6000);
      return;
    }
    if (candidates.length === 1) { setActiveRecord(candidates[0]); setStep("confirm_exit"); }
    else { setExitCandidates(candidates); setStep("pick_exit"); }
  };

  const onScanAccept = async (scan) => {
    setScanning(false);
    setBusy(true);
    try {
      // ---- EXIT BY RESCAN ---- branch before the entry workflow.
      if (eventType === "exit") {
        if (step === "qr") { await handleQR(scan); return; }
        const mapped = scan.mappedFields || {};
        const { visitor } = await resolveOrCreateVisitor({ mapped, photoUrl: scan.photoUrl, scan, createIfMissing: false });
        setPendingVisitor(visitor);
        if (!visitor?.id) {
          setResult({
            flagged: true, flag_reason: "Visitor not recognised — cannot exit",
            person_name: "Unknown", person_type: "unknown",
            event_type: "exit", status: "denied", gate_name: gate, timestamp: new Date().toISOString(),
          });
          resetWorkflow();
          setTimeout(() => setResult(null), 6000);
          return;
        }
        await beginExitForVisitor(visitor, scan);
        return;
      }

      // ---- ENTRY / DENY ---- (original workflow)
      if (step === "licence" || step === "id") {
        const mapped = scan.mappedFields || {};
        const { visitor, created } = await resolveOrCreateVisitor({ mapped, photoUrl: scan.photoUrl, scan });
        const previous = await countPreviousVisits(visitor?.id);
        setPendingVisitor(visitor);
        setPendingMeta({ created, previous });
        setLicenceScan(scan);
        setStep(mode === "vehicle" ? "disc" : "purpose");
      } else if (step === "disc") {
        const disc = scan.mappedFields || {};
        if (disc.registration_number) {
          try {
            await base44.entities.VehicleLicenceDisc.create({
              registration_number: disc.registration_number,
              vin: disc.vin || "", engine_number: disc.engine_number || "",
              licence_number: disc.licence_number || "", make: disc.make || "",
              model: disc.model || "", colour: disc.colour || "",
              expiry_date: disc.expiry_date || "", owner: disc.owner || "",
              province: disc.province || "",
              raw_scan_json: scan.result?.formattedJSONRaw || scan.result?.textualData || "",
              scan_timestamp: new Date().toISOString(),
              scanned_by_id: user?.id, scanned_by_name: user?.full_name,
              related_visitor_id: pendingVisitor?.id || "",
            });
          } catch (e) { console.warn("[access] vehicle disc create failed", e?.message || e); }
        }
        setDiscFields(disc);
        setStep("purpose");
      } else if (step === "qr") {
        await handleQR(scan);
      }
    } catch (e) {
      console.error("[access] scan accept failed", e);
    } finally {
      setBusy(false);
    }
  };

  const handleQR = async (scan) => {
    // The QR contains ONLY a unique visitor/pass token (e.g. VSTMSKUUVX3J5N0) —
    // not structured data. Look that token up against the Visitor table.
    const payload = (scan.result?.textualData || "").trim();
    let visitor = null;
    if (payload) {
      try { const m = await base44.entities.Visitor.filter({ qr_code: payload }); if (m.length) visitor = m[0]; } catch (_) {}
      if (!visitor) { try { const m = await base44.entities.Visitor.filter({ otp_code: payload }); if (m.length) visitor = m[0]; } catch (_) {} }
      // Case-insensitive fallback — guards against any casing mismatch between
      // the stored token and the decoded QR payload.
      if (!visitor) {
        try {
          const recent = await base44.entities.Visitor.list("-created_date", 200);
          const pnorm = payload.toUpperCase();
          visitor = recent.find((v) =>
            (v.qr_code || "").toUpperCase() === pnorm ||
            (v.otp_code || "").toUpperCase() === pnorm
          ) || null;
        } catch (_) {}
      }
    }

    // EXIT by QR: resolve active inside record(s) for the matched visitor
    if (eventType === "exit") {
      if (!visitor) {
        setQrStatus({ label: "UNKNOWN OR INVALID VISITOR PASS", message: `QR token "${payload}" decoded but no matching visitor record was found. Cannot process exit.` });
        setStep("qr_invalid");
        return;
      }
      await beginExitForVisitor(visitor, scan);
      return;
    }

    // ENTRY by QR
    setLicenceScan(scan);
    setQrPayload(payload);
    if (!visitor) {
      setQrStatus({ label: "UNKNOWN OR INVALID VISITOR PASS", message: `The QR token "${payload}" was scanned successfully, but no matching Expected Visitor record was found in the database.` });
      setStep("qr_invalid");
      return;
    }
    const pass = evaluateVisitorPass(visitor);
    if (!pass.valid) {
      setQrStatus(pass);
      setStep("qr_invalid");
      return;
    }
    // Blacklist pre-check (person by SA ID + vehicle by registration)
    const blMatch = await checkBlacklist({
      saId: visitor.visitor_id_number,
      vehicleReg: visitor.vehicle_registration,
    });
    if (blMatch) {
      setQrVisitor(visitor);
      setQrStatus({
        label: "ACCESS DENIED — BLACKLISTED",
        message: `${visitor.visitor_name}${visitor.surname ? " " + visitor.surname : ""} is on the blacklist (${(blMatch.reason || "other").replace(/_/g, " ")}). Entry is blocked. A supervisor override is required to proceed.`,
      });
      setStep("qr_invalid");
      return;
    }
    setPendingVisitor(visitor);
    setQrVisitor(visitor);
    setStep("qr_confirm");
  };

  const confirmQrEntry = () => finalizeEntry({ purpose: "none", destination: qrVisitor?.destination || "", workType: "", visitor: qrVisitor, scan: licenceScan, qrPayload });
  const denyQrEntry = () => finalizeEntry({ purpose: "none", destination: qrVisitor?.destination || "", workType: "", visitor: qrVisitor, scan: licenceScan, qrPayload, denied: true });
  const scanAgain = () => { setQrStatus(null); setQrVisitor(null); setQrPayload(null); setStep("qr"); openScanner("qr"); };

  const onApprove = (purpose, { destination, workType }) => {
    finalizeEntry({ purpose, destination, workType, visitor: pendingVisitor, scan: licenceScan });
  };

  const confirmExit = () => { if (activeRecord) finalizeExit(activeRecord, { scan: licenceScan }); };
  const pickExitRecord = (rec) => { setActiveRecord(rec); setExitCandidates([]); setStep("confirm_exit"); };

  // Exit = UPDATE the active record (status inside → exited). No duplicate log.
  const finalizeExit = async (activeLog, { scan, manual } = {}) => {
    setBusy(true);
    try {
      const gps = await getGPS();
      const now = new Date().toISOString();
      const entryTime = activeLog.entry_time || activeLog.timestamp;
      const mins = Math.max(0, Math.round((Date.now() - new Date(entryTime).getTime()) / 60000));
      const sm = manual ? "manual"
        : scan?.resolvedProfileId === "qr" ? "qr_code"
        : scan?.resolvedProfileId === "sa_id" ? "sa_id"
        : scan?.resolvedProfileId === "vehicle_disc" ? "vehicle_disc"
        : "drivers_licence";
      const update = {
        status: "exited",
        event_type: "exit",
        exit_time: now,
        exit_gate: gate,
        exit_guard_id: user?.id,
        exit_guard_name: user?.full_name,
        exit_scan_method: sm,
        exit_location: gps,
        exit_notes: manual ? "Manually exited from live log" : "",
        time_on_site_minutes: mins,
      };
      await base44.entities.AccessLog.update(activeLog.id, update);
      if (activeLog.visitor_id) {
        try { await base44.entities.Visitor.update(activeLog.visitor_id, { status: "exited", exited_at: now }); } catch (_) {}
      }
      setResult({ ...activeLog, ...update, person_name: activeLog.person_name });
      resetWorkflow();
      qc.invalidateQueries(["access_logs_recent"]);
      setTimeout(() => setResult(null), 8000);
    } catch (e) {
      console.error("[access] finalize exit failed", e);
    } finally {
      setBusy(false);
    }
  };

  // Entry = CREATE a new record with status "inside" (or "denied").
  const finalizeEntry = async ({ purpose, destination, workType, visitor, scan, qrPayload, denied }) => {
    setBusy(true);
    try {
      const mapped = scan?.mappedFields || licenceScan?.mappedFields || {};
      const disc = discFields || {};
      const gps = await getGPS();
      const device = getDeviceDescriptor();
      const v = visitor || pendingVisitor;
      const personType = v ? "visitor" : "unknown";
      const now = new Date().toISOString();
      const blacklist = await checkBlacklist({
        saId: v?.visitor_id_number || mapped.visitor_id_number,
        driverLicence: mapped.driver_licence_number,
        vehicleReg: v?.vehicle_registration || disc.registration_number,
      });
      const isBlacklisted = !!blacklist;
      const isDenied = !!denied || isBlacklisted;
      const log = {
        event_type: isDenied ? "denied" : "entry",
        status: isBlacklisted ? "blacklisted" : (denied ? "denied" : "inside"),
        person_type: personType,
        person_id: v?.id || "",
        person_name: v?.visitor_name ? (v.surname ? `${v.visitor_name} ${v.surname}` : v.visitor_name) : "Unknown",
        visitor_id: v?.id || "",
        unit_number: v?.unit_number || "",
        gate_name: gate,
        scan_method: denied ? "qr_code" : (scan?.resolvedProfileId === "qr" ? "qr_code" : scan?.resolvedProfileId === "sa_id" ? "sa_id" : scan?.resolvedProfileId === "vehicle_disc" ? "vehicle_disc" : "drivers_licence"),
        scanned_data: qrPayload || scan?.result?.textualData || "",
        qr_code: qrPayload || "",
        driver_licence_number: mapped.driver_licence_number || "",
        sa_id_number: v?.visitor_id_number || mapped.visitor_id_number || "",
        vehicle_registration: disc.registration_number || v?.vehicle_registration || "",
        vehicle_licence_disc_number: disc.licence_number || "",
        vehicle_vin: disc.vin || "",
        vehicle_make: disc.make || "",
        vehicle_model: disc.model || "",
        vehicle_colour: disc.colour || "",
        vehicle_licence_number: disc.licence_number || "",
        destination: destination || v?.destination || "",
        visitor_type: v?.visitor_entry_type || "",
        visit_or_work: purpose || "none",
        work_type: workType || "",
        parsed_json: scan?.result?.formattedJSONRaw || licenceScan?.result?.formattedJSONRaw || "",
        confidence: (scan?.result?.parsed || licenceScan?.result?.parsed) ? 100 : 40,
        device,
        photo_url: scan?.photoUrl || licenceScan?.photoUrl || "",
        location: gps,
        entry_time: now,
        exit_time: null,
        time_on_site_minutes: null,
        timestamp: now,
        guard_id: user?.id,
        guard_name: user?.full_name,
        flagged: isDenied,
        flag_reason: isBlacklisted ? `Blacklisted: ${blacklist.reason}` : (denied ? "QR not recognised" : ""),
        blacklist_match_id: isBlacklisted ? blacklist.id : "",
        notes: "",
      };
      const created = await base44.entities.AccessLog.create(log);
      if (v?.id && !isDenied) {
        try { await base44.entities.Visitor.update(v.id, { status: "entered", entered_at: now }); } catch (_) {}
      }
      setResult({ ...log, id: created?.id });
      resetWorkflow();
      qc.invalidateQueries(["access_logs_recent"]);
      setTimeout(() => setResult(null), 8000);
    } catch (e) {
      console.error("[access] finalize failed", e);
    } finally {
      setBusy(false);
    }
  };

  const filteredLogs = recentLogs.filter((log) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.person_name?.toLowerCase().includes(q) ||
      log.gate_name?.toLowerCase().includes(q) ||
      log.scan_method?.toLowerCase().includes(q) ||
      log.vehicle_registration?.toLowerCase().includes(q) ||
      log.driver_licence_number?.toLowerCase().includes(q) ||
      log.sa_id_number?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-24">
      {scanning && (
        <DocumentScanner
          documentType={scanProfile}
          caller="access_control"
          onClose={() => setScanning(false)}
          onAccept={onScanAccept}
          autoAccept={scanProfile === "qr"}
        />
      )}

      <div className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Access Control</h1>
              <p className="text-slate-400 text-xs">Guarded Entry & Exit</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-emerald-400 text-xs font-medium">LIVE</span>
            </div>
            <Link to="/AccessSettings" className="w-9 h-9 bg-slate-800 rounded-xl flex items-center justify-center text-slate-300">
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {/* Gate + Event controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs mb-1.5 block font-medium">Gate Point</label>
            <Select value={gate} onValueChange={setGate}>
              <SelectTrigger className="bg-slate-800/80 border-slate-700 text-white h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GATES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1.5 block font-medium">Event Type</label>
            <div className="flex gap-2">
              <button
                onClick={() => setEventType("entry")}
                className={`flex-1 h-11 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold transition-all ${
                  eventType === "entry" ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/30" : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                <LogIn className="w-4 h-4" /> IN
              </button>
              <button
                onClick={() => setEventType("exit")}
                className={`flex-1 h-11 rounded-lg flex items-center justify-center gap-1.5 text-sm font-semibold transition-all ${
                  eventType === "exit" ? "bg-amber-500 text-white shadow-lg shadow-amber-500/30" : "bg-slate-800 text-slate-400 border border-slate-700"
                }`}
              >
                <LogOut className="w-4 h-4" /> OUT
              </button>
            </div>
          </div>
        </div>

        {/* Mode selection */}
        {!mode && (
          <div className="flex gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => startMode(m.id)}
                className="min-w-[240px] shrink-0 sm:min-w-0 rounded-2xl border-2 border-dashed border-sky-500/40 bg-sky-500/5 hover:border-sky-400/70 hover:bg-sky-500/10 p-4 flex flex-col items-center gap-2 transition-all active:scale-95"
              >
                <div className="w-11 h-11 rounded-full bg-sky-500/20 flex items-center justify-center">
                  <m.icon className="w-6 h-6 text-sky-400" />
                </div>
                <span className="text-white font-semibold text-sm">{m.label}</span>
                <span className="text-slate-500 text-xs text-center">{m.desc}</span>
              </button>
            ))}
          </div>
        )}

        {/* Workflow panel */}
        {mode && (
          <div className="rounded-2xl border border-slate-700/50 bg-slate-800/40 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className="bg-slate-700 capitalize">{mode}</Badge>
                <span className="text-slate-400 text-xs">Step: <span className="text-slate-200">{step}</span></span>
              </div>
              <button onClick={resetWorkflow} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            {mode === "vehicle" && step === "licence" && (
              <StepCard icon={Fingerprint} title="Step 1 — Scan Driver's Licence" subtitle="Back of card, PDF417 barcode" onScan={() => openScanner("drivers_licence")} busy={busy} />
            )}

            {mode === "pedestrian" && step === "id" && (
              <div className="space-y-3">
                <p className="text-slate-300 text-sm font-medium">Scan SA ID Card / Book or Driver's Licence</p>
                <div className="grid grid-cols-2 gap-3">
                  <StepCard icon={CreditCard} title="SA ID" onScan={() => openScanner("sa_id")} busy={busy} />
                  <StepCard icon={Fingerprint} title="Driver's Licence" onScan={() => openScanner("drivers_licence")} busy={busy} />
                </div>
              </div>
            )}

            {pendingVisitor && step !== "qr" && (
              <VisitorCard visitor={pendingVisitor} meta={pendingMeta} photoUrl={licenceScan?.photoUrl} />
            )}

            {mode === "vehicle" && step === "disc" && (
              <div className="space-y-3">
                <StepCard icon={Car} title="Step 2 — Scan Vehicle Licence Disc" subtitle="Disc PDF417 barcode" onScan={() => openScanner("vehicle_disc")} busy={busy} />
                {discFields && (
                  <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3 text-xs space-y-1">
                    <p className="text-slate-300 font-semibold">{discFields.registration_number || "—"}</p>
                    <p className="text-slate-400">{[discFields.make, discFields.model].filter(Boolean).join(" ") || "—"}</p>
                    {discFields.vin && <p className="text-slate-500 font-mono">VIN: {discFields.vin}</p>}
                    {discFields.expiry_date && <p className="text-slate-500">Expiry: {discFields.expiry_date}</p>}
                  </div>
                )}
              </div>
            )}

            {step === "purpose" && (
              <div className="space-y-3">
                <p className="text-slate-300 text-sm font-medium">
                  Step {mode === "vehicle" ? 3 : 2} — Visit or Work?
                </p>
                <PurposeStep
                  destinations={destinations}
                  workTypes={workTypes}
                  onApprove={onApprove}
                  busy={busy}
                  eventType={eventType}
                />
              </div>
            )}

            {mode === "qr" && step === "qr" && (
              <StepCard icon={QrCode} title="Scan QR Code" subtitle="Expected visitor pass" onScan={() => openScanner("qr")} busy={busy} />
            )}

            {step === "qr_invalid" && qrStatus && (
              <div className="space-y-3">
                <div className="rounded-2xl border-2 border-rose-500/60 bg-rose-500/10 p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-rose-500/20 flex items-center justify-center shrink-0">
                      <XCircle className="w-7 h-7 text-rose-400" />
                    </div>
                    <div>
                      <p className="text-rose-300 font-bold text-sm uppercase tracking-wide">{qrStatus.label}</p>
                      {qrPayload && <p className="text-slate-400 text-xs font-mono mt-0.5">Scanned: {qrPayload}</p>}
                    </div>
                  </div>
                  <p className="text-slate-300 text-sm">{qrStatus.message}</p>
                </div>
                <p className="text-slate-400 text-xs">Normal Expected Visitor entry is not allowed for this pass.</p>
                <div className="flex gap-3">
                  <Button onClick={scanAgain} disabled={busy} className="flex-1 h-12 bg-sky-600 hover:bg-sky-700">
                    <QrCode className="w-5 h-5 mr-2" /> Scan Again
                  </Button>
                  <Button onClick={resetWorkflow} disabled={busy} variant="outline" className="flex-1 h-12 border-slate-600 text-slate-300">
                    <X className="w-5 h-5 mr-2" /> Cancel
                  </Button>
                </div>
              </div>
            )}

            {step === "qr_confirm" && qrVisitor && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-emerald-300 text-sm font-semibold">
                  <CheckCircle2 className="w-5 h-5" /> EXPECTED VISITOR FOUND
                </div>
                <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    {licenceScan?.photoUrl
                      ? <img src={licenceScan.photoUrl} alt="visitor" className="w-16 h-20 rounded-lg object-cover border border-slate-600" />
                      : <div className="w-16 h-20 rounded-lg bg-slate-800 border border-slate-600 flex items-center justify-center"><User className="w-7 h-7 text-slate-500" /></div>}
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-bold text-lg truncate">{qrVisitor.visitor_name} {qrVisitor.surname ? qrVisitor.surname : ""}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge className={qrVisitor.visitor_entry_type === "vehicle" ? "bg-sky-600" : "bg-emerald-600"}>
                          {qrVisitor.visitor_entry_type === "vehicle" ? "VEHICLE VISITOR" : "PEDESTRIAN VISITOR"}
                        </Badge>
                        <Badge variant="outline" className="border-emerald-500/50 text-emerald-300 capitalize">{qrVisitor.status}</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 text-sm pt-1">
                    {qrVisitor.visitor_id_number && <p className="flex items-center gap-2 text-slate-300"><IdCard className="w-4 h-4 text-slate-400" /> ID: <span className="font-mono">{qrVisitor.visitor_id_number}</span></p>}
                    {qrVisitor.visitor_entry_type === "vehicle" && qrVisitor.vehicle_registration && (
                      <p className="flex items-center gap-2 text-slate-300"><Car className="w-4 h-4 text-sky-400" /> Vehicle: <span className="font-semibold text-white uppercase">{qrVisitor.vehicle_registration}</span></p>
                    )}
                    {qrVisitor.resident_name && <p className="flex items-center gap-2 text-slate-300"><Home className="w-4 h-4 text-slate-400" /> Host: <span className="text-white">{qrVisitor.resident_name}</span>{qrVisitor.unit_number ? ` (Unit ${qrVisitor.unit_number})` : ""}</p>}
                  </div>
                  {qrVisitor.destination && (
                    <div className="rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-2 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <p className="text-amber-300 text-xs uppercase tracking-wide font-semibold">Destination</p>
                        <p className="text-white font-semibold">{qrVisitor.destination}</p>
                      </div>
                    </div>
                  )}
                  {qrVisitor.expected_date && (
                    <p className="flex items-center gap-2 text-slate-400 text-xs"><Calendar className="w-3.5 h-3.5" /> Expected {new Date(`${qrVisitor.expected_date}T${qrVisitor.expected_arrival_time || "00:00"}:00`).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</p>
                  )}
                  {qrVisitor.valid_until && (
                    <p className="flex items-center gap-2 text-slate-400 text-xs"><Clock className="w-3.5 h-3.5" /> Valid until {new Date(qrVisitor.valid_until).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</p>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button onClick={confirmQrEntry} disabled={busy} className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                    <ShieldCheck className="w-5 h-5 mr-2" /> Confirm Entry
                  </Button>
                  <Button onClick={denyQrEntry} disabled={busy} variant="outline" className="flex-1 h-12 border-rose-500/40 text-rose-400 hover:bg-rose-500/10">
                    <XCircle className="w-5 h-5 mr-2" /> Deny
                  </Button>
                </div>
              </div>
            )}

            {step === "pick_exit" && (
              <div className="space-y-3">
                <p className="text-amber-300 text-sm font-medium">Multiple active entries found — select the one being exited</p>
                <div className="space-y-2">
                  {exitCandidates.map((rec) => (
                    <button key={rec.id} onClick={() => pickExitRecord(rec)}
                      className="w-full text-left rounded-xl border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 p-3 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">{rec.person_name || "Unknown"}</p>
                        <p className="text-slate-400 text-xs truncate">{rec.gate_name} • entered {new Date(rec.entry_time || rec.timestamp).toLocaleTimeString()}</p>
                        {rec.vehicle_registration && <p className="text-slate-500 text-xs">{rec.vehicle_registration}</p>}
                      </div>
                      <LogOut className="w-4 h-4 text-amber-400 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === "confirm_exit" && activeRecord && (
              <div className="space-y-3">
                {pendingVisitor && <VisitorCard visitor={pendingVisitor} meta={pendingMeta} photoUrl={licenceScan?.photoUrl} />}
                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 space-y-1">
                  <p className="text-amber-200 text-xs font-semibold uppercase tracking-wide">Active entry to close</p>
                  <p className="text-white text-sm font-medium">{activeRecord.person_name || "Unknown"}</p>
                  <p className="text-slate-300 text-xs">{activeRecord.gate_name} • entered {new Date(activeRecord.entry_time || activeRecord.timestamp).toLocaleString()}</p>
                  {activeRecord.vehicle_registration && <p className="text-slate-400 text-xs">Vehicle: {activeRecord.vehicle_registration}</p>}
                  <p className="text-emerald-400 text-sm font-semibold">
                    On site: {Math.max(0, Math.round((Date.now() - new Date(activeRecord.entry_time || activeRecord.timestamp).getTime()) / 60000))} min
                  </p>
                </div>
                <Button onClick={confirmExit} disabled={busy} className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-white font-semibold">
                  <LogOut className="w-5 h-5 mr-2" /> Confirm Exit
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <div className={`border-2 rounded-2xl p-4 flex items-center gap-4 ${result.flagged ? "border-rose-500 bg-rose-500/10" : "border-emerald-500 bg-emerald-500/10"}`}>
                <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${result.flagged ? "bg-rose-500/20" : "bg-emerald-500/20"}`}>
                  {result.flagged ? <XCircle className="w-7 h-7 text-rose-400" /> : <CheckCircle2 className="w-7 h-7 text-emerald-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white font-bold truncate">{result.person_name || "Unknown"}</p>
                  <p className="text-slate-300 text-sm capitalize">{result.person_type} • {result.event_type} logged</p>
                  {result.destination && <p className="text-slate-400 text-xs">Destination: {result.destination}</p>}
                  {result.work_type && <p className="text-slate-400 text-xs">Work: {result.work_type}</p>}
                  {result.vehicle_registration && <p className="text-slate-400 text-xs">Vehicle: {result.vehicle_registration}</p>}
                  {result.flag_reason && <p className="text-rose-300 text-xs font-medium">{result.flag_reason}</p>}
                  <p className="text-slate-500 text-xs">{result.gate_name} • {new Date(result.timestamp).toLocaleTimeString()}</p>
                </div>
                <Badge className={`${eventBadge[result.event_type] || "bg-slate-600"} shrink-0`}>{result.event_type.toUpperCase()}</Badge>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Live logs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold">Live Access Log</h2>
            <Link to="/AccessHistory" className="text-xs text-sky-400 font-medium">View all →</Link>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input
              placeholder="Search name, reg, ID…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 bg-slate-800 border-slate-700 text-white text-sm"
            />
          </div>
          <div className="space-y-2">
            {filteredLogs.slice(0, 8).map((log) => {
              const inside = log.status === "inside";
              const canExit = inside && can(user, PERMISSIONS.ACCESS_MANUAL_EXIT);
              return (
                <div
                  key={log.id}
                  className={`border rounded-xl p-3 flex items-center justify-between ${eventBg[log.event_type] || "bg-slate-800/50 border-slate-700/50"} ${inside ? "ring-1 ring-amber-500/40" : ""}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {log.photo_url
                      ? <img src={log.photo_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                      : <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-slate-300" /></div>}
                    <div className="min-w-0">
                      <p className="text-white text-sm font-medium truncate">{log.person_name || "Unknown"}</p>
                      <p className="text-slate-400 text-xs truncate">
                        {log.gate_name} • {new Date(log.timestamp).toLocaleTimeString()}
                        {log.destination ? ` • → ${log.destination}` : ""}
                        {log.scan_method && log.scan_method !== "qr_code" ? ` • ${log.scan_method}` : ""}
                        {log.vehicle_registration ? ` • ${log.vehicle_registration}` : ""}
                        {log.time_on_site_minutes != null && log.status === "exited" ? ` • ${log.time_on_site_minutes}m` : ""}
                      </p>
                    </div>
                  </div>
                  {log.status === "blacklisted" && can(user, PERMISSIONS.BLACKLIST_OVERRIDE) ? (
                    <button
                      onClick={() => setOverrideTarget(log)}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-500 text-white"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" /> Override
                    </button>
                  ) : inside ? (
                    <button
                      onClick={() => canExit && setManualExitTarget(log)}
                      disabled={!canExit}
                      className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold ${canExit ? "bg-amber-500 text-white" : "bg-slate-700 text-slate-400 cursor-not-allowed"}`}
                    >
                      <LogOut className="w-3.5 h-3.5" /> Exit
                    </button>
                  ) : (
                    <Badge className={`${eventBadge[log.event_type] || "bg-slate-600"} shrink-0 text-xs`}>{log.event_type}</Badge>
                  )}
                </div>
              );
            })}
            {filteredLogs.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No access logs yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {manualExitTarget && (
        <ExitConfirmModal
          target={manualExitTarget}
          busy={busy}
          onClose={() => setManualExitTarget(null)}
          onConfirm={() => {
            const target = manualExitTarget;
            setManualExitTarget(null);
            finalizeExit(target, { manual: true });
          }}
        />
      )}

      {overrideTarget && (
        <OverrideModal
          target={overrideTarget}
          onClose={() => setOverrideTarget(null)}
          onDone={() => { setOverrideTarget(null); qc.invalidateQueries(["access_logs_recent"]); }}
        />
      )}
    </div>
  );
}