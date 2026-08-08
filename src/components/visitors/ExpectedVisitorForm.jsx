import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  X, ScanLine, CheckCircle2, IdCard, ChevronDown, ChevronUp,
  Car, User, Clock, MapPin, AlertCircle,
} from "lucide-react";

const DL_FIELDS = [
  "first_names", "initials", "driver_licence_number",
  "date_of_birth", "gender", "nationality", "country",
  "issue_date", "expiry_date", "vehicle_classes", "restrictions", "prdp", "licence_status"
];

const EMPTY_FORM = {
  visitor_entry_type: "",
  visitor_name: "",
  surname: "",
  visitor_id_number: "",
  visitor_phone: "",
  vehicle_registration: "",
  destination: "",
  expected_date: "",
  expected_arrival_time: "",
  valid_until: "",
  notes: "",
  visit_type: "pre_registered",
  ...Object.fromEntries(DL_FIELDS.map((f) => [f, ""])),
};

export default function ExpectedVisitorForm({ user, destinations, scanPayload, onScanOpen, onClearScan, onSubmit, pending, onCancel }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [showLicenceDetails, setShowLicenceDetails] = useState(false);
  const [error, setError] = useState("");

  // Auto-merge scanned document fields into the form
  useEffect(() => {
    if (!scanPayload) return;
    setForm((f) => {
      const next = { ...f };
      const m = scanPayload.mappedFields || {};
      for (const key of Object.keys(next)) {
        if (m[key] != null && m[key] !== "") next[key] = m[key];
      }
      if (m.registration_number) next.vehicle_registration = m.registration_number;
      if (scanPayload.qrInfo?.data?.visitor_name) next.visitor_name = scanPayload.qrInfo.data.visitor_name;
      if (!next.visitor_entry_type) {
        if (scanPayload.documentType === "vehicle_disc") next.visitor_entry_type = "vehicle";
        else if (scanPayload.documentType === "drivers_licence" || scanPayload.documentType === "sa_id") next.visitor_entry_type = "pedestrian";
      }
      return next;
    });
    if (scanPayload.mappedFields && DL_FIELDS.some((k) => scanPayload.mappedFields[k])) setShowLicenceDetails(true);
  }, [scanPayload]);

  const isVehicle = form.visitor_entry_type === "vehicle";
  const isPedestrian = form.visitor_entry_type === "pedestrian";

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const validate = () => {
    if (!form.visitor_entry_type) return "Please select Vehicle or Pedestrian visitor type.";
    if (!form.visitor_name?.trim()) return "Visitor name is required.";
    if (!form.surname?.trim()) return "Surname is required.";
    if (!form.visitor_id_number?.trim()) return "ID number is required.";
    if (isVehicle && !form.vehicle_registration?.trim()) return "Vehicle registration is required for vehicle visitors.";
    if (!form.destination) return "Destination is required.";
    if (!form.expected_date) return "Expected date is required.";
    if (!form.expected_arrival_time) return "Expected arrival time is required.";
    return "";
  };

  const submit = () => {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    const payload = {
      ...form,
      // Pedestrian visitors must not carry a vehicle registration
      vehicle_registration: isPedestrian ? "" : form.vehicle_registration,
      // Combine expected date + arrival time into valid_from for expiry checks
      valid_from: form.expected_date
        ? `${form.expected_date}T${form.expected_arrival_time || "00:00"}:00`
        : form.valid_from,
    };
    onSubmit(payload);
  };

  return (
    <Card className="bg-slate-800 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">Register Expected Visitor</CardTitle>
          <Button variant="ghost" size="icon" onClick={onCancel}><X /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Visitor type selection — mandatory */}
        <div className="space-y-2">
          <label className="text-slate-300 text-xs font-semibold uppercase tracking-wide">Visitor Type *</label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, visitor_entry_type: "vehicle" })}
              className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all ${
                isVehicle
                  ? "border-sky-500 bg-sky-500/15 text-white"
                  : "border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600"
              }`}
            >
              <Car className={`w-7 h-7 ${isVehicle ? "text-sky-400" : ""}`} />
              <span className="text-sm font-semibold">Vehicle Visitor</span>
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, visitor_entry_type: "pedestrian", vehicle_registration: "" })}
              className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all ${
                isPedestrian
                  ? "border-emerald-500 bg-emerald-500/15 text-white"
                  : "border-slate-700 bg-slate-900/50 text-slate-400 hover:border-slate-600"
              }`}
            >
              <User className={`w-7 h-7 ${isPedestrian ? "text-emerald-400" : ""}`} />
              <span className="text-sm font-semibold">Pedestrian Visitor</span>
            </button>
          </div>
        </div>

        {/* Scan document — auto-detect */}
        <div className="space-y-2">
          <Button type="button" className="w-full bg-sky-600 hover:bg-sky-700" onClick={onScanOpen}>
            <ScanLine className="w-4 h-4 mr-2" /> SCAN ID / LICENCE (OPTIONAL)
          </Button>
          {scanPayload && (
            <div className="flex items-center gap-3 p-2 rounded-lg bg-sky-500/10 border border-sky-500/30">
              {scanPayload.thumbnail ? (
                <img src={scanPayload.thumbnail} alt="Scanned" className="w-10 h-12 object-cover rounded border border-slate-600" style={{ imageRendering: "pixelated" }} />
              ) : (
                <div className="w-10 h-12 rounded bg-slate-800 border border-slate-600 flex items-center justify-center">
                  <IdCard className="w-5 h-5 text-slate-500" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sky-300 text-xs font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Document scanned · <span className="capitalize">{scanPayload.documentType?.replace("_", " ")}</span>
                </p>
                <p className="text-slate-400 text-xs">{scanPayload.sdkVersion} · {scanPayload.barcodeType}</p>
              </div>
              <button onClick={onClearScan} className="text-slate-400 hover:text-rose-400"><X className="w-4 h-4" /></button>
            </div>
          )}
        </div>

        {/* Mandatory fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Visitor Name *</label>
            <Input placeholder="First name(s)" value={form.visitor_name} onChange={set("visitor_name")} className="bg-slate-900 border-slate-700 text-white" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Surname *</label>
            <Input placeholder="Surname" value={form.surname} onChange={set("surname")} className="bg-slate-900 border-slate-700 text-white" />
          </div>
        </div>

        <div>
          <label className="text-slate-400 text-xs mb-1 block">ID / Licence Number *</label>
          <Input placeholder="ID number" value={form.visitor_id_number} onChange={set("visitor_id_number")} className="bg-slate-900 border-slate-700 text-white" />
        </div>

        <Input placeholder="Visitor phone number (optional)" value={form.visitor_phone} onChange={set("visitor_phone")} className="bg-slate-900 border-slate-700 text-white" />

        {/* Vehicle registration — only for vehicle visitors */}
        {isVehicle && (
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Vehicle Registration *</label>
            <Input placeholder="Vehicle registration" value={form.vehicle_registration} onChange={set("vehicle_registration")} className="bg-slate-900 border-slate-700 text-white uppercase" />
          </div>
        )}
        {isPedestrian && (
          <p className="text-xs text-slate-500 italic flex items-center gap-1">
            <User className="w-3 h-3" /> Pedestrian visitor — vehicle registration not applicable.
          </p>
        )}

        {/* Destination — mandatory */}
        <div>
          <label className="text-slate-400 text-xs mb-1 block">Destination *</label>
          <Select value={form.destination} onValueChange={(v) => setForm({ ...form, destination: v })}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
              <SelectValue placeholder="Select destination" />
            </SelectTrigger>
            <SelectContent>
              {destinations.map((d) => (
                <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {destinations.length === 0 && (
            <p className="text-amber-400 text-xs mt-1">No destinations configured. Ask an admin to add destinations under Access Settings.</p>
          )}
        </div>

        {/* Expected date + arrival time — mandatory */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Expected Date *</label>
            <Input type="date" value={form.expected_date} onChange={set("expected_date")} className="bg-slate-900 border-slate-700 text-white" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Expected Arrival Time *</label>
            <Input type="time" value={form.expected_arrival_time} onChange={set("expected_arrival_time")} className="bg-slate-900 border-slate-700 text-white" />
          </div>
        </div>

        {/* Licence details (auto-filled from scan) */}
        <button
          type="button"
          onClick={() => setShowLicenceDetails((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-slate-300"
        >
          Licence details {showLicenceDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showLicenceDetails && (
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-900/50 border border-slate-700">
            {DL_FIELDS.map((f) => (
              <Input key={f}
                placeholder={f.replace(/_/g, " ")}
                value={form[f] || ""}
                onChange={set(f)}
                className="bg-slate-900 border-slate-700 text-white text-sm" />
            ))}
          </div>
        )}

        {/* Optional expiry / notes */}
        <div>
          <label className="text-slate-400 text-xs mb-1 block">Pass Valid Until (optional)</label>
          <Input type="datetime-local" value={form.valid_until} onChange={set("valid_until")} className="bg-slate-900 border-slate-700 text-white" />
        </div>
        <Input placeholder="Notes (optional)" value={form.notes} onChange={set("notes")} className="bg-slate-900 border-slate-700 text-white" />

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-300 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <Button className="w-full bg-sky-500 hover:bg-sky-600 h-12" onClick={submit} disabled={pending}>
          {pending ? "Registering..." : "Register Expected Visitor"}
        </Button>
      </CardContent>
    </Card>
  );
}