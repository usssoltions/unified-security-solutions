import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, QrCode, Type, X, AlertCircle, CheckCircle2, Scan } from "lucide-react";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, []);

  const stopScanning = () => {
    scanningRef.current = false;
    
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
    setScanning(true);
    setError(null);
    setScanSuccess(false);
    setManualMode(false);
    scanningRef.current = true;
    
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
        await videoRef.current.play();
        
        // Try native Barcode Detection API
        if ('BarcodeDetector' in window) {
          try {
            const formats = await window.BarcodeDetector.getSupportedFormats();
            if (formats.includes('qr_code')) {
              const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
              detectWithNativeAPI(detector);
              return;
            }
          } catch (e) {
            console.log("Barcode API failed, falling back to canvas");
          }
        }
        
        // Fallback to canvas-based detection
        detectWithCanvas();
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Cannot access camera. Please use manual entry.");
      setScanning(false);
      setManualMode(true);
    }
  };

  const detectWithNativeAPI = async (detector) => {
    const detect = async () => {
      if (!scanningRef.current) return;
      
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        try {
          const barcodes = await detector.detect(videoRef.current);
          if (barcodes.length > 0) {
            handleScanSuccess(barcodes[0].rawValue);
            return;
          }
        } catch (err) {
          // Continue scanning
        }
      }
      
      if (scanningRef.current) {
        requestAnimationFrame(detect);
      }
    };
    detect();
  };

  const detectWithCanvas = () => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
    }
    
    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    const scan = () => {
      if (!scanningRef.current || !video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        if (scanningRef.current) {
          requestAnimationFrame(scan);
        }
        return;
      }
      
      const ctx = canvas.getContext('2d');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Simple QR detection - look for patterns
      // This is a basic implementation, not as robust as a full library
      try {
        const qrData = scanImageForQR(imageData);
        if (qrData) {
          handleScanSuccess(qrData);
          return;
        }
      } catch (e) {
        // Continue scanning
      }
      
      if (scanningRef.current) {
        requestAnimationFrame(scan);
      }
    };
    
    scan();
  };

  const scanImageForQR = (imageData) => {
    // This is a placeholder - in production you'd use a proper QR library
    // For now, we'll rely on the native API or manual entry
    return null;
  };

  const handleScanSuccess = (code) => {
    if (!code) return;
    
    scanningRef.current = false;
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
      
      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch (e) {
      // Silent fail
    }
  };

  const handleManualSubmit = () => {
    if (manualCode.trim()) {
      onScan(manualCode.trim());
      setManualCode("");
      setManualMode(false);
    }
  };

  if (scanning) {
    return (
      <Card className="bg-slate-800/50 border-slate-700">
        <CardContent className="pt-6 space-y-4">
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
                <div className="w-64 h-64 border-4 border-emerald-500 rounded-lg bg-emerald-500/20 flex items-center justify-center animate-pulse">
                  <CheckCircle2 className="w-24 h-24 text-emerald-400" />
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
                <p className="text-white bg-emerald-600 px-4 py-3 rounded-lg text-center font-semibold">
                  ✓ QR Code Detected!
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-white bg-slate-900/90 px-4 py-3 rounded-lg text-center font-semibold">
                    📷 Hold steady, center QR code
                  </p>
                  <Button
                    onClick={() => {
                      stopScanning();
                      setManualMode(true);
                    }}
                    className="w-full bg-amber-600 hover:bg-amber-700"
                    size="sm"
                  >
                    <Type className="w-4 h-4 mr-2" />
                    Can't Scan? Enter Manually
                  </Button>
                </div>
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
          <div className="w-48 h-48 mx-auto bg-slate-900 rounded-2xl border-4 border-dashed border-slate-600 flex items-center justify-center">
            <QrCode className="w-24 h-24 text-slate-500" />
          </div>

          {error && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-amber-400 text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <Button
              className="w-full h-14 text-lg bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
              onClick={startScanning}
            >
              <Camera className="w-5 h-5 mr-2" />
              Scan QR Code
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-700" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-slate-800 px-2 text-slate-500">OR</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full h-14 text-lg border-slate-600 text-slate-300 hover:bg-slate-700"
              onClick={() => setManualMode(!manualMode)}
            >
              <Type className="w-5 h-5 mr-2" />
              Enter Code Manually
            </Button>
          </div>

          {manualMode && (
            <div className="space-y-3 pt-4 border-t border-slate-700">
              <p className="text-sm text-slate-400">Enter any checkpoint code:</p>
              <Input
                placeholder="Type or paste code here"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                className="bg-slate-900 border-slate-700 text-white text-center font-mono text-lg h-14"
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
              💡 Best on Chrome Android. Hold phone 6-8 inches from QR code with good lighting.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}