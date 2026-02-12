import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mic, Play, Pause, Download, User, Users, Clock, Calendar } from "lucide-react";
import { format } from "date-fns";

export default function PTTRecordings() {
  const [playingId, setPlayingId] = useState(null);
  const [audioRefs] = useState({});

  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ["pttRecordings"],
    queryFn: () => base44.entities.PTTMessage.list("-created_date", 100)
  });

  const { data: channels = [] } = useQuery({
    queryKey: ["pttChannels"],
    queryFn: () => base44.entities.PTTChannel.list()
  });

  const getChannelName = (channelId) => {
    const channel = channels.find(c => c.id === channelId);
    return channel?.name || "Unknown Channel";
  };

  const togglePlay = (recording) => {
    if (!recording.audio_url) return;

    if (playingId === recording.id) {
      // Pause
      audioRefs[recording.id]?.pause();
      setPlayingId(null);
    } else {
      // Stop any currently playing
      if (playingId && audioRefs[playingId]) {
        audioRefs[playingId].pause();
      }

      // Play new
      if (!audioRefs[recording.id]) {
        audioRefs[recording.id] = new Audio(recording.audio_url);
        audioRefs[recording.id].onended = () => setPlayingId(null);
      }
      
      audioRefs[recording.id].play();
      setPlayingId(recording.id);
    }
  };

  const downloadRecording = (recording) => {
    if (!recording.audio_url) return;
    
    const a = document.createElement('a');
    a.href = recording.audio_url;
    a.download = `PTT_${recording.sender_name}_${format(new Date(recording.created_date), 'yyyy-MM-dd_HH-mm')}.webm`;
    a.click();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-sky-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
            <Mic className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">PTT Recordings</h1>
            <p className="text-slate-400">All recorded push-to-talk transmissions</p>
          </div>
        </div>

        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader>
            <CardTitle className="text-white">
              Recordings ({recordings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recordings.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <Mic className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>No PTT recordings yet</p>
              </div>
            ) : (
              recordings.map((recording) => (
                <div key={recording.id} className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {recording.priority === 'urgent' || recording.priority === 'emergency' ? (
                          <Badge className="bg-rose-500">
                            {recording.priority}
                          </Badge>
                        ) : null}
                        <span className="text-white font-medium">{getChannelName(recording.channel_id)}</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                        <div className="flex items-center gap-1">
                          <User className="w-3 h-3" />
                          {recording.sender_name}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {recording.duration_seconds}s
                        </div>
                        <div className="flex items-center gap-1 col-span-2">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(recording.created_date), 'MMM dd, yyyy HH:mm')}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {recording.audio_url && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => togglePlay(recording)}
                            className="border-slate-600"
                          >
                            {playingId === recording.id ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadRecording(recording)}
                            className="border-slate-600"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}