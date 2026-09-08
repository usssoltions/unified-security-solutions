import React, { useRef, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PenTool, RotateCcw } from "lucide-react";

/**
 * Compact signature canvas for Task Scheduling sign-offs (guard completion
 * sign-off and Control Room Operator verification sign-off). Emits the PNG
 * data URL on every stroke end and null when cleared, so the parent can
 * enable its submit button only once the pad is signed.
 */
export default function TaskSignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getCoordinates = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDrawing = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
    setIsEmpty(false);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (!isEmpty) onChange && onChange(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    onChange && onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm text-slate-300">
        <PenTool className="w-4 h-4 text-sky-400" /> Signature (required)
      </div>
      <div className="border-2 border-slate-600 rounded-lg bg-white overflow-hidden">
        <canvas
          ref={canvasRef}
          width={600}
          height={160}
          className="w-full cursor-crosshair"
          style={{ touchAction: "none" }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          onTouchCancel={stopDrawing}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear}
          className="bg-slate-800 border-slate-700 text-slate-300 h-9">
          <RotateCcw className="w-3.5 h-3.5" /> Clear
        </Button>
        <span className="text-xs text-slate-500">Sign with your finger or mouse</span>
      </div>
    </div>
  );
}