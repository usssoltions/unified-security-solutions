import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, QrCode, Type, X, AlertCircle, CheckCircle2 } from "lucide-react";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const scanIntervalRef = useRef(null);

  useEffect(() => {
    // Check if Barcode Detection API is available
    if ('BarcodeDetector' in window) {
      window.BarcodeDetector.getSupportedFormats().then(formats => {
        if (formats.includes('qr_code')) {
          detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
        }
      });
    }
    
    return () => {
      stopScanning();
    };
  }, []);

  const startScanning = async () => {
    setScanning(true);
    setError(null);
    setScanSuccess(false);
    
    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute("playsinline", true);
        
        await videoRef.current.play();
        startDetection();
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Cannot access camera. Please enable camera permissions in your browser settings.");
      setScanning(false);
      setManualMode(true);
    }
  };

  const startDetection = () => {
    scanIntervalRef.current = setInterval(async () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        try {
          if (detectorRef.current) {
            // Use native Barcode Detection API
            const barcodes = await detectorRef.current.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleScanSuccess(barcodes[0].rawValue);
            }
          }
        } catch (err) {
          // Silent fail - keep scanning
        }
      }
    }, 300); // Check every 300ms
  };

  const handleScanSuccess = (code) => {
    setScanSuccess(true);
    playSuccessSound();
    
    setTimeout(() => {
      stopScanning();
      onScan(code);
    }, 500);
  };

  const stopScanning = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setScanning(false);
    setScanSuccess(false);
  };

  const playSuccessSound = () => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      // Silent fail
    }
  };

  const handleManualSubmit = () => {
    if (manualCode.trim()) {
      onScan(manualCode.trim());
      setManualCode("");
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
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              {scanSuccess ? (
                <div className="w-64 h-64 border-4 border-emerald-500 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 className="w-24 h-24 text-emerald-400 animate-pulse" />
                </div>
              ) : (
                <div className="w-64 h-64 border-4 border-sky-500 rounded-lg relative">
                  <div className="absolute w-full h-1 bg-emerald-400 top-0 animate-scan" />
                  <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
                </div>
              )}
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
              {scanSuccess ? (
                <p className="text-white bg-emerald-600 px-4 py-3 rounded-lg text-center font-semibold flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-5 h-5" />
                  QR Code Detected!
                </p>
              ) : (
                <p className="text-white bg-slate-900/90 px-4 py-3 rounded-lg text-center font-semibold">
                  📷 Scanning... Point camera at QR code
                </p>
              )}
            </div>
          </div>
          
          {!detectorRef.current && (
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-xs text-amber-400 text-center">
                ⚠️ Native QR detection not available. Please try manual entry below or use a different browser.
              </p>
            </div>
          )}
          
          <style>{`
            @keyframes scan {
              0% { transform: translateY(0); }
              100% { transform: translateY(256px); }
            }
            .animate-scan {
              animation: scan 2s linear infinite;
            }
          `}</style>
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

          {error && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              <div className="text-left">
                <p className="text-rose-400 text-sm font-semibold mb-1">{error}</p>
                <p className="text-xs text-slate-400">Use manual entry below or check camera permissions in your browser settings.</p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Button
              className="w-full h-14 text-lg bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
              onClick={startScanning}
            >
              <Camera className="w-5 h-5 mr-2" />
              Start QR Scanner
            </Button>

            <Button
              variant="outline"
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
              onClick={() => setManualMode(!manualMode)}
            >
              <Type className="w-5 h-5 mr-2" />
              {manualMode ? "Hide Manual Entry" : "Enter Code Manually"}
            </Button>
          </div>

          {manualMode && (
            <div className="space-y-3 pt-4 border-t border-slate-700">
              <p className="text-sm text-slate-400">Enter the checkpoint code from the QR label:</p>
              <Input
                placeholder="e.g., SITE_CHCK_123"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                className="bg-slate-900 border-slate-700 text-white text-center font-mono text-lg"
                onKeyPress={(e) => e.key === "Enter" && handleManualSubmit()}
                autoFocus
              />
              <Button
                onClick={handleManualSubmit}
                disabled={!manualCode.trim()}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="w-5 h-5 mr-2" />
                Submit Code
              </Button>
            </div>
          )}

          <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg">
            <p className="text-xs text-slate-400">
              💡 <strong>Tips:</strong> Hold phone steady, ensure good lighting, and center the QR code in the frame. Works best in Chrome or Safari.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}