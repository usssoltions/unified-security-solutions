import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Plus, Check, X, Clock, AlertCircle, User, MapPin } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function ShiftSwapManager({ user }) {
  const queryClient = useQueryClient();
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [formData, setFormData] = useState({
    target_guard_id: "",
    original_shift_id: "",
    offered_shift_id: "",
    reason: ""
  });

  const { data: myShifts = [] } = useQuery({
    queryKey: ['myShifts', user?.id],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ 
        guard_id: user.id,
        status: "scheduled"
      });
      return shifts.filter(s => new Date(s.start_time) > new Date());
    },
    enabled: !!user
  });

  const { data: guards = [] } = useQuery({
    queryKey: ['guards'],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard" && u.id !== user?.id);
    }
  });

  const { data: swapRequests = [] } = useQuery({
    queryKey: ['swapRequests', user?.id],
    queryFn: async () => {
      const requests = await base44.entities.ShiftSwapRequest.list('-created_date');
      return requests.filter(r => 
        r.requesting_guard_id === user.id || r.target_guard_id === user.id
      );
    },
    enabled: !!user,
    refetchInterval: 10000
  });

  const createSwapMutation = useMutation({
    mutationFn: async (data) => {
      const originalShift = myShifts.find(s => s.id === data.original_shift_id);
      const targetGuard = guards.find(g => g.id === data.target_guard_id);

      const swapRequest = await base44.entities.ShiftSwapRequest.create({
        requesting_guard_id: user.id,
        requesting_guard_name: user.full_name,
        target_guard_id: data.target_guard_id,
        target_guard_name: targetGuard.full_name,
        original_shift_id: data.original_shift_id,
        original_shift_details: {
          site_name: originalShift.site_name,
          start_time: originalShift.start_time,
          end_time: originalShift.end_time
        },
        offered_shift_id: data.offered_shift_id || null,
        reason: data.reason,
        status: "pending"
      });

      // Notify target guard
      await base44.entities.Notification.create({
        recipient_id: data.target_guard_id,
        recipient_name: targetGuard.full_name,
        type: "system",
        priority: "medium",
        title: "🔄 Shift Swap Request",
        message: `${user.full_name} wants to swap shifts with you. Check the Swap Requests section.`,
        related_entity: "ShiftSwapRequest",
        related_id: swapRequest.id
      });

      return swapRequest;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['swapRequests']);
      setShowRequestForm(false);
      setFormData({ target_guard_id: "", original_shift_id: "", offered_shift_id: "", reason: "" });
    }
  });

  const respondToSwapMutation = useMutation({
    mutationFn: async ({ requestId, approved, response }) => {
      const request = swapRequests.find(r => r.id === requestId);
      
      await base44.entities.ShiftSwapRequest.update(requestId, {
        status: approved ? "approved_by_target" : "rejected",
        target_response: response,
        target_responded_at: new Date().toISOString()
      });

      // Notify requester
      await base44.entities.Notification.create({
        recipient_id: request.requesting_guard_id,
        recipient_name: request.requesting_guard_name,
        type: "system",
        priority: "high",
        title: approved ? "✅ Swap Approved by Guard" : "❌ Swap Request Declined",
        message: `${request.target_guard_name} has ${approved ? 'agreed to' : 'declined'} your shift swap request. ${approved ? 'Awaiting admin approval.' : ''}`,
        related_entity: "ShiftSwapRequest",
        related_id: requestId
      });

      if (approved) {
        // Notify admins
        const admins = await base44.entities.User.filter({ role_type: "admin" });
        await Promise.all(admins.map(admin =>
          base44.entities.Notification.create({
            recipient_id: admin.id,
            recipient_name: admin.full_name,
            type: "system",
            priority: "medium",
            title: "🔄 Swap Request Needs Approval",
            message: `${request.requesting_guard_name} and ${request.target_guard_name} have agreed to swap shifts. Please review.`,
            related_entity: "ShiftSwapRequest",
            related_id: requestId
          })
        ));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['swapRequests']);
    }
  });

  const adminApproveSwapMutation = useMutation({
    mutationFn: async ({ requestId, approved, notes }) => {
      const request = swapRequests.find(r => r.id === requestId);

      if (approved) {
        // Perform the swap
        await base44.entities.Shift.update(request.original_shift_id, {
          guard_id: request.target_guard_id,
          guard_name: request.target_guard_name
        });

        if (request.offered_shift_id) {
          await base44.entities.Shift.update(request.offered_shift_id, {
            guard_id: request.requesting_guard_id,
            guard_name: request.requesting_guard_name
          });
        }

        await base44.entities.ShiftSwapRequest.update(requestId, {
          status: "approved_by_admin",
          approved_by: user.id,
          approved_at: new Date().toISOString(),
          admin_notes: notes,
          completed_at: new Date().toISOString()
        });

        // Notify both guards
        await Promise.all([
          base44.entities.Notification.create({
            recipient_id: request.requesting_guard_id,
            recipient_name: request.requesting_guard_name,
            type: "system",
            priority: "high",
            title: "✅ Shift Swap Approved",
            message: "Your shift swap has been approved by management. Check your updated schedule.",
            related_entity: "ShiftSwapRequest",
            related_id: requestId
          }),
          base44.entities.Notification.create({
            recipient_id: request.target_guard_id,
            recipient_name: request.target_guard_name,
            type: "system",
            priority: "high",
            title: "✅ Shift Swap Approved",
            message: "The shift swap has been approved by management. Check your updated schedule.",
            related_entity: "ShiftSwapRequest",
            related_id: requestId
          })
        ]);
      } else {
        await base44.entities.ShiftSwapRequest.update(requestId, {
          status: "rejected",
          admin_notes: notes
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['swapRequests']);
      queryClient.invalidateQueries(['shifts']);
    }
  });

  const statusColors = {
    pending: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    approved_by_target: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    approved_by_admin: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    rejected: "bg-rose-500/20 text-rose-400 border-rose-500/30"
  };

  const isAdmin = user?.role_type === "admin" || user?.role_type === "dispatcher";

  return (
    <div className="space-y-4 w-full">
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="p-3 sm:p-4 lg:p-6">
          <div className="flex items-center justify-between">
            <CardTitle className="text-white flex items-center gap-2 text-base sm:text-lg">
              <RefreshCw className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
              Shift Swap Requests
            </CardTitle>
            {user?.role_type === "guard" && (
              <Button
                size="sm"
                onClick={() => setShowRequestForm(!showRequestForm)}
                className="bg-sky-600 hover:bg-sky-700 text-xs sm:text-sm"
              >
                <Plus className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
                Request Swap
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4 lg:p-6 pt-0 space-y-3 sm:space-y-4">
          {showRequestForm && (
            <Card className="bg-slate-900/50 border-slate-700">
              <CardContent className="p-3 sm:p-4 space-y-3">
                <Alert className="bg-sky-500/10 border-sky-500/20">
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription className="text-xs sm:text-sm text-slate-300">
                    Request a shift swap with another guard. Both the guard and admin must approve.
                  </AlertDescription>
                </Alert>

                <div className="space-y-2">
                  <Label className="text-slate-300 text-xs sm:text-sm">Your Shift to Swap</Label>
                  <Select
                    value={formData.original_shift_id}
                    onValueChange={(value) => setFormData({ ...formData, original_shift_id: value })}
                  >
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white text-sm">
                      <SelectValue placeholder="Select shift..." />
                    </SelectTrigger>
                    <SelectContent>
                      {myShifts.map(shift => (
                        <SelectItem key={shift.id} value={shift.id}>
                          {shift.site_name} - {new Date(shift.start_time).toLocaleDateString()} {new Date(shift.start_time).toLocaleTimeString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300 text-xs sm:text-sm">Swap With Guard</Label>
                  <Select
                    value={formData.target_guard_id}
                    onValueChange={(value) => setFormData({ ...formData, target_guard_id: value })}
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
                  <Label className="text-slate-300 text-xs sm:text-sm">Reason</Label>
                  <Textarea
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="Why do you need to swap this shift?"
                    className="bg-slate-900 border-slate-700 text-white text-sm"
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowRequestForm(false)}
                    variant="outline"
                    size="sm"
                    className="flex-1 border-slate-600 text-xs sm:text-sm"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createSwapMutation.mutate(formData)}
                    disabled={!formData.original_shift_id || !formData.target_guard_id || !formData.reason || createSwapMutation.isPending}
                    size="sm"
                    className="flex-1 bg-sky-600 hover:bg-sky-700 text-xs sm:text-sm"
                  >
                    Submit Request
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="space-y-2 sm:space-y-3">
            {swapRequests.map(request => (
              <Card key={request.id} className="bg-slate-900/50 border-slate-700">
                <CardContent className="p-3 sm:p-4">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <User className="w-4 h-4 text-sky-400 flex-shrink-0" />
                          <span className="text-sm sm:text-base font-medium text-white truncate">
                            {request.requesting_guard_name} → {request.target_guard_name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-400">
                          <MapPin className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                          <span className="truncate">{request.original_shift_details?.site_name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">
                            {new Date(request.original_shift_details?.start_time).toLocaleDateString()} {new Date(request.original_shift_details?.start_time).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <Badge className={`${statusColors[request.status]} border text-xs whitespace-nowrap`}>
                        {request.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>

                    {request.reason && (
                      <p className="text-xs sm:text-sm text-slate-400 italic">"{request.reason}"</p>
                    )}

                    {request.target_guard_id === user.id && request.status === "pending" && (
                      <div className="flex gap-2 pt-2 border-t border-slate-700">
                        <Input
                          placeholder="Optional response message..."
                          className="bg-slate-900 border-slate-700 text-white text-xs sm:text-sm"
                          id={`response-${request.id}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const response = document.getElementById(`response-${request.id}`).value;
                            respondToSwapMutation.mutate({ requestId: request.id, approved: false, response });
                          }}
                          className="border-rose-600 text-rose-400 text-xs"
                        >
                          <X className="w-3 h-3 sm:w-4 sm:h-4" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            const response = document.getElementById(`response-${request.id}`).value;
                            respondToSwapMutation.mutate({ requestId: request.id, approved: true, response });
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-xs"
                        >
                          <Check className="w-3 h-3 sm:w-4 sm:h-4" />
                        </Button>
                      </div>
                    )}

                    {isAdmin && request.status === "approved_by_target" && (
                      <div className="flex gap-2 pt-2 border-t border-slate-700">
                        <Input
                          placeholder="Admin notes..."
                          className="bg-slate-900 border-slate-700 text-white text-xs sm:text-sm"
                          id={`admin-${request.id}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const notes = document.getElementById(`admin-${request.id}`).value;
                            adminApproveSwapMutation.mutate({ requestId: request.id, approved: false, notes });
                          }}
                          className="border-rose-600 text-rose-400 text-xs"
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            const notes = document.getElementById(`admin-${request.id}`).value;
                            adminApproveSwapMutation.mutate({ requestId: request.id, approved: true, notes });
                          }}
                          className="bg-emerald-600 hover:bg-emerald-700 text-xs"
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {swapRequests.length === 0 && (
              <div className="text-center py-8">
                <RefreshCw className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No shift swap requests</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}