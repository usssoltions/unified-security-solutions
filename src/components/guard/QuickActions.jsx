import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QrCode, AlertTriangle, Wrench, Navigation, FileText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function QuickActions({ location, shiftId, siteId }) {
  const navigate = useNavigate();

  const actions = [
    {
      title: "Scan QR",
      icon: QrCode,
      color: "from-sky-500 to-sky-600",
      action: () => navigate(createPageUrl("QRScanner"))
    },
    {
      title: "Report Incident",
      icon: AlertTriangle,
      color: "from-rose-500 to-rose-600",
      action: () => navigate(createPageUrl("GuardIncidents"))
    },
    {
      title: "Maintenance",
      icon: Wrench,
      color: "from-amber-500 to-amber-600",
      action: () => navigate(createPageUrl("GuardMaintenance"))
    },
    {
      title: "Start of Shift",
      icon: FileText,
      color: "from-purple-500 to-purple-600",
      action: () => navigate(createPageUrl("StartOfShift"))
    }
  ];

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader>
        <CardTitle className="text-white">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((action) => (
            <Button
              key={action.title}
              onClick={action.action}
              className={`h-24 flex flex-col gap-2 bg-gradient-to-br ${action.color} hover:opacity-90 transition-opacity`}
            >
              <action.icon className="w-6 h-6" />
              <span className="text-sm font-semibold">{action.title}</span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}