import React, { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera, Type, X, CheckCircle2, Zap, Smartphone } from "lucide-react";

export default function QRCodeReader({ onScan }) {
  const [manualMode, setManualMode] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [jsQRLoaded, setJsQRLoaded] = useState(false);
  const [scanAttempts, setScanAttempts] = useState(0);
  const [barcodeDetectorSupported, setBarcodeDetectorSupported] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanningRef = useRef(false);
  const lastScanTimeRef = useRef(0);

  useEffect(() => {
    // Check if BarcodeDetector API is supported (native browser QR scanning)
    if ('BarcodeDetector' in window) {
      setBarcodeDetectorSupported(true);
      console.log('Native BarcodeDetector API supported');
    }

    // Load jsQR library from CDN as fallback
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    script.async = true;
    script.onload = () => {
      setJsQRLoaded(true);
      console.log('jsQR library loaded successfully');
    };
    script.onerror = () => {
      console.error('Failed to load jsQR library');
      if (!barcodeDetectorSupported) {
        setError("QR scanner library failed to load. Please use manual entry.");
        setManualMode(true);
      }
    };
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
    setScanAttempts(0);
  };

  const handleNativeCameraCapture = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Try BarcodeDetector API first (newer, native)
      if ('BarcodeDetector' in window) {
        const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const barcodes = await barcodeDetector.detect(file);
        
        if (barcodes.length > 0) {
          handleScanSuccess(barcodes[0].rawValue);
          return;
        }
      }

      // Fallback to jsQR
      if (window.jsQR) {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        
        await new Promise((resolve) => {
          img.onload = resolve;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth",
        });

        if (code && code.data) {
          handleScanSuccess(code.data);
          URL.revokeObjectURL(img.src);
          return;
        }
        
        URL.revokeObjectURL(img.src);
      }

      alert("No QR code detected in photo. Please try again or enter code manually.");
    } catch (error) {
      console.error("Failed to scan QR from photo:", error);
      alert("Failed to scan QR code. Please try again or use manual entry.");
    }
    
    // Reset file input
    e.target.value = '';
  };

  const startScanning = async () => {
    if (!jsQRLoaded && !barcodeDetectorSupported) {
      setError("QR scanner still loading, please wait a moment...");
      setTimeout(() => {
        if (jsQRLoaded || barcodeDetectorSupported) {
          startScanning();
        }
      }, 1000);
      return;
    }

    setScanning(true);
    setError(null);
    setScanSuccess(false);
    setManualMode(false);
    scanningRef.current = true;
    setScanAttempts(0);
    
    try {
      const constraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { min: 640, ideal: 1920, max: 1920 },
          height: { min: 480, ideal: 1080, max: 1080 },
          aspectRatio: { ideal: 16/9 },
          frameRate: { ideal: 30, max: 60 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', true);
        videoRef.current.setAttribute('autoplay', true);
        
        await videoRef.current.play();
        
        console.log('Camera started, beginning QR scan...');
        
        await new Promise((resolve) => {
          const checkReady = () => {
            if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
              resolve();
            } else {
              setTimeout(checkReady, 100);
            }
          };
          checkReady();
        });
        
        requestAnimationFrame(tick);
      }
    } catch (err) {
      console.error("Camera error:", err);
      let errorMessage = "Cannot access camera. ";
      
      if (err.name === 'NotAllowedError') {
        errorMessage += "Please allow camera permission in your browser settings.";
      } else if (err.name === 'NotFoundError') {
        errorMessage += "No camera found on this device.";
      } else {
        errorMessage += "Please check camera permissions and try again.";
      }
      
      setError(errorMessage);
      setScanning(false);
      setManualMode(true);
    }
  };

  const tick = async () => {
    if (!scanningRef.current) return;

    const video = videoRef.current;
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      requestAnimationFrame(tick);
      return;
    }

    try {
      // Try BarcodeDetector API first (more efficient, native)
      if (barcodeDetectorSupported && 'BarcodeDetector' in window) {
        setScanAttempts(prev => prev + 1);
        
        try {
          const barcodeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const barcodes = await barcodeDetector.detect(video);
          
          if (barcodes.length > 0) {
            const now = Date.now();
            if (now - lastScanTimeRef.current > 500) {
              lastScanTimeRef.current = now;
              console.log('QR Code detected (native):', barcodes[0].rawValue);
              handleScanSuccess(barcodes[0].rawValue);
              return;
            }
          }
        } catch (e) {
          // BarcodeDetector failed, fall back to jsQR
        }
      }

      // Fallback to jsQR
      if (!canvasRef.current) {
        canvasRef.current = document.createElement('canvas');
      }

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      if (canvas.width === 0 || canvas.height === 0) {
        requestAnimationFrame(tick);
        return;
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      if (window.jsQR) {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth",
        });
        
        if (code && code.data) {
          const now = Date.now();
          if (now - lastScanTimeRef.current > 500) {
            lastScanTimeRef.current = now;
            console.log('QR Code detected (jsQR):', code.data);
            handleScanSuccess(code.data);
            return;
          }
        }
      }
    } catch (error) {
      console.error('Scan error:', error);
    }
    
    if (scanningRef.current) {
      requestAnimationFrame(tick);
    }
  };

  const handleScanSuccess = (code) => {
    if (!code || !scanningRef.current) return;
    
    scanningRef.current = false;
    setScanSuccess(true);
    playSuccessSound();
    
    if ('vibrate' in navigator) {
      navigator.vibrate([200, 100, 200]);
    }
    
    setTimeout(() => {
      stopScanning();
      onScan(code);
    }, 800);
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
                <div className="w-64 h-64 border-4 border-emerald-500 rounded-lg bg-emerald-500/20 flex flex-col items-center justify-center gap-4">
                  <CheckCircle2 className="w-24 h-24 text-emerald-400 animate-bounce" />
                  <p className="text-white font-bold text-xl">Scanned!</p>
                </div>
              ) : (
                <div className="w-64 h-64 border-4 border-sky-500 rounded-lg relative">
                  <div className="absolute w-full h-1 bg-emerald-400 top-0 animate-scan shadow-lg shadow-emerald-400/50" />
                  <div className="absolute -top-1 -left-1 w-12 h-12 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                  <div className="absolute -top-1 -right-1 w-12 h-12 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                  <div className="absolute -bottom-1 -left-1 w-12 h-12 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                  <div className="absolute -bottom-1 -right-1 w-12 h-12 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
                  
                  {scanAttempts > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Zap className="w-8 h-8 text-sky-400 animate-pulse" />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="absolute top-4 right-4 z-10">
              <Button
                size="icon"
                variant="destructive"
                onClick={stopScanning}
                className="bg-rose-600 hover:bg-rose-700"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            <div className="absolute bottom-4 left-0 right-0 px-4 z-10">
              {scanSuccess ? (
                <div className="bg-emerald-600 px-4 py-3 rounded-lg text-center">
                  <p className="text-white font-semibold">✓ QR Code Detected!</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="bg-slate-900/90 px-4 py-3 rounded-lg text-center">
                    <p className="text-white font-semibold">📷 Center QR code in frame</p>
                    <p className="text-xs text-slate-400 mt-1">
                      Scans: {scanAttempts} • Keep camera steady
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      stopScanning();
                      setManualMode(true);
                    }}
                    className="w-full bg-amber-600 hover:bg-amber-700"
                    size="sm"
                  >
                    <Type className="w-4 h-4 mr-2" />
                    Can't Scan? Enter Code Manually
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
              animation: scan 2s ease-in-out infinite;
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
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg">
              <p className="text-rose-400 text-sm">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleNativeCameraCapture}
              className="hidden"
              id="native-camera"
            />
            <label htmlFor="native-camera">
              <Button
                type="button"
                className="w-full h-16 text-lg bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 font-bold"
                asChild
              >
                <div>
                  <Smartphone className="w-6 h-6 mr-2" />
                  📱 Use Phone Camera App
                </div>
              </Button>
            </label>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-slate-700" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-slate-800 px-2 text-slate-500">OR</span>
              </div>
            </div>

            <Button
              className="w-full h-14 text-lg bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-600 hover:to-sky-700"
              onClick={startScanning}
              disabled={!jsQRLoaded && !barcodeDetectorSupported}
            >
              <Camera className="w-6 h-6 mr-2" />
              {jsQRLoaded || barcodeDetectorSupported ? "📸 Live Camera Scanner" : "⏳ Loading Scanner..."}
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
              Type Code Manually
            </Button>
          </div>

          {manualMode && (
            <div className="space-y-3 pt-4 border-t border-slate-700">
              <p className="text-sm text-slate-400">Enter any checkpoint code:</p>
              <Input
                placeholder="CODE-123 or scan result"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
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

          {barcodeDetectorSupported && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <p className="text-xs text-emerald-400">✓ Native QR scanner supported on this device</p>
            </div>
          )}

          {!jsQRLoaded && !barcodeDetectorSupported && !error && (
            <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg">
              <p className="text-xs text-slate-400">Loading QR scanner library...</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}