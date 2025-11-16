import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckSquare, Clock, User, MapPin, FileText, Image } from "lucide-react";
import { format } from "date-fns";

export default function CompletedPatrols() {
  const [selectedPatrol, setSelectedPatrol] = useState(null);

  const { data: completions = [] } = useQuery({
    queryKey: ["completedPatrols"],
    queryFn: async () => {
      return await base44.entities.ChecklistCompletion.list("-completed_at", 100);
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      return await base44.entities.Site.list();
    }
  });

  const getSiteName = (siteId) => {
    const site = sites.find(s => s.id === siteId);
    return site?.name || "Unknown Site";
  };

  if (selectedPatrol) {
    const completedCount = selectedPatrol.completed_items?.filter(item => 
      item.checked || item.value || item.photo_url
    ).length || 0;
    const totalItems = selectedPatrol.completed_items?.length || 0;

    return (
      <div className="min-h-screen p-6 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              onClick={() => setSelectedPatrol(null)}
              className="border-slate-600"
            >
              ← Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-white">{selectedPatrol.template_name}</h1>
              <p className="text-slate-400">{getSiteName(selectedPatrol.site_id)}</p>
            </div>
          </div>

          <Card className="bg-slate-800 border-slate-700">
            <CardHeader>
              <CardTitle className="text-white">Patrol Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-400">Guard</p>
                  <p className="text-white font-semibold">{selectedPatrol.guard_name}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Completed</p>
                  <p className="text-white font-semibold">
                    {format(new Date(selectedPatrol.completed_at), "PPp")}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Time Spent</p>
                  <p className="text-white font-semibold">
                    {selectedPatrol.time_spent_minutes || 0} minutes
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-400">Items Completed</p>
                  <p className="text-white font-semibold">
                    {completedCount} / {totalItems}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-white">Checklist Items</h3>
            {selectedPatrol.completed_items?.map((item, idx) => (
              <Card key={idx} className="bg-slate-800 border-slate-700">
                <CardContent className="pt-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      {item.checked && (
                        <CheckSquare className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="text-white">Item #{idx + 1}</p>
                        {item.value && item.value !== "✓" && (
                          <p className="text-slate-300 mt-2 p-3 bg-slate-900 rounded">
                            {item.value}
                          </p>
                        )}
                      </div>
                    </div>
                    {item.photo_url && (
                      <img
                        src={item.photo_url}
                        alt="Evidence"
                        className="w-full h-64 object-cover rounded-lg"
                      />
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {selectedPatrol.notes && (
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-lg">Additional Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-slate-300">{selectedPatrol.notes}</p>
              </CardContent>
            </Card>
          )}

          {selectedPatrol.signature && (
            <Card className="bg-slate-800 border-slate-700">
              <CardHeader>
                <CardTitle className="text-white text-lg">Guard Signature</CardTitle>
              </CardHeader>
              <CardContent>
                <img
                  src={selectedPatrol.signature.data_url}
                  alt="Signature"
                  className="h-32 bg-white rounded"
                />
                <p className="text-xs text-slate-400 mt-2">
                  Signed: {format(new Date(selectedPatrol.signature.timestamp), "PPp")}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-white">Completed Patrols</h1>
          <p className="text-slate-400">View all completed patrol checklists</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {completions.map((completion) => {
            const completedCount = completion.completed_items?.filter(item => 
              item.checked || item.value || item.photo_url
            ).length || 0;
            const totalItems = completion.completed_items?.length || 0;
            const completionRate = totalItems > 0 ? (completedCount / totalItems) * 100 : 0;

            return (
              <Card
                key={completion.id}
                className="bg-slate-800 border-slate-700 hover:border-sky-500 transition-colors cursor-pointer"
                onClick={() => setSelectedPatrol(completion)}
              >
                <CardHeader>
                  <CardTitle className="text-white text-lg">
                    {completion.template_name}
                  </CardTitle>
                  <p className="text-sm text-slate-400">{getSiteName(completion.site_id)}</p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <User className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-300">{completion.guard_name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-300">
                      {format(new Date(completion.completed_at), "PPp")}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1 text-sm">
                      <span className="text-slate-400">Completion</span>
                      <span className="text-white font-semibold">{completionRate.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${completionRate}%` }}
                      />
                    </div>
                  </div>
                  <Badge
                    className={completion.status === "completed" ? "bg-emerald-600" : "bg-amber-600"}
                  >
                    {completion.status}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {completions.length === 0 && (
          <Card className="bg-slate-800 border-slate-700">
            <CardContent className="py-12 text-center">
              <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-white font-semibold mb-2">No Completed Patrols</h3>
              <p className="text-slate-400">Completed patrol checklists will appear here</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}