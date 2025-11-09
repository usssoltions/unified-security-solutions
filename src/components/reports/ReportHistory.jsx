import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, FileText } from "lucide-react";

export default function ReportHistory() {
  // In a real implementation, this would fetch saved reports from the database
  // For now, showing a placeholder
  
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-400" />
          Recent Reports
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-center py-8">
          <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 mb-2">No saved reports yet</p>
          <p className="text-xs text-slate-500">
            Generate your first report above. Reports will appear here for quick access.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}