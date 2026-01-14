import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mic, Users, User, Plus, Radio, Volume2, Loader2, X, Settings, Archive, ArchiveRestore, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import ChannelSettingsModal from "@/components/ptt/ChannelSettingsModal";
import PTTAlertHandler, { SystemAlertBadge } from "@/components/ptt/PTTAlertHandler";
import AvailabilitySelector, { AvailabilityBadge } from "@/components/ptt/AvailabilitySelector";

export default function PTT() {
  const [user, setUser] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [channelType, setChannelType] = useState("direct");
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    } catch (error) {
      console.error("Failed to load user:", error);
    }
  };

  const { data: allChannels = [] } = useQuery({
    queryKey: ["pttChannels", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const allChannels = await base44.entities.PTTChannel.list();
      return allChannels
        .filter(ch => ch.members.some(m => m.user_id === user.id))
        .sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
    },
    enabled: !!user,
    refetchInterval: 3000
  });

  const channels = allChannels.filter(ch => showArchived ? ch.is_archived : !ch.is_archived);

  const { data: messages = [] } = useQuery({
    queryKey: ["pttMessages", selectedChannel?.id],
    queryFn: async () => {
      if (!selectedChannel) return [];
      return await base44.entities.PTTMessage.filter(
        { channel_id: selectedChannel.id },
        "-created_date",
        50
      );
    },
    enabled: !!selectedChannel,
    refetchInterval: 2000
  });

  const { data: allUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: () => base44.entities.User.list(),
    enabled: !!user
  });

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        await uploadAudio(blob);
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (error) {
      alert("Failed to access microphone: " + error.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setRecording(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const uploadAudio = async (blob) => {
    setUploading(true);
    try {
      const file = new File([blob], `ptt-${Date.now()}.webm`, { type: blob.type });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      await base44.entities.PTTMessage.create({
        channel_id: selectedChannel.id,
        sender_id: user.id,
        sender_name: user.full_name,
        sender_role: user.role_type,
        audio_url: file_url,
        duration_seconds: recordingTime
      });

      await base44.entities.PTTChannel.update(selectedChannel.id, {
        last_message_at: new Date().toISOString()
      });

      queryClient.invalidateQueries(["pttMessages"]);
      queryClient.invalidateQueries(["pttChannels"]);
    } catch (error) {
      alert("Failed to send voice message: " + error.message);
    } finally {
      setUploading(false);
      setRecordingTime(0);
    }
  };

  const createChannelMutation = useMutation({
    mutationFn: async () => {
      const members = selectedMembers.map(userId => {
        const u = allUsers.find(usr => usr.id === userId);
        return {
          user_id: u.id,
          user_name: u.full_name,
          role: u.role_type
        };
      });

      members.push({
        user_id: user.id,
        user_name: user.full_name,
        role: user.role_type
      });

      return await base44.entities.PTTChannel.create({
        name: newChannelName || (channelType === "direct" ? `${user.full_name} - ${members[0].user_name}` : "Group Channel"),
        type: channelType,
        members,
        created_by: user.id,
        created_by_name: user.full_name,
        last_message_at: new Date().toISOString()
      });
    },
    onSuccess: (channel) => {
      queryClient.invalidateQueries(["pttChannels"]);
      setShowNewChannel(false);
      setSelectedChannel(channel);
      setNewChannelName("");
      setSelectedMembers([]);
    }
  });

  const markAsListened = async (messageId) => {
    try {
      const message = messages.find(m => m.id === messageId);
      if (message && !message.listened_by.includes(user.id)) {
        await base44.entities.PTTMessage.update(messageId, {
          listened_by: [...message.listened_by, user.id]
        });
        queryClient.invalidateQueries(["pttMessages"]);
      }
    } catch (error) {
      console.error("Failed to mark as listened:", error);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-sky-500 rounded-full flex items-center justify-center">
              <Radio className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Push-to-Talk</h1>
              <p className="text-slate-400 text-sm">Voice Communication System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <AvailabilitySelector user={user} />
            <div className="h-6 w-px bg-slate-700" />
            <Dialog open={showNewChannel} onOpenChange={setShowNewChannel}>
              <DialogTrigger asChild>
                <Button className="bg-sky-500 hover:bg-sky-600">
                  <Plus className="w-4 h-4 mr-2" />
                  New Channel
                </Button>
              </DialogTrigger>

            <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
              <DialogHeader>
                <DialogTitle className="text-white">Create PTT Channel</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className="text-sm text-slate-300 block mb-2">Channel Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={channelType === "direct" ? "default" : "outline"}
                      onClick={() => {
                        setChannelType("direct");
                        setSelectedMembers([]);
                      }}
                      className={channelType === "direct" ? "bg-sky-500" : "border-slate-600 text-slate-300"}
                    >
                      <User className="w-4 h-4 mr-2" />
                      Direct
                    </Button>
                    <Button
                      type="button"
                      variant={channelType === "group" ? "default" : "outline"}
                      onClick={() => {
                        setChannelType("group");
                        setSelectedMembers([]);
                      }}
                      className={channelType === "group" ? "bg-sky-500" : "border-slate-600 text-slate-300"}
                    >
                      <Users className="w-4 h-4 mr-2" />
                      Group
                    </Button>
                  </div>
                </div>

                {channelType === "group" && (
                  <div>
                    <label className="text-sm text-slate-300 block mb-2">Channel Name</label>
                    <Input
                      placeholder="Enter channel name"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      className="bg-slate-900 border-slate-700 text-white"
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm text-slate-300 block mb-2">
                    Select {channelType === "direct" ? "User" : "Members"}
                  </label>
                  <div className="max-h-64 overflow-y-auto space-y-2 bg-slate-900 rounded-lg p-3 border border-slate-700">
                    {usersLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
                      </div>
                    ) : allUsers.filter(u => u.id !== user.id).length === 0 ? (
                      <div className="text-center py-8 text-slate-400">
                        <p className="text-sm">No other users available</p>
                      </div>
                    ) : (
                      allUsers.filter(u => u.id !== user.id).map(u => (
                        <label key={u.id} className="flex items-center gap-3 p-2 hover:bg-slate-800 rounded cursor-pointer">
                          <input
                            type={channelType === "direct" ? "radio" : "checkbox"}
                            checked={selectedMembers.includes(u.id)}
                            onChange={(e) => {
                              if (channelType === "direct") {
                                setSelectedMembers(e.target.checked ? [u.id] : []);
                              } else {
                                setSelectedMembers(prev =>
                                  e.target.checked
                                    ? [...prev, u.id]
                                    : prev.filter(id => id !== u.id)
                                );
                              }
                            }}
                            className="w-4 h-4"
                          />
                          <div className="flex-1">
                            <p className="text-white text-sm">{u.full_name}</p>
                            <div className="flex items-center gap-2">
                              <p className="text-slate-400 text-xs">{u.role_type}</p>
                              <AvailabilityBadge status={u.ptt_availability} />
                            </div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={() => createChannelMutation.mutate()}
                  disabled={selectedMembers.length === 0 || createChannelMutation.isPending}
                  className="w-full bg-sky-500 hover:bg-sky-600"
                >
                  {createChannelMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>Create Channel</>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Channels List */}
          <div className="lg:col-span-1">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    {showArchived ? "Archived" : "Channels"} ({channels.length})
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowArchived(!showArchived)}
                    className="text-slate-400 hover:text-white"
                  >
                    {showArchived ? (
                      <>
                        <ArchiveRestore className="w-4 h-4 mr-1" />
                        Active
                      </>
                    ) : (
                      <>
                        <Archive className="w-4 h-4 mr-1" />
                        Archived
                      </>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[600px] overflow-y-auto">
                {channels.map(channel => {
                  const unreadCount = messages.filter(m => 
                    m.channel_id === channel.id && 
                    m.sender_id !== user.id && 
                    !m.listened_by.includes(user.id)
                  ).length;

                  return (
                    <button
                      key={channel.id}
                      onClick={() => setSelectedChannel(channel)}
                      className={`w-full text-left p-3 rounded-lg transition-all ${
                        selectedChannel?.id === channel.id
                          ? "bg-sky-500 text-white"
                          : "bg-slate-900 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {channel.type === "direct" ? (
                            <User className="w-4 h-4" />
                          ) : (
                            <Users className="w-4 h-4" />
                          )}
                          <span className="font-semibold">{channel.name}</span>
                        </div>
                        {unreadCount > 0 && (
                          <Badge className="bg-rose-500 text-white">
                            {unreadCount}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs opacity-70">
                        {channel.members.length} member{channel.members.length !== 1 ? 's' : ''}
                      </p>
                    </button>
                  );
                })}
                {channels.length === 0 && (
                  <div className="text-center py-8 text-slate-400">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No channels yet</p>
                    <p className="text-sm">Create a channel to start</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Messages Area */}
          <div className="lg:col-span-2">
            {selectedChannel ? (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader className="border-b border-slate-700">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-white flex items-center gap-2">
                        {selectedChannel.type === "direct" ? (
                          <User className="w-5 h-5" />
                        ) : (
                          <Users className="w-5 h-5" />
                        )}
                        {selectedChannel.name}
                        {selectedChannel.is_archived && (
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                            Archived
                          </Badge>
                        )}
                      </CardTitle>
                      <p className="text-slate-400 text-sm mt-1">
                        {selectedChannel.members.map(m => m.user_name).join(", ")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowChannelSettings(true)}
                      className="text-slate-400 hover:text-white"
                    >
                      <Settings className="w-4 h-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-4">
                  <div className="space-y-3 max-h-[400px] overflow-y-auto mb-4">
                    {messages.slice().reverse().map(msg => {
                      const isOwn = msg.sender_id === user.id;
                      const hasListened = msg.listened_by.includes(user.id);
                      const isSystemAlert = msg.is_system_alert;

                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isOwn ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-xs ${
                              isSystemAlert && msg.priority === "emergency"
                                ? "bg-rose-600 border-2 border-rose-400"
                                : isSystemAlert && msg.priority === "urgent"
                                ? "bg-orange-600 border-2 border-orange-400"
                                : isSystemAlert
                                ? "bg-sky-600"
                                : isOwn
                                ? "bg-sky-500"
                                : hasListened
                                ? "bg-slate-700"
                                : "bg-emerald-600"
                            } rounded-lg p-3`}
                          >
                            {isSystemAlert && (
                              <div className="mb-2">
                                <SystemAlertBadge priority={msg.priority} />
                              </div>
                            )}
                            
                            {!isOwn && !isSystemAlert && (
                              <p className="text-xs text-white/80 mb-2">
                                {msg.sender_name}
                              </p>
                            )}

                            {isSystemAlert && msg.alert_text && (
                              <div className="mb-2 text-white">
                                <p className="text-xs font-semibold mb-1">
                                  {msg.alert_type?.toUpperCase()}
                                </p>
                                <p className="text-sm">{msg.alert_text}</p>
                              </div>
                            )}

                            {msg.audio_url && (
                              <audio
                                controls
                                className="w-full"
                                onPlay={() => !isOwn && markAsListened(msg.id)}
                                src={msg.audio_url}
                              />
                            )}
                            
                            <div className="flex items-center justify-between mt-2 text-xs text-white/70">
                              {msg.duration_seconds && <span>{msg.duration_seconds}s</span>}
                              <span>
                                {new Date(msg.created_date).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {messages.length === 0 && (
                      <div className="text-center py-12 text-slate-400">
                        <Volume2 className="w-16 h-16 mx-auto mb-3 opacity-50" />
                        <p>No messages yet</p>
                        <p className="text-sm">Press and hold to record</p>
                      </div>
                    )}
                  </div>

                  {/* PTT Button */}
                  <div className="flex items-center justify-center">
                    {uploading ? (
                      <div className="text-center py-4">
                        <Loader2 className="w-8 h-8 text-sky-400 animate-spin mx-auto mb-2" />
                        <p className="text-slate-400 text-sm">Sending...</p>
                      </div>
                    ) : (
                      <div className="text-center">
                        <button
                          onMouseDown={(e) => {
                            e.preventDefault();
                            startRecording();
                          }}
                          onMouseUp={(e) => {
                            e.preventDefault();
                            stopRecording();
                          }}
                          onMouseLeave={(e) => {
                            e.preventDefault();
                            if (recording) stopRecording();
                          }}
                          onTouchStart={(e) => {
                            e.preventDefault();
                            startRecording();
                          }}
                          onTouchEnd={(e) => {
                            e.preventDefault();
                            stopRecording();
                          }}
                          onTouchCancel={(e) => {
                            e.preventDefault();
                            stopRecording();
                          }}
                          className={`w-24 h-24 rounded-full flex items-center justify-center transition-all ${
                            recording
                              ? "bg-rose-500 scale-110 animate-pulse"
                              : "bg-sky-500 hover:bg-sky-600"
                          }`}
                        >
                          <Mic className="w-10 h-10 text-white" />
                        </button>
                        {recording && (
                          <p className="text-rose-400 font-bold mt-3">
                            Recording... {recordingTime}s
                          </p>
                        )}
                        {!recording && (
                          <p className="text-slate-400 text-sm mt-3">
                            Press & Hold to Talk
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-slate-800/50 border-slate-700">
                <CardContent className="flex items-center justify-center h-[600px]">
                  <div className="text-center text-slate-400">
                    <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p className="text-lg mb-2">Select a channel to start</p>
                    <p className="text-sm">or create a new one</p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Channel Settings Modal */}
      {selectedChannel && (
        <ChannelSettingsModal
          channel={selectedChannel}
          user={user}
          open={showChannelSettings}
          onClose={() => setShowChannelSettings(false)}
        />
      )}

      {/* Channel Settings Modal */}
      {selectedChannel && (
        <ChannelSettingsModal
          channel={selectedChannel}
          user={user}
          open={showChannelSettings}
          onClose={() => setShowChannelSettings(false)}
        />
      )}

      {/* Alert Handler */}
      {selectedChannel && (
        <PTTAlertHandler
          messages={messages}
          user={user}
          selectedChannel={selectedChannel}
        />
      )}
      </div>
    </div>
  );
}