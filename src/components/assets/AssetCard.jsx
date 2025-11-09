import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, Calendar, MapPin, User, Edit, AlertCircle } from "lucide-react";

export default function AssetCard({ asset, onEdit }) {
  const statusColors = {
    active: "bg-emerald-500",
    maintenance: "bg-amber-500",
    retired: "bg-slate-500",
    lost: "bg-rose-500"
  };

  const getDaysUntilService = () => {
    if (!asset.next_service_date) return null;
    const today = new Date();
    const serviceDate = new Date(asset.next_service_date);
    const days = Math.floor((serviceDate - today) / (1000 * 60 * 60 * 24));
    return days;
  };

  const daysUntilService = getDaysUntilService();
  const isOverdue = daysUntilService !== null && daysUntilService < 0;
  const isDueSoon = daysUntilService !== null && daysUntilService >= 0 && daysUntilService <= 30;

  return (
    <Card className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-colors">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-white text-lg mb-2">{asset.asset_name}</CardTitle>
            <p className="text-sm text-slate-400">#{asset.asset_number}</p>
          </div>
          <div className="flex flex-col gap-2">
            <Badge className={statusColors[asset.status]}>
              {asset.status}
            </Badge>
            <Button size="icon" variant="ghost" onClick={onEdit} className="text-slate-400">
              <Edit className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Package className="w-4 h-4" />
          <span className="capitalize">{asset.category}</span>
        </div>

        {asset.site_name && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <MapPin className="w-4 h-4" />
            <span>{asset.site_name}</span>
          </div>
        )}

        {asset.assigned_to_name && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <User className="w-4 h-4" />
            <span>{asset.assigned_to_name}</span>
          </div>
        )}

        {(isOverdue || isDueSoon) && (
          <div className={`flex items-center gap-2 text-sm p-2 rounded ${
            isOverdue ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'
          }`}>
            <AlertCircle className="w-4 h-4" />
            <span>
              {isOverdue 
                ? `Service overdue by ${Math.abs(daysUntilService)} days`
                : `Service due in ${daysUntilService} days`
              }
            </span>
          </div>
        )}

        {asset.current_value && (
          <div className="pt-3 border-t border-slate-700">
            <p className="text-xs text-slate-500">Current Value</p>
            <p className="text-lg font-bold text-white">${asset.current_value.toLocaleString()}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}