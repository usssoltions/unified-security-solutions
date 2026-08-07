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
  Search, Fingerprint, CreditCard, X, Settings,
} from "lucide-react";
import DocumentScanner from "@/components/documents/DocumentScanner";
import VisitorCard from "@/components/access/VisitorCard";
import PurposeStep from "@/components/access/PurposeStep";
import StepCard from "@/components/access/StepCard";
import { resolveOrCreateVisitor, getGPS, getDeviceDescriptor, countPreviousVisits } from "@/lib/accessVisitor";

const MODES = [
  { id: "vehicle", label: "Vehicle Entry", icon: Car, desc: "Licence → Disc → Visit/Work" },
  { id: "pedestrian", label: "Pedestrian Entry", icon: User, desc: "ID / Licence → Visit/Work" },
  { id: "qr", label: "QR Pass", icon: QrCode, desc: "Resident / Visitor QR" },
];

const GATES = ["Main Gate", "Secondary Gate", "Pedestrian Gate", "Delivery Gate", "Emergency Gate"];
const eventBg = { entry: "bg-emerald-500/10 border-emerald-500/30", exit: "bg-amber-500/10 border-amber-500/30", denied: "bg-rose-500/10 border-rose-500/30" };
const eventBadge = { entry: "bg-emerald-600", exit: "bg-amber-600", denied: "bg-rose-600" };

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
  };

  const startMode = (m) => {
    resetWorkflow(); setResult(null);
    setMode(m);
    setStep(m === "vehicle" ? "licence" : m === "pedestrian" ? "id" : "qr");
  };

  const openScanner = (profileId) => { setScanProfile(profileId); setScanning(true); };

  const onScanAccept = async (scan) => {
    setScanning(false);
    setBusy(true);
    try {
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
    const payload = scan.result?.textualData || "";
    let visitor = null;
    try { const m = await base44.entities.Visitor.filter({ otp_code: payload }); if (m.length) visitor = m[0]; } catch (_) {}
    if (!visitor) { try { const m = await base44.entities.Visitor.filter({ qr_code: payload }); if (m.length) visitor = m[0]; } catch (_) {} }
    if (visitor) {
      await finalize({ purpose: "none", destination: "", workType: "", visitor, scan, qrPayload: payload });
    } else {
      await finalize({ purpose: "none", destination: "", workType: "", visitor: null, scan, qrPayload: payload, denied: true });
    }
  };

  const onApprove = (purpose, { destination, workType }) => {
    finalize({ purpose, destination, workType, visitor: pendingVisitor, scan: licenceScan });
  };

  const finalize = async ({ purpose, destination, workType, visitor, scan, qrPayload, denied }) => {
    setBusy(true);
    try {
      const mapped = scan?.mappedFields || licenceScan?.mappedFields || {};
      const disc = discFields || {};
      const gps = await getGPS();
      const device = getDeviceDescriptor();
      const v = visitor || pendingVisitor;
      const personType = v ? "visitor" : "unknown";
      let entryTime = eventType === "entry" ? new Date().toISOString() : null;
      let exitTime = eventType === "exit" ? new Date().toISOString() : null;
      let timeOnSite = null;
      if (eventType === "exit" && v?.id) {
        try {
          const entries = await base44.entities.AccessLog.filter({ visitor_id: v.id, event_type: "entry" });
          const last = entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
          if (last) {
            const mins = Math.round((Date.now() - new Date(last.timestamp).getTime()) / 60000);
            if (mins > 0) { timeOnSite = mins; entryTime = last.timestamp; }
          }
        } catch (_) {}
      }
      const log = {
        event_type: denied ? "denied" : eventType,
        person_type: personType,
        person_id: v?.id || "",
        person_name: v?.visitor_name || "Unknown",
        visitor_id: v?.id || "",
        unit_number: v?.unit_number || "",
        gate_name: gate,
        scan_method: denied ? "qr_code" : (scan?.resolvedProfileId === "qr" ? "qr_code" : scan?.resolvedProfileId === "sa_id" ? "sa_id" : scan?.resolvedProfileId === "vehicle_disc" ? "vehicle_disc" : "drivers_licence"),
        scanned_data: qrPayload || scan?.result?.textualData || "",
        qr_code: qrPayload || "",
        driver_licence_number: mapped.driver_licence_number || "",
        sa_id_number: mapped.visitor_id_number || "",
        vehicle_registration: disc.registration_number || "",
        vehicle_licence_disc_number: disc.licence_number || "",
        vehicle_vin: disc.vin || "",
        vehicle_make: disc.make || "",
        vehicle_model: disc.model || "",
        vehicle_colour: disc.colour || "",
        vehicle_licence_number: disc.licence_number || "",
        destination: destination || "",
        visit_or_work: purpose || "none",
        work_type: workType || "",
        parsed_json: scan?.result?.formattedJSONRaw || licenceScan?.result?.formattedJSONRaw || "",
        confidence: (scan?.result?.parsed || licenceScan?.result?.parsed) ? 100 : 40,
        device,
        photo_url: scan?.photoUrl || licenceScan?.photoUrl || "",
        location: gps,
        entry_time: entryTime,
        exit_time: exitTime,
        time_on_site_minutes: timeOnSite,
        timestamp: new Date().toISOString(),
        guard_id: user?.id,
        guard_name: user?.full_name,
        flagged: !!denied,
        flag_reason: denied ? "QR not recognised" : "",
        notes: "",
      };
      const created = await base44.entities.AccessLog.create(log);
      if (v?.id && !denied) {
        try {
          await base44.entities.Visitor.update(v.id, {
            status: eventType === "entry" ? "entered" : "exited",
            entered_at: eventType === "entry" ? entryTime : v.entered_at,
            exited_at: eventType === "exit" ? exitTime : v.exited_at,
          });
        } catch (_) {}
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => startMode(m.id)}
                className="rounded-2xl border-2 border-dashed border-sky-500/40 bg-sky-500/5 hover:border-sky-400/70 hover:bg-sky-500/10 p-4 flex flex-col items-center gap-2 transition-all active:scale-95"
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
              <StepCard icon={QrCode} title="Scan QR Code" subtitle="Resident / visitor pass" onScan={() => openScanner("qr")} busy={busy} />
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
            {filteredLogs.slice(0, 8).map((log) => (
              <div key={log.id} className={`border rounded-xl p-3 flex items-center justify-between ${eventBg[log.event_type] || "bg-slate-800/50 border-slate-700/50"}`}>
                <div className="flex items-center gap-3 min-w-0">
                  {log.photo_url
                    ? <img src={log.photo_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    : <div className="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0"><User className="w-4 h-4 text-slate-300" /></div>}
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{log.person_name || "Unknown"}</p>
                    <p className="text-slate-400 text-xs truncate">
                      {log.gate_name} • {new Date(log.timestamp).toLocaleTimeString()}
                      {log.scan_method && log.scan_method !== "qr_code" ? ` • ${log.scan_method}` : ""}
                      {log.vehicle_registration ? ` • ${log.vehicle_registration}` : ""}
                    </p>
                  </div>
                </div>
                <Badge className={`${eventBadge[log.event_type] || "bg-slate-600"} shrink-0 text-xs`}>{log.event_type}</Badge>
              </div>
            ))}
            {filteredLogs.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No access logs yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}