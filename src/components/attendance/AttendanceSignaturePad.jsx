/**
 * Large, touch-optimised signature pad for the Attendance module.
 * A fresh instance is required for every attendance visit.
 */
import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, Check, PenTool } from "lucide-react";

export default function AttendanceSignaturePad({ onAccept, onCancel }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const coords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  };

  const start = (e) => {
    e.preventDefault();
    const { x, y } = coords(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath(); ctx.moveTo(x, y);
    setIsDrawing(true); setIsEmpty(false);
  };
  const move = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = coords(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y); ctx.stroke();
  };
  const stop = () => setIsDrawing(false);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  };

  const accept = () => {
    const dataUrl = canvasRef.current.toDataURL("image/png");
    onAccept(dataUrl);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <PenTool className="w-5 h-5 text-sky-400" />
        <span className="text-white font-semibold text-base">Signature Required</span>
      </div>
      <p className="text-slate-400 text-sm">Please sign in the box below using your finger or stylus.</p>
      <div className="border-2 border-slate-400 rounded-xl overflow-hidden bg-white touch-none" style={{ cursor: "crosshair" }}>
        <canvas
          ref={canvasRef}
          width={900} height={280}
          className="w-full"
          style={{ touchAction: "none", display: "block" }}
          onMouseDown={start} onMouseMove={move} onMouseUp={stop} onMouseLeave={stop}
          onTouchStart={start} onTouchMove={move} onTouchEnd={stop} onTouchCancel={stop}
        />
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={clear} className="flex-1 border-slate-600 text-slate-300 h-12">
          <RotateCcw className="w-4 h-4 mr-2" /> Clear
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="flex-1 border-slate-600 text-slate-300 h-12">
            Back
          </Button>
        )}
        <Button onClick={accept} disabled={isEmpty} className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-12">
          <Check className="w-4 h-4 mr-2" /> Accept Signature
        </Button>
      </div>
    </div>
  );
}