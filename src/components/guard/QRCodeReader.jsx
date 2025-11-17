import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, QrCode, Type, X, AlertCircle, CheckCircle2, Keyboard } from "lucide-react";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(true);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [apiAvailable, setApiAvailable] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const scanIntervalRef = useRef(null);

  useEffect(() => {
    if ('BarcodeDetector' in window) {
      window.BarcodeDetector.getSupportedFormats().then(formats => {
        if (formats.includes('qr_code')) {
          detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
          setApiAvailable(true);
        }
      }).catch(() => {
        setApiAvailable(false);
      });
    }
    
    return () => {
      stopScanning();
    };
  }, []);

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

  const startScanning = async () => {
    if (!apiAvailable) {
      setError("QR scanning not supported in this browser. Please use manual entry below.");
      return;
    }

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
      setError("Cannot access camera. Please use manual entry below.");
      setScanning(false);
    }
  };

  const startDetection = () => {
    scanIntervalRef.current = setInterval(async () => {
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        try {
          if (detectorRef.current) {
            const barcodes = await detectorRef.current.detect(videoRef.current);
            if (barcodes.length > 0) {
              handleScanSuccess(barcodes[0].rawValue);
            }
          }
        } catch (err) {
          // Silent fail - keep scanning
        }
      }
    }, 300);
  };

  const handleScanSuccess = (code) => {
    setScanSuccess(true);
    playSuccessSound();
    
    setTimeout(() => {
      stopScanning();
      onScan(code);
    }, 500);
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
          <div className="w-48 h-48 mx-auto bg-gradient-to-br from-sky-500/20 to-emerald-500/20 rounded-2xl border-4 border-sky-500/30 flex items-center justify-center">
            <Keyboard className="w-24 h-24 text-sky-400" />
          </div>

          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white">Enter Checkpoint Code</h3>
            <p className="text-sm text-slate-400">Type the code from the QR label</p>
          </div>

          {error && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-amber-400 text-sm text-left">{error}</p>
            </div>
          )}

          <div className="space-y-4 pt-2">
            <Input
              placeholder="Enter checkpoint code"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
              className="bg-slate-900 border-slate-700 text-white text-center font-mono text-xl h-16"
              onKeyPress={(e) => e.key === "Enter" && handleManualSubmit()}
              autoFocus
            />
            <Button
              onClick={handleManualSubmit}
              disabled={!manualCode.trim()}
              className="w-full h-14 text-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700"
            >
              <CheckCircle2 className="w-5 h-5 mr-2" />
              Submit Checkpoint Code
            </Button>

            {apiAvailable && (
              <div className="pt-4 border-t border-slate-700">
                <Button
                  variant="outline"
                  className="w-full h-12 border-slate-600 text-slate-300 hover:bg-slate-700"
                  onClick={startScanning}
                >
                  <Camera className="w-5 h-5 mr-2" />
                  Try Camera Scanner Instead
                </Button>
              </div>
            )}
          </div>

          <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg text-left">
            <p className="text-xs text-slate-400">
              💡 <strong>Where to find the code:</strong> Look for a text code printed below or next to the QR code at the checkpoint location.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}