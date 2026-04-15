import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  QrCode, CreditCard, Car, Camera, CheckCircle2, XCircle, Clock,
  User, AlertTriangle, ScanLine, LogIn, LogOut, Shield
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
  const [cameraFile, setCameraFile] = useState(null);
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: recentLogs = [] } = useQuery({
    queryKey: ["access_logs_recent"],
    queryFn: () => base44.entities.AccessLog.list("-timestamp", 20),
    initialData: [],
    refetchInterval: 10000
  });

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
      setTimeout(() => setScanResult(null), 5000);
    }
  });

  const handleScan = async (scannedData) => {
    setScanning(false);
    // Try to match visitor OTP or QR
    let personInfo = { person_name: "Unknown", person_type: "unknown", scanned_data: scannedData };

    try {
      // Check if it's a visitor OTP
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
        // Update visitor status
        await base44.entities.Visitor.update(v.id, {
          status: eventType === "entry" ? "entered" : "exited",
          entered_at: eventType === "entry" ? new Date().toISOString() : v.entered_at,
          exited_at: eventType === "exit" ? new Date().toISOString() : v.exited_at
        });
      } else {
        // Try residents by SA ID or other lookup
        const residents = await base44.entities.Resident.filter({ id_number: scannedData });
        if (residents.length > 0) {
          const r = residents[0];
          personInfo = {
            person_name: r.full_name,
            person_type: "resident",
            unit_number: r.unit_number,
            scanned_data: scannedData
          };
        }
      }
    } catch (e) {
      console.error("Lookup error:", e);
    }

    logMutation.mutate(personInfo);
  };

  const handleManualSubmit = () => {
    if (!manualInput.trim()) return;
    handleScan(manualInput.trim());
    setManualInput("");
  };

  const handlePhotoScan = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Use AI to extract text from SA documents
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Extract text from this South African document image. This could be:
1. SA ID card - extract: ID number, full name, date of birth
2. SA Driver's Licence - extract: licence number, full name, ID number
3. Vehicle Licence Disc - extract: registration number, make, model, expiry date
4. QR code data if visible

Return JSON with: { document_type, id_number, full_name, registration_number, raw_text }`,
        file_urls: [file_url],
        response_json_schema: {
          type: "object",
          properties: {
            document_type: { type: "string" },
            id_number: { type: "string" },
            full_name: { type: "string" },
            registration_number: { type: "string" },
            raw_text: { type: "string" }
          }
        }
      });

      const scanValue = result.id_number || result.registration_number || result.raw_text || "UNKNOWN";
      await handleScan(scanValue);
    } catch (err) {
      alert("Failed to scan document: " + err.message);
    }
  };

  const eventColors = { entry: "text-emerald-400", exit: "text-amber-400", denied: "text-rose-400" };
  const personColors = { resident: "bg-sky-600", visitor: "bg-purple-600", guard: "bg-emerald-600", vendor: "bg-orange-600", unknown: "bg-slate-600" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">

        <div className="pt-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield className="w-7 h-7 text-sky-400" /> Access Control
          </h1>
          <p className="text-slate-400 text-sm mt-1">Scan entry & exit — SA ID, Driver's Licence, Vehicle Disc, QR</p>
        </div>

        {/* Gate & Event Type */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Gate</label>
            <Select value={gate} onValueChange={setGate}>
              <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Main Gate">Main Gate</SelectItem>
                <SelectItem value="Secondary Gate">Secondary Gate</SelectItem>
                <SelectItem value="Pedestrian Gate">Pedestrian Gate</SelectItem>
                <SelectItem value="Delivery Gate">Delivery Gate</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Event Type</label>
            <div className="flex gap-2">
              <Button
                onClick={() => setEventType("entry")}
                className={`flex-1 h-9 ${eventType === "entry" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                <LogIn className="w-4 h-4 mr-1" /> Entry
              </Button>
              <Button
                onClick={() => setEventType("exit")}
                className={`flex-1 h-9 ${eventType === "exit" ? "bg-amber-600 hover:bg-amber-700" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                <LogOut className="w-4 h-4 mr-1" /> Exit
              </Button>
            </div>
          </div>
        </div>

        {/* Scan Mode Selection */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base">Scan Method</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: "qr_code", label: "QR Code / OTP", icon: QrCode },
                { value: "sa_id", label: "SA ID Card", icon: CreditCard },
                { value: "drivers_licence", label: "Driver's Licence", icon: CreditCard },
                { value: "vehicle_disc", label: "Vehicle Disc", icon: Car }
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setScanMode(value)}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                    scanMode === value
                      ? "bg-sky-500 border-sky-500 text-white"
                      : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>

            {scanMode === "qr_code" ? (
              <div>
                {scanning ? (
                  <QRCodeReader onScan={handleScan} />
                ) : (
                  <Button onClick={() => setScanning(true)} className="w-full bg-sky-500 hover:bg-sky-600">
                    <ScanLine className="w-4 h-4 mr-2" /> Open QR Scanner
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-slate-400 text-xs">Take a photo of the document or enter number manually</p>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoScan} className="hidden" id="doc-scan" />
                <label htmlFor="doc-scan">
                  <Button type="button" className="w-full bg-purple-600 hover:bg-purple-700" asChild>
                    <div><Camera className="w-4 h-4 mr-2" /> Scan Document with Camera</div>
                  </Button>
                </label>
                <div className="flex gap-2">
                  <Input
                    placeholder={scanMode === "vehicle_disc" ? "Registration number" : "ID / Licence number"}
                    value={manualInput}
                    onChange={e => setManualInput(e.target.value)}
                    className="bg-slate-900 border-slate-700 text-white"
                    onKeyDown={e => e.key === "Enter" && handleManualSubmit()}
                  />
                  <Button onClick={handleManualSubmit} className="bg-emerald-600 hover:bg-emerald-700">Log</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scan Result */}
        {scanResult && (
          <Card className={`border-2 ${scanResult.flagged ? "border-rose-500 bg-rose-500/10" : "border-emerald-500 bg-emerald-500/10"}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {scanResult.flagged
                  ? <XCircle className="w-8 h-8 text-rose-400" />
                  : <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                }
                <div>
                  <p className="text-white font-semibold">{scanResult.person_name}</p>
                  <p className="text-slate-300 text-sm capitalize">{scanResult.person_type} • {scanResult.event_type} logged</p>
                  {scanResult.unit_number && <p className="text-slate-400 text-xs">Unit: {scanResult.unit_number}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {logMutation.isPending && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="p-4 text-center text-slate-400">Processing scan...</CardContent>
          </Card>
        )}

        {/* Recent Logs */}
        <div>
          <h2 className="text-white font-semibold mb-3">Recent Access Log</h2>
          <div className="space-y-2">
            {recentLogs.map(log => (
              <Card key={log.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${personColors[log.person_type]}`}>
                      <User className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{log.person_name || "Unknown"}</p>
                      <p className="text-slate-400 text-xs">{log.gate_name} • {new Date(log.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold uppercase ${eventColors[log.event_type]}`}>{log.event_type}</p>
                    <Badge className={personColors[log.person_type]} style={{ fontSize: "10px" }}>{log.person_type}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}