import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Loader2, Send, PenTool, Mic, Sparkles, StopCircle } from "lucide-react";
import SignaturePad from "./SignaturePad";

export default function IncidentForm({ user, shift, location, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    incident_report_number: Date.now().toString(),
    date_time_of_incident: new Date().toISOString().slice(0, 16),
    incident_type: "",
    victim_names: "",
    victim_contact: "",
    suspect_names: "",
    suspect_contact: "",
    witness_names: "",
    witness_contact: "",
    incident_location: "",
    incident_summary: "",
    who_what_when_details: "",
    officer_actions: "",
    police_called: "No",
    police_names_badges: "",
    fire_truck_number: "",
    ambulance_number: "",
    media: [],
    voice_notes: [],
    signature: null
  });

  const [uploading, setUploading] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [aiAssisting, setAiAssisting] = useState(false);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const reportContent = `
INCIDENT REPORT
Time Zone: Africa/Johannesburg

ID, DATE, CLIENT, & SITE
Internal ID: ${data.incident_report_number}
Date Entered: ${new Date().toLocaleString()}
Client: ${shift?.site_name || 'N/A'}
Site: ${shift?.site_name || 'N/A'}

OFFICER / ENTERED BY
Officer Name: ${user.full_name}

OVERVIEW
Incident Report #: ${data.incident_report_number}
Date and Time of Incident: ${new Date(data.date_time_of_incident).toLocaleString()}
Incident Type: ${data.incident_type}
Victim Name(s): ${data.victim_names}
Victim Contact Info: ${data.victim_contact}
Suspect Name(s): ${data.suspect_names}
Suspect Contact Info: ${data.suspect_contact}
Witness Name(s): ${data.witness_names}
Witness Contact Info: ${data.witness_contact}
Incident Location: ${data.incident_location}

Incident Summary:
${data.incident_summary}

Who, What, When, etc.:
${data.who_what_when_details}

OFFICER ACTIONS
Details: ${data.officer_actions}

RESPONDER INFO
Police Called: ${data.police_called}
${data.police_names_badges ? `Police Name(s) & Badge(s): ${data.police_names_badges}` : ''}
${data.fire_truck_number ? `Fire Truck Number: ${data.fire_truck_number}` : ''}
${data.ambulance_number ? `Ambulance Number: ${data.ambulance_number}` : ''}

PHOTOS: ${data.media.length} photo(s) attached
VOICE NOTES: ${data.voice_notes.length} voice note(s) attached
Officer Signature: Signed
      `.trim();

      const incident = await base44.entities.Incident.create({
        title: `Incident Report - ${data.incident_type}`,
        description: reportContent,
        category: "other",
        priority: "high",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: shift?.site_id || "",
        site_name: shift?.site_name || "",
        shift_id: shift?.id || "",
        location: location,
        reported_at: data.date_time_of_incident,
        media: [...data.media, ...data.voice_notes.map(url => ({ type: 'audio', url }))]
      });

      // Send real-time notifications
      const allUsers = await base44.entities.User.list();
      const recipients = allUsers.filter(u => 
        ['admin', 'dispatcher', 'supervisor', 'management'].includes(u.role_type)
      );

      for (const recipient of recipients) {
        if (recipient.email) {
          await base44.integrations.Core.SendEmail({
            to: recipient.email,
            subject: `🚨 INCIDENT REPORT: ${data.incident_type} - ${shift?.site_name}`,
            body: reportContent
          });
        }
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

  const handleMediaCapture = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      const uploadedMedia = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        uploadedMedia.push({ type: 'photo', url: file_url });
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

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        
        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          setFormData(prev => ({
            ...prev,
            voice_notes: [...prev.voice_notes, file_url]
          }));
        } catch (error) {
          alert("Failed to upload voice note");
        }
        
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (error) {
      alert("Failed to access microphone");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      setMediaRecorder(null);
    }
  };

  const getAIAssistance = async () => {
    setAiAssisting(true);
    try {
      const prompt = `Based on this incident information, provide a professional incident summary and suggested officer actions:

Incident Type: ${formData.incident_type}
Location: ${formData.incident_location}
Current Summary: ${formData.incident_summary}
Details: ${formData.who_what_when_details}

Please provide:
1. An enhanced incident summary
2. Suggested officer actions`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: "object",
          properties: {
            enhanced_summary: { type: "string" },
            suggested_actions: { type: "string" }
          }
        }
      });

      setFormData(prev => ({
        ...prev,
        incident_summary: prev.incident_summary + "\n\nAI Enhancement: " + response.enhanced_summary,
        officer_actions: prev.officer_actions + "\n\nAI Suggestions: " + response.suggested_actions
      }));
    } catch (error) {
      alert("AI assistance failed");
    } finally {
      setAiAssisting(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.signature) {
      setShowSignature(true);
      return;
    }
    createMutation.mutate(formData);
  };

  if (showSignature) {
    return (
      <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
        <div className="min-h-screen p-4">
          <SignaturePad
            onSave={(sig) => {
              setFormData({ ...formData, signature: sig });
              setShowSignature(false);
            }}
            onCancel={() => setShowSignature(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto">
      <div className="min-h-screen p-4 pt-20 pb-20">
        <Card className="w-full max-w-2xl mx-auto bg-slate-800 border-slate-700">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white text-xl">Incident Report</CardTitle>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={getAIAssistance}
                  disabled={aiAssisting || !formData.incident_type}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  {aiAssisting ? "AI Assisting..." : "AI Assist"}
                </Button>
                <Button variant="ghost" size="icon" onClick={onClose}>
                  <X />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white font-medium block mb-2">Report #</label>
                  <Input
                    value={formData.incident_report_number}
                    className="bg-slate-900 border-slate-700 text-white"
                    disabled
                  />
                </div>
                <div>
                  <label className="text-white font-medium block mb-2">Date & Time *</label>
                  <Input
                    type="datetime-local"
                    value={formData.date_time_of_incident}
                    onChange={(e) => setFormData({ ...formData, date_time_of_incident: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Incident Type *</label>
                <Input
                  value={formData.incident_type}
                  onChange={(e) => setFormData({ ...formData, incident_type: e.target.value })}
                  placeholder="e.g., Theft, Trespassing, etc."
                  className="bg-slate-900 border-slate-700 text-white"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white font-medium block mb-2">Victim Name(s)</label>
                  <Input
                    value={formData.victim_names}
                    onChange={(e) => setFormData({ ...formData, victim_names: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-white font-medium block mb-2">Victim Contact</label>
                  <Input
                    value={formData.victim_contact}
                    onChange={(e) => setFormData({ ...formData, victim_contact: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white font-medium block mb-2">Suspect Name(s)</label>
                  <Input
                    value={formData.suspect_names}
                    onChange={(e) => setFormData({ ...formData, suspect_names: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-white font-medium block mb-2">Suspect Contact</label>
                  <Input
                    value={formData.suspect_contact}
                    onChange={(e) => setFormData({ ...formData, suspect_contact: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-white font-medium block mb-2">Witness Name(s)</label>
                  <Input
                    value={formData.witness_names}
                    onChange={(e) => setFormData({ ...formData, witness_names: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
                <div>
                  <label className="text-white font-medium block mb-2">Witness Contact</label>
                  <Input
                    value={formData.witness_contact}
                    onChange={(e) => setFormData({ ...formData, witness_contact: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Incident Location *</label>
                <Input
                  value={formData.incident_location}
                  onChange={(e) => setFormData({ ...formData, incident_location: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white"
                  required
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Incident Summary *</label>
                <Textarea
                  value={formData.incident_summary}
                  onChange={(e) => setFormData({ ...formData, incident_summary: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white min-h-24"
                  required
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Who, What, When, etc.</label>
                <Textarea
                  value={formData.who_what_when_details}
                  onChange={(e) => setFormData({ ...formData, who_what_when_details: e.target.value })}
                  placeholder="Detailed description..."
                  className="bg-slate-900 border-slate-700 text-white min-h-32"
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Officer Actions</label>
                <Textarea
                  value={formData.officer_actions}
                  onChange={(e) => setFormData({ ...formData, officer_actions: e.target.value })}
                  className="bg-slate-900 border-slate-700 text-white min-h-24"
                />
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Police Called?</label>
                <select
                  value={formData.police_called}
                  onChange={(e) => setFormData({ ...formData, police_called: e.target.value })}
                  className="w-full bg-slate-900 border border-slate-700 text-white rounded-md p-2"
                >
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>

              {formData.police_called === "Yes" && (
                <div>
                  <label className="text-white font-medium block mb-2">Police Name(s) & Badge(s)</label>
                  <Input
                    value={formData.police_names_badges}
                    onChange={(e) => setFormData({ ...formData, police_names_badges: e.target.value })}
                    className="bg-slate-900 border-slate-700 text-white"
                  />
                </div>
              )}

              <div>
                <label className="text-white font-medium block mb-2">Photos</label>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handleMediaCapture}
                  className="hidden"
                  id="incident-photos"
                />
                <label htmlFor="incident-photos">
                  <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center cursor-pointer hover:border-sky-500">
                    <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-400">{uploading ? "Uploading..." : "Take/Upload Photos"}</p>
                  </div>
                </label>
                {formData.media.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {formData.media.map((item, idx) => (
                      <img key={idx} src={item.url} alt="Evidence" className="w-full h-24 object-cover rounded" />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Voice Notes</label>
                <Button
                  type="button"
                  onClick={recording ? stopRecording : startRecording}
                  className={`w-full ${recording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-sky-600 hover:bg-sky-700'}`}
                >
                  {recording ? (
                    <>
                      <StopCircle className="w-5 h-5 mr-2 animate-pulse" />
                      Stop Recording
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5 mr-2" />
                      Record Voice Note
                    </>
                  )}
                </Button>
                {formData.voice_notes.length > 0 && (
                  <p className="text-sm text-emerald-400 mt-2">
                    {formData.voice_notes.length} voice note(s) recorded
                  </p>
                )}
              </div>

              {formData.signature && (
                <div className="p-4 bg-slate-900/50 rounded-lg border border-emerald-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-slate-400">Officer Signature</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowSignature(true)}
                      className="text-sky-400"
                    >
                      Re-sign
                    </Button>
                  </div>
                  <img src={formData.signature} alt="Signature" className="h-24 bg-white rounded" />
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1 border-slate-600"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 bg-rose-600 hover:bg-rose-700"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : !formData.signature ? (
                    <>
                      <PenTool className="w-5 h-5 mr-2" />
                      Sign & Submit
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5 mr-2" />
                      Submit Report
                    </>
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