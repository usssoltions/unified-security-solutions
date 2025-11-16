import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Send, Mic, StopCircle, Play, X, AlertCircle, Volume2, Phone } from "lucide-react";
import VoiceCall from "./VoiceCall";

export default function GuardChat({ user, onClose }) {
  const [message, setMessage] = useState("");
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const messagesEndRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: messages = [] } = useQuery({
    queryKey: ["chatMessages", user.id],
    queryFn: async () => {
      const allMessages = await base44.entities.ChatMessage.list("-created_date", 100);
      return allMessages.filter(m => 
        m.sender_id === user.id || 
        m.recipient_id === user.id ||
        m.is_broadcast === true
      );
    },
    refetchInterval: 3000
  });

  const { data: supervisors = [] } = useQuery({
    queryKey: ["supervisors"],
    queryFn: async () => {
      const users = await base44.entities.User.list();
      return users.filter(u => 
        u.role_type === "admin" || 
        u.role_type === "dispatcher" || 
        u.role_type === "supervisor"
      );
    }
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

  const markAsReadMutation = useMutation({
    mutationFn: async (messageId) => {
      const msg = messages.find(m => m.id === messageId);
      if (msg && !msg.read_by?.includes(user.id)) {
        await base44.entities.ChatMessage.update(messageId, {
          read_by: [...(msg.read_by || []), user.id]
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["chatMessages"]);
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    
    messages.forEach(msg => {
      if (msg.recipient_id === user.id && !msg.read_by?.includes(user.id)) {
        markAsReadMutation.mutate(msg.id);
      }
    });
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
        recipient_id: null,
        is_broadcast: false,
        broadcast_to: "specific_user",
        message: "🎤 Voice Message",
        message_type: "voice",
        voice_url: file_url,
        priority: "normal"
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
      recipient_id: null,
      is_broadcast: false,
      broadcast_to: "specific_user",
      message: message,
      message_type: "text",
      priority: "normal"
    });
  };

  const initiateCall = (supervisor) => {
    setActiveCall({
      caller: user,
      recipient: supervisor,
      isInitiator: true
    });
  };

  const priorityColors = {
    normal: "bg-slate-700",
    urgent: "bg-amber-600",
    emergency: "bg-rose-600"
  };

  if (activeCall) {
    return (
      <VoiceCall
        caller={activeCall.caller}
        recipient={activeCall.recipient}
        isInitiator={activeCall.isInitiator}
        onEnd={() => setActiveCall(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-slate-900/95 z-50 flex flex-col">
      <div className="bg-slate-800 border-b border-slate-700 p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageCircle className="w-6 h-6 text-sky-400" />
          <div>
            <h2 className="text-white font-semibold">Team Chat</h2>
            <p className="text-xs text-slate-400">Real-time communication</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {supervisors.length > 0 && (
            <Button
              onClick={() => initiateCall(supervisors[0])}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Phone className="w-4 h-4 mr-2" />
              Call Control Room
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5 text-white" />
          </Button>
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
            const isBroadcast = msg.is_broadcast;

            return (
              <div key={msg.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] ${isOwnMessage ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!isOwnMessage && (
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-xs font-semibold text-slate-400">{msg.sender_name}</p>
                      <Badge variant="outline" className="border-slate-600 text-slate-400 text-xs">
                        {msg.sender_role}
                      </Badge>
                      {isBroadcast && (
                        <Badge className="bg-purple-500 text-xs">Broadcast</Badge>
                      )}
                    </div>
                  )}
                  
                  <div className={`rounded-2xl px-4 py-2 ${
                    isOwnMessage 
                      ? priorityColors[msg.priority] 
                      : isBroadcast
                      ? 'bg-purple-600/20 border border-purple-500/30'
                      : 'bg-slate-700'
                  }`}>
                    {msg.message_type === "voice" ? (
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-sky-400" />
                        <audio src={msg.voice_url} controls className="max-w-[200px]" />
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
                  
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(msg.created_date).toLocaleTimeString()}
                  </p>
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
              <Play className="w-5 h-5 text-emerald-400" />
              <audio src={recordedAudio.url} controls className="max-w-[200px]" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setRecordedAudio(null)} variant="outline" className="border-slate-600">
                Cancel
              </Button>
              <Button size="sm" onClick={sendVoiceMessage} className="bg-emerald-600 hover:bg-emerald-700">
                <Send className="w-4 h-4" />
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
            className={recording ? "bg-rose-600 hover:bg-rose-700" : "bg-sky-600 hover:bg-sky-700"}
          >
            {recording ? <StopCircle className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
          </Button>
          
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Type a message..."
            className="bg-slate-900 border-slate-700 text-white"
            disabled={recording || recordedAudio}
          />
          
          <Button onClick={handleSendMessage} disabled={!message.trim() || recording || recordedAudio} className="bg-sky-600 hover:bg-sky-700">
            <Send className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  );
}