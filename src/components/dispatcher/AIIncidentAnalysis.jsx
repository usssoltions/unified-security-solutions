import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, Sparkles, Loader2, CheckCircle2, Users, AlertTriangle, ClipboardList } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export default function AIIncidentAnalysis({ incident, onClose }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [assigningGuard, setAssigningGuard] = useState(false);
  const queryClient = useQueryClient();

  const { data: availableGuards } = useQuery({
    queryKey: ["availableGuards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    },
    initialData: []
  });

  useEffect(() => {
    analyzeIncident();
  }, [incident]);

  const analyzeIncident = async () => {
    setLoading(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Perform a comprehensive analysis of this security incident:

Incident ID: ${incident.id}
Title: ${incident.title}
Description: ${incident.description}
Category: ${incident.category}
Current Priority: ${incident.priority}
Location: ${incident.site_name}
Reported by: ${incident.guard_name}
Status: ${incident.status}

Provide a detailed analysis including:
1. Executive summary of the incident
2. Severity assessment and recommended priority level
3. Immediate actions required (5-7 specific steps)
4. Long-term preventive measures
5. Required resources and personnel types
6. Estimated resolution timeline
7. Potential escalation scenarios
8. Similar incident patterns to watch for
9. Compliance and reporting requirements
10. Recommended guard skills/experience for assignment`,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            severity_assessment: { type: "string" },
            recommended_priority: {
              type: "string",
              enum: ["critical", "high", "medium", "low"]
            },
            immediate_actions: {
              type: "array",
              items: { type: "string" }
            },
            preventive_measures: {
              type: "array",
              items: { type: "string" }
            },
            required_resources: {
              type: "array",
              items: { type: "string" }
            },
            personnel_requirements: { type: "string" },
            estimated_resolution: { type: "string" },
            escalation_scenarios: {
              type: "array",
              items: { type: "string" }
            },
            similar_patterns: { type: "string" },
            compliance_notes: { type: "string" },
            recommended_guard_skills: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error("AI analysis failed:", error);
      alert("Failed to generate AI analysis");
    } finally {
      setLoading(false);
    }
  };

  const assignToGuard = async (guardId, guardName) => {
    setAssigningGuard(true);
    try {
      await base44.entities.Incident.update(incident.id, {
        assigned_to: guardId,
        status: "assigned",
        dispatcher_notes: `AI Analysis Summary:\n${analysis.executive_summary}\n\nRecommended Actions:\n${analysis.immediate_actions.join('\n')}`
      });

      // Create assignment
      await base44.entities.Assignment.create({
        type: "incident",
        title: incident.title,
        description: incident.description,
        priority: analysis.recommended_priority,
        assigned_to: guardId,
        assigned_by: (await base44.auth.me()).id,
        site_id: incident.site_id,
        site_name: incident.site_name,
        location: incident.location,
        status: "pending",
        related_id: incident.id
      });

      // Create alert for guard
      await base44.entities.Alert.create({
        type: "assignment",
        priority: analysis.recommended_priority,
        title: "New Incident Assignment",
        message: `You have been assigned to: ${incident.title}`,
        guard_id: guardId,
        guard_name: guardName,
        site_id: incident.site_id,
        status: "active"
      });

      queryClient.invalidateQueries(["pendingIncidents"]);
      alert("Incident assigned successfully!");
      onClose();
    } catch (error) {
      alert("Failed to assign incident");
    } finally {
      setAssigningGuard(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-10">
        <Card className="w-full max-w-4xl bg-slate-800 border-purple-500/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-white">AI Incident Analysis</CardTitle>
                  <p className="text-sm text-slate-400">{incident.title}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {loading ? (
              <div className="text-center py-12">
                <Loader2 className="w-12 h-12 mx-auto animate-spin text-purple-400 mb-4" />
                <p className="text-slate-400">AI analyzing incident details...</p>
              </div>
            ) : analysis ? (
              <>
                {/* Executive Summary */}
                <Card className="bg-purple-500/10 border-purple-500/30">
                  <CardHeader>
                    <CardTitle className="text-purple-400 text-sm">Executive Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-white">{analysis.executive_summary}</p>
                  </CardContent>
                </Card>

                {/* Severity & Priority */}
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-slate-900/50 border-slate-700">
                    <CardContent className="pt-6">
                      <p className="text-sm text-slate-400 mb-2">Severity Assessment</p>
                      <p className="text-white text-sm">{analysis.severity_assessment}</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-slate-900/50 border-slate-700">
                    <CardContent className="pt-6">
                      <p className="text-sm text-slate-400 mb-2">Recommended Priority</p>
                      <Badge className={
                        analysis.recommended_priority === 'critical' ? 'bg-rose-500' :
                        analysis.recommended_priority === 'high' ? 'bg-orange-500' :
                        analysis.recommended_priority === 'medium' ? 'bg-amber-500' :
                        'bg-slate-500'
                      }>
                        {analysis.recommended_priority.toUpperCase()}
                      </Badge>
                      <p className="text-xs text-slate-400 mt-2">
                        Current: <Badge variant="outline">{incident.priority}</Badge>
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Immediate Actions */}
                <Card className="bg-slate-900/50 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-white text-sm flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-emerald-400" />
                      Immediate Actions Required
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ol className="space-y-2">
                      {analysis.immediate_actions.map((action, idx) => (
                        <li key={idx} className="flex items-start gap-3 text-sm">
                          <span className="text-emerald-400 font-bold">{idx + 1}.</span>
                          <span className="text-slate-300">{action}</span>
                        </li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>

                {/* Resources & Timeline */}
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-slate-900/50 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-sm">Required Resources</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {analysis.required_resources.map((resource, idx) => (
                          <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                            <span className="text-sky-400">•</span>
                            {resource}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900/50 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-sm">Estimated Resolution</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-slate-300 text-sm">{analysis.estimated_resolution}</p>
                      <div className="mt-3 pt-3 border-t border-slate-700">
                        <p className="text-xs text-slate-400 mb-1">Personnel Requirements:</p>
                        <p className="text-sm text-white">{analysis.personnel_requirements}</p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Preventive Measures */}
                <Card className="bg-slate-900/50 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-white text-sm">Long-term Prevention</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {analysis.preventive_measures.map((measure, idx) => (
                        <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                          {measure}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                {/* Escalation & Patterns */}
                <div className="grid grid-cols-2 gap-4">
                  <Card className="bg-slate-900/50 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-sm flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        Escalation Scenarios
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1">
                        {analysis.escalation_scenarios.map((scenario, idx) => (
                          <li key={idx} className="text-xs text-slate-400">
                            • {scenario}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>

                  <Card className="bg-slate-900/50 border-slate-700">
                    <CardHeader>
                      <CardTitle className="text-white text-sm">Pattern Recognition</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-slate-400">{analysis.similar_patterns}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Compliance */}
                {analysis.compliance_notes && (
                  <Card className="bg-amber-500/10 border-amber-500/30">
                    <CardHeader>
                      <CardTitle className="text-amber-400 text-sm">Compliance & Reporting</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-slate-300 text-sm">{analysis.compliance_notes}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Guard Assignment */}
                <Card className="bg-slate-900/50 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-white text-sm flex items-center gap-2">
                      <Users className="w-4 h-4 text-sky-400" />
                      Assign to Guard
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs text-slate-400 mb-2">Recommended Skills:</p>
                      <div className="flex flex-wrap gap-2">
                        {analysis.recommended_guard_skills.map((skill, idx) => (
                          <Badge key={idx} variant="outline" className="border-purple-500/30 text-purple-400 text-xs">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400">Available Guards:</p>
                      {availableGuards.length > 0 ? (
                        <div className="grid grid-cols-2 gap-2">
                          {availableGuards.map(guard => (
                            <Button
                              key={guard.id}
                              onClick={() => assignToGuard(guard.id, guard.full_name)}
                              disabled={assigningGuard}
                              size="sm"
                              variant="outline"
                              className="border-slate-600 hover:bg-sky-500/10 hover:border-sky-500"
                            >
                              {guard.full_name}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No guards available</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-8">
                <AlertTriangle className="w-12 h-12 mx-auto text-rose-400 mb-4" />
                <p className="text-slate-400">Failed to generate analysis</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}