import React, { useState, useRef, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Camera, CheckCircle, XCircle, FileSearch, Loader2, UserCheck, RefreshCw,
} from "lucide-react";
import DocumentScanner from "@/components/documents/DocumentScanner";
import { getUserDisplayName } from "@/lib/userDisplayName";

/**
 * PatientCheckIn — Medical identity verification workflow.
 *
 * Uses the EXISTING protected Barkoder DocumentScanner (no scanner config changes).
 * Flow: Scan SA ID / Driver's Licence → capture realtime photo → staff compares →
 * select Verified / Failed / Manual Review → save PatientIdentityVerification →
 * update Appointment to "arrived" (only if verified).
 *
 * Human-assisted identity verification — NOT facial recognition.
 */
export default function PatientCheckIn({ appointment, user, onClose, onVerified }) {
  const [step, setStep] = useState("scan"); // scan | photo | compare
  const [scanFields, setScanFields] = useState(null);
  const [docType, setDocType] = useState("manual");
  const [docPhoto, setDocPhoto] = useState(null);
  const [realtimePhoto, setRealtimePhoto] = useState(null);
  const [result, setResult] = useState(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  // --- Step 1: DocumentScanner onAccept ---
  const handleScanAccept = useCallback((payload) => {
    const fields = payload.mappedFields || {};
    const profileName = (payload.profile?.name || payload.resolvedProfileId || "").toLowerCase();
    let dt = "manual";
    if (profileName.includes("sa_id") || profileName.includes("sa-id") || profileName.includes("id")) dt = "sa_id";
    else if (profileName.includes("driver") || profileName.includes("licence") || profileName.includes("dl")) dt = "drivers_licence";

    setDocType(dt);
    setScanFields({
      first_names: fields.first_names || fields.names || "",
      surname: fields.surname || "",
      id_number: fields.id_number || fields.sa_id_number || fields.drivers_licence_number || "",
    });
    setDocPhoto(payload.photoUrl || null);
    setStep("photo");
  }, []);

  // --- Step 2: realtime photo ---
  useEffect(() => {
    if (step !== "photo") return;
    let cancelled = false;
    const startCam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
      } catch (e) {
        setError("Camera access denied. Allow camera permission to capture a realtime photo.");
      }
    };
    startCam();
    return () => {
      cancelled = true;
      if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
      setCameraReady(false);
    };
  }, [step]);

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 640;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }

    try {
      const blob = await fetch(dataUrl).then(r => r.blob());
      const file = new File([blob], "patient_realtime.jpg", { type: "image/jpeg" });
      const res = await base44.integrations.Core.UploadFile({ file });
      setRealtimePhoto(res.file_url);
      setStep("compare");
    } catch (e) {
      setError("Failed to upload realtime photo: " + (e.message || e));
    }
  }, []);

  // --- Step 3: save verification ---
  const saveVerification = async () => {
    if ((result === "failed" || result === "manual_review") && !reason.trim()) {
      setError("Reason is required for " + (result === "failed" ? "verification failure" : "manual review"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const scanSummary = scanFields
        ? JSON.stringify(scanFields).slice(0, 500)
        : null;

      const verification = await base44.entities.PatientIdentityVerification.create({
        customer_id: user.customer_id,
        patient_id: appointment.patient_id,
        patient_name: appointment.patient_name,
        document_type: docType,
        document_photo_url: docPhoto,
        realtime_photo_url: realtimePhoto,
        result,
        failure_reason: result !== "verified" ? reason.trim() : null,
        verifier_id: user.id,
        verifier_name: getUserDisplayName(user),
        verified_at: new Date().toISOString(),
        scan_data: scanSummary,
      });

      // Only advance appointment to "arrived" if verified
      if (result === "verified") {
        await base44.entities.Appointment.update(appointment.id, {
          status: "arrived",
          arrival_verified: true,
          arrival_time: new Date().toISOString(),
          check_in_user_id: user.id,
          check_in_user_name: getUserDisplayName(user),
        });
      }

      onVerified?.(verification);
      handleClose();
    } catch (e) {
      setError("Failed to save verification: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    onClose?.();
  };

  const rescan = () => {
    setScanFields(null);
    setDocPhoto(null);
    setRealtimePhoto(null);
    setResult(null);
    setReason("");
    setError(null);
    setStep("scan");
  };

  // Step 1: full-screen DocumentScanner (not wrapped in Dialog)
  if (step === "scan") {
    return (
      <DocumentScanner
        caller="medical_checkin"
        documentType="auto"
        onClose={handleClose}
        onAccept={handleScanAccept}
      />
    );
  }

  // Steps 2-3: Dialog
  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent className="bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-emerald-400" />
            Patient Check-In — {appointment.patient_name}
          </DialogTitle>
        </DialogHeader>

        {step === "photo" && (
          <div className="space-y-4">
            <p className="text-slate-300 text-sm">
              Document scanned. Now capture a realtime photo of the patient for comparison.
            </p>
            {scanFields && (
              <div className="bg-slate-800 rounded-lg p-3 space-y-1">
                <p className="text-white text-sm font-medium">Extracted identity:</p>
                <p className="text-slate-300 text-sm">{scanFields.first_names} {scanFields.surname}</p>
                {scanFields.id_number && <p className="text-slate-400 text-xs">ID: {scanFields.id_number}</p>}
                <p className="text-slate-500 text-xs">Document: {docType.replace(/_/g, " ")}</p>
              </div>
            )}
            <div className="flex flex-col items-center gap-2">
              <video ref={videoRef} className="w-48 h-48 object-cover rounded-lg border border-slate-700 bg-slate-800" />
              <canvas ref={canvasRef} className="hidden" />
              {!cameraReady && !error && (
                <p className="text-slate-400 text-xs flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Starting camera...
                </p>
              )}
            </div>
            {docPhoto && (
              <div>
                <p className="text-slate-400 text-xs mb-1">Document photo:</p>
                <img src={docPhoto} alt="Document" className="w-28 h-28 object-cover rounded-lg border border-slate-700" />
              </div>
            )}
            {error && <p className="text-rose-400 text-sm">{error}</p>}
            <div className="flex gap-2">
              <Button onClick={capturePhoto} disabled={!cameraReady} className="bg-emerald-500 hover:bg-emerald-600">
                <Camera className="w-4 h-4 mr-2" /> Capture Photo
              </Button>
              <Button onClick={rescan} variant="outline" className="border-slate-700 text-slate-300">
                <RefreshCw className="w-4 h-4 mr-2" /> Re-scan
              </Button>
            </div>
          </div>
        )}

        {step === "compare" && (
          <>
            <div className="space-y-4">
              <p className="text-slate-300 text-sm font-medium">
                Compare the document photo with the realtime photo, then select a verification result:
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-400 text-xs mb-2">Document photo:</p>
                  {docPhoto ? (
                    <img src={docPhoto} alt="Document" className="w-full aspect-square object-cover rounded-lg border border-slate-700" />
                  ) : (
                    <div className="w-full aspect-square bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-sm">No photo</div>
                  )}
                </div>
                <div>
                  <p className="text-slate-400 text-xs mb-2">Realtime photo:</p>
                  {realtimePhoto ? (
                    <img src={realtimePhoto} alt="Realtime" className="w-full aspect-square object-cover rounded-lg border border-slate-700" />
                  ) : (
                    <div className="w-full aspect-square bg-slate-800 rounded-lg flex items-center justify-center text-slate-500 text-sm">No photo</div>
                  )}
                </div>
              </div>
              {scanFields && (
                <div className="bg-slate-800 rounded-lg p-3">
                  <p className="text-white text-sm font-medium">{scanFields.first_names} {scanFields.surname}</p>
                  {scanFields.id_number && <p className="text-slate-400 text-xs">ID: {scanFields.id_number}</p>}
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">Verification result:</Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button onClick={() => setResult("verified")} variant={result === "verified" ? "default" : "outline"}
                    className={result === "verified" ? "bg-emerald-500 hover:bg-emerald-600" : "border-slate-700 text-slate-300"}>
                    <CheckCircle className="w-4 h-4 mr-1" /> Verified
                  </Button>
                  <Button onClick={() => setResult("failed")} variant={result === "failed" ? "default" : "outline"}
                    className={result === "failed" ? "bg-rose-500 hover:bg-rose-600" : "border-slate-700 text-slate-300"}>
                    <XCircle className="w-4 h-4 mr-1" /> Failed
                  </Button>
                  <Button onClick={() => setResult("manual_review")} variant={result === "manual_review" ? "default" : "outline"}
                    className={result === "manual_review" ? "bg-amber-500 hover:bg-amber-600" : "border-slate-700 text-slate-300"}>
                    <FileSearch className="w-4 h-4 mr-1" /> Review
                  </Button>
                </div>
              </div>
              {result && result !== "verified" && (
                <div>
                  <Label className="text-slate-300 text-sm">Reason (required):</Label>
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
                    className="bg-slate-800 border-slate-700 text-white mt-1" rows={2}
                    placeholder={result === "failed" ? "Explain why identity could not be verified..." : "Explain why manual review is needed..."} />
                </div>
              )}
              {error && <p className="text-rose-400 text-sm">{error}</p>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={rescan} className="border-slate-700 text-slate-300">
                <RefreshCw className="w-4 h-4 mr-2" /> Re-scan
              </Button>
              <Button onClick={saveVerification} disabled={!result || saving || (result !== "verified" && !reason.trim())}
                className="bg-emerald-500 hover:bg-emerald-600">
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save Verification
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}