import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, Plus, Shield, Clock, MapPin, User, Edit2, Trash2 } from "lucide-react";

export default function OnCallScheduling({ user }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [formData, setFormData] = useState({
    guard_id: "",
    specialty: "general",
    start_time: "",
    end_time: "",
    priority_level: 3,
    contact_number: "",
    backup_guard_id: "",
    response_time_minutes: 30,
    notes: ""
  });

  const { data: guards = [] } = useQuery({
    queryKey: ['guards'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => base44.entities.Site.list()
  });

  const { data: onCallSchedules = [] } = useQuery({
    queryKey: ['onCallSchedules'],
    queryFn: () => base44.entities.OnCallSchedule.list('-start_time'),
    refetchInterval: 30000
  });

  const createScheduleMutation = useMutation({
    mutationFn: async (data) => {
      const guard = guards.find(g => g.id === data.guard_id);
      const backup = guards.find(g => g.id === data.backup_guard_id);

      const scheduleData = {
        ...data,
        guard_name: guard?.full_name,
        backup_guard_name: backup?.full_name || null,
        status: "scheduled"
      };

      if (editingSchedule) {
        await base44.entities.OnCallSchedule.update(editingSchedule.id, scheduleData);
      } else {
        await base44.entities.OnCallSchedule.create(scheduleData);
      }

      // Notify guard
      await base44.entities.Notification.create({
        recipient_id: data.guard_id,
        recipient_name: guard.full_name,
        type: "system",
        priority: "high",
        title: "📞 On-Call Assignment",
        message: `You've been assigned on-call duty (${data.specialty}) from ${new Date(data.start_time).toLocaleString()}`,
        related_entity: "OnCallSchedule",
        related_id: editingSchedule?.id || "new"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['onCallSchedules']);
      setShowForm(false);
      setEditingSchedule(null);
      setFormData({
        guard_id: "",
        specialty: "general",
        start_time: "",
        end_time: "",
        priority_level: 3,
        contact_number: "",
        backup_guard_id: "",
        response_time_minutes: 30,
        notes: ""
      });
    }
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id) => base44.entities.OnCallSchedule.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['onCallSchedules'])
  });

  const specialtyColors = {
    armed_response: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    k9_unit: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    medical_response: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    fire_response: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    technical_support: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    supervisor: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    general: "bg-slate-500/20 text-slate-400 border-slate-500/30"
  };

  const statusColors = {
    scheduled: "bg-sky-500/20 text-sky-400",
    active: "bg-emerald-500/20 text-emerald-400",
    responded: "bg-amber-500/20 text-amber-400",
    completed: "bg-slate-500/20 text-slate-400",
    unavailable: "bg-rose-500/20 text-rose-400"
  };

  const isAdmin = user?.role_type === "admin" || user?.role_type === "dispatcher";
  const currentSchedules = onCallSchedules.filter(s => new Date(s.end_time) > new Date());

  return (
    <div className="space-y-4 w-full">
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="p-3 sm:p-4 lg:p-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2 text-base sm:text-lg">
              <Phone className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
              On-Call Schedule
            </CardTitle>
            {isAdmin && (
              <Button
                size="sm"
                onClick={() => setShowForm(!showForm)}
                className="bg-emerald-600 hover:bg-emerald-700 text-xs sm:text-sm"
              >
                <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                Add On-Call
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 lg:p-6 pt-0 space-y-3 sm:space-y-4">
          {(showForm || editingSchedule) && isAdmin && (
            <Card className="bg-slate-900/50 border-slate-700">
              <CardContent className="p-3 sm:p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">Guard</Label>
                    <Select
                      value={formData.guard_id}
                      onValueChange={(value) => setFormData({ ...formData, guard_id: value })}
                    >
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm">
                        <SelectValue placeholder="Select guard..." />
                      </SelectTrigger>
                      <SelectContent>
                        {guards.map(guard => (
                          <SelectItem key={guard.id} value={guard.id}>
                            {guard.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">Specialty</Label>
                    <Select
                      value={formData.specialty}
                      onValueChange={(value) => setFormData({ ...formData, specialty: value })}
                    >
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="armed_response">Armed Response</SelectItem>
                        <SelectItem value="k9_unit">K9 Unit</SelectItem>
                        <SelectItem value="medical_response">Medical Response</SelectItem>
                        <SelectItem value="fire_response">Fire Response</SelectItem>
                        <SelectItem value="technical_support">Technical Support</SelectItem>
                        <SelectItem value="supervisor">Supervisor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">Start Time</Label>
                    <Input
                      type="datetime-local"
                      value={formData.start_time}
                      onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">End Time</Label>
                    <Input
                      type="datetime-local"
                      value={formData.end_time}
                      onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">Priority (1=Highest)</Label>
                    <Select
                      value={String(formData.priority_level)}
                      onValueChange={(value) => setFormData({ ...formData, priority_level: parseInt(value) })}
                    >
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 - Primary</SelectItem>
                        <SelectItem value="2">2 - Secondary</SelectItem>
                        <SelectItem value="3">3 - Standard</SelectItem>
                        <SelectItem value="4">4 - Backup</SelectItem>
                        <SelectItem value="5">5 - Reserve</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">Contact Number</Label>
                    <Input
                      value={formData.contact_number}
                      onChange={(e) => setFormData({ ...formData, contact_number: e.target.value })}
                      placeholder="+27..."
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">Response Time (mins)</Label>
                    <Input
                      type="number"
                      value={formData.response_time_minutes}
                      onChange={(e) => setFormData({ ...formData, response_time_minutes: parseInt(e.target.value) })}
                      className="bg-slate-900 border-slate-700 text-white text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-300 text-xs sm:text-sm">Backup Guard</Label>
                    <Select
                      value={formData.backup_guard_id}
                      onValueChange={(value) => setFormData({ ...formData, backup_guard_id: value })}
                    >
                      <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm">
                        <SelectValue placeholder="Optional..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={null}>None</SelectItem>
                        {guards.filter(g => g.id !== formData.guard_id).map(guard => (
                          <SelectItem key={guard.id} value={guard.id}>
                            {guard.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => {
                      setShowForm(false);
                      setEditingSchedule(null);
                    }}
                    variant="outline"
                    size="sm"
                    className="flex-1 border-slate-600 text-xs sm:text-sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createScheduleMutation.mutate(formData)}
                    disabled={!formData.guard_id || !formData.start_time || !formData.end_time || createScheduleMutation.isPending}
                    size="sm"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs sm:text-sm"
                  >
                    {editingSchedule ? 'Update' : 'Create'} Schedule
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2 sm:space-y-3">
            {currentSchedules.map(schedule => (
              <Card key={schedule.id} className="bg-slate-900/50 border-slate-700">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`${specialtyColors[schedule.specialty]} border text-xs`}>
                          {schedule.specialty.replace(/_/g, ' ')}
                        </Badge>
                        <Badge className={`${statusColors[schedule.status]} text-xs`}>
                          Priority {schedule.priority_level}
                        </Badge>
                        <Badge className={`${statusColors[schedule.status]} text-xs`}>
                          {schedule.status}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-sky-400 flex-shrink-0" />
                        <span className="text-sm sm:text-base font-medium text-white truncate">
                          {schedule.guard_name}
                        </span>
                      </div>

                      {schedule.contact_number && (
                        <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-400">
                          <Phone className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                          <span>{schedule.contact_number}</span>
                        </div>
                      )}

                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {new Date(schedule.start_time).toLocaleString()} → {new Date(schedule.end_time).toLocaleString()}
                        </span>
                      </div>

                      {schedule.backup_guard_name && (
                        <div className="text-xs text-slate-500">
                          <Shield className="w-3 h-3 inline mr-1" />
                          Backup: {schedule.backup_guard_name}
                        </div>
                      )}

                      {schedule.response_time_minutes && (
                        <div className="text-xs text-emerald-400">
                          Expected response: {schedule.response_time_minutes} min
                        </div>
                      )}
                    </div>

                    {isAdmin && (
                      <div className="flex gap-1 flex-shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditingSchedule(schedule);
                            setFormData({
                              guard_id: schedule.guard_id,
                              specialty: schedule.specialty,
                              start_time: new Date(schedule.start_time).toISOString().slice(0, 16),
                              end_time: new Date(schedule.end_time).toISOString().slice(0, 16),
                              priority_level: schedule.priority_level,
                              contact_number: schedule.contact_number || "",
                              backup_guard_id: schedule.backup_guard_id || "",
                              response_time_minutes: schedule.response_time_minutes || 30,
                              notes: schedule.notes || ""
                            });
                            setShowForm(true);
                          }}
                          className="text-slate-400 hover:text-white h-8 w-8"
                        >
                          <Edit2 className="w-3 h-3 sm:w-4 sm:h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            if (confirm('Delete this on-call schedule?')) {
                              deleteScheduleMutation.mutate(schedule.id);
                            }
                          }}
                          className="text-rose-400 hover:text-rose-300 h-8 w-8"
                        >
                          <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {currentSchedules.length === 0 && (
              <div className="text-center py-8">
                <Phone className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No active on-call schedules</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}