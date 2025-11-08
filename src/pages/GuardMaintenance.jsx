import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Wrench, Clock, MapPin } from "lucide-react";
import MaintenanceForm from "../components/guard/MaintenanceForm";

export default function GuardMaintenance() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [shift, setShift] = useState(null);

  useEffect(() => {
    loadData();
    getLocation();
  }, []);

  const loadData = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
    
    const shifts = await base44.entities.Shift.filter({
      guard_id: currentUser.id,
      status: "active"
    });
    if (shifts.length > 0) {
      setShift(shifts[0]);
    }
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        setLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
      });
    }
  };

  const { data: requests } = useQuery({
    queryKey: ["maintenance", user?.id],
    queryFn: async () => {
      if (!user) return [];
      return await base44.entities.MaintenanceRequest.filter(
        { guard_id: user.id },
        "-reported_at",
        20
      );
    },
    enabled: !!user,
    initialData: []
  });

  const urgencyColors = {
    critical: "bg-rose-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  const statusColors = {
    reported: "bg-slate-500",
    assigned: "bg-sky-500",
    in_progress: "bg-amber-500",
    completed: "bg-emerald-500",
    cancelled: "bg-slate-600"
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Maintenance Requests</h1>
          <p className="text-slate-400 mt-1">Report facility issues and repairs needed</p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          New Request
        </Button>
      </div>

      {showForm && (
        <MaintenanceForm
          user={user}
          shift={shift}
          location={location}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries(["maintenance"]);
          }}
        />
      )}

      <div className="grid gap-4">
        {requests.map((request) => (
          <Card key={request.id} className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-colors">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="w-5 h-5 text-amber-400" />
                    <CardTitle className="text-white">{request.title}</CardTitle>
                  </div>
                  <p className="text-sm text-slate-400">{request.description}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Badge className={urgencyColors[request.urgency]}>
                    {request.urgency}
                  </Badge>
                  <Badge className={statusColors[request.status]}>
                    {request.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2 text-slate-400">
                  <MapPin className="w-4 h-4" />
                  <span>{request.site_name}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Clock className="w-4 h-4" />
                  <span>{new Date(request.reported_at).toLocaleString()}</span>
                </div>
              </div>

              {request.media && request.media.length > 0 && (
                <div className="mt-4 flex gap-2 overflow-x-auto">
                  {request.media.map((media, idx) => (
                    <img
                      key={idx}
                      src={media.url}
                      alt="Issue"
                      className="h-24 w-24 object-cover rounded-lg border border-slate-700"
                    />
                  ))}
                </div>
              )}

              {request.completion_notes && (
                <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <p className="text-xs text-emerald-400 font-semibold mb-1">Completion Notes:</p>
                  <p className="text-sm text-slate-300">{request.completion_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {requests.length === 0 && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-12 pb-12 text-center">
              <Wrench className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">No Maintenance Requests</h3>
              <p className="text-slate-400">Click "New Request" to report a facility issue</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}