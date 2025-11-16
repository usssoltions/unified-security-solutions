import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Loader2, MapPin, CheckCircle2, Clock, AlertTriangle, Send } from "lucide-react";

export default function AIPatrolGuidance({ user, shift, location }) {
  const [guidance, setGuidance] = useState(null);
  const [checkpointFeedback, setCheckpointFeedback] = useState({});
  const queryClient = useQueryClient();

  const { data: assignedPlan } = useQuery({
    queryKey: ["assignedPatrolPlan", user.id, shift?.id],
    queryFn: async () => {
      const plans = await base44.entities.PatrolPlan.filter({
        assigned_to: user.id,
        shift_id: shift?.id,
        status: { $in: ["pending", "active"] }
      });
      return plans[0] || null;
    },
    enabled: !!user && !!shift,
    refetchInterval: 10000
  });

  const { data: siteIncidents = [] } = useQuery({
    queryKey: ["siteIncidents", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return [];
      return await base44.entities.Incident.filter(
        { site_id: shift.site_id },
        "-reported_at",
        20
      );
    },
    enabled: !!shift?.site_id,
    initialData: []
  });

  const { data: patrolLogs = [] } = useQuery({
    queryKey: ["patrolLogs", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return [];
      return await base44.entities.PatrolLog.filter(
        { site_id: shift.site_id },
        "-timestamp",
        50
      );
    },
    enabled: !!shift?.site_id,
    initialData: []
  });

  const { data: site } = useQuery({
    queryKey: ["site", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return null;
      return await base44.entities.Site.get(shift.site_id);
    },
    enabled: !!shift?.site_id
  });

  const startPlanMutation = useMutation({
    mutationFn: async (planId) => {
      await base44.entities.PatrolPlan.update(planId, {
        status: "active",
        started_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["assignedPatrolPlan"]);
    }
  });

  const completeCheckpointMutation = useMutation({
    mutationFn: async ({ planId, checkpointIndex, feedback }) => {
      const updatedCheckpoints = [...assignedPlan.route_checkpoints];
      updatedCheckpoints[checkpointIndex] = {
        ...updatedCheckpoints[checkpointIndex],
        completed: true,
        completed_at: new Date().toISOString(),
        guard_feedback: feedback
      };

      await base44.entities.PatrolPlan.update(planId, {
        route_checkpoints: updatedCheckpoints
      });

      await base44.entities.PatrolLog.create({
        guard_id: user.id,
        guard_name: user.full_name,
        shift_id: shift.id,
        site_id: shift.site_id,
        checkpoint_id: updatedCheckpoints[checkpointIndex].checkpoint_id,
        checkpoint_name: updatedCheckpoints[checkpointIndex].checkpoint_name,
        location: location,
        timestamp: new Date().toISOString(),
        verified: true,
        notes: feedback || "Patrol plan checkpoint completed"
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["assignedPatrolPlan"]);
      setCheckpointFeedback({});
    }
  });

  const completePlanMutation = useMutation({
    mutationFn: async ({ planId, notes }) => {
      await base44.entities.PatrolPlan.update(planId, {
        status: "completed",
        completed_at: new Date().toISOString(),
        guard_notes: notes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["assignedPatrolPlan"]);
    }
  });

  const analyzePatrolMutation = useMutation({
    mutationFn: async () => {
      const prompt = `Analyze current security situation and provide patrol guidance:

Current Location: ${location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : 'Unknown'}
Site: ${shift?.site_name || 'Unknown'}
Available Checkpoints: ${site?.checkpoints?.map(c => c.name).join(", ") || "None"}

Recent Incidents (Last 30 days):
${siteIncidents.slice(0, 10).map(i => 
  `- ${i.category} on ${new Date(i.reported_at).toLocaleDateString()} (Priority: ${i.priority})`
).join("\n") || "No recent incidents"}

Recent Patrol Activity:
${patrolLogs.slice(0, 10).map(p => 
  `- ${p.checkpoint_name} at ${new Date(p.timestamp).toLocaleString()}`
).join("\n") || "No recent patrols"}

Provide:
1. Risk level assessment (low/medium/high/critical)
2. Immediate action items (max 3)
3. High-risk areas to focus on (max 3)
4. Suggested patrol route (checkpoint names in order)
5. Time-specific security tips`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt,
        add_context_from_internet: false,
        response_json_schema: {
          type: "object",
          properties: {
            risk_level: { type: "string" },
            immediate_actions: {
              type: "array",
              items: { type: "string" }
            },
            high_risk_areas: {
              type: "array",
              items: { type: "string" }
            },
            suggested_route: {
              type: "array",
              items: { type: "string" }
            },
            time_based_tips: { type: "string" }
          }
        }
      });

      setGuidance(response);
    }
  });

  const allCheckpointsCompleted = assignedPlan?.route_checkpoints?.every(cp => cp.completed);

  const riskColors = {
    low: "text-emerald-400",
    medium: "text-amber-400",
    high: "text-orange-400",
    critical: "text-rose-400"
  };

  const priorityColors = {
    low: "bg-slate-600",
    medium: "bg-amber-600",
    high: "bg-orange-600",
    critical: "bg-rose-600"
  };

  if (assignedPlan) {
    const completedCount = assignedPlan.route_checkpoints.filter(cp => cp.completed).length;
    const totalCount = assignedPlan.route_checkpoints.length;
    const progress = (completedCount / totalCount) * 100;

    return (
      <Card className="bg-gradient-to-br from-purple-500/10 to-sky-500/10 border-purple-500/30">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <MapPin className="w-5 h-5 text-purple-400" />
                {assignedPlan.name}
              </CardTitle>
              <p className="text-sm text-slate-400 mt-1">
                Dynamic patrol plan assigned by {assignedPlan.created_by_name}
              </p>
            </div>
            <Badge className={priorityColors[assignedPlan.priority]}>
              {assignedPlan.priority}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {assignedPlan.status === "pending" && (
            <Button
              onClick={() => startPlanMutation.mutate(assignedPlan.id)}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              Start Patrol Plan
            </Button>
          )}

          <div className="p-3 bg-slate-900/50 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-slate-400">Progress</span>
              <span className="text-sm font-semibold text-white">
                {completedCount} / {totalCount}
              </span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-sky-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {assignedPlan.ai_recommendations && (
            <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <p className="text-xs font-semibold text-purple-400 mb-1">AI Recommendations:</p>
              <p className="text-sm text-slate-300">{assignedPlan.ai_recommendations}</p>
            </div>
          )}

          {assignedPlan.high_risk_areas?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-rose-400 mb-2">⚠️ High Risk Areas:</p>
              <div className="flex flex-wrap gap-2">
                {assignedPlan.high_risk_areas.map((area, i) => (
                  <Badge key={i} className="bg-rose-500">{area}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-semibold text-white mb-2">Checkpoint Route:</p>
            {assignedPlan.route_checkpoints.map((cp, index) => (
              <div
                key={index}
                className={`p-3 rounded-lg border ${
                  cp.completed
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-slate-900/50 border-slate-700"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    cp.completed ? "bg-emerald-600" : "bg-slate-700"
                  }`}>
                    {cp.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-white" />
                    ) : (
                      <span className="text-white font-bold text-sm">{cp.order}</span>
                    )}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className={`font-medium ${cp.completed ? "text-emerald-400" : "text-white"}`}>
                        {cp.checkpoint_name}
                      </p>
                      <Badge className={priorityColors[cp.risk_level]}>{cp.risk_level}</Badge>
                    </div>
                    
                    {cp.notes && (
                      <p className="text-xs text-slate-400 mb-2">{cp.notes}</p>
                    )}

                    {cp.completed ? (
                      <div className="mt-2">
                        <p className="text-xs text-emerald-400">
                          ✓ Completed at {new Date(cp.completed_at).toLocaleTimeString()}
                        </p>
                        {cp.guard_feedback && (
                          <p className="text-xs text-slate-400 mt-1">
                            Feedback: {cp.guard_feedback}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2 space-y-2">
                        <Textarea
                          placeholder="Add feedback (optional)..."
                          value={checkpointFeedback[index] || ""}
                          onChange={(e) => setCheckpointFeedback(prev => ({
                            ...prev,
                            [index]: e.target.value
                          }))}
                          className="bg-slate-800 border-slate-700 text-white text-sm h-16"
                        />
                        <Button
                          size="sm"
                          onClick={() => completeCheckpointMutation.mutate({
                            planId: assignedPlan.id,
                            checkpointIndex: index,
                            feedback: checkpointFeedback[index]
                          })}
                          disabled={completeCheckpointMutation.isPending}
                          className="w-full bg-emerald-600 hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Mark Complete
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {allCheckpointsCompleted && assignedPlan.status === "active" && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg space-y-3">
              <p className="text-emerald-400 font-semibold">
                🎉 All checkpoints completed!
              </p>
              <Textarea
                placeholder="Add final notes about this patrol..."
                className="bg-slate-800 border-slate-700 text-white"
              />
              <Button
                onClick={() => completePlanMutation.mutate({
                  planId: assignedPlan.id,
                  notes: ""
                })}
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                <Send className="w-4 h-4 mr-2" />
                Complete Patrol Plan
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-purple-500/10 to-sky-500/10 border-purple-500/30">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-400" />
          AI Patrol Guidance
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {!guidance ? (
          <div className="text-center py-8">
            <p className="text-slate-400 mb-4">
              Get AI-powered patrol recommendations based on current conditions
            </p>
            <Button
              onClick={() => analyzePatrolMutation.mutate()}
              disabled={analyzePatrolMutation.isPending}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {analyzePatrolMutation.isPending ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5 mr-2" />
                  Get AI Guidance
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            <div className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Current Risk Level</span>
                <Badge className={`${riskColors[guidance.risk_level]} font-bold`}>
                  {guidance.risk_level?.toUpperCase()}
                </Badge>
              </div>
            </div>

            {guidance.immediate_actions?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-amber-400 mb-2">
                  ⚡ Immediate Actions:
                </p>
                <ul className="space-y-1">
                  {guidance.immediate_actions.map((action, i) => (
                    <li key={i} className="text-sm text-slate-300 flex items-start gap-2">
                      <span className="text-amber-400">•</span>
                      {action}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {guidance.high_risk_areas?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-rose-400 mb-2">
                  🎯 High-Risk Areas:
                </p>
                <div className="flex flex-wrap gap-2">
                  {guidance.high_risk_areas.map((area, i) => (
                    <Badge key={i} className="bg-rose-500">{area}</Badge>
                  ))}
                </div>
              </div>
            )}

            {guidance.suggested_route?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-sky-400 mb-2">
                  🗺️ Suggested Route:
                </p>
                <div className="space-y-2">
                  {guidance.suggested_route.map((checkpoint, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="w-6 h-6 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs">
                        {i + 1}
                      </span>
                      {checkpoint}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {guidance.time_based_tips && (
              <div className="p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
                <p className="text-xs font-semibold text-purple-400 mb-1">
                  <Clock className="w-3 h-3 inline mr-1" />
                  Time-Based Tips:
                </p>
                <p className="text-sm text-slate-300">{guidance.time_based_tips}</p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}