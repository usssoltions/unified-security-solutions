import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, User, MapPin, Loader2, TrendingUp, Shield, Award } from "lucide-react";

export default function AIDispatchRecommendation({ incident, onSelectGuard, selectedGuard }) {
  const [recommendations, setRecommendations] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (incident?.location && incident?.alarm_type) {
      analyzeDispatch();
    }
  }, [incident?.location, incident?.alarm_type]);

  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const lat1Num = parseFloat(lat1);
    const lon1Num = parseFloat(lon1);
    const lat2Num = parseFloat(lat2);
    const lon2Num = parseFloat(lon2);
    
    if (isNaN(lat1Num) || isNaN(lon1Num) || isNaN(lat2Num) || isNaN(lon2Num)) {
      return 0;
    }
    
    const R = 6371;
    const dLat = (lat2Num - lat1Num) * Math.PI / 180;
    const dLon = (lon2Num - lon1Num) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1Num * Math.PI / 180) * Math.cos(lat2Num * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  };

  const analyzeDispatch = async () => {
    setAnalyzing(true);
    try {
      const [shifts, assignments] = await Promise.all([
        base44.entities.Shift.filter({ status: "active" }),
        base44.entities.Assignment.filter({ status: { $in: ["pending", "in_progress"] } })
      ]);

      const guardsData = [];
      for (const shift of shifts) {
        try {
          const guardUser = await base44.entities.User.get(shift.guard_id);
          if (guardUser?.last_location?.lat && guardUser?.last_location?.lng) {
            const distance = calculateDistance(
              incident.location.lat,
              incident.location.lng,
              guardUser.last_location.lat,
              guardUser.last_location.lng
            );

            const guardAssignments = assignments.filter(a => a.assigned_to === shift.guard_id);
            
            guardsData.push({
              guard_id: shift.guard_id,
              guard_name: guardUser.full_name || shift.guard_name,
              distance,
              location: guardUser.last_location,
              skills: guardUser.skills || [],
              workload: guardUser.current_workload || guardAssignments.length,
              performance_rating: guardUser.performance_rating || 5,
              shift
            });
          }
        } catch (error) {
          console.error(`Failed to fetch guard ${shift.guard_id}:`, error);
        }
      }

      if (guardsData.length === 0) {
        setRecommendations({ error: "No active guards available" });
        return;
      }

      const prompt = `Analyze and recommend the best guards for this security incident:

INCIDENT DETAILS:
- Type: ${incident.alarm_type}
- Priority: ${incident.priority}
- Location: ${incident.address}
- Description: ${incident.description || 'N/A'}

AVAILABLE GUARDS:
${guardsData.map((g, i) => `
${i + 1}. ${g.guard_name}
   - Distance: ${g.distance} km
   - Current Workload: ${g.workload} active assignments
   - Performance Rating: ${g.performance_rating}/5
   - Skills: ${g.skills.join(", ") || "None specified"}
   - Current Site: ${g.shift.site_name}
`).join("\n")}

Analyze and provide:
1. Top 3 recommended guards (use exact guard names from list)
2. For each: fitness score (0-100), reasoning, estimated ETA minutes
3. Overall dispatch strategy
4. Any concerns or risk factors

Consider: proximity, workload balance, skills match, performance history`;

      const aiResponse = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            top_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  guard_name: { type: "string" },
                  fitness_score: { type: "number" },
                  reasoning: { type: "string" },
                  eta_minutes: { type: "number" }
                }
              }
            },
            strategy: { type: "string" },
            concerns: { type: "string" }
          }
        }
      });

      const enrichedRecommendations = aiResponse.top_recommendations.map(rec => {
        const guardData = guardsData.find(g => 
          g.guard_name.toLowerCase() === rec.guard_name.toLowerCase()
        );
        return { ...rec, guardData };
      }).filter(r => r.guardData);

      setRecommendations({
        recommendations: enrichedRecommendations,
        strategy: aiResponse.strategy,
        concerns: aiResponse.concerns,
        allGuards: guardsData
      });

    } catch (error) {
      console.error("AI analysis failed:", error);
      setRecommendations({ error: "Analysis failed" });
    } finally {
      setAnalyzing(false);
    }
  };

  if (analyzing) {
    return (
      <Card className="bg-purple-500/10 border-purple-500/30">
        <CardContent className="p-6 text-center">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin mx-auto mb-3" />
          <p className="text-purple-400 font-medium">AI analyzing optimal resource allocation...</p>
        </CardContent>
      </Card>
    );
  }

  if (!recommendations || recommendations.error) {
    return null;
  }

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-r from-purple-500/10 to-sky-500/10 border-purple-500/30">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            AI Dispatch Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {recommendations.strategy && (
            <div className="p-3 bg-slate-900/50 rounded-lg border border-purple-500/20">
              <p className="text-sm font-semibold text-purple-400 mb-1">Strategy:</p>
              <p className="text-sm text-slate-300">{recommendations.strategy}</p>
            </div>
          )}

          <div className="space-y-3">
            {recommendations.recommendations.map((rec, index) => (
              <Card
                key={index}
                className={`cursor-pointer transition-all ${
                  selectedGuard === rec.guardData.guard_id
                    ? "bg-sky-500/20 border-sky-500"
                    : "bg-slate-900 border-slate-700 hover:border-purple-500/50"
                }`}
                onClick={() => onSelectGuard(rec.guardData.guard_id, rec.guardData.guard_name)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {index === 0 && <Award className="w-4 h-4 text-amber-400" />}
                        <p className="text-white font-semibold">{rec.guard_name}</p>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">{rec.guardData.shift.site_name}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-purple-400">{rec.fitness_score}</div>
                      <div className="text-xs text-slate-400">Fitness Score</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                    <div className="flex items-center gap-1 text-slate-400">
                      <MapPin className="w-3 h-3" />
                      {rec.guardData.distance} km • ~{rec.eta_minutes} min
                    </div>
                    <div className="flex items-center gap-1 text-slate-400">
                      <TrendingUp className="w-3 h-3" />
                      Workload: {rec.guardData.workload}
                    </div>
                    <div className="flex items-center gap-1 text-slate-400">
                      <Shield className="w-3 h-3" />
                      Rating: {rec.guardData.performance_rating}/5
                    </div>
                    {rec.guardData.skills.length > 0 && (
                      <div className="flex items-center gap-1 text-emerald-400">
                        ✓ {rec.guardData.skills.length} skills
                      </div>
                    )}
                  </div>

                  <div className="p-2 bg-slate-800/50 rounded text-xs text-slate-300">
                    {rec.reasoning}
                  </div>

                  {rec.guardData.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {rec.guardData.skills.map((skill, i) => (
                        <Badge key={i} className="bg-emerald-600 text-xs">
                          {skill.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {recommendations.concerns && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <p className="text-sm font-semibold text-amber-400 mb-1">⚠️ Concerns:</p>
              <p className="text-sm text-slate-300">{recommendations.concerns}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}