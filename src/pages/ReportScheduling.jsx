import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Calendar, Mail, Clock, Send, Trash2, Plus, X } from "lucide-react";

export default function ReportScheduling() {
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [customEmails, setCustomEmails] = useState([]);
  const [newEmail, setNewEmail] = useState("");
  
  const [formData, setFormData] = useState({
    report_type: "incident_maintenance_summary",
    frequency: "monthly",
    schedule_day: 1,
    schedule_time: "08:00",
    include_admins: true
  });

  const queryClient = useQueryClient();

  const { data: schedules = [] } = useQuery({
    queryKey: ['reportSchedules'],
    queryFn: () => base44.entities.ReportSchedule.list()
  });

  const createScheduleMutation = useMutation({
    mutationFn: (data) => base44.entities.ReportSchedule.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['reportSchedules']);
      resetForm();
    }
  });

  const updateScheduleMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ReportSchedule.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['reportSchedules']);
      resetForm();
    }
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id) => base44.entities.ReportSchedule.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['reportSchedules']);
    }
  });

  const sendNowMutation = useMutation({
    mutationFn: async (reportType) => {
      if (reportType === 'incident_maintenance_summary') {
        return base44.functions.invoke('sendIncidentMaintenanceSummary', {});
      } else if (reportType === 'guard_performance') {
        return base44.functions.invoke('sendGuardPerformanceReport', {});
      }
    },
    onSuccess: () => {
      alert('Report sent successfully!');
    }
  });

  const addCustomEmail = () => {
    if (newEmail && /\S+@\S+\.\S+/.test(newEmail)) {
      setCustomEmails([...customEmails, { email: newEmail, name: newEmail, type: 'custom' }]);
      setNewEmail("");
    }
  };

  const removeCustomEmail = (index) => {
    setCustomEmails(customEmails.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingSchedule(null);
    setCustomEmails([]);
    setFormData({
      report_type: "incident_maintenance_summary",
      frequency: "monthly",
      schedule_day: 1,
      schedule_time: "08:00",
      include_admins: true
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    const scheduleData = {
      ...formData,
      recipients: customEmails
    };

    if (editingSchedule) {
      updateScheduleMutation.mutate({ id: editingSchedule.id, data: scheduleData });
    } else {
      createScheduleMutation.mutate(scheduleData);
    }
  };

  const reportTypeLabels = {
    incident_maintenance_summary: "Incident & Maintenance Summary",
    guard_performance: "Guard Performance Report",
    site_activity: "Site Activity Report",
    comprehensive_monthly: "Comprehensive Monthly Report"
  };

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
            <Calendar className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Report Scheduling</h1>
            <p className="text-sm text-slate-400">Automate report generation and distribution</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(true)} className="bg-purple-500 hover:bg-purple-600">
          <Plus className="w-4 h-4 mr-2" />
          New Schedule
        </Button>
      </div>

      {showForm && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">
                {editingSchedule ? 'Edit Schedule' : 'Create New Schedule'}
              </CardTitle>
              <Button variant="ghost" size="icon" onClick={resetForm}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-slate-300">Report Type</Label>
                  <Select
                    value={formData.report_type}
                    onValueChange={(value) => setFormData({ ...formData, report_type: value })}
                  >
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="incident_maintenance_summary">Incident & Maintenance Summary</SelectItem>
                      <SelectItem value="guard_performance">Guard Performance Report</SelectItem>
                      <SelectItem value="site_activity">Site Activity Report</SelectItem>
                      <SelectItem value="comprehensive_monthly">Comprehensive Monthly Report</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-slate-300">Frequency</Label>
                  <Select
                    value={formData.frequency}
                    onValueChange={(value) => setFormData({ ...formData, frequency: value })}
                  >
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="real-time">Real-time (Immediate)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.frequency === 'monthly' && (
                  <div>
                    <Label className="text-slate-300">Day of Month</Label>
                    <Input
                      type="number"
                      min="1"
                      max="31"
                      value={formData.schedule_day}
                      onChange={(e) => setFormData({ ...formData, schedule_day: parseInt(e.target.value) })}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                )}

                {formData.frequency !== 'real-time' && (
                  <div>
                    <Label className="text-slate-300">Time</Label>
                    <Input
                      type="time"
                      value={formData.schedule_time}
                      onChange={(e) => setFormData({ ...formData, schedule_time: e.target.value })}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-900 rounded-lg">
                <Label className="text-slate-300">Send to all Admins</Label>
                <Switch
                  checked={formData.include_admins}
                  onCheckedChange={(checked) => setFormData({ ...formData, include_admins: checked })}
                />
              </div>

              <div>
                <Label className="text-slate-300 mb-2 block">Additional Recipients</Label>
                <div className="flex gap-2 mb-2">
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                  <Button type="button" onClick={addCustomEmail} variant="outline">
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {customEmails.map((email, index) => (
                    <div key={index} className="flex items-center justify-between p-2 bg-slate-900 rounded">
                      <span className="text-slate-300 text-sm">{email.email}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCustomEmail(index)}
                      >
                        <Trash2 className="w-4 h-4 text-rose-400" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" className="flex-1 bg-purple-500 hover:bg-purple-600">
                  {editingSchedule ? 'Update Schedule' : 'Create Schedule'}
                </Button>
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {schedules.map((schedule) => (
          <Card key={schedule.id} className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-white">
                      {reportTypeLabels[schedule.report_type]}
                    </h3>
                    <Badge variant={schedule.is_active ? "default" : "secondary"}>
                      {schedule.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    <Badge variant="outline" className="border-purple-400 text-purple-400">
                      {schedule.frequency}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center gap-6 text-sm text-slate-400">
                    {schedule.frequency === 'monthly' && (
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Day {schedule.schedule_day} of month
                      </div>
                    )}
                    {schedule.schedule_time && (
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        {schedule.schedule_time}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4" />
                      {schedule.include_admins ? 'All Admins' : 'Custom'}
                      {schedule.recipients?.length > 0 && ` + ${schedule.recipients.length} more`}
                    </div>
                  </div>

                  {schedule.last_sent_at && (
                    <p className="text-xs text-slate-500">
                      Last sent: {new Date(schedule.last_sent_at).toLocaleString()}
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => sendNowMutation.mutate(schedule.report_type)}
                    className="border-sky-400 text-sky-400 hover:bg-sky-400/10"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send Now
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteScheduleMutation.mutate(schedule.id)}
                    className="text-rose-400 hover:bg-rose-400/10"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {schedules.length === 0 && !showForm && (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="p-12 text-center">
              <Calendar className="w-12 h-12 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No scheduled reports yet</p>
              <p className="text-sm text-slate-500 mb-4">Create your first automated report schedule</p>
              <Button onClick={() => setShowForm(true)} className="bg-purple-500 hover:bg-purple-600">
                Create Schedule
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}