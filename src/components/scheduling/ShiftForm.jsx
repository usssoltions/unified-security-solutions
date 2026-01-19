import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Loader2, Calendar, Users } from "lucide-react";
import { useMutation } from '@tanstack/react-query'; // Import useMutation

// Helper function to format ISO date strings for datetime-local input
const formatDateTimeForInput = (isoString) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  // Using methods that respect the local time zone to format for datetime-local input
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export default function ShiftForm({ shift, guards, sites, preselectedDate, onClose, onSuccess }) {
  const [formData, setFormData] = useState(() => {
    if (shift) {
      return {
        guard_id: shift.guard_id || null,
        site_id: shift.site_id,
        start_time: formatDateTimeForInput(shift.start_time),
        end_time: formatDateTimeForInput(shift.end_time),
        status: shift.status
      };
    } else {
      // Pre-fill date and time if a date was selected from calendar
      let defaultStart = "";
      let defaultEnd = "";
      
      if (preselectedDate) {
        const date = new Date(preselectedDate);
        date.setHours(8, 0, 0, 0); // Default to 8 AM
        defaultStart = formatDateTimeForInput(date.toISOString());
        
        const endDate = new Date(date);
        endDate.setHours(20, 0, 0, 0); // Default to 8 PM (12-hour shift)
        defaultEnd = formatDateTimeForInput(endDate.toISOString());
      }
      
      return {
        guard_ids: [],
        site_id: "",
        start_time: defaultStart,
        end_time: defaultEnd,
        status: "scheduled"
      };
    }
  });
  
  const [selectedGuards, setSelectedGuards] = useState([]);

  const createShiftMutation = useMutation({
    mutationFn: async (shiftsData) => {
      if (shift) {
        // Update existing shift (single guard)
        const updated = await base44.entities.Shift.update(shift.id, shiftsData);
        
        // Send email and in-app notification if guard was assigned/changed
        if (shiftsData.guard_id && shiftsData.guard_id !== shift.guard_id) {
          try {
            const guard = guards.find(g => g.id === shiftsData.guard_id);
            await base44.functions.invoke('sendShiftNotification', {
              shiftId: updated.id,
              guardId: shiftsData.guard_id,
              guardEmail: guard?.email,
              guardName: shiftsData.guard_name,
              siteName: shiftsData.site_name,
              startTime: shiftsData.start_time,
              endTime: shiftsData.end_time,
              notificationType: 'updated'
            });
          } catch (error) {
            console.error('Failed to send shift notification:', error);
          }
        }
        
        return updated;
      } else {
        // Create shifts for multiple guards
        const site = sites.find(s => s.id === shiftsData.site_id);
        const createdShifts = [];
        
        for (const guardId of shiftsData.guard_ids) {
          const guard = guards.find(g => g.id === guardId);
          const shiftData = {
            guard_id: guardId,
            guard_name: guard?.full_name || null,
            site_id: shiftsData.site_id,
            site_name: site?.name || "",
            start_time: shiftsData.start_time,
            end_time: shiftsData.end_time,
            status: shiftsData.status
          };
          
          const created = await base44.entities.Shift.create(shiftData);
          createdShifts.push(created);
          
          // Send notification to each guard
          try {
            await base44.functions.invoke('sendShiftNotification', {
              shiftId: created.id,
              guardId: guardId,
              guardEmail: guard?.email,
              guardName: guard?.full_name,
              siteName: site?.name,
              startTime: shiftsData.start_time,
              endTime: shiftsData.end_time,
              notificationType: 'assigned'
            });
          } catch (error) {
            console.error('Failed to send shift notification:', error);
          }
        }
        
        return createdShifts;
      }
    },
    onSuccess: () => {
      onSuccess();
    },
    onError: (error) => {
      console.error("Shift operation failed:", error);
      alert(`Failed to ${shift ? 'update' : 'create'} shift: ${error.message || 'Unknown error'}`);
    }
  });

  const handleSubmit = async () => {
    // Basic validation
    if (!formData.site_id || !formData.start_time || !formData.end_time) {
      alert("Please fill in all required fields (Site, Start Time, End Time)");
      return;
    }

    if (shift) {
      // Editing existing shift (single guard)
      const guard = guards.find(g => g.id === formData.guard_id);
      const site = sites.find(s => s.id === formData.site_id);
      const dataToSend = {
        ...formData,
        guard_name: guard?.full_name || null,
        site_name: site?.name || ""
      };
      createShiftMutation.mutate(dataToSend);
    } else {
      // Creating new shifts (potentially multiple guards)
      if (selectedGuards.length === 0) {
        alert("Please select at least one guard");
        return;
      }
      
      const dataToSend = {
        guard_ids: selectedGuards,
        site_id: formData.site_id,
        start_time: formData.start_time,
        end_time: formData.end_time,
        status: formData.status
      };
      
      createShiftMutation.mutate(dataToSend);
    }
  };
  
  const toggleGuard = (guardId) => {
    setSelectedGuards(prev => 
      prev.includes(guardId) 
        ? prev.filter(id => id !== guardId)
        : [...prev, guardId]
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-white" />
                </div>
                <CardTitle className="text-white text-xl">
                  {shift ? "Edit Shift" : "Create New Shift"}
                </CardTitle>
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

            {shift ? (
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Assign Guard (Optional - leave blank for open shift)
                </label>
                <Select value={formData.guard_id} onValueChange={(value) => setFormData({ ...formData, guard_id: value })}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Select guard or leave open..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>Open Shift</SelectItem>
                    {guards.map((guard) => (
                      <SelectItem key={guard.id} value={guard.id}>
                        {guard.full_name} ({guard.badge_number})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2 flex items-center gap-2">
                  <Users className="w-4 h-4" />
                  Select Guards <span className="text-rose-400">*</span>
                  <span className="text-xs text-slate-500 font-normal ml-auto">
                    {selectedGuards.length} selected
                  </span>
                </label>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
                  {guards.map((guard) => (
                    <div 
                      key={guard.id}
                      className="flex items-center gap-3 p-2 rounded hover:bg-slate-800 cursor-pointer"
                      onClick={() => toggleGuard(guard.id)}
                    >
                      <Checkbox 
                        checked={selectedGuards.includes(guard.id)}
                        onCheckedChange={() => toggleGuard(guard.id)}
                      />
                      <div className="flex-1">
                        <p className="text-white text-sm font-medium">{guard.full_name}</p>
                        <p className="text-slate-400 text-xs">{guard.badge_number}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Start Time <span className="text-rose-400">*</span>
                </label>
                <Input
                  type="datetime-local"
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  End Time <span className="text-rose-400">*</span>
                </label>
                <Input
                  type="datetime-local"
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 border-slate-600 text-slate-300"
                disabled={createShiftMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createShiftMutation.isPending}
                className="flex-1 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700"
              >
                {createShiftMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    {shift ? "Saving..." : "Creating..."}
                  </>
                ) : (
                  shift ? "Save Changes" : "Create Shift"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}