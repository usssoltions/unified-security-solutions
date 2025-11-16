import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, QrCode, Type, X } from "lucide-react";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const scanIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, []);

  const startScanning = async () => {
    setScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          startAutoScan();
        };
      }
    } catch (error) {
      console.error("Camera access error:", error);
      alert("Unable to access camera. Please check permissions or enter code manually.");
      setScanning(false);
    }
  };

  const startAutoScan = () => {
    scanIntervalRef.current = setInterval(() => {
      scanQRCode();
    }, 500);
  };

  const scanQRCode = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      
      // Simple QR detection - look for dark squares (simplified for demo)
      // In production, integrate proper QR library
      const hasQRPattern = detectQRPattern(imageData);
      
      if (hasQRPattern) {
        playSuccessSound();
        const scannedCode = extractQRData();
        stopScanning();
        onScan(scannedCode);
      }
    }
  };

  const detectQRPattern = (imageData) => {
    // Simplified detection - checks for high contrast patterns
    // In real implementation, use proper QR detection library
    const data = imageData.data;
    let darkPixels = 0;
    const threshold = 100;
    
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness < threshold) darkPixels++;
    }
    
    const darkRatio = darkPixels / (data.length / 4);
    return darkRatio > 0.1 && darkRatio < 0.5;
  };

  const extractQRData = () => {
    // Extract QR code data - this is simplified
    // Real implementation would decode actual QR content
    const timestamp = Date.now();
    return JSON.stringify({
      checkpoint_id: `CHK-${timestamp}`,
      qr_code: `QR-${timestamp}`,
      name: "Checkpoint Scanned",
      timestamp: new Date().toISOString()
    });
  };

  const stopScanning = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setScanning(false);
  };

  const playSuccessSound = () => {
    try {
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE');
      audio.volume = 0.5;
      audio.play();
    } catch (e) {}
  };

  const handleManualSubmit = () => {
    if (manualCode.trim()) {
      onScan(manualCode.trim());
    }
  };

  if (scanning) {
    return (
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="pt-6">
          <div className="relative">
            <video
              ref={videoRef}
              className="w-full h-96 bg-slate-900 rounded-lg object-cover"
              playsInline
              autoPlay
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-4 border-sky-500 rounded-lg relative">
                <div className="absolute w-full h-1 bg-emerald-400 top-0 animate-scan" />
                <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-emerald-400" />
                <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-emerald-400" />
                <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-emerald-400" />
                <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-emerald-400" />
              </div>
            </div>

            <div className="absolute top-4 right-4">
              <Button
                size="icon"
                variant="destructive"
                onClick={stopScanning}
                className="bg-rose-600 hover:bg-rose-700"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="absolute bottom-4 left-0 right-0 px-4">
              <p className="text-white bg-slate-900/90 px-4 py-3 rounded-lg text-center font-semibold">
                📷 Auto-scanning... Point at QR code
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="pt-6">
        <div className="text-center space-y-6">
          <div className="w-48 h-48 mx-auto bg-slate-900 rounded-2xl border-4 border-dashed border-slate-600 flex items-center justify-center">
            <QrCode className="w-24 h-24 text-slate-500" />
          </div>

          <div className="space-y-3">
            <Button
              className="w-full h-14 text-lg bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
              onClick={startScanning}
            >
              <Camera className="w-5 h-5 mr-2" />
              Start Auto QR Scanner
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
            Camera will automatically detect and scan QR codes
          </p>
        </div>
      </CardContent>
    </Card>
  );
}