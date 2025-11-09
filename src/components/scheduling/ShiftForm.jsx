
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Loader2, Calendar } from "lucide-react";
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

export default function ShiftForm({ shift, guards, sites, onClose, onSuccess }) {
  const [formData, setFormData] = useState(() => {
    if (shift) {
      return {
        guard_id: shift.guard_id || null, // Ensure null if unassigned
        site_id: shift.site_id,
        start_time: formatDateTimeForInput(shift.start_time),
        end_time: formatDateTimeForInput(shift.end_time),
        status: shift.status
      };
    } else {
      return {
        guard_id: null, // Default to null for new shifts, representing "open shift"
        site_id: "",
        start_time: "",
        end_time: "",
        status: "scheduled"
      };
    }
  });

  const createShiftMutation = useMutation({
    mutationFn: async (shiftData) => {
      if (shift) {
        // Update existing shift
        const updated = await base44.entities.Shift.update(shift.id, shiftData);
        
        // Notify guard of shift change if assigned and guard_id changed
        // This includes new assignments to existing shifts or changing guards on a shift
        if (shiftData.guard_id && shiftData.guard_id !== shift.guard_id) {
          try {
            await base44.functions.invoke('sendPushNotification', {
              user_ids: [shiftData.guard_id],
              title: '📅 Shift Updated',
              body: `Your shift at ${shiftData.site_name} has been updated`,
              priority: 'medium',
              data: {
                type: 'shift',
                id: updated.id,
                action: 'updated'
              }
            });
          } catch (error) {
            console.error('Failed to send notification for updated shift:', error);
          }
        }
        
        return updated;
      } else {
        // Create new shift
        const created = await base44.entities.Shift.create(shiftData);
        
        // Notify guard of new shift assignment
        if (shiftData.guard_id) {
          try {
            await base44.functions.invoke('sendPushNotification', {
              user_ids: [shiftData.guard_id],
              title: '📅 New Shift Assigned',
              body: `You have been assigned a shift at ${shiftData.site_name}`,
              priority: 'medium',
              data: {
                type: 'shift',
                id: created.id,
                action: 'created'
              }
            });
          } catch (error) {
            console.error('Failed to send notification for new shift:', error);
          }
        }
        
        return created;
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

    const guard = guards.find(g => g.id === formData.guard_id);
    const site = sites.find(s => s.id === formData.site_id);

    // Prepare data for mutation, ensuring guard_id is null if not selected, and names are included for notifications
    const dataToSend = {
      ...formData,
      guard_name: guard?.full_name || null, // Set to null if no guard is assigned
      site_name: site?.name || ""
    };

    createShiftMutation.mutate(dataToSend);
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
