import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, X, Clock, CheckCircle2, Car, Phone, ScanLine, IdCard, ChevronDown, ChevronUp } from "lucide-react";
import DocumentScanner from "@/components/documents/DocumentScanner";
import VisitorScanHistory from "@/components/documents/VisitorScanHistory";
import { uploadDocumentPhotoWithThumbnail } from "@/lib/documentPhotoManager";
import { recordScanAudit, getQuickGPS } from "@/lib/documentScanAudit";

const DL_FIELDS = [
  "surname", "first_names", "initials", "driver_licence_number",
  "date_of_birth", "gender", "nationality", "country",
  "issue_date", "expiry_date", "vehicle_classes", "restrictions", "prdp", "licence_status"
];

const EMPTY_FORM = {
  visitor_name: "", visitor_id_number: "", visitor_phone: "", vehicle_registration: "",
  visit_type: "pre_registered", valid_from: "", valid_until: "", notes: "",
  ...Object.fromEntries(DL_FIELDS.map((f) => [f, ""]))
};

export default function ResidentVisitors() {
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanPayload, setScanPayload] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showLicenceDetails, setShowLicenceDetails] = useState(false);
  const scanOpenRef = useRef(0);
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: visitors = [] } = useQuery({
    queryKey: ["my_visitors", user?.id],
    queryFn: () => base44.entities.Visitor.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: []
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      return await base44.entities.Visitor.create({
        ...data,
        resident_id: user.id,
        resident_name: user.full_name,
        unit_number: user.unit_number,
        otp_code: otp,
        status: "approved",
        id_scan_url: scanPayload?.photoUrl || null,
        scan_thumbnail_url: scanPayload?.thumbnail || null,
        scan_document_type: scanPayload?.documentType || "",
        scan_barcode_type: scanPayload?.barcodeType || "",
        scan_sdk_version: scanPayload?.sdkVersion || "",
        scan_parser_used: scanPayload?.parserUsed || "",
        scan_profile: scanPayload?.profileId || "",
        scan_timestamp: scanPayload?.scanTime || "",
        scan_raw_json: scanPayload?.rawJson || "",
      });
    },
    onSuccess: (_data, variables) => {
      // Link the audit record to the newly created visitor
      if (scanPayload?.auditId && _data?.id) {
        base44.entities.DocumentScan.update(scanPayload.auditId, {
          related_id: _data.id, related_entity: "Visitor",
          mapped_summary: `${variables.visitor_name} ${variables.visitor_id_number || ""}`.trim(),
        }).catch(() => {});
      }
      qc.invalidateQueries(["my_visitors"]);
      setShowForm(false);
      setScanPayload(null);
      setForm(EMPTY_FORM);
      setShowLicenceDetails(false);
    }
  });

  const handleScanAccept = async (scan) => {
    const duration = Date.now() - scanOpenRef.current;
    const { result, photoUrl, mappedFields, resolvedProfileId, profile, parserUsed, sdkVersion, qrInfo } = scan;
    const rawJson = result?.formattedJSON ? JSON.stringify(result.formattedJSON, null, 2) : (result?.textualData || "");

    // Upload photo (+ thumbnail) once, deduped at the manager level
    let uploaded = { url: null, thumbnail: null };
    if (photoUrl) uploaded = await uploadDocumentPhotoWithThumbnail(photoUrl, `visitor_${Date.now()}.png`);

    const gps = await getQuickGPS();

    const audit = await recordScanAudit({
      user, callerPage: "resident_visitors",
      documentType: resolvedProfileId, barcodeType: result?.barcodeType,
      success: true, durationMs: duration,
      sdkVersion, parserUsed, profile: resolvedProfileId,
      rawJson, photoUrl: uploaded.url,
      mappedSummary: mappedFields?.visitor_name || "",
      relatedEntity: "Visitor", gps, device: navigator?.userAgent || "",
    });

    setScanPayload({
      photoUrl: uploaded.url, thumbnail: uploaded.thumbnail,
      rawJson, documentType: resolvedProfileId, profileId: resolvedProfileId,
      barcodeType: result?.barcodeType, sdkVersion, parserUsed,
      scanTime: result?.timestamp || new Date().toISOString(),
      auditId: audit?.id || null, mappedFields, qrInfo,
    });

    // Auto-populate form from mapped fields
    setForm((f) => {
      const next = { ...f };
      if (mappedFields) {
        for (const key of Object.keys(f)) {
          if (mappedFields[key] != null && mappedFields[key] !== "") next[key] = mappedFields[key];
        }
        if (mappedFields.registration_number) next.vehicle_registration = mappedFields.registration_number;
      }
      // QR payload may carry a name
      if (qrInfo?.data?.visitor_name) next.visitor_name = qrInfo.data.visitor_name;
      return next;
    });

    setShowScanner(false);
    setShowForm(true);
    if (mappedFields && DL_FIELDS.some((k) => mappedFields[k])) setShowLicenceDetails(true);
  };

  const handleScannerClose = async () => {
    const duration = Date.now() - scanOpenRef.current;
    setShowScanner(false);
    if (!scanPayload) {
      recordScanAudit({
        user, callerPage: "resident_visitors", documentType: "unknown",
        success: false, reason: "cancelled", durationMs: duration,
      }).catch(() => {});
    }
  };

  const openScanner = () => { scanOpenRef.current = Date.now(); setShowScanner(true); };

  const statusColors = { pending: "bg-amber-600", approved: "bg-emerald-600", denied: "bg-rose-600", entered: "bg-sky-600", exited: "bg-slate-600", expired: "bg-slate-500" };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-2xl mx-auto space-y-4 pb-24">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold text-white">My Visitors</h1>
          <Button onClick={() => setShowForm(true)} className="bg-sky-500 hover:bg-sky-600">
            <UserPlus className="w-4 h-4 mr-2" /> Add Visitor
          </Button>
        </div>

        {showForm && (
          <Card className="bg-slate-800 border-slate-700">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">Register Visitor</CardTitle>
                <Button variant="ghost" size="icon" onClick={() => setShowForm(false)}><X /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Scan Document — auto-detect */}
              <div className="space-y-2">
                <Button type="button" className="w-full bg-sky-600 hover:bg-sky-700" onClick={openScanner}>
                  <ScanLine className="w-4 h-4 mr-2" /> SCAN DOCUMENT
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
                    <button onClick={() => setScanPayload(null)} className="text-slate-400 hover:text-rose-400"><X className="w-4 h-4" /></button>
                  </div>
                )}
              </div>

              <Input placeholder="Visitor full name *" value={form.visitor_name} onChange={e => setForm({ ...form, visitor_name: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="ID / licence number" value={form.visitor_id_number} onChange={e => setForm({ ...form, visitor_id_number: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Visitor phone number" value={form.visitor_phone} onChange={e => setForm({ ...form, visitor_phone: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Input placeholder="Vehicle registration (optional)" value={form.vehicle_registration} onChange={e => setForm({ ...form, vehicle_registration: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />

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
                      onChange={e => setForm({ ...form, [f]: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white text-sm" />
                  ))}
                </div>
              )}

              <Select value={form.visit_type} onValueChange={v => setForm({ ...form, visit_type: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Visit type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pre_registered">Pre-Registered Guest</SelectItem>
                  <SelectItem value="unexpected">Unexpected Visitor</SelectItem>
                  <SelectItem value="contractor">Contractor / Worker</SelectItem>
                  <SelectItem value="delivery">Delivery</SelectItem>
                </SelectContent>
              </Select>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Valid From</label>
                  <Input type="datetime-local" value={form.valid_from} onChange={e => setForm({ ...form, valid_from: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                </div>
                <div>
                  <label className="text-slate-400 text-xs mb-1 block">Valid Until</label>
                  <Input type="datetime-local" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
                </div>
              </div>
              <Input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="bg-slate-900 border-slate-700 text-white" />
              <Button className="w-full bg-sky-500 hover:bg-sky-600"
                onClick={() => createMutation.mutate(form)}
                disabled={!form.visitor_name || createMutation.isPending}>
                {createMutation.isPending ? "Registering..." : "Register Visitor"}
              </Button>
            </CardContent>
          </Card>
        )}

        {visitors.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-8 text-center">
              <UserPlus className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No visitors registered yet</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {visitors.map(v => (
              <Card key={v.id} className="bg-slate-800/50 border-slate-700">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-white font-semibold">{v.visitor_name}</p>
                        <Badge className={statusColors[v.status]}>{v.status}</Badge>
                        {v.id_scan_url && (
                          <img src={v.id_scan_url} alt="ID" className="w-6 h-8 object-cover rounded border border-slate-600" style={{ imageRendering: "pixelated" }} />
                        )}
                      </div>
                      <div className="space-y-1 text-sm text-slate-400">
                        {v.visitor_id_number && <p className="flex items-center gap-1"><IdCard className="w-3 h-3" /> {v.visitor_id_number}</p>}
                        {v.visitor_phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" /> {v.visitor_phone}</p>}
                        {v.vehicle_registration && <p className="flex items-center gap-1"><Car className="w-3 h-3" /> {v.vehicle_registration}</p>}
                        {v.valid_from && <p className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(v.valid_from).toLocaleDateString()} – {v.valid_until ? new Date(v.valid_until).toLocaleDateString() : "Open"}</p>}
                      </div>
                      {v.otp_code && (
                        <div className="mt-2 p-2 bg-slate-900/60 rounded-lg inline-block">
                          <p className="text-xs text-slate-400">OTP Code</p>
                          <p className="text-2xl font-mono font-bold text-sky-400 tracking-widest">{v.otp_code}</p>
                        </div>
                      )}
                      <VisitorScanHistory visitor={v} />
                    </div>
                    <Badge variant="outline" className="border-slate-600 text-slate-400 capitalize">{v.visit_type?.replace("_", " ")}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showScanner && (
        <DocumentScanner
          caller="resident_visitors"
          documentType="auto"
          onClose={handleScannerClose}
          onAccept={handleScanAccept}
        />
      )}
    </div>
  );
}