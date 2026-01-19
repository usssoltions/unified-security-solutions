import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  Plus, 
  Check, 
  AlertTriangle, 
  Users, 
  Clock,
  Shield,
  MapPin,
  Camera,
  Lock
} from "lucide-react";
import MediaCapture from "../components/guard/MediaCapture";
import SignaturePad from "../components/guard/SignaturePad";

export default function ShiftHandover() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [formData, setFormData] = useState({
    site_status: {
      all_secure: true,
      gates_locked: true,
      alarms_armed: true,
      lights_functional: true,
      cameras_operational: true,
      perimeter_secure: true
    },
    maintenance_issues: [],
    visitors_log: [],
    key_activities: [],
    outstanding_tasks: [],
    weather_conditions: "",
    special_instructions: "",
    media_attachments: []
  });
  const [newIssue, setNewIssue] = useState({ issue: "", location: "", urgency: "medium" });
  const [newVisitor, setNewVisitor] = useState({ name: "", time: "", purpose: "" });
  const [newTask, setNewTask] = useState({ task: "", priority: "medium", due_by: "" });
  const [signature, setSignature] = useState(null);
  const [showSignature, setShowSignature] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const currentUser = await base44.auth.me();
    setUser(currentUser);
  };

  const { data: activeShift } = useQuery({
    queryKey: ['activeShift', user?.id],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({
        guard_id: user.id,
        status: "active"
      });
      return shifts[0];
    },
    enabled: !!user
  });

  const { data: nextGuard } = useQuery({
    queryKey: ['nextGuard', activeShift?.site_id],
    queryFn: async () => {
      const now = new Date();
      const shifts = await base44.entities.Shift.filter({
        site_id: activeShift.site_id,
        status: "scheduled"
      });
      
      const upcomingShifts = shifts.filter(s => {
        const start = new Date(s.start_time);
        return start > now && start < new Date(now.getTime() + 4 * 60 * 60 * 1000);
      });
      
      return upcomingShifts[0];
    },
    enabled: !!activeShift
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['shiftIncidents', activeShift?.id],
    queryFn: async () => {
      return await base44.entities.Incident.filter({
        shift_id: activeShift.id
      });
    },
    enabled: !!activeShift
  });

  const createHandoverMutation = useMutation({
    mutationFn: async (data) => {
      const handover = await base44.entities.ShiftHandover.create({
        shift_id: activeShift.id,
        site_id: activeShift.site_id,
        site_name: activeShift.site_name,
        outgoing_guard_id: user.id,
        outgoing_guard_name: user.full_name,
        incoming_guard_id: nextGuard?.guard_id || null,
        incoming_guard_name: nextGuard?.guard_name || "Not yet assigned",
        handover_time: new Date().toISOString(),
        site_status: formData.site_status,
        incidents_during_shift: incidents.map(i => ({
          incident_id: i.id,
          summary: i.title,
          status: i.status
        })),
        maintenance_issues: formData.maintenance_issues,
        visitors_log: formData.visitors_log,
        key_activities: formData.key_activities,
        outstanding_tasks: formData.outstanding_tasks,
        weather_conditions: formData.weather_conditions,
        special_instructions: formData.special_instructions,
        outgoing_guard_signature: signature,
        signed_at: new Date().toISOString(),
        media_attachments: formData.media_attachments
      });

      // Notify incoming guard
      if (nextGuard?.guard_id) {
        await base44.entities.Notification.create({
          recipient_id: nextGuard.guard_id,
          recipient_name: nextGuard.guard_name,
          type: "system",
          priority: "high",
          title: "📋 Shift Handover Report Available",
          message: `${user.full_name} has completed a handover report for ${activeShift.site_name}. Please review before your shift.`,
          related_entity: "ShiftHandover",
          related_id: handover.id
        });
      }

      return handover;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['shiftHandovers']);
      alert('Handover report submitted successfully!');
      // Reset form
      setFormData({
        site_status: {
          all_secure: true,
          gates_locked: true,
          alarms_armed: true,
          lights_functional: true,
          cameras_operational: true,
          perimeter_secure: true
        },
        maintenance_issues: [],
        visitors_log: [],
        key_activities: [],
        outstanding_tasks: [],
        weather_conditions: "",
        special_instructions: "",
        media_attachments: []
      });
      setSignature(null);
    }
  });

  if (!user || !activeShift) {
    return (
      <div className="min-h-screen p-4 flex items-center justify-center">
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-8 text-center">
            <Shield className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No active shift found. Clock in to create a handover report.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-3 sm:p-4 lg:p-6 w-full overflow-x-hidden">
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white">Shift Handover Report</h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">Document shift activities and site status</p>
        </div>

        {/* Site Status */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="p-3 sm:p-4">
            <CardTitle className="text-white flex items-center gap-2 text-base sm:text-lg">
              <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
              Site Status - {activeShift.site_name}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
            {Object.entries(formData.site_status).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between p-2 sm:p-3 bg-slate-900/50 rounded-lg">
                <Label className="text-slate-300 text-xs sm:text-sm capitalize">
                  {key.replace(/_/g, ' ')}
                </Label>
                <Checkbox
                  checked={value}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      site_status: { ...formData.site_status, [key]: checked }
                    })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Maintenance Issues */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="p-3 sm:p-4">
            <CardTitle className="text-white flex items-center gap-2 text-base sm:text-lg">
              <AlertTriangle className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
              Maintenance Issues
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
            <div className="space-y-2">
              <Input
                placeholder="Issue description"
                value={newIssue.issue}
                onChange={(e) => setNewIssue({ ...newIssue, issue: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white text-sm"
              />
              <Input
                placeholder="Location"
                value={newIssue.location}
                onChange={(e) => setNewIssue({ ...newIssue, location: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white text-sm"
              />
              <div className="flex gap-2">
                <select
                  value={newIssue.urgency}
                  onChange={(e) => setNewIssue({ ...newIssue, urgency: e.target.value })}
                  className="flex-1 bg-slate-900 border border-slate-700 text-white rounded-md p-2 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <Button
                  size="sm"
                  onClick={() => {
                    if (newIssue.issue) {
                      setFormData({
                        ...formData,
                        maintenance_issues: [...formData.maintenance_issues, newIssue]
                      });
                      setNewIssue({ issue: "", location: "", urgency: "medium" });
                    }
                  }}
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {formData.maintenance_issues.map((issue, idx) => (
              <div key={idx} className="p-2 sm:p-3 bg-slate-900/50 rounded-lg">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{issue.issue}</p>
                    <p className="text-xs text-slate-400">{issue.location}</p>
                  </div>
                  <Badge className={`${
                    issue.urgency === 'critical' ? 'bg-rose-500' :
                    issue.urgency === 'high' ? 'bg-orange-500' :
                    issue.urgency === 'medium' ? 'bg-amber-500' : 'bg-slate-500'
                  } text-xs`}>
                    {issue.urgency}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Visitors Log */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="p-3 sm:p-4">
            <CardTitle className="text-white flex items-center gap-2 text-base sm:text-lg">
              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
              Visitors Log
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-4 pt-0 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                placeholder="Name"
                value={newVisitor.name}
                onChange={(e) => setNewVisitor({ ...newVisitor, name: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white text-sm"
              />
              <Input
                type="time"
                value={newVisitor.time}
                onChange={(e) => setNewVisitor({ ...newVisitor, time: e.target.value })}
                className="bg-slate-900 border-slate-700 text-white text-sm"
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Purpose"
                  value={newVisitor.purpose}
                  onChange={(e) => setNewVisitor({ ...newVisitor, purpose: e.target.value })}
                  className="flex-1 bg-slate-900 border-slate-700 text-white text-sm"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (newVisitor.name) {
                      setFormData({
                        ...formData,
                        visitors_log: [...formData.visitors_log, newVisitor]
                      });
                      setNewVisitor({ name: "", time: "", purpose: "" });
                    }
                  }}
                  className="bg-sky-600 hover:bg-sky-700"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {formData.visitors_log.map((visitor, idx) => (
              <div key={idx} className="p-2 sm:p-3 bg-slate-900/50 rounded-lg text-sm">
                <span className="text-white font-medium">{visitor.name}</span>
                <span className="text-slate-400"> • {visitor.time} • {visitor.purpose}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Additional Info */}
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-3 sm:p-4 space-y-3">
            <div className="space-y-2">
              <Label className="text-slate-300 text-xs sm:text-sm">Weather Conditions</Label>
              <Input
                value={formData.weather_conditions}
                onChange={(e) => setFormData({ ...formData, weather_conditions: e.target.value })}
                placeholder="Clear, Rainy, Windy..."
                className="bg-slate-900 border-slate-700 text-white text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-xs sm:text-sm">Special Instructions for Next Shift</Label>
              <Textarea
                value={formData.special_instructions}
                onChange={(e) => setFormData({ ...formData, special_instructions: e.target.value })}
                placeholder="Any important notes for the incoming guard..."
                className="bg-slate-900 border-slate-700 text-white text-sm"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-slate-300 text-xs sm:text-sm">Photo/Video Evidence</Label>
              <MediaCapture
                media={formData.media_attachments}
                onMediaChange={(media) => setFormData({ ...formData, media_attachments: media })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Signature */}
        {!signature ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-3 sm:p-4">
              <Button
                onClick={() => setShowSignature(true)}
                className="w-full bg-sky-600 hover:bg-sky-700"
              >
                <FileText className="w-4 h-4 mr-2" />
                Add Signature
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-emerald-500/10 border-emerald-500/30">
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-emerald-400" />
                  <span className="text-emerald-400 font-medium text-sm">Signed by {user.full_name}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSignature(null)}
                  className="text-emerald-400"
                >
                  Clear
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Submit */}
        <Button
          onClick={() => createHandoverMutation.mutate()}
          disabled={!signature || createHandoverMutation.isPending}
          className="w-full h-11 sm:h-12 bg-emerald-600 hover:bg-emerald-700 text-sm sm:text-base"
        >
          {createHandoverMutation.isPending ? "Submitting..." : "Submit Handover Report"}
        </Button>

        {showSignature && (
          <SignaturePad
            onSave={(sig) => {
              setSignature(sig);
              setShowSignature(false);
            }}
            onClose={() => setShowSignature(false)}
          />
        )}
      </div>
    </div>
  );
}