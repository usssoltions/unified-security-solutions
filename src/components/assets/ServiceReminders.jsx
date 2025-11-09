import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Calendar, Wrench } from "lucide-react";

export default function ServiceReminders({ dueForService, overdue, onAssetClick }) {
  return (
    <div className="space-y-6">
      {/* Overdue */}
      {overdue.length > 0 && (
        <Card className="bg-rose-500/10 border-rose-500/20">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-400" />
              Overdue Service ({overdue.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {overdue.map((asset) => {
              const daysOverdue = Math.abs(
                Math.floor((new Date() - new Date(asset.next_service_date)) / (1000 * 60 * 60 * 24))
              );
              
              return (
                <div
                  key={asset.id}
                  className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 flex items-center justify-between"
                >
                  <div>
                    <h4 className="font-semibold text-white">{asset.asset_name}</h4>
                    <p className="text-sm text-slate-400">#{asset.asset_number}</p>
                    <p className="text-sm text-rose-400 mt-1">
                      Overdue by {daysOverdue} days
                    </p>
                  </div>
                  <Button onClick={() => onAssetClick(asset)} className="bg-rose-600 hover:bg-rose-700">
                    Schedule Service
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Due Soon */}
      {dueForService.length > 0 && (
        <Card className="bg-amber-500/10 border-amber-500/20">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Calendar className="w-5 h-5 text-amber-400" />
              Due for Service ({dueForService.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {dueForService.map((asset) => {
              const daysUntil = Math.floor(
                (new Date(asset.next_service_date) - new Date()) / (1000 * 60 * 60 * 24)
              );
              
              return (
                <div
                  key={asset.id}
                  className="p-4 bg-slate-900/50 rounded-lg border border-slate-700 flex items-center justify-between"
                >
                  <div>
                    <h4 className="font-semibold text-white">{asset.asset_name}</h4>
                    <p className="text-sm text-slate-400">#{asset.asset_number}</p>
                    <p className="text-sm text-amber-400 mt-1">
                      Service due in {daysUntil} days ({new Date(asset.next_service_date).toLocaleDateString()})
                    </p>
                  </div>
                  <Button onClick={() => onAssetClick(asset)} variant="outline" className="border-amber-500 text-amber-400">
                    View Details
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {dueForService.length === 0 && overdue.length === 0 && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="pt-12 pb-12 text-center">
            <Wrench className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">All Assets Up to Date</h3>
            <p className="text-slate-400">No service reminders at this time</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}