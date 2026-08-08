import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserPlus, IdCard, Phone, Car, Clock, QrCode, MapPin, Calendar, User } from "lucide-react";
import DocumentScanner from "@/components/documents/DocumentScanner";
import VisitorScanHistory from "@/components/documents/VisitorScanHistory";
import { uploadDocumentPhotoWithThumbnail } from "@/lib/documentPhotoManager";
import { recordScanAudit, getQuickGPS } from "@/lib/documentScanAudit";
import { visitorQrImageUrl } from "@/lib/whatsapp";
import VisitorQrShareModal from "@/components/visitors/VisitorQrShareModal";
import ExpectedVisitorForm from "@/components/visitors/ExpectedVisitorForm";

export default function ResidentVisitors() {
  const [user, setUser] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanPayload, setScanPayload] = useState(null);
  const [shareVisitor, setShareVisitor] = useState(null);
  const scanOpenRef = useRef(0);
  const qc = useQueryClient();

  useEffect(() => { base44.auth.me().then(setUser); }, []);

  const { data: visitors = [] } = useQuery({
    queryKey: ["my_visitors", user?.id],
    queryFn: () => base44.entities.Visitor.filter({ resident_id: user?.id }),
    enabled: !!user, initialData: []
  });

  const { data: destinations = [] } = useQuery({
    queryKey: ["destinations"],
    queryFn: () => base44.entities.Destination.list(),
    enabled: !!user, initialData: []
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const qrCode = "VST" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
      return await base44.entities.Visitor.create({
        ...data,
        resident_id: user.id,
        resident_name: user.full_name,
        unit_number: user.unit_number,
        otp_code: otp,
        qr_code: qrCode,
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
      // Notify relevant staff (admins / guards) via backend (in-app + email)
      if (_data?.id) {
        base44.functions.invoke("sendVisitorRegistrationNotification", {
          visitorId: _data.id,
          visitorName: variables.visitor_name,
          visitorIdNumber: variables.visitor_id_number,
          visitorPhone: variables.visitor_phone,
          vehicleReg: variables.vehicle_registration,
          hostName: user.full_name,
          unitNumber: user.unit_number,
          validFrom: variables.valid_from,
          validUntil: variables.valid_until,
          qrCode: _data.qr_code,
          otp: _data.otp_code,
        }).catch(() => {});
      }
      qc.invalidateQueries(["my_visitors"]);
      setShowForm(false);
      setScanPayload(null);
      setShareVisitor(_data);
    }
  });

  const handleScanAccept = async (scan) => {
    const duration = Date.now() - scanOpenRef.current;
    const { result, photoUrl, mappedFields, resolvedProfileId, parserUsed, sdkVersion, qrInfo } = scan;
    const rawJson = result?.formattedJSON ? JSON.stringify(result.formattedJSON, null, 2) : (result?.textualData || "");

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

    setShowScanner(false);
    setShowForm(true);
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

  const statusColors = {
    pending: "bg-amber-600", approved: "bg-emerald-600", denied: "bg-rose-600",
    entered: "bg-sky-600", exited: "bg-slate-600", expired: "bg-slate-500"
  };

  const fmtDateTime = (date, time) => {
    if (!date) return null;
    const d = new Date(`${date}T${time || "00:00"}:00`);
    return isNaN(d) ? null : d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
  };

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
          <ExpectedVisitorForm
            user={user}
            destinations={destinations}
            scanPayload={scanPayload}
            onScanOpen={openScanner}
            onClearScan={() => setScanPayload(null)}
            onSubmit={(payload) => createMutation.mutate(payload)}
            pending={createMutation.isPending}
            onCancel={() => { setShowForm(false); setScanPayload(null); }}
          />
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
            {visitors.map((v) => {
              const isVehicle = v.visitor_entry_type === "vehicle";
              return (
                <Card key={v.id} className="bg-slate-800/50 border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-white font-semibold truncate">{v.visitor_name} {v.surname ? v.surname : ""}</p>
                          <Badge className={statusColors[v.status]}>{v.status}</Badge>
                          {v.visitor_entry_type && (
                            <Badge variant="outline" className={`capitalize text-xs ${isVehicle ? "border-sky-500 text-sky-400" : "border-emerald-500 text-emerald-400"}`}>
                              {isVehicle ? <><Car className="w-3 h-3 mr-1" /> Vehicle</> : <><User className="w-3 h-3 mr-1" /> Pedestrian</>}
                            </Badge>
                          )}
                          {v.id_scan_url && (
                            <img src={v.id_scan_url} alt="ID" className="w-6 h-8 object-cover rounded border border-slate-600" style={{ imageRendering: "pixelated" }} />
                          )}
                        </div>
                        <div className="space-y-1 text-sm text-slate-400">
                          {v.visitor_id_number && <p className="flex items-center gap-1"><IdCard className="w-3 h-3" /> {v.visitor_id_number}</p>}
                          {v.visitor_phone && <p className="flex items-center gap-1"><Phone className="w-3 h-3" /> {v.visitor_phone}</p>}
                          {v.vehicle_registration && <p className="flex items-center gap-1"><Car className="w-3 h-3" /> {v.vehicle_registration}</p>}
                          {v.destination && <p className="flex items-center gap-1"><MapPin className="w-3 h-3 text-amber-400" /> <span className="text-amber-300 font-medium">{v.destination}</span></p>}
                          {fmtDateTime(v.expected_date, v.expected_arrival_time) && (
                            <p className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Expected {fmtDateTime(v.expected_date, v.expected_arrival_time)}</p>
                          )}
                          {v.valid_until && <p className="flex items-center gap-1"><Clock className="w-3 h-3" /> Until {new Date(v.valid_until).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}</p>}
                        </div>
                        {v.otp_code && (
                          <div className="mt-2 p-2 bg-slate-900/60 rounded-lg inline-block">
                            <p className="text-xs text-slate-400">OTP Code</p>
                            <p className="text-2xl font-mono font-bold text-sky-400 tracking-widest">{v.otp_code}</p>
                          </div>
                        )}
                        {v.qr_code && (
                          <div className="mt-2 flex items-center gap-3">
                            <img src={visitorQrImageUrl(v.qr_code)} alt="Visitor QR" className="w-16 h-16 bg-white p-1 rounded shrink-0" />
                            <Button size="sm" variant="outline" className="border-slate-600 text-slate-300" onClick={() => setShareVisitor(v)}>
                              <QrCode className="w-4 h-4 mr-1" /> Show / Send QR
                            </Button>
                          </div>
                        )}
                        <VisitorScanHistory visitor={v} />
                      </div>
                      <Badge variant="outline" className="border-slate-600 text-slate-400 capitalize shrink-0">{v.visit_type?.replace("_", " ")}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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

      {shareVisitor && (
        <VisitorQrShareModal
          visitor={shareVisitor}
          hostName={user?.full_name}
          onClose={() => setShareVisitor(null)}
        />
      )}
    </div>
  );
}