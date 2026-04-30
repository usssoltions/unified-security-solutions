import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import {
  QrCode, CreditCard, Car, Camera, CheckCircle2, XCircle, Clock,
  User, AlertTriangle, ScanLine, LogIn, LogOut, Shield, Sparkles,
  Fingerprint, Eye, Zap, Brain, RefreshCw, ChevronRight, Search
} from "lucide-react";
import QRCodeReader from "@/components/guard/QRCodeReader";

export default function AccessControl() {
  const [user, setUser] = useState(null);
  const [scanMode, setScanMode] = useState("qr_code");
  const [gate, setGate] = useState("Main Gate");
  const [eventType, setEventType] = useState("entry");
  const [manualInput, setManualInput] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiInsight, setAiInsight] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["access_logs_recent"],
    queryFn: () => base44.entities.AccessLog.list("-timestamp", 30),
    refetchInterval: 8000
  });

  // Real-time subscription for live updates
  useEffect(() => {
    const unsubscribe = base44.entities.AccessLog.subscribe((event) => {
      qc.invalidateQueries({ queryKey: ["access_logs_recent"] });
    });
    return unsubscribe;
  }, []);

  const logMutation = useMutation({
    mutationFn: async (logData) => {
      return await base44.entities.AccessLog.create({
        ...logData,
        gate_name: gate,
        event_type: eventType,
        scan_method: scanMode,
        timestamp: new Date().toISOString(),
        guard_id: user?.id,
        guard_name: user?.full_name
      });
    },
    onSuccess: (data) => {
      setScanResult(data);
      qc.invalidateQueries(["access_logs_recent"]);
      // Auto-clear after 6 seconds
      setTimeout(() => setScanResult(null), 6000);
    }
  });

  const handleScan = async (scannedData) => {
    setScanning(false);
    let personInfo = { person_name: "Unknown", person_type: "unknown", scanned_data: scannedData };

    const visitors = await base44.entities.Visitor.filter({ otp_code: scannedData });
    if (visitors.length > 0) {
      const v = visitors[0];
      personInfo = {
        person_name: v.visitor_name,
        person_type: "visitor",
        unit_number: v.unit_number,
        visitor_id: v.id,
        scanned_data: scannedData,
        vehicle_registration: v.vehicle_registration
      };
      await base44.entities.Visitor.update(v.id, {
        status: eventType === "entry" ? "entered" : "exited",
        entered_at: eventType === "entry" ? new Date().toISOString() : v.entered_at,
        exited_at: eventType === "exit" ? new Date().toISOString() : v.exited_at
      });
    } else {
      const residents = await base44.entities.Resident.filter({ id_number: scannedData });
      if (residents.length > 0) {
        const r = residents[0];
        personInfo = { person_name: r.full_name, person_type: "resident", unit_number: r.unit_number, scanned_data: scannedData };
      }
    }

    logMutation.mutate(personInfo);
  };

  const handleManualSubmit = () => {
    if (!manualInput.trim()) return;
    handleScan(manualInput.trim());
    setManualInput("");
  };

  const handleAIScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAiProcessing(true);
    setAiInsight(null);

    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an AI security access control system analyzing a South African document image.

Analyze this document and extract ALL visible information. The document could be:
1. SA Green ID Book - extract: 13-digit ID number, full name, date of birth, gender
2. SA Smart ID Card - extract: 13-digit ID number, full name, date of birth  
3. SA Driver's Licence (card) - extract: licence number, full name, ID number, vehicle codes, expiry
4. Vehicle Licence Disc - extract: registration number, vehicle make/model, expiry date, engine number
5. QR Code / Barcode - extract: embedded data

Also assess: document authenticity indicators (any visible tampering, damage), confidence score (0-100).

Return structured JSON with document_type, id_number, full_name, registration_number, licence_number, expiry_date, confidence, authenticity_notes, raw_text`,
      file_urls: [file_url],
      response_json_schema: {
        type: "object",
        properties: {
          document_type: { type: "string" },
          id_number: { type: "string" },
          full_name: { type: "string" },
          registration_number: { type: "string" },
          licence_number: { type: "string" },
          expiry_date: { type: "string" },
          confidence: { type: "number" },
          authenticity_notes: { type: "string" },
          raw_text: { type: "string" }
        }
      }
    });

    setAiInsight(result);
    setAiProcessing(false);

    const scanValue = result.id_number || result.licence_number || result.registration_number || result.raw_text || "UNKNOWN";
    await handleScan(scanValue);
  };

  const filteredLogs = recentLogs.filter(log => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      log.person_name?.toLowerCase().includes(q) ||
      log.gate_name?.toLowerCase().includes(q) ||
      log.person_type?.toLowerCase().includes(q)
    );
  });

  const eventColors = { entry: "text-emerald-400", exit: "text-amber-400", denied: "text-rose-400" };
  const personColors = {
    resident: "bg-sky-600", visitor: "bg-purple-600", guard: "bg-emerald-600",
    vendor: "bg-orange-600", unknown: "bg-slate-600"
  };
  const eventBg = { entry: "bg-emerald-500/10 border-emerald-500/30", exit: "bg-amber-500/10 border-amber-500/30", denied: "bg-rose-500/10 border-rose-500/30" };

  const todayStats = {
    entries: recentLogs.filter(l => l.event_type === "entry").length,
    exits: recentLogs.filter(l => l.event_type === "exit").length,
    denied: recentLogs.filter(l => l.event_type === "denied").length,
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-slate-900/95 backdrop-blur-xl border-b border-slate-700/50 px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-sky-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-sky-500/30">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">Access Control</h1>
              <p className="text-slate-400 text-xs">AI-Powered Gate Management</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-emerald-400 text-xs font-medium">LIVE</span>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Entries", value: todayStats.entries, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
            { label: "Exits", value: todayStats.exits, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
            { label: "Denied", value: todayStats.denied, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
          ].map(s => (
            <div key={s.label} className={`${s.bg} border rounded-xl p-3 text-center`}>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-slate-400 text-xs mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Gate & Event Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs mb-1.5 block font-medium">Gate Point</label>
            <Select value={gate} onValueChange={setGate}>
              <SelectTrigger className="bg-slate-800/80 border-slate-700 text-white h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Main Gate", "Secondary Gate", "Pedestrian Gate", "Delivery Gate", "Emergency Gate"].map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
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

        {/* Scan Method Tabs */}
        <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 overflow-hidden">
          <div className="grid grid-cols-4 border-b border-slate-700/50">
            {[
              { value: "qr_code", label: "QR / OTP", icon: QrCode },
              { value: "sa_id", label: "SA ID", icon: CreditCard },
              { value: "drivers_licence", label: "Licence", icon: Fingerprint },
              { value: "vehicle_disc", label: "Vehicle", icon: Car },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setScanMode(value)}
                className={`flex flex-col items-center gap-1 py-3 text-xs font-medium transition-all ${
                  scanMode === value
                    ? "bg-sky-500/20 text-sky-400 border-b-2 border-sky-400"
                    : "text-slate-400 hover:text-slate-300"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-3">
            {scanMode === "qr_code" ? (
              <div>
                {scanning ? (
                  <div className="rounded-xl overflow-hidden">
                    <QRCodeReader onScan={handleScan} />
                    <Button onClick={() => setScanning(false)} variant="outline" className="w-full mt-2 border-slate-600 text-slate-300">
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => setScanning(true)}
                    className="w-full h-24 bg-gradient-to-br from-sky-500/10 to-blue-600/10 border-2 border-dashed border-sky-500/40 rounded-xl flex flex-col items-center justify-center gap-2 hover:border-sky-400/60 transition-all active:scale-95"
                  >
                    <div className="w-10 h-10 bg-sky-500/20 rounded-full flex items-center justify-center">
                      <ScanLine className="w-5 h-5 text-sky-400" />
                    </div>
                    <span className="text-sky-400 font-semibold text-sm">Tap to Scan QR / OTP</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* AI Camera Scan */}
                <div>
                  <input type="file" accept="image/*" capture="environment" onChange={handleAIScan} className="hidden" id="doc-ai-scan" />
                  <label htmlFor="doc-ai-scan">
                    <div className={`w-full h-24 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 ${
                      aiProcessing
                        ? "border-purple-400/60 bg-purple-500/10"
                        : "border-purple-500/40 bg-purple-500/10 hover:border-purple-400/60"
                    }`}>
                      {aiProcessing ? (
                        <>
                          <div className="flex items-center gap-2">
                            <Brain className="w-5 h-5 text-purple-400 animate-pulse" />
                            <Sparkles className="w-4 h-4 text-purple-300 animate-spin" />
                          </div>
                          <span className="text-purple-300 text-sm font-medium">AI Analyzing Document...</span>
                        </>
                      ) : (
                        <>
                          <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                            <Camera className="w-5 h-5 text-purple-400" />
                          </div>
                          <span className="text-purple-400 font-semibold text-sm">AI Scan Document</span>
                          <span className="text-slate-500 text-xs">ID / Driver's Licence / Vehicle Disc</span>
                        </>
                      )}
                    </div>
                  </label>
                </div>

                {/* AI Insight Result */}
                <AnimatePresence>
                  {aiInsight && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 space-y-1"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="w-4 h-4 text-purple-400" />
                        <span className="text-purple-300 text-xs font-semibold uppercase tracking-wide">AI Document Analysis</span>
                        {aiInsight.confidence && (
                          <Badge className={`ml-auto text-xs ${aiInsight.confidence > 80 ? 'bg-emerald-600' : aiInsight.confidence > 60 ? 'bg-amber-600' : 'bg-rose-600'}`}>
                            {aiInsight.confidence}% confidence
                          </Badge>
                        )}
                      </div>
                      {aiInsight.document_type && <p className="text-slate-300 text-xs"><span className="text-slate-500">Type:</span> {aiInsight.document_type}</p>}
                      {aiInsight.full_name && <p className="text-white text-sm font-semibold">{aiInsight.full_name}</p>}
                      {aiInsight.id_number && <p className="text-slate-300 text-xs"><span className="text-slate-500">ID:</span> {aiInsight.id_number}</p>}
                      {aiInsight.registration_number && <p className="text-slate-300 text-xs"><span className="text-slate-500">Reg:</span> {aiInsight.registration_number}</p>}
                      {aiInsight.expiry_date && <p className="text-slate-300 text-xs"><span className="text-slate-500">Expires:</span> {aiInsight.expiry_date}</p>}
                      {aiInsight.authenticity_notes && (
                        <p className="text-amber-300 text-xs mt-1">⚠ {aiInsight.authenticity_notes}</p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Manual Entry */}
                <div className="flex gap-2">
                  <Input
                    placeholder={scanMode === "vehicle_disc" ? "Registration number (e.g. CA 123-456)" : scanMode === "sa_id" ? "13-digit SA ID number" : "Licence number"}
                    value={manualInput}
                    onChange={e => setManualInput(e.target.value)}
                    className="bg-slate-900 border-slate-700 text-white h-11"
                    onKeyDown={e => e.key === "Enter" && handleManualSubmit()}
                  />
                  <Button onClick={handleManualSubmit} className="bg-emerald-600 hover:bg-emerald-700 h-11 px-4 shrink-0">
                    <Zap className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}

            {logMutation.isPending && (
              <div className="flex items-center gap-2 py-2 justify-center">
                <RefreshCw className="w-4 h-4 text-sky-400 animate-spin" />
                <span className="text-slate-400 text-sm">Processing...</span>
              </div>
            )}
          </div>
        </div>

        {/* Scan Result */}
        <AnimatePresence>
          {scanResult && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className={`border-2 rounded-2xl p-4 ${scanResult.flagged ? "border-rose-500 bg-rose-500/10" : "border-emerald-500 bg-emerald-500/10"}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center ${scanResult.flagged ? "bg-rose-500/20" : "bg-emerald-500/20"}`}>
                    {scanResult.flagged
                      ? <XCircle className="w-7 h-7 text-rose-400" />
                      : <CheckCircle2 className="w-7 h-7 text-emerald-400" />
                    }
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-bold text-lg">{scanResult.person_name}</p>
                    <p className="text-slate-300 text-sm capitalize">{scanResult.person_type} • {eventType} logged</p>
                    {scanResult.unit_number && <p className="text-slate-400 text-xs mt-0.5">Unit: {scanResult.unit_number}</p>}
                    <p className="text-slate-500 text-xs mt-0.5">{gate} • {new Date().toLocaleTimeString()}</p>
                  </div>
                  {scanResult.flagged ? (
                    <Badge className="bg-rose-600 shrink-0">DENIED</Badge>
                  ) : (
                    <Badge className={eventType === "entry" ? "bg-emerald-600 shrink-0" : "bg-amber-600 shrink-0"}>
                      {eventType.toUpperCase()}
                    </Badge>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recent Logs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold">Live Access Log</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-8 bg-slate-800 border-slate-700 text-white text-xs w-32"
              />
            </div>
          </div>
          <div className="space-y-2">
            <AnimatePresence>
              {filteredLogs.map((log, i) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <div className={`border rounded-xl p-3 flex items-center justify-between ${eventBg[log.event_type] || "bg-slate-800/50 border-slate-700/50"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${personColors[log.person_type]}`}>
                        <User className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{log.person_name || "Unknown"}</p>
                        <p className="text-slate-400 text-xs">{log.gate_name} • {new Date(log.timestamp).toLocaleTimeString()}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-bold uppercase ${eventColors[log.event_type]}`}>{log.event_type}</p>
                      <p className="text-slate-500 text-xs capitalize">{log.person_type}</p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
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