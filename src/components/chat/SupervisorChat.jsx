import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, Send, Mic, StopCircle, X, Users, Radio, Volume2 } from "lucide-react";

export default function SupervisorChat({ user, onClose }) {
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [broadcastType, setBroadcastType] = useState("all_guards");
  const [selectedSite, setSelectedSite] = useState(null);
  const [selectedGuard, setSelectedGuard] = useState(null);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: messages = [] } = useQuery({
    queryKey: ["chatMessages"],
    queryFn: async () => base44.entities.ChatMessage.list("-created_date", 200),
    refetchInterval: 3000
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => u.role_type === "guard");
    }
  });

  const { data: sites = [] } = useQuery({
    queryKey: ["sites"],
    queryFn: async () => base44.entities.Site.list(),
    initialData: []
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (messageData) => {
      await base44.entities.ChatMessage.create(messageData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["chatMessages"]);
      setMessage("");
      setRecordedAudio(null);
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(blob);
        setRecordedAudio({ blob, url: audioUrl });
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (error) {
      alert("Failed to access microphone");
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
      setRecording(false);
      setMediaRecorder(null);
    }
  };

  const sendVoiceMessage = async () => {
    if (!recordedAudio) return;

    try {
      const file = new File([recordedAudio.blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      sendMessageMutation.mutate({
        sender_id: user.id,
        sender_name: user.full_name,
        sender_role: user.role_type,
        recipient_id: selectedGuard,
        is_broadcast: broadcastType !== "specific_user",
        broadcast_to: broadcastType,
        site_id: broadcastType === "site_team" ? selectedSite : null,
        message: "🎤 Voice Broadcast",
        message_type: "voice",
        voice_url: file_url,
        priority: priority
      });
    } catch (error) {
      alert("Failed to send voice message");
    }
  };

  const handleSendMessage = () => {
    if (!message.trim()) return;

    sendMessageMutation.mutate({
      sender_id: user.id,
      sender_name: user.full_name,
      sender_role: user.role_type,
      recipient_id: selectedGuard,
      is_broadcast: broadcastType !== "specific_user",
      broadcast_to: broadcastType,
      site_id: broadcastType === "site_team" ? selectedSite : null,
      message: message,
      message_type: "text",
      priority: priority
    });
  };

  const priorityColors = {
    normal: "bg-slate-700",
    urgent: "bg-amber-600",
    emergency: "bg-rose-600"
  };

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 flex flex-col">
      <div className="bg-slate-800 border-b border-slate-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Radio className="w-6 h-6 text-purple-400" />
            <div>
              <h2 className="text-white font-semibold">Command Center Chat</h2>
              <p className="text-xs text-slate-400">Broadcast & direct messaging</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5 text-white" />
          </Button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Select value={broadcastType} onValueChange={setBroadcastType}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_guards">🌐 All Guards</SelectItem>
              <SelectItem value="site_team">🏢 Site Team</SelectItem>
              <SelectItem value="specific_user">👤 Specific Guard</SelectItem>
            </SelectContent>
          </Select>

          {broadcastType === "site_team" && (
            <Select value={selectedSite} onValueChange={setSelectedSite}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue placeholder="Select site..." />
              </SelectTrigger>
              <SelectContent>
                {sites.map(site => (
                  <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {broadcastType === "specific_user" && (
            <Select value={selectedGuard} onValueChange={setSelectedGuard}>
              <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
                <SelectValue placeholder="Select guard..." />
              </SelectTrigger>
              <SelectContent>
                {guards.map(guard => (
                  <SelectItem key={guard.id} value={guard.id}>{guard.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger className="bg-slate-900 border-slate-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="urgent">⚠️ Urgent</SelectItem>
              <SelectItem value="emergency">🚨 Emergency</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <MessageCircle className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">No messages yet</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isOwnMessage = msg.sender_id === user.id;

            return (
              <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[70%] ${isOwnMessage ? 'items-end' : 'items-start'} flex flex-col`}>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-xs font-semibold text-slate-400">{msg.sender_name}</p>
                    <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">
                      {msg.sender_role}
                    </Badge>
                    {msg.is_broadcast && (
                      <Badge className="bg-purple-500 text-xs">
                        <Users className="w-3 h-3 mr-1" />
                        {msg.broadcast_to === "all_guards" ? "All" : "Site"}
                      </Badge>
                    )}
                  </div>
                  
                  <div className={`rounded-2xl px-4 py-2 ${
                    isOwnMessage 
                      ? priorityColors[msg.priority] 
                      : msg.is_broadcast
                      ? 'bg-purple-600/20 border border-purple-500/30'
                      : 'bg-slate-700'
                  }`}>
                    {msg.message_type === "voice" ? (
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-sky-400" />
                        <audio src={msg.voice_url} controls className="max-w-[250px]" />
                      </div>
                    ) : (
                      <p className="text-white text-sm">{msg.message}</p>
                    )}
                    
                    {msg.priority !== "normal" && (
                      <Badge className={`mt-2 ${priorityColors[msg.priority]} text-xs`}>
                        {msg.priority}
                      </Badge>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-slate-500">
                      {new Date(msg.created_date).toLocaleTimeString()}
                    </p>
                    {msg.read_by?.length > 0 && (
                      <Badge variant="outline" className="border-slate-600 text-slate-500 text-xs">
                        ✓ {msg.read_by.length} read
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {recordedAudio && (
        <div className="bg-emerald-500/10 border-t border-emerald-500/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Volume2 className="w-5 h-5 text-emerald-400" />
              <audio src={recordedAudio.url} controls className="max-w-[250px]" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setRecordedAudio(null)} variant="outline" className="border-slate-600">
                Cancel
              </Button>
              <Button size="sm" onClick={sendVoiceMessage} className="bg-emerald-600 hover:bg-emerald-700">
                <Send className="w-4 h-4 mr-2" />
                Broadcast Voice
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-800 border-t border-slate-700 p-4">
        <div className="flex gap-2">
          <Button
            size="icon"
            onClick={recording ? stopVoiceRecording : startVoiceRecording}
            className={recording ? "bg-rose-600 hover:bg-rose-700 animate-pulse" : "bg-purple-600 hover:bg-purple-700"}
          >
            {recording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </Button>
          
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={broadcastType === "all_guards" ? "Broadcast to all guards..." : "Type a message..."}
            className="bg-slate-900 border-slate-700 text-white"
            disabled={recording || recordedAudio}
          />
          
          <Button 
            onClick={handleSendMessage} 
            disabled={!message.trim() || recording || recordedAudio}
            className="bg-purple-600 hover:bg-purple-700"
          >
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}