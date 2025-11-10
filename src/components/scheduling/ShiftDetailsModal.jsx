import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, Edit2, Save, Trash2, MapPin, User, Clock, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ShiftDetailsModal({ shift, onClose }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    guard_id: shift.guard_id || "",
    site_id: shift.site_id || "",
    start_time: shift.start_time ? new Date(shift.start_time).toISOString().slice(0, 16) : "",
    end_time: shift.end_time ? new Date(shift.end_time).toISOString().slice(0, 16) : "",
    notes: shift.notes || "",
    status: shift.status || "scheduled"
  });

  const { data: guards } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    initialData: []
  });

  const { data: sites } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => {
      return await base44.entities.Site.list();
    },
    initialData: []
  });

  const updateShiftMutation = useMutation({
    mutationFn: async (data) => {
      const selectedGuard = guards.find(g => g.id === data.guard_id);
      const selectedSite = sites.find(s => s.id === data.site_id);

      const updateData = {
        guard_id: data.guard_id,
        guard_name: selectedGuard?.full_name || "",
        site_id: data.site_id,
        site_name: selectedSite?.name || "",
        start_time: new Date(data.start_time).toISOString(),
        end_time: new Date(data.end_time).toISOString(),
        notes: data.notes,
        status: data.status
      };

      await base44.entities.Shift.update(shift.id, updateData);

      // Send notification to guard
      if (selectedGuard) {
        await base44.entities.Alert.create({
          type: "shift_reminder",
          priority: "medium",
          title: "Shift Updated",
          message: `Your shift at ${selectedSite?.name} has been updated. New time: ${new Date(data.start_time).toLocaleString()}`,
          guard_id: selectedGuard.id,
          guard_name: selectedGuard.full_name,
          shift_id: shift.id,
          status: "active"
        });
      }

      return updateData;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["allShifts"]);
      setIsEditing(false);
    }
  });

  const deleteShiftMutation = useMutation({
    mutationFn: async () => {
      // Notify guard before deleting
      if (shift.guard_id) {
        await base44.entities.Alert.create({
          type: "shift_reminder",
          priority: "high",
          title: "Shift Cancelled",
          message: `Your shift at ${shift.site_name} on ${new Date(shift.start_time).toLocaleString()} has been cancelled.`,
          guard_id: shift.guard_id,
          guard_name: shift.guard_name,
          status: "active"
        });
      }
      
      await base44.entities.Shift.delete(shift.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["allShifts"]);
      onClose();
    }
  });

  const handleSave = () => {
    updateShiftMutation.mutate(formData);
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this shift? The assigned guard will be notified.")) {
      deleteShiftMutation.mutate();
    }
  };

  const statusColors = {
    scheduled: "bg-sky-500",
    active: "bg-emerald-500",
    completed: "bg-green-500",
    cancelled: "bg-red-500",
    missed: "bg-rose-500"
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 my-8">
        <CardHeader className="border-b border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                {isEditing ? <Edit2 className="w-5 h-5" /> : null}
                {isEditing ? "Edit Shift" : "Shift Details"}
              </CardTitle>
              <p className="text-sm text-slate-400 mt-1">
                {shift.site_name}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!isEditing && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setIsEditing(true)}
                    className="border-slate-600 text-slate-300"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleDelete}
                    disabled={deleteShiftMutation.isPending}
                    className="border-rose-600 text-rose-400 hover:bg-rose-500/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              )}
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {isEditing ? (
            <>
              <Alert className="bg-sky-500/10 border-sky-500/20">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription className="text-slate-300 text-sm">
                  Changes will be saved and the assigned guard will be notified
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Assigned Guard</Label>
                  <Select
                    value={formData.guard_id}
                    onValueChange={(value) => setFormData({ ...formData, guard_id: value })}
                  >
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue placeholder="Select guard..." />
                    </SelectTrigger>
                    <SelectContent>
                      {guards.map((guard) => (
                        <SelectItem key={guard.id} value={guard.id}>
                          {guard.full_name} - {guard.badge_number || guard.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Site</Label>
                  <Select
                    value={formData.site_id}
                    onValueChange={(value) => setFormData({ ...formData, site_id: value })}
                  >
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue placeholder="Select site..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sites.map((site) => (
                        <SelectItem key={site.id} value={site.id}>
                          {site.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-slate-300">Start Time</Label>
                    <Input
                      type="datetime-local"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300">End Time</Label>
                    <Input
                      type="datetime-local"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scheduled">Scheduled</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Notes</Label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                  className="flex-1 border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={updateShiftMutation.isPending}
                  className="flex-1 bg-sky-600 hover:bg-sky-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {updateShiftMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <Badge className={statusColors[shift.status]}>
                  {shift.status}
                </Badge>
                {shift.is_overtime && (
                  <Badge variant="outline" className="border-amber-500 text-amber-400">
                    Overtime
                  </Badge>
                )}
              </div>

              <div className="space-y-3 p-4 bg-slate-900/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <User className="w-5 h-5 text-sky-400" />
                  <div>
                    <p className="text-sm text-slate-400">Guard</p>
                    <p className="font-semibold text-white">{shift.guard_name || "Unassigned"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-emerald-400" />
                  <div>
                    <p className="text-sm text-slate-400">Site</p>
                    <p className="font-semibold text-white">{shift.site_name}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-purple-400" />
                  <div>
                    <p className="text-sm text-slate-400">Schedule</p>
                    <p className="font-semibold text-white">
                      {new Date(shift.start_time).toLocaleString()}
                    </p>
                    <p className="text-sm text-slate-500">
                      to {new Date(shift.end_time).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {shift.clock_in && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                  <p className="text-sm font-semibold text-emerald-400 mb-2">Clock In</p>
                  <p className="text-sm text-slate-300">
                    {new Date(shift.clock_in.timestamp).toLocaleString()}
                  </p>
                  {shift.clock_in.location && (
                    <p className="text-xs text-slate-500 mt-1">
                      Location: {shift.clock_in.location.lat.toFixed(6)}, {shift.clock_in.location.lng.toFixed(6)}
                    </p>
                  )}
                </div>
              )}

              {shift.clock_out && (
                <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                  <p className="text-sm font-semibold text-sky-400 mb-2">Clock Out</p>
                  <p className="text-sm text-slate-300">
                    {new Date(shift.clock_out.timestamp).toLocaleString()}
                  </p>
                  {shift.clock_out.location && (
                    <p className="text-xs text-slate-500 mt-1">
                      Location: {shift.clock_out.location.lat.toFixed(6)}, {shift.clock_out.location.lng.toFixed(6)}
                    </p>
                  )}
                </div>
              )}

              {shift.notes && (
                <div className="p-4 bg-slate-900/50 rounded-lg">
                  <p className="text-sm font-semibold text-slate-300 mb-2">Notes</p>
                  <p className="text-sm text-slate-400">{shift.notes}</p>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}