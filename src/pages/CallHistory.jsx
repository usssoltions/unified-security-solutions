import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, PhoneIncoming, PhoneOutgoing, Users, Clock, Calendar, Search, Loader2, Play, Pause, Download, Filter } from "lucide-react";
import { format } from "date-fns";

export default function CallHistory() {
  const [currentUser, setCurrentUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [recordingFilter, setRecordingFilter] = useState("all");
  const [playingAudio, setPlayingAudio] = useState(null);
  const audioRef = React.useRef(null);

  React.useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const user = await base44.auth.me();
      setCurrentUser(user);
    } catch (error) {
      console.error("Failed to load user:", error);
    }
  };

  const { data: callHistory = [], isLoading } = useQuery({
    queryKey: ["callHistory", currentUser?.id],
    queryFn: async () => {
      if (currentUser?.role_type === 'admin' || currentUser?.role_type === 'dispatcher') {
        // Admins see all calls
        return await base44.entities.CallHistory.list('-created_date', 100);
      } else {
        // Guards see only their calls
        const asCaller = await base44.entities.CallHistory.filter({
          caller_id: currentUser?.id
        }, '-created_date', 50);
        const asReceiver = await base44.entities.CallHistory.filter({
          receiver_id: currentUser?.id
        }, '-created_date', 50);
        
        // Merge and sort by date
        const allCalls = [...asCaller, ...asReceiver];
        return allCalls.sort((a, b) => 
          new Date(b.created_date) - new Date(a.created_date)
        );
      }
    },
    enabled: !!currentUser
  });

  const filteredCalls = callHistory.filter(call => {
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = (
        call.caller_name?.toLowerCase().includes(query) ||
        call.receiver_name?.toLowerCase().includes(query) ||
        call.participants?.some(p => p.user_name?.toLowerCase().includes(query))
      );
      if (!matchesSearch) return false;
    }
    
    // Status filter
    if (statusFilter !== "all" && call.status !== statusFilter) {
      return false;
    }
    
    // Recording filter
    if (recordingFilter === "with_recording" && !call.has_recording) {
      return false;
    }
    if (recordingFilter === "without_recording" && call.has_recording) {
      return false;
    }
    
    return true;
  });

  const handlePlayRecording = (call) => {
    if (playingAudio === call.id) {
      audioRef.current?.pause();
      setPlayingAudio(null);
    } else {
      if (audioRef.current) {
        audioRef.current.src = call.recording_url;
        audioRef.current.play();
        setPlayingAudio(call.id);
      }
    }
  };

  const handleDownloadRecording = (call) => {
    const a = document.createElement('a');
    a.href = call.recording_url;
    a.download = `call_recording_${format(new Date(call.created_date), 'yyyy-MM-dd_HH-mm')}.webm`;
    a.click();
  };

  React.useEffect(() => {
    if (audioRef.current) {
      audioRef.current.onended = () => setPlayingAudio(null);
    }
  }, []);

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusColor = (status) => {
    const colors = {
      completed: 'bg-emerald-500',
      missed: 'bg-rose-500',
      declined: 'bg-amber-500',
      failed: 'bg-slate-500'
    };
    return colors[status] || 'bg-slate-500';
  };

  const isIncomingCall = (call) => {
    return call.receiver_id === currentUser?.id;
  };

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-sky-500 rounded-full flex items-center justify-center">
              <Phone className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Call History</h1>
              <p className="text-slate-400 text-sm">View your past voice calls</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="flex gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="missed">Missed</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>

              <Select value={recordingFilter} onValueChange={setRecordingFilter}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white">
                  <SelectValue placeholder="Filter by recording" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Calls</SelectItem>
                  <SelectItem value="with_recording">With Recording</SelectItem>
                  <SelectItem value="without_recording">Without Recording</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <audio ref={audioRef} className="hidden" />

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          </div>
        ) : filteredCalls.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-12 text-center">
              <Phone className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">
                {searchQuery ? "No calls found matching your search" : "No call history yet"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredCalls.map((call) => (
              <Card key={call.id} className="bg-slate-800/50 border-slate-700 hover:border-sky-500/50 transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        call.call_type === 'group' ? 'bg-purple-500' :
                        isIncomingCall(call) ? 'bg-emerald-500' : 'bg-sky-500'
                      }`}>
                        {call.call_type === 'group' ? (
                          <Users className="w-5 h-5 text-white" />
                        ) : isIncomingCall(call) ? (
                          <PhoneIncoming className="w-5 h-5 text-white" />
                        ) : (
                          <PhoneOutgoing className="w-5 h-5 text-white" />
                        )}
                      </div>

                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-1">
                          <div>
                            {call.call_type === 'group' ? (
                              <h3 className="text-white font-semibold">Group Call</h3>
                            ) : (
                              <h3 className="text-white font-semibold">
                                {isIncomingCall(call) ? call.caller_name : call.receiver_name}
                              </h3>
                            )}
                            <p className="text-slate-400 text-sm">
                              {isIncomingCall(call) ? 'Incoming' : 'Outgoing'} • {call.call_type}
                            </p>
                          </div>
                          <Badge className={`${getStatusColor(call.status)} text-white text-xs`}>
                            {call.status}
                          </Badge>
                        </div>

                        {call.call_type === 'group' && call.participants && (
                          <div className="text-slate-400 text-sm mb-2">
                            Participants: {call.participants.map(p => p.user_name).join(', ')}
                          </div>
                        )}

                        <div className="flex items-center gap-4 text-slate-400 text-sm flex-wrap">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{formatDuration(call.duration_seconds)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            <span>
                              {call.started_at 
                                ? format(new Date(call.started_at), 'MMM d, yyyy h:mm a')
                                : format(new Date(call.created_date), 'MMM d, yyyy h:mm a')
                              }
                            </span>
                          </div>
                        </div>

                        {call.has_recording && call.recording_url && (
                          <div className="flex items-center gap-2 mt-3">
                            <Button
                              onClick={() => handlePlayRecording(call)}
                              size="sm"
                              variant="outline"
                              className="border-sky-500 text-sky-400 hover:bg-sky-500/10"
                            >
                              {playingAudio === call.id ? (
                                <><Pause className="w-3 h-3 mr-1" /> Pause</>
                              ) : (
                                <><Play className="w-3 h-3 mr-1" /> Play Recording</>
                              )}
                            </Button>
                            <Button
                              onClick={() => handleDownloadRecording(call)}
                              size="sm"
                              variant="ghost"
                              className="text-slate-400 hover:text-white"
                            >
                              <Download className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}