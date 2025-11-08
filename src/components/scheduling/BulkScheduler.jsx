import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Loader2, Users } from "lucide-react";

export default function BulkScheduler({ guards, sites, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    site_id: "",
    start_date: "",
    end_date: "",
    start_time: "08:00",
    end_time: "16:00",
    days: {
      monday: false,
      tuesday: false,
      wednesday: false,
      thursday: false,
      friday: false,
      saturday: false,
      sunday: false
    }
  });
  const [selectedGuards, setSelectedGuards] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!formData.site_id || !formData.start_date || !formData.end_date) {
      alert("Please fill in all required fields");
      return;
    }

    const selectedDays = Object.keys(formData.days).filter(day => formData.days[day]);
    if (selectedDays.length === 0) {
      alert("Please select at least one day");
      return;
    }

    setSubmitting(true);

    try {
      const site = sites.find(s => s.id === formData.site_id);
      const shifts = [];
      
      const startDate = new Date(formData.start_date);
      const endDate = new Date(formData.end_date);
      
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
        
        if (formData.days[dayName]) {
          const shiftDate = new Date(d);
          const [startHour, startMinute] = formData.start_time.split(':');
          const [endHour, endMinute] = formData.end_time.split(':');
          
          const startTime = new Date(shiftDate.setHours(parseInt(startHour), parseInt(startMinute)));
          const endTime = new Date(shiftDate.setHours(parseInt(endHour), parseInt(endMinute)));
          
          if (selectedGuards.length > 0) {
            for (const guardId of selectedGuards) {
              const guard = guards.find(g => g.id === guardId);
              shifts.push({
                guard_id: guardId,
                guard_name: guard?.full_name || "",
                site_id: formData.site_id,
                site_name: site?.name || "",
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                status: "scheduled"
              });
            }
          } else {
            shifts.push({
              guard_id: "",
              guard_name: "",
              site_id: formData.site_id,
              site_name: site?.name || "",
              start_time: startTime.toISOString(),
              end_time: endTime.toISOString(),
              status: "open"
            });
          }
        }
      }

      await base44.entities.Shift.bulkCreate(shifts);
      onSuccess();
    } catch (error) {
      alert("Failed to create shifts");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-2xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
                  <Users className="w-6 h-6 text-white" />
                </div>
                <CardTitle className="text-white text-xl">Bulk Shift Scheduler</CardTitle>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Site <span className="text-rose-400">*</span>
              </label>
              <Select value={formData.site_id} onValueChange={(value) => setFormData({ ...formData, site_id: value })}>
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

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Start Date <span className="text-rose-400">*</span>
                </label>
                <Input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  End Date <span className="text-rose-400">*</span>
                </label>
                <Input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Shift Start</label>
                <Input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Shift End</label>
                <Input
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Repeat on Days <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-4 gap-2">
                {Object.keys(formData.days).map((day) => (
                  <label key={day} className="flex items-center gap-2 text-white cursor-pointer">
                    <Checkbox
                      checked={formData.days[day]}
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          days: { ...formData.days, [day]: checked }
                        })
                      }
                    />
                    <span className="capitalize text-sm">{day.substring(0, 3)}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm text-slate-300 font-medium block mb-2">
                Assign Guards (optional)
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto p-3 bg-slate-900/50 rounded-lg">
                {guards.map((guard) => (
                  <label key={guard.id} className="flex items-center gap-2 text-white cursor-pointer">
                    <Checkbox
                      checked={selectedGuards.includes(guard.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedGuards([...selectedGuards, guard.id]);
                        } else {
                          setSelectedGuards(selectedGuards.filter(id => id !== guard.id));
                        }
                      }}
                    />
                    <span className="text-sm">{guard.full_name} ({guard.badge_number})</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 text-slate-300"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Shifts"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}