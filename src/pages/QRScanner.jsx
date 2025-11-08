import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, QrCode, CheckCircle2, Camera } from "lucide-react";
import { createPageUrl } from "@/utils";
import QRCodeReader from "../components/guard/QRCodeReader";
import ChecklistForm from "../components/guard/ChecklistForm";

export default function QRScanner() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [scannedQR, setScannedQR] = useState(null);
  const [checkpoint, setCheckpoint] = useState(null);
  const [template, setTemplate] = useState(null);
  const [shift, setShift] = useState(null);

  useEffect(() => {
    loadData();
    getLocation();
  }, []);

  const loadData = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
    
    const shifts = await base44.entities.Shift.filter({
      guard_id: currentUser.id,
      status: "active"
    });
    if (shifts.length > 0) {
      setShift(shifts[0]);
    }
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      });
    }
  };

  const handleQRScan = async (qrCode) => {
    setScannedQR(qrCode);

    // Find checkpoint
    const sites = await base44.entities.Site.list();
    let foundCheckpoint = null;
    let foundSite = null;

    for (const site of sites) {
      const cp = site.checkpoints?.find(c => c.qr_code === qrCode);
      if (cp) {
        foundCheckpoint = cp;
        foundSite = site;
        break;
      }
    }

    if (!foundCheckpoint) {
      alert("Invalid QR code");
      return;
    }

    setCheckpoint({ ...foundCheckpoint, site_id: foundSite.id });

    // Find template
    const templates = await base44.entities.ChecklistTemplate.filter({
      checkpoint_id: foundCheckpoint.id,
      status: "active"
    });

    if (templates.length > 0) {
      setTemplate(templates[0]);
    }

    // Log patrol
    await base44.entities.PatrolLog.create({
      guard_id: user.id,
      guard_name: user.full_name,
      shift_id: shift.id,
      site_id: foundSite.id,
      checkpoint_id: foundCheckpoint.id,
      checkpoint_name: foundCheckpoint.name,
      qr_code: qrCode,
      location: location,
      timestamp: new Date().toISOString(),
      verified: true
    });
  };

  const handleChecklistComplete = () => {
    navigate(createPageUrl("GuardShift"));
  };

  if (!user || !shift) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(createPageUrl("GuardShift"))}
            className="text-slate-300"
          >
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Checkpoint Verification</h1>
            <p className="text-slate-400">Scan QR code at patrol checkpoint</p>
          </div>
        </div>

        {!scannedQR && (
          <QRCodeReader onScan={handleQRScan} />
        )}

        {scannedQR && checkpoint && (
          <Card className="bg-slate-800/50 border-slate-700 mb-6">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-white">Checkpoint Verified</CardTitle>
                  <p className="text-sm text-slate-400">{checkpoint.name}</p>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        {template && checkpoint && (
          <ChecklistForm
            template={template}
            checkpoint={checkpoint}
            shift={shift}
            user={user}
            location={location}
            qrCode={scannedQR}
            onComplete={handleChecklistComplete}
          />
        )}

        {scannedQR && !template && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-6 text-center">
              <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">Checkpoint Logged</h3>
              <p className="text-slate-400 mb-6">No checklist required for this checkpoint</p>
              <Button onClick={() => navigate(createPageUrl("GuardShift"))} className="bg-sky-600">
                Return to Shift
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}