import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, MapPin, AlertTriangle, Navigation, TrendingUp, Clock, Loader2, RefreshCw, Target } from "lucide-react";

export default function AIPatrolGuidance({ user, shift, location }) {
  const [guidance, setGuidance] = useState(null);

  const { data: siteIncidents = [] } = useQuery({
    queryKey: ["siteIncidents", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return [];
      const incidents = await base44.entities.Incident.filter(
        { site_id: shift.site_id },
        "-reported_at",
        100
      );
      return incidents;
    },
    enabled: !!shift?.site_id
  });

  const { data: sitePatrols = [] } = useQuery({
    queryKey: ["sitePatrols", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return [];
      const patrols = await base44.entities.PatrolLog.filter(
        { site_id: shift.site_id },
        "-timestamp",
        100
      );
      return patrols;
    },
    enabled: !!shift?.site_id
  });

  const { data: site } = useQuery({
    queryKey: ["site", shift?.site_id],
    queryFn: async () => {
      if (!shift?.site_id) return null;
      return await base44.entities.Site.get(shift.site_id);
    },
    enabled: !!shift?.site_id
  });

  const analyzePatrolMutation = useMutation({
    mutationFn: async () => {
      if (!shift || !site) {
        throw new Error("Shift and site data required");
      }

      const currentHour = new Date().getHours();
      const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });

      const incidentSummary = siteIncidents.slice(0, 50).map(inc => ({
        type: inc.category,
        time: new Date(inc.reported_at).getHours(),
        day: new Date(inc.reported_at).toLocaleDateString('en-US', { weekday: 'long' }),
        priority: inc.priority,
        description: inc.title
      }));

      const patrolSummary = sitePatrols.slice(0, 50).map(patrol => ({
        checkpoint: patrol.checkpoint_name,
        time: new Date(patrol.timestamp).getHours(),
        verified: patrol.verified
      }));

      const checkpoints = site.checkpoints || [];

      const prompt = `You are an AI security advisor analyzing patrol data for ${site.name}.

Current Context:
- Time: ${currentHour}:00 on ${currentDay}
- Guard Location: ${location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : 'Unknown'}
- Available Checkpoints: ${checkpoints.map(c => c.name).join(', ')}

Historical Incident Data (Last 50 incidents):
${JSON.stringify(incidentSummary, null, 2)}

Recent Patrol History (Last 50 patrols):
${JSON.stringify(patrolSummary, null, 2)}

Based on this data, provide:
1. Immediate high-risk areas to focus on RIGHT NOW
2. Optimized patrol route for the current time
3. Specific checkpoints to prioritize
4. Time-based recommendations for the current hour
5. Actionable security tips

Be specific, concise, and immediately actionable for a guard on duty.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: "object",
          properties: {
            risk_level: {
              type: "string",
              enum: ["low", "medium", "high", "critical"]
            },
            high_risk_areas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  area: { type: "string" },
                  reason: { type: "string" },
                  priority: { type: "string" }
                }
              }
            },
            suggested_route: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  checkpoint: { type: "string" },
                  order: { type: "number" },
                  estimated_time: { type: "string" },
                  reason: { type: "string" }
                }
              }
            },
            immediate_actions: {
              type: "array",
              items: { type: "string" }
            },
            time_based_tips: {
              type: "array",
              items: { type: "string" }
            },
            overall_assessment: { type: "string" }
          }
        }
      });

      return response;
    },
    onSuccess: (data) => {
      setGuidance(data);
    }
  });

  const riskColors = {
    low: "bg-emerald-500",
    medium: "bg-amber-500",
    high: "bg-rose-500",
    critical: "bg-red-600"
  };

  const priorityColors = {
    low: "border-emerald-500 bg-emerald-500/10",
    medium: "border-amber-500 bg-amber-500/10",
    high: "border-rose-500 bg-rose-500/10",
    critical: "border-red-500 bg-red-500/10"
  };

  if (!shift) {
    return null;
  }

  return (
    <Card className="bg-gradient-to-br from-purple-500/10 to-indigo-600/10 border-purple-500/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-white text-lg">AI Patrol Guidance</CardTitle>
              <p className="text-sm text-purple-300">Smart route optimization</p>
            </div>
          </div>
          <Button
            onClick={() => analyzePatrolMutation.mutate()}
            disabled={analyzePatrolMutation.isPending}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
          >
            {analyzePatrolMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Get Guidance
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!guidance && (
          <div className="text-center py-6">
            <Target className="w-12 h-12 text-purple-400 mx-auto mb-3 opacity-50" />
            <p className="text-slate-400 text-sm">
              Get AI-powered patrol recommendations based on historical data
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Analyzing {siteIncidents.length} incidents and {sitePatrols.length} patrol logs
            </p>
          </div>
        )}

        {guidance && (
          <div className="space-y-4">
            <Alert className={`${riskColors[guidance.risk_level]} border-none`}>
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="text-white font-semibold">
                {guidance.risk_level.toUpperCase()} Risk Level - {guidance.overall_assessment}
              </AlertDescription>
            </Alert>

            {guidance.immediate_actions?.length > 0 && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  Immediate Actions
                </h4>
                <ul className="space-y-2">
                  {guidance.immediate_actions.map((action, idx) => (
                    <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                      <span className="text-rose-400 font-bold">•</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {guidance.high_risk_areas?.length > 0 && (
              <div>
                <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-amber-400" />
                  High-Risk Areas to Monitor
                </h4>
                <div className="space-y-2">
                  {guidance.high_risk_areas.map((area, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border ${priorityColors[area.priority?.toLowerCase() || 'medium']}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-white">{area.area}</p>
                        <Badge className={riskColors[area.priority?.toLowerCase() || 'medium']}>
                          {area.priority}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-300">{area.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {guidance.suggested_route?.length > 0 && (
              <div>
                <h4 className="text-white font-semibold mb-3 flex items-center gap-2">
                  <Navigation className="w-4 h-4 text-sky-400" />
                  Suggested Patrol Route
                </h4>
                <div className="space-y-2">
                  {guidance.suggested_route
                    .sort((a, b) => a.order - b.order)
                    .map((stop, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-slate-900/50 rounded-lg border border-slate-700 hover:border-sky-500/50 transition-all"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-white font-bold text-sm">{stop.order}</span>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <p className="font-semibold text-white">{stop.checkpoint}</p>
                              <div className="flex items-center gap-1 text-xs text-slate-400">
                                <Clock className="w-3 h-3" />
                                {stop.estimated_time}
                              </div>
                            </div>
                            <p className="text-sm text-slate-400">{stop.reason}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {guidance.time_based_tips?.length > 0 && (
              <div className="p-4 bg-sky-500/10 border border-sky-500/20 rounded-lg">
                <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-sky-400" />
                  Time-Based Tips (Now: {new Date().toLocaleTimeString()})
                </h4>
                <ul className="space-y-1">
                  {guidance.time_based_tips.map((tip, idx) => (
                    <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                      <span className="text-sky-400">→</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-3 border-t border-slate-700">
              <p className="text-xs text-slate-500 text-center">
                Guidance updated {new Date().toLocaleTimeString()} • Based on {siteIncidents.length} incidents & {sitePatrols.length} patrols
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}