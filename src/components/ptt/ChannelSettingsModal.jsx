import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Settings, Archive, Trash2, UserPlus, Bell, BellOff, Edit2, Loader2 } from "lucide-react";

export default function ChannelSettingsModal({ channel, user, open, onClose }) {
  const [editMode, setEditMode] = useState(false);
  const [channelName, setChannelName] = useState(channel?.name || "");
  const queryClient = useQueryClient();

  const archiveMutation = useMutation({
    mutationFn: async () => {
      return await base44.entities.PTTChannel.update(channel.id, {
        is_archived: !channel.is_archived,
        archived_at: !channel.is_archived ? new Date().toISOString() : null,
        archived_by: !channel.is_archived ? user.id : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["pttChannels"]);
      onClose();
    }
  });

  const updateNameMutation = useMutation({
    mutationFn: async () => {
      return await base44.entities.PTTChannel.update(channel.id, {
        name: channelName
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["pttChannels"]);
      setEditMode(false);
    }
  });

  const toggleNotificationsMutation = useMutation({
    mutationFn: async (memberId) => {
      const updatedMembers = channel.members.map(m => {
        if (m.user_id === memberId) {
          return { ...m, notifications_enabled: !m.notifications_enabled };
        }
        return m;
      });

      return await base44.entities.PTTChannel.update(channel.id, {
        members: updatedMembers
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["pttChannels"]);
    }
  });

  const deleteChannelMutation = useMutation({
    mutationFn: async () => {
      return await base44.entities.PTTChannel.delete(channel.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(["pttChannels"]);
      onClose();
    }
  });

  if (!channel) return null;

  const isCreator = channel.created_by === user.id;
  const currentMember = channel.members.find(m => m.user_id === user.id);
  const notificationsEnabled = currentMember?.notifications_enabled !== false;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-800 border-slate-700 max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Channel Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Channel Name */}
          <div>
            <label className="text-sm text-slate-300 block mb-2">Channel Name</label>
            {editMode && isCreator ? (
              <div className="flex gap-2">
                <Input
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white"
                />
                <Button
                  size="sm"
                  onClick={() => updateNameMutation.mutate()}
                  disabled={!channelName || updateNameMutation.isPending}
                  className="bg-sky-500 hover:bg-sky-600"
                >
                  {updateNameMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditMode(false);
                    setChannelName(channel.name);
                  }}
                  className="border-slate-600 text-slate-300"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-white">{channel.name}</p>
                {isCreator && channel.type === "group" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditMode(true)}
                    className="text-slate-400 hover:text-white"
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Channel Type */}
          <div>
            <label className="text-sm text-slate-300 block mb-2">Type</label>
            <Badge className={channel.type === "direct" ? "bg-sky-500" : "bg-purple-500"}>
              {channel.type === "direct" ? "Direct Chat" : "Group Chat"}
            </Badge>
          </div>

          {/* Members */}
          <div>
            <label className="text-sm text-slate-300 block mb-2">
              Members ({channel.members.length})
            </label>
            <div className="space-y-2 max-h-48 overflow-y-auto bg-slate-900 rounded-lg p-3 border border-slate-700">
              {channel.members.map(member => (
                <div key={member.user_id} className="flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm">{member.user_name}</p>
                    <p className="text-slate-400 text-xs">{member.role}</p>
                  </div>
                  {member.user_id === user.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleNotificationsMutation.mutate(member.user_id)}
                      className="text-slate-400 hover:text-white"
                    >
                      {member.notifications_enabled !== false ? (
                        <Bell className="w-4 h-4 text-sky-400" />
                      ) : (
                        <BellOff className="w-4 h-4 text-slate-500" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* My Notifications */}
          <div>
            <label className="text-sm text-slate-300 block mb-2">My Notifications</label>
            <Button
              onClick={() => toggleNotificationsMutation.mutate(user.id)}
              disabled={toggleNotificationsMutation.isPending}
              variant="outline"
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              {notificationsEnabled ? (
                <>
                  <Bell className="w-4 h-4 mr-2 text-sky-400" />
                  Notifications On
                </>
              ) : (
                <>
                  <BellOff className="w-4 h-4 mr-2" />
                  Notifications Off
                </>
              )}
            </Button>
          </div>

          {/* Archive/Delete Actions */}
          {isCreator && (
            <div className="space-y-2 pt-4 border-t border-slate-700">
              <Button
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                variant="outline"
                className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
              >
                {archiveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Archive className="w-4 h-4 mr-2" />
                )}
                {channel.is_archived ? "Unarchive Channel" : "Archive Channel"}
              </Button>

              <Button
                onClick={() => {
                  if (confirm("Are you sure you want to delete this channel? This cannot be undone.")) {
                    deleteChannelMutation.mutate();
                  }
                }}
                disabled={deleteChannelMutation.isPending}
                variant="outline"
                className="w-full border-rose-500 text-rose-400 hover:bg-rose-500/10"
              >
                {deleteChannelMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4 mr-2" />
                )}
                Delete Channel
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}