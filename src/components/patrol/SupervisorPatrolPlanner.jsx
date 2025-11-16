import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Sparkles, Send, Trash2, ArrowUp, ArrowDown, Loader2 } from "lucide-react";

export default function SupervisorPatrolPlanner({ user, onClose }) {
  const [formData, setFormData] = useState({
    name: "",
    site_id: "",
    assigned_to: "",
    priority: "medium",
    route_checkpoints: [],
    estimated_duration_minutes: 60,
    high_risk_areas: [],
    ai_recommendations: ""
  });
  const [selectedCheckpoints, setSelectedCheckpoints] = useState([]);
  const [aiGenerating, setAiGenerating] = useState(false);
  const queryClient = useQueryClient();

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: () => base44.entities.Site.list(),
    initialData: []
  });

  const { data: activeGuards = [] } = useQuery({
    queryKey: ["activeGuards"],
    queryFn: async () => {
      const shifts = await base44.entities.Shift.filter({ status: "active" });
      return shifts;
    }
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ["recentIncidents"],
    queryFn: () => base44.entities.Incident.list("-reported_at", 50),
    initialData: []
  });

  const selectedSite = sites.find(s => s.id === formData.site_id);
  const availableCheckpoints = selectedSite?.checkpoints || [];

  const createPatrolPlanMutation = useMutation({
    mutationFn: async (planData) => {
      const assignedGuard = activeGuards.find(g => g.guard_id === planData.assigned_to);
      
      const plan = await base44.entities.PatrolPlan.create({
        ...planData,
        site_name: selectedSite?.name,
        assigned_to_name: assignedGuard?.guard_name,
        shift_id: assignedGuard?.id,
        created_by: user.id,
        created_by_name: user.full_name,
        status: "pending"
      });

      await base44.entities.Alert.create({
        type: "assignment",
        priority: planData.priority,
        title: "📍 New Patrol Plan Assigned",
        message: `You have been assigned a new patrol route: ${planData.name}. ${planData.route_checkpoints.length} checkpoints to complete.`,
        guard_id: planData.assigned_to,
        guard_name: assignedGuard?.guard_name,
        status: "active",
        metadata: { patrol_plan_id: plan.id }
      });

      return plan;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["patrolPlans"]);
      onClose();
    }
  });

  const generateAIRoute = async () => {
    if (!formData.site_id) {
      alert("Please select a site first");
      return;
    }

    setAiGenerating(true);
    try {
      const siteIncidents = incidents.filter(i => i.site_id === formData.site_id);
      
      const prompt = `Based on recent security data, generate an optimized patrol route:

Site: ${selectedSite?.name}
Available Checkpoints: ${availableCheckpoints.map(c => c.name).join(", ")}
Recent Incidents (last 30 days): ${siteIncidents.map(i => `${i.category} at ${new Date(i.reported_at).toLocaleDateString()}`).join(", ")}

Provide:
1. Recommended checkpoint order (use checkpoint names from available list)
2. Risk level for each checkpoint (low/medium/high/critical)
3. High-risk areas to focus on
4. Estimated total patrol duration in minutes
5. Key security recommendations

Format as JSON with: recommended_route (array of {checkpoint_name, order, risk_level, notes}), high_risk_areas (array), estimated_duration, recommendations`;

      const aiResponse = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false,
        response_json_schema: {
          type: "object",
          properties: {
            recommended_route: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  checkpoint_name: { type: "string" },
                  order: { type: "number" },
                  risk_level: { type: "string" },
                  notes: { type: "string" }
                }
              }
            },
            high_risk_areas: { type: "array", items: { type: "string" } },
            estimated_duration: { type: "number" },
            recommendations: { type: "string" }
          }
        }
      });

      const routeCheckpoints = aiResponse.recommended_route.map(item => {
        const checkpoint = availableCheckpoints.find(c => 
          c.name.toLowerCase() === item.checkpoint_name.toLowerCase()
        );
        return {
          checkpoint_id: checkpoint?.id || "",
          checkpoint_name: item.checkpoint_name,
          order: item.order,
          risk_level: item.risk_level,
          notes: item.notes,
          completed: false
        };
      }).filter(c => c.checkpoint_id);

      setFormData(prev => ({
        ...prev,
        route_checkpoints: routeCheckpoints,
        high_risk_areas: aiResponse.high_risk_areas,
        estimated_duration_minutes: aiResponse.estimated_duration,
        ai_recommendations: aiResponse.recommendations,
        name: `AI Patrol Plan - ${new Date().toLocaleDateString()}`
      }));
      
    } catch (error) {
      console.error("AI generation failed:", error);
      alert("Failed to generate AI route");
    } finally {
      setAiGenerating(false);
    }
  };

  const addCheckpoint = (checkpoint) => {
    const exists = formData.route_checkpoints.find(c => c.checkpoint_id === checkpoint.id);
    if (exists) return;

    setFormData(prev => ({
      ...prev,
      route_checkpoints: [
        ...prev.route_checkpoints,
        {
          checkpoint_id: checkpoint.id,
          checkpoint_name: checkpoint.name,
          order: prev.route_checkpoints.length + 1,
          risk_level: "medium",
          notes: "",
          completed: false
        }
      ]
    }));
  };

  const removeCheckpoint = (index) => {
    setFormData(prev => ({
      ...prev,
      route_checkpoints: prev.route_checkpoints.filter((_, i) => i !== index)
        .map((cp, i) => ({ ...cp, order: i + 1 }))
    }));
  };

  const moveCheckpoint = (index, direction) => {
    const newCheckpoints = [...formData.route_checkpoints];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    
    if (targetIndex < 0 || targetIndex >= newCheckpoints.length) return;
    
    [newCheckpoints[index], newCheckpoints[targetIndex]] = 
    [newCheckpoints[targetIndex], newCheckpoints[index]];
    
    setFormData(prev => ({
      ...prev,
      route_checkpoints: newCheckpoints.map((cp, i) => ({ ...cp, order: i + 1 }))
    }));
  };

  const handleSubmit = () => {
    if (!formData.name || !formData.site_id || !formData.assigned_to || formData.route_checkpoints.length === 0) {
      alert("Please fill in all required fields and add at least one checkpoint");
      return;
    }

    createPatrolPlanMutation.mutate(formData);
  };

  const riskColors = {
    low: "bg-slate-600",
    medium: "bg-amber-600",
    high: "bg-orange-600",
    critical: "bg-rose-600"
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 py-20">
        <Card className="max-w-4xl mx-auto bg-slate-800 border-slate-700">
          <CardHeader className="border-b border-slate-700">
            <div className="flex items-center justify-between">
              <CardTitle className="text-white">Create Dynamic Patrol Plan</CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-6 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white font-medium block mb-2">Plan Name *</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Evening patrol route"
                  className="bg-slate-900 border-slate-700 text-white"
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Priority *</label>
                <Select value={formData.priority} onValueChange={(v) => setFormData(prev => ({ ...prev, priority: v }))}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-white font-medium block mb-2">Site *</label>
                <Select value={formData.site_id} onValueChange={(v) => setFormData(prev => ({ ...prev, site_id: v }))}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Select site..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map(site => (
                      <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Assign to Guard *</label>
                <Select value={formData.assigned_to} onValueChange={(v) => setFormData(prev => ({ ...prev, assigned_to: v }))}>
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue placeholder="Select guard..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeGuards.map(guard => (
                      <SelectItem key={guard.guard_id} value={guard.guard_id}>
                        {guard.guard_name} - {guard.site_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={generateAIRoute}
                disabled={!formData.site_id || aiGenerating}
                className="bg-purple-600 hover:bg-purple-700 flex-1"
              >
                {aiGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Generating AI Route...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate AI-Optimized Route
                  </>
                )}
              </Button>
            </div>

            {formData.ai_recommendations && (
              <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <p className="text-sm font-semibold text-purple-400 mb-2">AI Recommendations:</p>
                <p className="text-sm text-slate-300">{formData.ai_recommendations}</p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-white font-medium">Route Checkpoints *</label>
                {formData.site_id && (
                  <Select onValueChange={(v) => {
                    const checkpoint = availableCheckpoints.find(c => c.id === v);
                    if (checkpoint) addCheckpoint(checkpoint);
                  }}>
                    <SelectTrigger className="w-48 bg-slate-900 border-slate-700 text-white">
                      <SelectValue placeholder="Add checkpoint..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCheckpoints.map(cp => (
                        <SelectItem key={cp.id} value={cp.id}>{cp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="space-y-2">
                {formData.route_checkpoints.length === 0 ? (
                  <p className="text-slate-400 text-sm text-center py-8">
                    No checkpoints added. Use AI generation or add manually.
                  </p>
                ) : (
                  formData.route_checkpoints.map((cp, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-slate-900 rounded-lg border border-slate-700">
                      <span className="text-white font-bold text-lg w-8">{cp.order}</span>
                      <div className="flex-1">
                        <p className="text-white font-medium">{cp.checkpoint_name}</p>
                        {cp.notes && <p className="text-xs text-slate-400">{cp.notes}</p>}
                      </div>
                      <Badge className={riskColors[cp.risk_level]}>{cp.risk_level}</Badge>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => moveCheckpoint(index, "up")} disabled={index === 0}>
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => moveCheckpoint(index, "down")} disabled={index === formData.route_checkpoints.length - 1}>
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeCheckpoint(index)} className="text-rose-400">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {formData.high_risk_areas.length > 0 && (
              <div>
                <label className="text-white font-medium block mb-2">High Risk Areas</label>
                <div className="flex flex-wrap gap-2">
                  {formData.high_risk_areas.map((area, i) => (
                    <Badge key={i} className="bg-rose-500">{area}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-slate-700">
              <Button variant="outline" onClick={onClose} className="flex-1 border-slate-600">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createPatrolPlanMutation.isPending}
                className="flex-1 bg-sky-600 hover:bg-sky-700"
              >
                {createPatrolPlanMutation.isPending ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5 mr-2" />
                    Assign Patrol Plan
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}