import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Pause,
  Download,
  Trash2,
  Search,
  Mic,
  Users,
  User,
  Calendar,
  Clock,
  Loader2,
  Filter
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import moment from "moment";

export default function CallRecordings() {
  const [user, setUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [playingRecording, setPlayingRecording] = useState(null);
  const [audioElement, setAudioElement] = useState(null);
  const [filterType, setFilterType] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  React.useEffect(() => {
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

  const { data: recordings = [], isLoading, refetch } = useQuery({
    queryKey: ["callRecordings"],
    queryFn: async () => {
      if (user?.role === "admin" || user?.role_type === "admin" || user?.role_type === "dispatcher") {
        return await base44.entities.CallHistory.filter({ has_recording: true }, "-created_date");
      } else {
        const userRecordings = await base44.entities.CallHistory.filter({
          has_recording: true
        }, "-created_date");
        
        return userRecordings.filter(
          r => r.caller_id === user?.id || r.receiver_id === user?.id
        );
      }
    },
    enabled: !!user
  });

  const handlePlayPause = (recording) => {
    if (playingRecording?.id === recording.id) {
      if (audioElement) {
        audioElement.pause();
        setPlayingRecording(null);
      }
    } else {
      if (audioElement) {
        audioElement.pause();
      }
      const audio = new Audio(recording.recording_url);
      audio.play();
      audio.onended = () => setPlayingRecording(null);
      setAudioElement(audio);
      setPlayingRecording(recording);
    }
  };

  const handleDownload = async (recording) => {
    try {
      const response = await fetch(recording.recording_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `call_${recording.call_id}_${moment(recording.started_at).format("YYYY-MM-DD_HH-mm")}.webm`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error("Download failed:", error);
      alert("Failed to download recording");
    }
  };

  const handleDelete = async (recording) => {
    if (!confirm("Are you sure you want to delete this recording? This cannot be undone.")) {
      return;
    }

    try {
      await base44.entities.CallHistory.update(recording.id, {
        has_recording: false,
        recording_url: null
      });
      refetch();
    } catch (error) {
      console.error("Failed to delete recording:", error);
      alert("Failed to delete recording");
    }
  };

  const filteredRecordings = recordings.filter(recording => {
    const matchesSearch = !searchQuery || 
      recording.caller_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      recording.receiver_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      recording.call_id?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = filterType === "all" || recording.call_type === filterType;

    let matchesDate = true;
    if (dateFilter !== "all") {
      const recordingDate = moment(recording.started_at);
      const now = moment();
      if (dateFilter === "today") {
        matchesDate = recordingDate.isSame(now, "day");
      } else if (dateFilter === "week") {
        matchesDate = recordingDate.isAfter(now.subtract(7, "days"));
      } else if (dateFilter === "month") {
        matchesDate = recordingDate.isAfter(now.subtract(30, "days"));
      }
    }

    return matchesSearch && matchesType && matchesDate;
  });

  const totalSize = recordings.length;
  const totalDuration = recordings.reduce((sum, r) => sum + (r.duration_seconds || 0), 0);

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-rose-500 rounded-full flex items-center justify-center">
              <Mic className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Call Recordings</h1>
              <p className="text-slate-400 text-sm">
                {totalSize} recordings • {Math.floor(totalDuration / 60)} minutes total
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm">Total Recordings</p>
                    <p className="text-2xl font-bold text-white">{totalSize}</p>
                  </div>
                  <Mic className="w-8 h-8 text-rose-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm">Total Duration</p>
                    <p className="text-2xl font-bold text-white">
                      {Math.floor(totalDuration / 60)}m {totalDuration % 60}s
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-sky-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-slate-400 text-sm">This Month</p>
                    <p className="text-2xl font-bold text-white">
                      {recordings.filter(r => moment(r.started_at).isAfter(moment().subtract(30, "days"))).length}
                    </p>
                  </div>
                  <Calendar className="w-8 h-8 text-emerald-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
              <Input
                placeholder="Search by caller, receiver, or call ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-full md:w-40 bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="direct">Direct Calls</SelectItem>
                <SelectItem value="group">Group Calls</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="w-full md:w-40 bg-slate-800 border-slate-700 text-white">
                <SelectValue placeholder="Date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">Last 7 Days</SelectItem>
                <SelectItem value="month">Last 30 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          </div>
        ) : filteredRecordings.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-12 text-center">
              <Mic className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">
                {searchQuery ? "No recordings found matching your search" : "No call recordings available"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredRecordings.map((recording) => (
              <Card key={recording.id} className="bg-slate-800/50 border-slate-700 hover:border-sky-500/50 transition-all">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        recording.call_type === "group" ? "bg-purple-500" : "bg-sky-500"
                      }`}>
                        {recording.call_type === "group" ? (
                          <Users className="w-6 h-6 text-white" />
                        ) : (
                          <User className="w-6 h-6 text-white" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-white font-semibold">
                            {recording.call_type === "group" ? "Group Call" : recording.caller_name}
                          </h3>
                          <Badge variant="outline" className="border-slate-600 text-slate-300">
                            {recording.call_type}
                          </Badge>
                          <Badge className={
                            recording.status === "completed" ? "bg-emerald-500" :
                            recording.status === "missed" ? "bg-amber-500" :
                            recording.status === "declined" ? "bg-rose-500" :
                            "bg-slate-500"
                          }>
                            {recording.status}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400">
                          {recording.call_type === "direct" && recording.receiver_name && (
                            <span>To: {recording.receiver_name}</span>
                          )}
                          {recording.call_type === "group" && recording.participants && (
                            <span>{recording.participants.length} participants</span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {moment(recording.started_at).format("MMM D, YYYY")}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {moment(recording.started_at).format("h:mm A")}
                          </span>
                          <span>
                            Duration: {Math.floor(recording.duration_seconds / 60)}:{(recording.duration_seconds % 60).toString().padStart(2, "0")}
                          </span>
                        </div>
                        {recording.call_type === "group" && recording.participants && (
                          <div className="mt-2 text-xs text-slate-500">
                            Participants: {recording.participants.map(p => p.user_name).join(", ")}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() => handlePlayPause(recording)}
                        variant="outline"
                        size="sm"
                        className="border-slate-600 text-slate-300 hover:bg-slate-700"
                      >
                        {playingRecording?.id === recording.id ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        onClick={() => handleDownload(recording)}
                        variant="outline"
                        size="sm"
                        className="border-slate-600 text-slate-300 hover:bg-slate-700"
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      {(user?.role === "admin" || user?.role_type === "admin") && (
                        <Button
                          onClick={() => handleDelete(recording)}
                          variant="outline"
                          size="sm"
                          className="border-rose-600 text-rose-400 hover:bg-rose-900/20"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
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