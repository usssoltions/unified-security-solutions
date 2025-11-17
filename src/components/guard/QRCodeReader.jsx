import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, QrCode, Type, X, AlertCircle } from "lucide-react";
import jsQR from "jsqr";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    return () => {
      stopScanning();
    };
  }, []);

  const startScanning = async () => {
    setScanning(true);
    setError(null);
    
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
        requestAnimationFrame(tick);
      }
    } catch (err) {
      console.error("Camera error:", err);
      setError("Camera access denied. Please enable camera permissions and try again.");
      setScanning(false);
    }
  };

  const tick = () => {
    if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      
      canvas.height = videoRef.current.videoHeight;
      canvas.width = videoRef.current.videoWidth;
      
      context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "dontInvert",
      });
      
      if (code) {
        playSuccessSound();
        stopScanning();
        onScan(code.data);
        return;
      }
    }
    
    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const stopScanning = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
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
      const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE=');
      audio.volume = 0.5;
      audio.play();
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
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-4 border-sky-500 rounded-lg relative">
                <div className="absolute w-full h-1 bg-emerald-400 top-0 animate-scan" />
                <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
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
                📷 Scanning... Point camera at QR code
              </p>
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
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              <p className="text-rose-400 text-sm text-left">{error}</p>
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
              className="w-full border-slate-600 text-slate-300"
              onClick={() => setManualMode(!manualMode)}
            >
              <Type className="w-5 h-5 mr-2" />
              {manualMode ? "Hide Manual Entry" : "Enter Code Manually"}
            </Button>
          </div>

          {manualMode && (
            <div className="space-y-3 pt-4 border-t border-slate-700">
              <Input
                placeholder="Enter checkpoint code (e.g., SITE_CHCK_123)"
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

          <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg">
            <p className="text-xs text-slate-400">
              💡 <strong>Tips:</strong> Hold phone steady, ensure good lighting, and center the QR code in the frame
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}