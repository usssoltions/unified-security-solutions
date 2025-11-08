import React, { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, QrCode, Type } from "lucide-react";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const fileInputRef = useRef(null);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // In production, use a QR code scanning library like jsQR
    // For now, simulate QR scan
    const simulatedQR = `CHK-${Math.random().toString(36).substring(7).toUpperCase()}`;
    onScan(simulatedQR);
  };

  const handleManualSubmit = () => {
    if (manualCode.trim()) {
      onScan(manualCode.trim());
    }
  };

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="pt-6">
        <div className="text-center space-y-6">
          <div className="w-48 h-48 mx-auto bg-slate-900 rounded-2xl border-4 border-dashed border-slate-600 flex items-center justify-center">
            <QrCode className="w-24 h-24 text-slate-500" />
          </div>

          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileUpload}
              className="hidden"
            />

            <Button
              className="w-full h-14 text-lg bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera className="w-5 h-5 mr-2" />
              Scan QR Code
            </Button>

            <Button
              variant="outline"
              className="w-full border-slate-600 text-slate-300"
              onClick={() => setManualMode(!manualMode)}
            >
              <Type className="w-5 h-5 mr-2" />
              Enter Code Manually
            </Button>
          </div>

          {manualMode && (
            <div className="space-y-3 pt-4 border-t border-slate-700">
              <Input
                placeholder="Enter checkpoint code"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                className="bg-slate-900 border-slate-700 text-white"
                onKeyPress={(e) => e.key === "Enter" && handleManualSubmit()}
              />
              <Button
                onClick={handleManualSubmit}
                disabled={!manualCode.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                Submit Code
              </Button>
            </div>
          )}

          <p className="text-xs text-slate-500">
            For demo: Click "Scan QR Code" to simulate scanning, or enter any code manually
          </p>
        </div>
      </CardContent>
    </Card>
  );
}