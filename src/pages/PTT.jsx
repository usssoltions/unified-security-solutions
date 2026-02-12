import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Mic, Users, User, Plus, Radio, Loader2, Settings, Archive, ArchiveRestore, Phone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import ChannelSettingsModal from "@/components/ptt/ChannelSettingsModal";
import PTTAlertHandler from "@/components/ptt/PTTAlertHandler";
import AvailabilitySelector from "@/components/ptt/AvailabilitySelector";
import RealtimeVoiceCall from "@/components/voice/RealtimeVoiceCall";

export default function PTT() {
  const [user, setUser] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [transmitting, setTransmitting] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [channelType, setChannelType] = useState("direct");
  const [showChannelSettings, setShowChannelSettings] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [activeGroupCall, setActiveGroupCall] = useState(null);
  
  const peerConnections = useRef({});
  const localStream = useRef(null);
  const remoteAudios = useRef({});
  const pollingInterval = useRef(null);
  const queryClient = useQueryClient();

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

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
      
      // Filter channels based on user role
      let filtered = allChannels.filter(ch => ch.members.some(m => m.user_id === user.id));
      
      // Guards only see their direct channels, admins/dispatchers see all
      if (user.role_type === 'guard') {
        filtered = filtered.filter(ch => 
          ch.type === 'direct' || 
          ch.members.some(m => m.user_id === user.id && m.role !== 'guard')
        );
      }
      
      return filtered.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
    },
    enabled: !!user
  });

  // Real-time subscription for PTT channels
  useEffect(() => {
    if (!user) return;
    const unsubscribe = base44.entities.PTTChannel.subscribe((event) => {
      queryClient.invalidateQueries(["pttChannels"]);
    });
    return () => unsubscribe();
  }, [user?.id, queryClient]);

  const channels = allChannels.filter(ch => showArchived ? ch.is_archived : !ch.is_archived);

  const { data: allUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: () => base44.entities.User.list(),
    enabled: !!user
  });

  // Initialize WebRTC when channel is selected
  useEffect(() => {
    if (selectedChannel) {
      initializeWebRTC();
    }
    return () => {
      cleanupWebRTC();
    };
  }, [selectedChannel?.id]);

  const initializeWebRTC = async () => {
    try {
      // Get user media
      localStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        }
      });

      // Mute by default (unmute when transmitting)
      localStream.current.getAudioTracks().forEach(track => track.enabled = false);

      // Start polling for signaling
      startPolling();
    } catch (error) {
      console.error("Failed to get media:", error);
      alert("Microphone access required for PTT");
    }
  };

  const cleanupWebRTC = () => {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }
    Object.values(peerConnections.current).forEach(pc => pc.close());
    peerConnections.current = {};
    remoteAudios.current = {};
  };

  const startTransmitting = async () => {
    if (!selectedChannel || !localStream.current) return;
    
    setTransmitting(true);
    
    // Enable audio
    localStream.current.getAudioTracks().forEach(track => track.enabled = true);

    // Notify channel members
    const otherMembers = selectedChannel.members.filter(m => m.user_id !== user.id);
    
    for (const member of otherMembers) {
      await createPeerConnection(member.user_id);
    }
  };

  const stopTransmitting = async () => {
    if (!localStream.current || !transmitting) return;
    
    // Mute audio immediately
    localStream.current.getAudioTracks().forEach(track => track.enabled = false);

    // Notify end of transmission
    try {
      await base44.functions.invoke('rtcSignaling', {
        action: 'end_transmission',
        channelId: selectedChannel.id
      });
    } catch (e) {
      console.error('End transmission error:', e);
    }

    // Close all peer connections
    Object.values(peerConnections.current).forEach(pc => pc.close());
    peerConnections.current = {};
    
    // Keep transmitting state as false
    setTransmitting(false);
  };

  const createPeerConnection = async (targetUserId) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current[targetUserId] = pc;

    // Add local stream
    localStream.current.getTracks().forEach(track => {
      pc.addTrack(track, localStream.current);
    });

    // Handle ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await base44.functions.invoke('rtcSignaling', {
          action: 'send_candidate',
          targetUserId: targetUserId,
          candidate: event.candidate,
          channelId: selectedChannel.id
        });
      }
    };

    // Create and send offer
    const offer = await pc.createOffer({ offerToReceiveAudio: false });
    await pc.setLocalDescription(offer);

    await base44.functions.invoke('rtcSignaling', {
      action: 'send_offer',
      targetUserId: targetUserId,
      offer: offer,
      channelId: selectedChannel.id,
      transmitterId: user.id,
      transmitterName: user.full_name
    });
  };

  const startPolling = () => {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
    }
    
    pollingInterval.current = setInterval(async () => {
      try {
        const { data } = await base44.functions.invoke('rtcSignaling', {
          action: 'poll_messages'
        });

        if (data?.messages && data.messages.length > 0) {
          for (const message of data.messages) {
            if (message.channelId === selectedChannel?.id) {
              await handleSignalingMessage(message);
            }
          }
        }
      } catch (error) {
        // Silent
      }
    }, 500);
  };

  const handleSignalingMessage = async (message) => {
    try {
      if (message.type === 'offer' && message.from !== user.id) {
        // Someone is transmitting to us
        const pc = new RTCPeerConnection(rtcConfig);
        peerConnections.current[message.from] = pc;

        // Handle incoming audio
        pc.ontrack = (event) => {
          const audio = new Audio();
          audio.srcObject = event.streams[0];
          audio.autoplay = true;
          remoteAudios.current[message.from] = audio;
        };

        // Handle ICE candidates
        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            await base44.functions.invoke('rtcSignaling', {
              action: 'send_candidate',
              targetUserId: message.from,
              candidate: event.candidate,
              channelId: selectedChannel.id
            });
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await base44.functions.invoke('rtcSignaling', {
          action: 'send_answer',
          targetUserId: message.from,
          answer: answer,
          channelId: selectedChannel.id
        });
      } else if (message.type === 'answer') {
        const pc = peerConnections.current[message.from];
        if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        }
      } else if (message.type === 'candidate') {
        const pc = peerConnections.current[message.from];
        if (pc && message.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
          } catch (e) {
            console.warn('ICE candidate error:', e);
          }
        }
      } else if (message.type === 'end_transmission') {
        // Clean up connection
        const pc = peerConnections.current[message.from];
        if (pc) {
          pc.close();
          delete peerConnections.current[message.from];
        }
        const audio = remoteAudios.current[message.from];
        if (audio) {
          audio.pause();
          audio.srcObject = null;
          delete remoteAudios.current[message.from];
        }
      }
    } catch (error) {
      console.error('Signaling error:', error);
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

  const initiateGroupCall = () => {
    if (!selectedChannel) return;
    
    const participants = selectedChannel.members
      .filter(m => m.user_id !== user.id)
      .map(m => ({ id: m.user_id, full_name: m.user_name }));
    
    setActiveGroupCall({
      channel: selectedChannel,
      participants
    });
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
              <h1 className="text-2xl font-bold text-white">Push-to-Talk Radio</h1>
              <p className="text-slate-400 text-sm">Live Voice Communication</p>
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
                            <p className="text-slate-400 text-xs">{u.role_type}</p>
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
                {channels.map(channel => (
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
                    </div>
                    <p className="text-xs opacity-70">
                      {channel.members.length} member{channel.members.length !== 1 ? 's' : ''}
                    </p>
                  </button>
                ))}
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

          {/* PTT Control Area */}
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
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-slate-400 text-sm">
                          {selectedChannel.members.map(m => m.user_name).join(", ")}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={initiateGroupCall}
                          className="border-emerald-600 text-emerald-400 hover:bg-emerald-600/10 ml-2"
                        >
                          <Phone className="w-3 h-3 mr-1" />
                          Group Call
                        </Button>
                      </div>
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
                <CardContent className="p-8">
                  <div className="flex flex-col items-center justify-center min-h-[400px]">
                    <div className="text-center mb-8">
                      <Radio className="w-20 h-20 text-sky-400 mx-auto mb-4" />
                      <h3 className="text-xl font-bold text-white mb-2">
                        {transmitting ? "TRANSMITTING" : "Ready to Transmit"}
                      </h3>
                      <p className="text-slate-400">
                        {transmitting 
                          ? "Broadcasting to all channel members" 
                          : "Press and hold the button to talk"}
                      </p>
                    </div>

                    {/* PTT Button */}
                    <div className="text-center">
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
                          if (!transmitting) startTransmitting();
                        }}
                        onMouseUp={(e) => {
                          e.preventDefault();
                          if (transmitting) stopTransmitting();
                        }}
                        onMouseLeave={(e) => {
                          if (transmitting) stopTransmitting();
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!transmitting) startTransmitting();
                        }}
                        onTouchEnd={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (transmitting) stopTransmitting();
                        }}
                        onTouchCancel={(e) => {
                          e.preventDefault();
                          if (transmitting) stopTransmitting();
                        }}
                        className={`w-32 h-32 rounded-full flex items-center justify-center transition-all select-none ${
                          transmitting
                            ? "bg-rose-500 scale-110 shadow-2xl shadow-rose-500/50"
                            : "bg-sky-500 hover:bg-sky-600 shadow-lg"
                        }`}
                        style={{ 
                          WebkitTouchCallout: 'none', 
                          WebkitUserSelect: 'none',
                          touchAction: 'none',
                          userSelect: 'none'
                        }}
                      >
                        <Mic className="w-16 h-16 text-white" />
                      </button>
                      {transmitting && (
                        <div className="mt-4">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse" />
                            <p className="text-rose-400 font-bold text-lg">ON AIR</p>
                          </div>
                        </div>
                      )}
                      {!transmitting && (
                        <p className="text-slate-400 text-sm mt-4">
                          Press & Hold to Talk
                        </p>
                      )}
                    </div>

                    <div className="mt-8 text-center">
                      <Badge variant="outline" className="border-slate-600 text-slate-400">
                        {selectedChannel.members.length} Active Members
                      </Badge>
                    </div>
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

      {/* Alert Handler */}
      {selectedChannel && (
        <PTTAlertHandler
          messages={[]}
          user={user}
          selectedChannel={selectedChannel}
        />
      )}

      {/* Group Voice Call */}
      {activeGroupCall && (
        <RealtimeVoiceCall
          participants={activeGroupCall.participants}
          isGroupCall={true}
          onClose={() => setActiveGroupCall(null)}
        />
      )}
    </div>
  );
}