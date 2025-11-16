import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, AlertTriangle, TrendingUp, MapPin, Clock, Calendar, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AIRiskPredictor({ user }) {
  const [predictions, setPredictions] = useState(null);

  const { data: incidents = [] } = useQuery({
    queryKey: ["incidentsForAnalysis"],
    queryFn: async () => {
      const allIncidents = await base44.entities.Incident.list("-reported_at", 500);
      return allIncidents.filter(i => i.reported_at);
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => base44.entities.Site.list(),
    initialData: []
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      if (incidents.length === 0) {
        throw new Error("No incident data available for analysis");
      }

      const incidentSummary = incidents.slice(0, 100).map(inc => ({
        type: inc.category,
        site: inc.site_name,
        date: new Date(inc.reported_at).toISOString(),
        time: new Date(inc.reported_at).getHours(),
        day_of_week: new Date(inc.reported_at).getDay(),
        priority: inc.priority
      }));

      const prompt = `You are an AI security analyst. Analyze the following historical incident data and provide security risk predictions and recommendations.

Historical Incident Data (${incidents.length} total incidents, showing last 100):
${JSON.stringify(incidentSummary, null, 2)}

Analyze this data to identify:
1. High-risk time periods (specific hours of day, days of week)
2. High-risk locations/sites
3. Most common incident types and patterns
4. Seasonal or temporal trends
5. Specific actionable recommendations for guards and supervisors

Provide detailed, actionable insights that can help prevent future incidents.`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: "object",
          properties: {
            high_risk_hours: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  hour_range: { type: "string" },
                  risk_level: { type: "string" },
                  reason: { type: "string" }
                }
              }
            },
            high_risk_sites: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  site_name: { type: "string" },
                  incident_count: { type: "number" },
                  primary_threats: { type: "string" },
                  recommendations: { type: "string" }
                }
              }
            },
            incident_patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pattern: { type: "string" },
                  frequency: { type: "string" },
                  impact: { type: "string" }
                }
              }
            },
            proactive_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  recommendation: { type: "string" },
                  priority: { type: "string" },
                  target_audience: { type: "string" }
                }
              }
            },
            overall_risk_assessment: { type: "string" }
          }
        }
      });

      // Create alerts for high-risk predictions
      if (user.role_type === 'admin' || user.role_type === 'dispatcher') {
        const riskSummary = `AI Risk Analysis: ${response.overall_risk_assessment}`;
        
        await base44.entities.Alert.create({
          type: "system",
          priority: "high",
          title: "🤖 AI Risk Prediction Available",
          message: riskSummary,
          status: "active"
        });
      }

      return response;
    },
    onSuccess: (data) => {
      setPredictions(data);
    }
  });

  const riskLevelColors = {
    critical: "bg-red-600",
    high: "bg-rose-500",
    medium: "bg-amber-500",
    low: "bg-emerald-500"
  };

  const priorityColors = {
    critical: "border-red-500 bg-red-500/10",
    high: "border-rose-500 bg-rose-500/10",
    medium: "border-amber-500 bg-amber-500/10",
    low: "border-emerald-500 bg-emerald-500/10"
  };

  return (
    <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/10 border-purple-500/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                AI Risk Predictor
              </CardTitle>
              <p className="text-sm text-purple-300">Predictive security intelligence</p>
            </div>
          </div>
          <Button
            onClick={() => analyzeMutation.mutate()}
            disabled={analyzeMutation.isPending || incidents.length === 0}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {analyzeMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Run Analysis
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {incidents.length === 0 && (
          <Alert className="bg-amber-500/10 border-amber-500/20">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription className="text-slate-300">
              No incident data available. Risk predictions require historical incident reports.
            </AlertDescription>
          </Alert>
        )}

        {!predictions && incidents.length > 0 && (
          <div className="text-center py-8">
            <Sparkles className="w-16 h-16 text-purple-400 mx-auto mb-4 opacity-50" />
            <p className="text-slate-400">Click "Run Analysis" to generate AI-powered risk predictions</p>
            <p className="text-sm text-slate-500 mt-2">
              Analyzing {incidents.length} historical incidents
            </p>
          </div>
        )}

        {predictions && (
          <div className="space-y-6">
            <Alert className="bg-purple-500/10 border-purple-500/20">
              <Sparkles className="w-4 h-4" />
              <AlertDescription className="text-white font-medium">
                {predictions.overall_risk_assessment}
              </AlertDescription>
            </Alert>

            {predictions.high_risk_hours?.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <Clock className="w-5 h-5 text-amber-400" />
                  High-Risk Time Periods
                </h3>
                {predictions.high_risk_hours.map((timeRisk, idx) => (
                  <div key={idx} className="p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-white">{timeRisk.hour_range}</p>
                      <Badge className={riskLevelColors[timeRisk.risk_level?.toLowerCase()]}>
                        {timeRisk.risk_level}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-400">{timeRisk.reason}</p>
                  </div>
                ))}
              </div>
            )}

            {predictions.high_risk_sites?.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-rose-400" />
                  High-Risk Locations
                </h3>
                {predictions.high_risk_sites.map((site, idx) => (
                  <div key={idx} className="p-4 bg-slate-900/50 rounded-lg border border-rose-500/20">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-semibold text-white">{site.site_name}</p>
                        <p className="text-sm text-rose-400">{site.incident_count} incidents recorded</p>
                      </div>
                    </div>
                    <div className="mt-2 space-y-2">
                      <div>
                        <p className="text-xs text-slate-500">Primary Threats</p>
                        <p className="text-sm text-slate-300">{site.primary_threats}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Recommendations</p>
                        <p className="text-sm text-emerald-400">{site.recommendations}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {predictions.incident_patterns?.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-sky-400" />
                  Identified Patterns
                </h3>
                {predictions.incident_patterns.map((pattern, idx) => (
                  <div key={idx} className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                    <p className="font-medium text-white mb-1">{pattern.pattern}</p>
                    <div className="flex gap-3 text-sm">
                      <span className="text-sky-400">Frequency: {pattern.frequency}</span>
                      <span className="text-amber-400">Impact: {pattern.impact}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {predictions.proactive_recommendations?.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-emerald-400" />
                  Proactive Recommendations
                </h3>
                {predictions.proactive_recommendations.map((rec, idx) => (
                  <div key={idx} className={`p-4 rounded-lg border ${priorityColors[rec.priority?.toLowerCase()]}`}>
                    <div className="flex items-start justify-between mb-2">
                      <Badge className={riskLevelColors[rec.priority?.toLowerCase()]}>
                        {rec.priority} Priority
                      </Badge>
                      <Badge variant="outline" className="border-slate-600 text-slate-300">
                        {rec.target_audience}
                      </Badge>
                    </div>
                    <p className="text-white">{rec.recommendation}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}