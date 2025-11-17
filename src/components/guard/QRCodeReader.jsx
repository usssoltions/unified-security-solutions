import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Type, X, CheckCircle2 } from "lucide-react";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [jsQRLoaded, setJsQRLoaded] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanningRef = useRef(false);

  useEffect(() => {
    // Load jsQR library from CDN
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    script.async = true;
    script.onload = () => setJsQRLoaded(true);
    document.head.appendChild(script);

    return () => {
      stopScanning();
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
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
    if (!jsQRLoaded) {
      setError("QR scanner library still loading, please wait...");
      return;
    }

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
        videoRef.current.setAttribute('playsinline', true);
        await videoRef.current.play();
        
        // Start scanning with jsQR
        requestAnimationFrame(tick);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Cannot access camera. Please allow camera permissions or use manual entry.");
      setScanning(false);
      setManualMode(true);
    }
  };

  const tick = () => {
    if (!scanningRef.current || !videoRef.current || videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      if (scanningRef.current) {
        requestAnimationFrame(tick);
      }
      return;
    }

    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    if (!canvas) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = video.videoWidth;
      canvasRef.current.height = video.videoHeight;
    }

    const ctx = canvasRef.current.getContext('2d');
    canvasRef.current.width = video.videoWidth;
    canvasRef.current.height = video.videoHeight;
    
    ctx.drawImage(video, 0, 0, canvasRef.current.width, canvasRef.current.height);
    const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    if (window.jsQR) {
      const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });
      
      if (code) {
        handleScanSuccess(code.data);
        return;
      }
    }
    
    if (scanningRef.current) {
      requestAnimationFrame(tick);
    }
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
                    📷 Point camera at QR code
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
          {error && (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-amber-400 text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <Button
              className="w-full h-14 text-lg bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
              onClick={startScanning}
              disabled={!jsQRLoaded}
            >
              <Camera className="w-5 h-5 mr-2" />
              {jsQRLoaded ? "Scan QR Code" : "Loading Scanner..."}
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
              <p className="text-sm text-slate-400">Enter checkpoint code:</p>
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
        </div>
      </CardContent>
    </Card>
  );
}