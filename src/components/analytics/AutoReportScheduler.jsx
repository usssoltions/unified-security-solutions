import React, { useEffect } from "react";
import { base44 } from "@/api/base44Client";

export default function AutoReportScheduler({ user }) {
  useEffect(() => {
    // Automated reports are now handled by scheduled tasks
    // This component is kept for backward compatibility but does nothing
    return;


  }, [user]);

  return null; // This component doesn't render anything
}