/**
 * Clear recoverable-failure state for the Attendance Register pages: a failed
 * or timed-out context/list request must NEVER leave an endless spinner.
 * Nothing the operator entered is lost — the page retries cleanly.
 */
import React from "react";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

export default function AttendanceLoadError({ onRetry }) {
  return (
    <div className="p-4 max-w-md mx-auto text-center py-16">
      <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <ShieldAlert className="w-8 h-8 text-slate-500" />
      </div>
      <h2 className="text-white text-lg font-semibold mb-2">Could not load the Attendance Register</h2>
      <p className="text-slate-400 text-sm mb-5">The request failed or timed out. Nothing was lost — try again.</p>
      <Button variant="brand" onClick={onRetry} className="h-12 px-6 active:scale-95 transition">
        Try Again
      </Button>
    </div>
  );
}