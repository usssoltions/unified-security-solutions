import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Plus, Trash2, Edit, Clock, Mail, Calendar, ToggleLeft, ToggleRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function AutomatedReportScheduler() {
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    name: "",
    report_type: "weekly_summary",
    frequency: "weekly",
    send_day: "Monday",
    send_time: "08:00",
    email_recipients: "",
    sites: [],
    status: "active"
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['report-schedules'],
    queryFn: () => base44.entities.ReportSchedule.list('-created_date')
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => base44.entities.Site.list()
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const scheduleData = {
        ...data,
        email_recipients: data.email_recipients.split(',').map(e => e.trim()).filter(e => e)
      };

      if (editingSchedule) {
        await base44.entities.ReportSchedule.update(editingSchedule.id, scheduleData);
      } else {
        await base44.entities.ReportSchedule.create(scheduleData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['report-schedules']);
      setShowForm(false);
      setEditingSchedule(null);
      resetForm();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ReportSchedule.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['report-schedules'])
  });

  const toggleMutation = useMutation({
    mutationFn: async (schedule) => {
      await base44.entities.ReportSchedule.update(schedule.id, {
        status: schedule.status === 'active' ? 'paused' : 'active'
      });
    },
    onSuccess: () => queryClient.invalidateQueries(['report-schedules'])
  });

  const testReportMutation = useMutation({
    mutationFn: async (schedule) => {
      await base44.functions.invoke('generateAIReport', {
        reportType: schedule.report_type,
        frequency: schedule.frequency,
        sites: schedule.sites,
        emailRecipients: schedule.email_recipients
      });
    }
  });

  const resetForm = () => {
    setFormData({
      name: "",
      report_type: "weekly_summary",
      frequency: "weekly",
      send_day: "Monday",
      send_time: "08:00",
      email_recipients: "",
      sites: [],
      status: "active"
    });
  };

  const handleEdit = (schedule) => {
    setEditingSchedule(schedule);
    setFormData({
      ...schedule,
      email_recipients: schedule.email_recipients?.join(', ') || ''
    });
    setShowForm(true);
  };

  const reportTypes = [
    { value: "weekly_summary", label: "Weekly Incident Summary" },
    { value: "monthly_performance", label: "Monthly Performance Review" },
    { value: "daily_activity", label: "Daily Activity Report" },
    { value: "maintenance_summary", label: "Maintenance Summary" },
    { value: "guard_performance", label: "Guard Performance Metrics" },
    { value: "site_analytics", label: "Site Analytics Report" },
    { value: "incident_trends", label: "Incident Trends Analysis" }
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Automated Report Schedules</h2>
          <p className="text-sm text-slate-400">Configure AI-powered recurring reports</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-purple-600 hover:bg-purple-700">
          <Plus className="w-4 h-4 mr-2" />
          New Schedule
        </Button>
      </div>

      {schedules.length === 0 ? (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="p-12 text-center">
            <Sparkles className="w-12 h-12 text-purple-400 mx-auto mb-4" />
            <p className="text-slate-400 mb-4">No automated reports configured yet</p>
            <Button onClick={() => setShowForm(true)} className="bg-purple-600 hover:bg-purple-700">
              Create First Schedule
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {schedules.map(schedule => (
            <Card key={schedule.id} className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-white font-semibold">{schedule.name}</h3>
                      <Badge className={schedule.status === 'active' ? 'bg-emerald-600' : 'bg-slate-600'}>
                        {schedule.status}
                      </Badge>
                      <Badge variant="outline" className="border-purple-500/30 text-purple-300">
                        {reportTypes.find(t => t.value === schedule.report_type)?.label}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="flex items-center gap-2 text-slate-400">
                        <Calendar className="w-4 h-4" />
                        {schedule.frequency} - {schedule.send_day}
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <Clock className="w-4 h-4" />
                        {schedule.send_time}
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <Mail className="w-4 h-4" />
                        {schedule.email_recipients?.length || 0} recipients
                      </div>
                      {schedule.last_sent && (
                        <div className="text-slate-400 text-xs">
                          Last sent: {new Date(schedule.last_sent).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleMutation.mutate(schedule)}
                      className="text-slate-400"
                    >
                      {schedule.status === 'active' ? (
                        <ToggleRight className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-5 h-5" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm('Generate and send test report now?')) {
                          testReportMutation.mutate(schedule);
                        }
                      }}
                      disabled={testReportMutation.isPending}
                      className="text-purple-400 hover:text-purple-300"
                    >
                      <Sparkles className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEdit(schedule)}
                      className="text-sky-400 hover:text-sky-300"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm('Delete this schedule?')) {
                          deleteMutation.mutate(schedule.id);
                        }
                      }}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={(open) => {
        if (!open) {
          setShowForm(false);
          setEditingSchedule(null);
          resetForm();
        }
      }}>
        <DialogContent className="bg-slate-800 border-slate-700 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingSchedule ? 'Edit' : 'Create'} Report Schedule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Schedule Name</label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Weekly Security Summary"
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Report Type</label>
              <Select value={formData.report_type} onValueChange={(v) => setFormData({ ...formData, report_type: v })}>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {reportTypes.map(type => (
                    <SelectItem key={type.value} value={type.value} className="text-white">
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Frequency</label>
                <Select value={formData.frequency} onValueChange={(v) => setFormData({ ...formData, frequency: v })}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700">
                    <SelectItem value="daily" className="text-white">Daily</SelectItem>
                    <SelectItem value="weekly" className="text-white">Weekly</SelectItem>
                    <SelectItem value="monthly" className="text-white">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.frequency === 'weekly' && (
                <div>
                  <label className="text-sm text-slate-400 mb-2 block">Day</label>
                  <Select value={formData.send_day} onValueChange={(v) => setFormData({ ...formData, send_day: v })}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => (
                        <SelectItem key={day} value={day} className="text-white">{day}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <label className="text-sm text-slate-400 mb-2 block">Time</label>
                <Input
                  type="time"
                  value={formData.send_time}
                  onChange={(e) => setFormData({ ...formData, send_time: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Email Recipients (comma-separated)</label>
              <Input
                value={formData.email_recipients}
                onChange={(e) => setFormData({ ...formData, email_recipients: e.target.value })}
                placeholder="admin@company.com, manager@company.com"
                className="bg-slate-900 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Sites (optional - leave empty for all)</label>
              <Select 
                value={formData.sites[0] || "all"} 
                onValueChange={(v) => setFormData({ ...formData, sites: v === 'all' ? [] : [v] })}
              >
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white">All Sites</SelectItem>
                  {sites.map(site => (
                    <SelectItem key={site.id} value={site.id} className="text-white">{site.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setEditingSchedule(null);
                  resetForm();
                }}
                className="flex-1 border-slate-600"
              >
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate(formData)}
                disabled={!formData.name || !formData.email_recipients || createMutation.isPending}
                className="flex-1 bg-purple-600 hover:bg-purple-700"
              >
                {createMutation.isPending ? 'Saving...' : editingSchedule ? 'Save Changes' : 'Create Schedule'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}