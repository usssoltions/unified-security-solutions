import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Camera, Loader2, Send, PenTool, Mic, Sparkles, StopCircle, Upload, Video, Play } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import SignaturePad from "./SignaturePad";
import { createPageUrl } from "@/utils";

export default function IncidentForm({ user, shift, location, onClose, onSuccess }) {
  const incidentTypes = [
    "Fire", "Theft", "Vandalism", "Medical Emergency", "Trespassing",
    "Suspicious Activity", "Equipment Failure", "Safety Hazard", "Other"
  ];

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
  const [videoRecording, setVideoRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [aiAssisting, setAiAssisting] = useState(false);
  const [videoPreview, setVideoPreview] = useState(null);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [similarIncidents, setSimilarIncidents] = useState([]);
  const videoPreviewRef = useRef(null);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    onMutate: async (newIncident) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['incidents'] });

      // Snapshot previous value
      const previousIncidents = queryClient.getQueryData(['incidents']);

      // Optimistically update
      queryClient.setQueryData(['incidents'], (old = []) => [
        {
          id: `temp-${Date.now()}`,
          title: `Incident Report - ${newIncident.incident_type}`,
          description: 'Submitting...',
          category: newIncident.incident_type?.toLowerCase() || 'other',
          priority: 'high',
          status: 'reported',
          guard_name: user.full_name,
          site_name: shift?.site_name || '',
          reported_at: new Date().toISOString(),
          created_date: new Date().toISOString(),
          media: newIncident.media || []
        },
        ...old
      ]);

      return { previousIncidents };
    },
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

PHOTOS: ${data.media.filter(m => m.type === 'photo').length} photo(s) attached
VIDEOS: ${data.media.filter(m => m.type === 'video').length} video(s) attached
VOICE NOTES: ${data.voice_notes.length} voice note(s) attached
Officer Signature: Signed
      `.trim();

      // Use AI-recommended category and priority if available
      const categoryMap = {
        'Fire': 'fire',
        'Theft': 'theft',
        'Vandalism': 'vandalism',
        'Medical Emergency': 'medical',
        'Trespassing': 'trespassing',
        'Suspicious Activity': 'suspicious_activity',
        'Equipment Failure': 'equipment_failure',
        'Safety Hazard': 'safety_hazard',
        'Other': 'other'
      };

      const incident = await base44.entities.Incident.create({
        title: `Incident Report - ${data.incident_type}`,
        description: reportContent,
        category: aiSuggestions?.recommended_category || categoryMap[data.incident_type] || "other",
        priority: aiSuggestions?.recommended_priority || "high",
        guard_id: user.id,
        guard_name: user.full_name,
        site_id: shift?.site_id || "",
        site_name: shift?.site_name || "",
        shift_id: shift?.id || "",
        location: location,
        reported_at: data.date_time_of_incident,
        media: [...data.media, ...data.voice_notes.map(url => ({ type: 'audio', url }))]
      });

      // Send immediate notifications via backend with location
      try {
        await base44.functions.invoke('notifyAdminsIncident', {
          incidentId: incident.id,
          guardName: user.full_name,
          incidentType: data.incident_type,
          siteName: shift?.site_name || 'Unknown Site',
          incidentTime: data.date_time_of_incident,
          location: location
        });
      } catch (error) {
        console.error('Failed to send incident notification:', error);
      }

      // Invoke serverless function to handle emails and notifications
      try {
        await base44.functions.invoke('processIncidentReport', {
          incidentId: incident.id,
          incidentReportNumber: data.incident_report_number,
          incidentType: data.incident_type,
          siteName: shift?.site_name || 'N/A',
          guardFullName: user.full_name,
          incidentDateTime: data.date_time_of_incident,
          incidentLocation: data.incident_location,
          incidentSummary: data.incident_summary,
          incidentDetails: data.who_what_when_details,
          victimNames: data.victim_names,
          suspectNames: data.suspect_names,
          witnessNames: data.witness_names,
          officerActions: data.officer_actions,
          policeCalled: data.police_called,
          policeNamesBadges: data.police_names_badges,
          mediaCount: data.media.length,
          voiceNotesCount: data.voice_notes.length,
          gpsLocation: location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : 'Not available',
          actionUrl: createPageUrl('Reports') // Assuming 'Reports' is the page name for incidents
        });
      } catch (error) {
        console.error('Failed to invoke processIncidentReport function:', error);
      }

      return incident;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
      onSuccess();
    },
    onError: (error, newIncident, context) => {
      // Rollback on error
      if (context?.previousIncidents) {
        queryClient.setQueryData(['incidents'], context.previousIncidents);
      }
      alert(`Failed to report incident: ${error.message}`);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['incidents'] });
    }
  });

  const handlePhotoCapture = async (e) => {
   const files = Array.from(e.target.files);
   if (!files.length) return;

   setUploading(true);
   for (const file of files) {
     try {
       const { file_url } = await base44.integrations.Core.UploadFile({ file });
       setFormData(prev => ({
         ...prev,
         media: [...prev.media, { type: 'photo', url: file_url }]
       }));
     } catch (err) {
       console.error("Upload error:", err);
     }
   }
   setUploading(false);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const type = file.type.startsWith('video') ? 'video' : 'photo';
        setFormData(prev => ({
          ...prev,
          media: [...prev.media, { type, url: file_url }]
        }));
      }
    } catch (error) {
      alert("Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  const startAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(blob);
        setRecordedAudio(audioUrl);

        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (error) {
      alert("Failed to access microphone");
    }
  };

  const saveAudioRecording = async () => {
    if (!recordedAudio) return;

    try {
      const response = await fetch(recordedAudio);
      const blob = await response.blob();
      const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });

      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData(prev => ({
        ...prev,
        voice_notes: [...prev.voice_notes, file_url]
      }));

      setRecordedAudio(null);
      alert("Voice note saved!");
    } catch (error) {
      alert("Failed to save voice note");
    }
  };

  const startVideoRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true
      });

      setVideoPreview(stream);

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.muted = true;
        videoPreviewRef.current.playsInline = true;
        await videoPreviewRef.current.play().catch(e => console.log('Video play failed:', e));
      }

      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const file = new File([blob], `video-${Date.now()}.webm`, { type: 'video/webm' });

        try {
          const { file_url } = await base44.integrations.Core.UploadFile({ file });
          setFormData(prev => ({
            ...prev,
            media: [...prev.media, { type: 'video', url: file_url }]
          }));
          alert("Video saved!");
        } catch (error) {
          alert("Failed to upload video");
        }

        stream.getTracks().forEach(track => track.stop());
        setVideoPreview(null);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setVideoRecording(true);

      setTimeout(() => {
        if (recorder.state === 'recording') {
          stopRecording();
        }
      }, 30000);
    } catch (error) {
      alert("Failed to access camera: " + error.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      setRecording(false);
      setVideoRecording(false);
      setMediaRecorder(null);
    }
  };

  const getAIAssistance = async () => {
    if (!formData.incident_type || !formData.incident_summary) {
      alert("Please fill in Incident Type and Summary first");
      return;
    }

    setAiAssisting(true);
    try {
      // Fetch all recent incidents to check for similarities
      const allIncidents = await base44.entities.Incident.list('-created_date', 50);

      const prompt = `You are a security incident analysis expert. Analyze this incident and provide comprehensive insights:

CURRENT INCIDENT:
- Type: ${formData.incident_type}
- Location: ${formData.incident_location}
- Summary: ${formData.incident_summary}
- Details: ${formData.who_what_when_details}
- Victim Info: ${formData.victim_names}
- Suspect Info: ${formData.suspect_names}
- Witness Info: ${formData.witness_names}

RECENT INCIDENTS FOR COMPARISON:
${allIncidents.slice(0, 20).map((inc, idx) => `
${idx + 1}. ${inc.title}
   Category: ${inc.category}
   Priority: ${inc.priority}
   Date: ${inc.reported_at || inc.created_date}
   Site: ${inc.site_name}
   Description: ${inc.description?.substring(0, 200)}
`).join('\n')}

Provide detailed analysis in JSON format:
1. recommended_category: One of [fire, theft, vandalism, medical, trespassing, suspicious_activity, equipment_failure, safety_hazard, other]
2. recommended_priority: One of [critical, high, medium, low]
3. priority_reason: Brief explanation for the priority level
4. enhanced_summary: Professional rewrite of the incident summary
5. suggested_actions: Immediate actions the officer should take
6. response_actions: List of recommended response steps (array of strings)
7. safety_notes: Important safety considerations
8. similar_incident_ids: Array of incident IDs from the recent incidents list that are similar (consider location, type, timing)
9. pattern_detected: Boolean - if this appears to be part of a pattern
10. pattern_description: If pattern detected, describe it`;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: prompt,
        response_json_schema: {
          type: "object",
          properties: {
            recommended_category: { 
              type: "string",
              enum: ["fire", "theft", "vandalism", "medical", "trespassing", "suspicious_activity", "equipment_failure", "safety_hazard", "other"]
            },
            recommended_priority: { 
              type: "string",
              enum: ["critical", "high", "medium", "low"]
            },
            priority_reason: { type: "string" },
            enhanced_summary: { type: "string" },
            suggested_actions: { type: "string" },
            response_actions: { 
              type: "array",
              items: { type: "string" }
            },
            safety_notes: { type: "string" },
            similar_incident_ids: {
              type: "array",
              items: { type: "string" }
            },
            pattern_detected: { type: "boolean" },
            pattern_description: { type: "string" }
          }
        }
      });

      setAiSuggestions(response);

      // Find similar incidents
      const similar = allIncidents.filter(inc => 
        response.similar_incident_ids?.includes(inc.id)
      );
      setSimilarIncidents(similar);

      // Update form with AI suggestions (don't overwrite existing content)
      setFormData(prev => ({
        ...prev,
        incident_summary: prev.incident_summary.trim() ? 
          prev.incident_summary + "\n\n[AI Enhancement]\n" + response.enhanced_summary :
          response.enhanced_summary,
        officer_actions: prev.officer_actions.trim() ?
          prev.officer_actions + "\n\n[AI Suggestions]\n" + response.suggested_actions :
          response.suggested_actions
      }));

    } catch (error) {
      console.error("AI assistance error:", error);
      alert("AI analysis failed. Please try again.");
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
      <div className="fixed inset-0 bg-slate-900/95 z-[60] flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
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
    <div 
      className="fixed inset-0 bg-slate-900/95 z-50 overflow-y-auto safe-area-top safe-area-bottom"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="min-h-screen p-4 pt-20 pb-32">
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
            <form onSubmit={handleSubmit} className="space-y-4" onClick={(e) => e.stopPropagation()}>
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
                <Select
                  value={formData.incident_type}
                  onValueChange={(value) => setFormData({ ...formData, incident_type: value })}
                  required
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white w-full">
                    <SelectValue placeholder="Select incident type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {incidentTypes.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                <Select
                  value={formData.police_called}
                  onValueChange={(value) => setFormData({ ...formData, police_called: value })}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[9999]">
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
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
                  onChange={handlePhotoCapture}
                  className="hidden"
                  id="photo-capture"
                />
                <label htmlFor="photo-capture">
                  <Button type="button" className="w-full bg-sky-600 hover:bg-sky-700" asChild>
                    <div>
                      <Camera className="w-4 h-4 mr-2" />
                      {uploading ? "Uploading..." : "Take Photo with Camera"}
                    </div>
                  </Button>
                </label>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Upload Media</label>
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload">
                  <Button type="button" variant="outline" className="w-full border-slate-700" asChild>
                    <div>
                      <Upload className="w-4 h-4 mr-2" />
                      Upload Photos/Videos from Gallery
                    </div>
                  </Button>
                </label>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Record Video (max 30 seconds)</label>
                {videoRecording && videoPreview && (
                  <div className="mb-2 relative">
                    <video
                      ref={videoPreviewRef}
                      className="w-full h-48 bg-black rounded-lg"
                      playsInline
                      autoPlay
                      muted
                    />
                    <div className="absolute top-2 right-2 bg-rose-600 px-3 py-1 rounded-full flex items-center gap-2">
                      <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                      <span className="text-white text-sm font-bold">REC</span>
                    </div>
                  </div>
                )}
                <Button
                  type="button"
                  onClick={videoRecording ? stopRecording : startVideoRecording}
                  className={`w-full ${videoRecording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                >
                  {videoRecording ? (
                    <>
                      <StopCircle className="w-5 h-5 mr-2 animate-pulse" />
                      Stop Recording Video
                    </>
                  ) : (
                    <>
                      <Video className="w-5 h-5 mr-2" />
                      Record Video
                    </>
                  )}
                </Button>
              </div>

              <div>
                <label className="text-white font-medium block mb-2">Voice Notes</label>
                {recordedAudio && (
                  <div className="mb-2 p-3 bg-slate-900/50 rounded-lg border border-emerald-500/20">
                    <audio src={recordedAudio} controls className="w-full mb-2" />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={saveAudioRecording}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                      >
                        Save Voice Note
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setRecordedAudio(null)}
                        className="border-slate-600"
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                )}
                {!recordedAudio && (
                  <Button
                    type="button"
                    onClick={recording ? stopRecording : startAudioRecording}
                    className={`w-full ${recording ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                  >
                    {recording ? (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                          <Mic className="w-5 h-5" />
                          <span>Recording... Tap to Stop</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <Mic className="w-5 h-5 mr-2" />
                        Record Voice Note
                      </>
                    )}
                  </Button>
                )}
                {formData.voice_notes.length > 0 && (
                  <p className="text-sm text-emerald-400 mt-2">
                    ✓ {formData.voice_notes.length} voice note(s) saved
                  </p>
                )}
              </div>

              {formData.media.length > 0 && (
                <div className="p-3 bg-slate-900/50 rounded-lg border border-slate-700">
                  <p className="text-sm text-slate-400 mb-2">Media Attached:</p>
                  <div className="grid grid-cols-3 gap-2">
                    {formData.media.map((item, idx) => (
                      <div key={idx} className="relative">
                        {item.type === 'video' ? (
                          <video src={item.url} className="w-full h-24 object-cover rounded" />
                        ) : (
                          <img src={item.url} alt="Evidence" className="w-full h-24 object-cover rounded" />
                        )}
                        <span className="absolute top-1 right-1 bg-black/70 text-white text-xs px-1 rounded">
                          {item.type === 'video' ? '📹' : '📷'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

              {aiSuggestions && (
                <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg space-y-3">
                  <div className="flex items-center gap-2 text-purple-300 font-semibold">
                    <Sparkles className="w-5 h-5" />
                    AI Analysis Results
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-900/50 rounded">
                      <p className="text-xs text-slate-400 mb-1">Recommended Category</p>
                      <p className="text-white font-medium capitalize">{aiSuggestions.recommended_category?.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="p-3 bg-slate-900/50 rounded">
                      <p className="text-xs text-slate-400 mb-1">Recommended Priority</p>
                      <p className={`font-medium uppercase ${
                        aiSuggestions.recommended_priority === 'critical' ? 'text-rose-400' :
                        aiSuggestions.recommended_priority === 'high' ? 'text-orange-400' :
                        aiSuggestions.recommended_priority === 'medium' ? 'text-amber-400' :
                        'text-sky-400'
                      }`}>
                        {aiSuggestions.recommended_priority}
                      </p>
                    </div>
                  </div>

                  {aiSuggestions.priority_reason && (
                    <div className="p-3 bg-slate-900/50 rounded">
                      <p className="text-xs text-slate-400 mb-1">Priority Reasoning</p>
                      <p className="text-sm text-slate-300">{aiSuggestions.priority_reason}</p>
                    </div>
                  )}

                  {aiSuggestions.response_actions && aiSuggestions.response_actions.length > 0 && (
                    <div className="p-3 bg-slate-900/50 rounded">
                      <p className="text-xs text-slate-400 mb-2">Recommended Response Actions</p>
                      <ul className="space-y-1">
                        {aiSuggestions.response_actions.map((action, idx) => (
                          <li key={idx} className="text-sm text-slate-300 flex items-start gap-2">
                            <span className="text-emerald-400 mt-1">•</span>
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {aiSuggestions.safety_notes && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded">
                      <p className="text-xs text-amber-400 mb-1">⚠️ Safety Notes</p>
                      <p className="text-sm text-amber-300">{aiSuggestions.safety_notes}</p>
                    </div>
                  )}

                  {aiSuggestions.pattern_detected && (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded">
                      <p className="text-xs text-rose-400 mb-1">🔴 Pattern Detected</p>
                      <p className="text-sm text-rose-300">{aiSuggestions.pattern_description}</p>
                    </div>
                  )}

                  {similarIncidents.length > 0 && (
                    <div className="p-3 bg-slate-900/50 rounded">
                      <p className="text-xs text-slate-400 mb-2">Similar Recent Incidents ({similarIncidents.length})</p>
                      <div className="space-y-2">
                        {similarIncidents.map(inc => (
                          <div key={inc.id} className="p-2 bg-slate-800/50 rounded border border-slate-700">
                            <p className="text-sm text-white font-medium">{inc.title}</p>
                            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                              <span>{inc.site_name}</span>
                              <span>•</span>
                              <span>{new Date(inc.reported_at || inc.created_date).toLocaleDateString()}</span>
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 capitalize">
                                {inc.priority}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-6 pb-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1 border-slate-600 h-12"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="flex-1 bg-rose-600 hover:bg-rose-700 h-12"
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