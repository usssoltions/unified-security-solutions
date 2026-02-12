import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, AlertTriangle, Clock, MapPin } from "lucide-react";
import IncidentForm from "../components/guard/IncidentForm";
import PullToRefresh from "../components/PullToRefresh";

export default function GuardIncidents() {
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

  const { data: incidents } = useQuery({
    queryKey: ["incidents", user?.id],
    queryFn: async () => {
      if (!user) return [];
      return await base44.entities.Incident.filter(
        { guard_id: user.id },
        "-reported_at",
        20
      );
    },
    enabled: !!user,
    initialData: []
  });

  const priorityColors = {
    critical: "bg-rose-500",
    high: "bg-orange-500",
    medium: "bg-amber-500",
    low: "bg-sky-500"
  };

  const statusColors = {
    reported: "bg-slate-500",
    assigned: "bg-sky-500",
    in_progress: "bg-amber-500",
    resolved: "bg-emerald-500",
    closed: "bg-slate-600"
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={async () => {
      await queryClient.invalidateQueries(["incidents"]);
    }}>
      <div className="min-h-screen p-4 lg:p-6 space-y-6">
        <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Incident Reports</h1>
          <p className="text-slate-400 mt-1">Document and track security incidents</p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          Report Incident
        </Button>
      </div>

      {showForm && (
        <IncidentForm
          user={user}
          shift={shift}
          location={location}
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries(["incidents"]);
          }}
        />
      )}

      <div className="grid gap-4">
        {incidents.map((incident) => (
          <Card key={incident.id} className="bg-slate-800/50 border-slate-700 hover:border-slate-600 transition-colors">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-5 h-5 text-rose-400" />
                    <CardTitle className="text-white">{incident.title}</CardTitle>
                  </div>
                  <p className="text-sm text-slate-400">{incident.description}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Badge className={priorityColors[incident.priority]}>
                    {incident.priority}
                  </Badge>
                  <Badge className={statusColors[incident.status]}>
                    {incident.status}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="flex items-center gap-2 text-slate-400">
                  <MapPin className="w-4 h-4" />
                  <span>{incident.site_name}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Clock className="w-4 h-4" />
                  <span>{new Date(incident.reported_at).toLocaleString()}</span>
                </div>
              </div>

              {incident.media && incident.media.length > 0 && (
                <div className="mt-4 flex gap-2 overflow-x-auto">
                  {incident.media.map((media, idx) => (
                    <img
                      key={idx}
                      src={media.url}
                      alt="Evidence"
                      className="h-24 w-24 object-cover rounded-lg border border-slate-700"
                    />
                  ))}
                </div>
              )}

              {incident.dispatcher_notes && (
                <div className="mt-4 p-3 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                  <p className="text-xs text-sky-400 font-semibold mb-1">Dispatcher Notes:</p>
                  <p className="text-sm text-slate-300">{incident.dispatcher_notes}</p>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {incidents.length === 0 && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="pt-12 pb-12 text-center">
              <AlertTriangle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-white mb-2">No Incidents Reported</h3>
              <p className="text-slate-400">Click "Report Incident" to document a security event</p>
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </PullToRefresh>
  );
}