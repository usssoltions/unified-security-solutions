
import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Camera, Video, Loader2, Sparkles, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function IncidentForm({ user, shift, location, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    priority: "medium",
    guard_id: user.id,
    guard_name: user.full_name,
    site_id: shift?.site_id || "",
    site_name: shift?.site_name || "",
    location: location,
    media: []
  });

  const [uploading, setUploading] = useState(false);
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      // Add AI analysis results if available
      if (aiSuggestions) {
        data.dispatcher_notes = `AI Analysis:\n${aiSuggestions.summary}\n\nSuggested Actions:\n${aiSuggestions.actions.join('\n')}\n\nRecommended Personnel: ${aiSuggestions.personnel.join(', ')}`;
      }
      
      const incident = await base44.entities.Incident.create({
        ...data,
        reported_at: new Date().toISOString()
      });

      // Send real-time email notifications to management
      try {
        const allUsers = await base44.entities.User.list();
        const managementEmails = allUsers
          .filter(u => ['admin', 'dispatcher', 'supervisor', 'management'].includes(u.role_type))
          .map(u => u.email)
          .filter(Boolean); // Ensure no empty emails

        const incidentMessage = `
🚨 NEW INCIDENT REPORT

Title: ${data.title}
Category: ${data.category}
Priority: ${data.priority}
Site: ${data.site_name}
Reported by: ${data.guard_name}
Time: ${new Date().toLocaleString()}

Description:
${data.description}

${data.location ? `Location: ${data.location.lat}, ${data.location.lng}` : ''}

${aiSuggestions ? `\nAI Analysis: ${aiSuggestions.summary}` : ''}

Status: ${data.status || 'Reported'}
        `.trim();

        for (const email of managementEmails) {
          await base44.integrations.Core.SendEmail({
            to: email,
            subject: `🚨 ${data.priority.toUpperCase()} INCIDENT: ${data.title}`,
            body: incidentMessage
          });
        }
      } catch (error) {
        console.error('Failed to send incident notification emails:', error);
        // Optionally, you might want to alert the user here, but not stop incident creation
        // alert("Warning: Failed to send management notifications.");
      }

      return incident;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["incidents"]);
      onSuccess();
    },
    onError: (error) => {
      alert(`Failed to report incident: ${error.message}`);
    }
  });

  const handleMediaCapture = async (e, type) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      const uploadedMedia = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploadedMedia.push({ type, url: file_url });
      }
      setFormData({
        ...formData,
        media: [...formData.media, ...uploadedMedia]
      });
    } catch (error) {
      alert("Failed to upload media");
    } finally {
      setUploading(false);
    }
  };

  const analyzeWithAI = async () => {
    if (!formData.description || formData.description.length < 10) {
      alert("Please provide a detailed description first");
      return;
    }

    setAnalyzingAI(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this security incident report and provide structured recommendations:

Incident Title: ${formData.title || 'Not specified'}
Description: ${formData.description}
Current Location: ${shift?.site_name || 'Unknown location'}

Please analyze and provide:
1. A concise summary (2-3 sentences)
2. Suggested incident category from: fire, theft, vandalism, medical, trespassing, suspicious_activity, equipment_failure, safety_hazard, other
3. Recommended priority level: critical, high, medium, or low
4. List of 3-5 specific follow-up actions
5. Types of personnel that should be assigned (e.g., senior guard, maintenance team, medical responder, police liaison)

Consider severity, potential risks, and immediate response needs.`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            category: { 
              type: "string",
              enum: ["fire", "theft", "vandalism", "medical", "trespassing", "suspicious_activity", "equipment_failure", "safety_hazard", "other"]
            },
            priority: {
              type: "string",
              enum: ["critical", "high", "medium", "low"]
            },
            actions: {
              type: "array",
              items: { type: "string" }
            },
            personnel: {
              type: "array",
              items: { type: "string" }
            },
            risk_assessment: { type: "string" }
          }
        }
      });

      setAiSuggestions(response);
      
      // Auto-apply AI suggestions to form
      setFormData({
        ...formData,
        category: response.category,
        priority: response.priority
      });

    } catch (error) {
      alert("AI analysis failed. Please categorize manually.");
      console.error("AI Analysis error:", error);
    } finally {
      setAnalyzingAI(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.title || !formData.description || !formData.category) {
      alert("Please fill in all required fields");
      return;
    }

    createMutation.mutate(formData);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 flex items-start justify-center pt-20">
        <Card className="w-full max-w-2xl bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-xl">Report Security Incident</CardTitle>
              <Button variant="ghost" size="icon" onClick={onClose} className="text-slate-400">
                <X />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* AI Analysis Banner */}
              <Alert className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border-purple-500/30">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <AlertDescription className="text-slate-300">
                  <strong>AI Assistant Available:</strong> Fill in the description, then click "Analyze with AI" for smart categorization and recommendations.
                </AlertDescription>
              </Alert>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Incident Title <span className="text-rose-400">*</span>
                </label>
                <Input
                  placeholder="Brief title of the incident"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">
                  Description <span className="text-rose-400">*</span>
                </label>
                <Textarea
                  placeholder="Detailed description of what happened..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white min-h-32"
                  required
                />
              </div>

              {/* AI Analysis Button */}
              <Button
                type="button"
                onClick={analyzeWithAI}
                disabled={analyzingAI || !formData.description}
                className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              >
                {analyzingAI ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    AI Analyzing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Analyze with AI
                  </>
                )}
              </Button>

              {/* AI Suggestions Display */}
              {aiSuggestions && (
                <Card className="bg-slate-900/50 border-purple-500/30">
                  <CardHeader>
                    <CardTitle className="text-purple-400 text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      AI Analysis Results
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Summary:</p>
                      <p className="text-sm text-white">{aiSuggestions.summary}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Suggested Category:</p>
                        <Badge className="bg-sky-500">{aiSuggestions.category}</Badge>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Suggested Priority:</p>
                        <Badge className={
                          aiSuggestions.priority === 'critical' ? 'bg-rose-500' :
                          aiSuggestions.priority === 'high' ? 'bg-orange-500' :
                          aiSuggestions.priority === 'medium' ? 'bg-amber-500' :
                          'bg-slate-500'
                        }>
                          {aiSuggestions.priority}
                        </Badge>
                      </div>
                    </div>

                    {aiSuggestions.risk_assessment && (
                      <div>
                        <p className="text-xs text-slate-400 mb-1">Risk Assessment:</p>
                        <p className="text-sm text-slate-300">{aiSuggestions.risk_assessment}</p>
                      </div>
                    )}

                    <div>
                      <p className="text-xs text-slate-400 mb-2">Recommended Actions:</p>
                      <ul className="space-y-1">
                        {aiSuggestions.actions.map((action, idx) => (
                          <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                            <span className="text-emerald-400 mt-0.5">•</span>
                            {action}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className="text-xs text-slate-400 mb-2">Suggested Personnel:</p>
                      <div className="flex flex-wrap gap-2">
                        {aiSuggestions.personnel.map((person, idx) => (
                          <Badge key={idx} variant="outline" className="border-slate-600 text-slate-300">
                            {person}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">
                    Category <span className="text-rose-400">*</span>
                  </label>
                  <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fire">Fire</SelectItem>
                      <SelectItem value="theft">Theft</SelectItem>
                      <SelectItem value="vandalism">Vandalism</SelectItem>
                      <SelectItem value="medical">Medical Emergency</SelectItem>
                      <SelectItem value="trespassing">Trespassing</SelectItem>
                      <SelectItem value="suspicious_activity">Suspicious Activity</SelectItem>
                      <SelectItem value="equipment_failure">Equipment Failure</SelectItem>
                      <SelectItem value="safety_hazard">Safety Hazard</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm text-slate-300 font-medium block mb-2">Priority</label>
                  <Select value={formData.priority} onValueChange={(value) => setFormData({ ...formData, priority: value })}>
                    <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-sm text-slate-300 font-medium block mb-2">Evidence (Photos/Videos)</label>
                <div className="flex gap-3">
                  <label className="flex-1">
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="hidden"
                      onChange={(e) => handleMediaCapture(e, 'photo')}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-slate-600"
                      disabled={uploading}
                      onClick={(e) => e.currentTarget.previousElementSibling.click()}
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Take Photo
                    </Button>
                  </label>
                  <label className="flex-1">
                    <input
                      type="file"
                      accept="video/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => handleMediaCapture(e, 'video')}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full border-slate-600"
                      disabled={uploading}
                      onClick={(e) => e.currentTarget.previousElementSibling.click()}
                    >
                      <Video className="w-4 h-4 mr-2" />
                      Record Video
                    </Button>
                  </label>
                </div>
              </div>

              {formData.media.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {formData.media.map((item, idx) => (
                    <div key={idx} className="relative">
                      {item.type === 'photo' ? (
                        <img src={item.url} alt="Evidence" className="w-full h-24 object-cover rounded border border-slate-700" />
                      ) : (
                        <video src={item.url} className="w-full h-24 object-cover rounded border border-slate-700" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {location && (
                <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                  <p className="text-xs text-slate-400">GPS Location</p>
                  <p className="text-sm text-white font-mono">
                    {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1 border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-600 hover:to-rose-700"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Reporting...
                    </>
                  ) : (
                    "Submit Report"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
