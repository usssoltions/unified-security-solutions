import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Phone, Search, Users, User, Loader2, Radio, MessageSquare } from "lucide-react";
import RealtimeVoiceCall from "@/components/voice/RealtimeVoiceCall";
import { AvailabilityBadge } from "@/components/ptt/AvailabilitySelector";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";

export default function Contacts() {
  const [currentUser, setCurrentUser] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCall, setActiveCall] = useState(null);
  const [incomingCall, setIncomingCall] = useState(null);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [isGroupCallMode, setIsGroupCallMode] = useState(false);
  const navigate = useNavigate();
  const ringtoneRef = React.useRef(null);

  useEffect(() => {
    loadUser();

    // Listen for incoming call events from service worker
    const handleIncomingCallEvent = (event) => {
      console.log('📞 Incoming call event received:', event.detail);
      const { callId, callerName, autoAnswer } = event.detail;
      
      setIncomingCall({
        callId: callId,
        caller: {
          full_name: callerName,
          badge_number: callerName
        },
        autoAnswer: autoAnswer
      });
    };

    window.addEventListener('incoming-call', handleIncomingCallEvent);
    
    return () => {
      window.removeEventListener('incoming-call', handleIncomingCallEvent);
    };
  }, []);

  const loadUser = async () => {
    try {
      const user = await base44.auth.me();
      setCurrentUser(user);
    } catch (error) {
      console.error("Failed to load user:", error);
    }
  };

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ["allUsers"],
    queryFn: async () => {
      try {
        // For guards, use backend function. For admins, use direct entity access
        if (currentUser.role_type === 'guard') {
          const { data } = await base44.functions.invoke('getAllUsers');
          return data.users || [];
        } else {
          const users = await base44.entities.User.list();
          return users;
        }
      } catch (error) {
        console.error("Failed to fetch users:", error);
        // Fallback to backend function
        try {
          const { data } = await base44.functions.invoke('getAllUsers');
          return data.users || [];
        } catch {
          return [];
        }
      }
    },
    enabled: !!currentUser,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    staleTime: 30000,
    cacheTime: 60000
  });

  // Initialize ringtone
  useEffect(() => {
    ringtoneRef.current = new Audio();
    ringtoneRef.current.loop = true;
    return () => {
      if (ringtoneRef.current) {
        ringtoneRef.current.pause();
        ringtoneRef.current = null;
      }
    };
  }, []);



  // Poll for incoming calls - CRITICAL FOR RECEIVING CALLS
  useEffect(() => {
    if (!currentUser) return;

    console.log('👂 Started listening for incoming calls...');

    const checkIncomingCalls = setInterval(async () => {
      try {
        const notifications = await base44.entities.Notification.filter({
          recipient_id: currentUser.id,
          related_entity: 'voice_call',
          read: false
        });

        if (notifications.length > 0) {
          console.log('📞 INCOMING CALL DETECTED!', notifications[0]);
          const callNotification = notifications[0];
          const callerName = callNotification.message.replace(' is calling you', '');
          
          setIncomingCall({
            callId: callNotification.related_id,
            caller: { 
              id: callNotification.related_id.split('_')[2],
              full_name: callerName,
              badge_number: callerName
            }
          });
          
          await base44.entities.Notification.update(callNotification.id, { read: true }).catch(() => {});
        }
      } catch (error) {
        // Silent fail - non-critical background polling
      }
    }, 2000); // Check every 2 seconds (reduced frequency)

    return () => clearInterval(checkIncomingCalls);
  }, [currentUser]);

  // Handle incoming call from push notification (when app was closed)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const incomingCallId = urlParams.get('incoming_call');
    
    if (incomingCallId && currentUser) {
      // Fetch call details from notifications
      base44.entities.Notification.filter({
        recipient_id: currentUser.id,
        related_id: incomingCallId,
        related_entity: 'voice_call'
      }).then(notifications => {
        if (notifications.length > 0) {
          const callNotification = notifications[0];
          const callerName = callNotification.message.replace(' is calling you', '');
          
          setIncomingCall({
            callId: incomingCallId,
            caller: {
              id: incomingCallId.split('_')[2],
              full_name: callerName,
              badge_number: callerName
            }
          });
          
          // Clear URL parameter
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      }).catch(() => {
        // Silent fail - couldn't fetch call details
      });
    }
  }, [currentUser]);

  const filteredUsers = allUsers
    .filter(u => u.id !== currentUser?.id)
    .filter(u => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        u.full_name?.toLowerCase().includes(query) ||
        u.email?.toLowerCase().includes(query) ||
        u.badge_number?.toLowerCase().includes(query) ||
        u.role_type?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      // Online users first
      if (a.ptt_availability === 'available' && b.ptt_availability !== 'available') return -1;
      if (b.ptt_availability === 'available' && a.ptt_availability !== 'available') return 1;
      return a.full_name?.localeCompare(b.full_name || '') || 0;
    });

  const initiateCall = (user) => {
    setActiveCall(user);
  };

  const toggleUserSelection = (userId) => {
    setSelectedUsers(prev => 
      prev.includes(userId) 
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    );
  };

  const startGroupCall = () => {
    if (selectedUsers.length === 0) return;
    
    const participants = allUsers.filter(u => selectedUsers.includes(u.id));
    setActiveCall({
      isGroupCall: true,
      participants
    });
    setIsGroupCallMode(false);
    setSelectedUsers([]);
  };

  const getRoleBadgeColor = (role) => {
    const colors = {
      admin: "bg-rose-500",
      dispatcher: "bg-purple-500",
      supervisor: "bg-blue-500",
      guard: "bg-emerald-500",
      client: "bg-amber-500"
    };
    return colors[role] || "bg-slate-500";
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
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-sky-500 rounded-full flex items-center justify-center">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">Contacts</h1>
                <p className="text-slate-400 text-sm">Call or message team members</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isGroupCallMode && selectedUsers.length > 0 && (
                <Button
                  onClick={startGroupCall}
                  className="bg-emerald-500 hover:bg-emerald-600"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  Call {selectedUsers.length} Selected
                </Button>
              )}
              <Button
                onClick={() => {
                  setIsGroupCallMode(!isGroupCallMode);
                  setSelectedUsers([]);
                }}
                variant={isGroupCallMode ? "default" : "outline"}
                className={isGroupCallMode ? "bg-sky-500" : "border-slate-600 text-slate-300"}
              >
                <Users className="w-4 h-4 mr-2" />
                {isGroupCallMode ? "Cancel" : "Group Call"}
              </Button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <Input
              placeholder="Search by name, email, badge number, or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-slate-800 border-slate-700 text-white"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <Card className="bg-slate-800/50 border-slate-700">
            <CardContent className="py-12 text-center">
              <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">
                {searchQuery ? "No users found matching your search" : "No other users available"}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsers.map((user) => (
              <Card 
                key={user.id} 
                className={`bg-slate-800/50 border-slate-700 hover:border-sky-500/50 transition-all ${
                  selectedUsers.includes(user.id) ? 'ring-2 ring-sky-500' : ''
                }`}
                onClick={() => isGroupCallMode && toggleUserSelection(user.id)}
                style={{ cursor: isGroupCallMode ? 'pointer' : 'default' }}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      {isGroupCallMode && (
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(user.id)}
                          onChange={() => toggleUserSelection(user.id)}
                          className="w-5 h-5 rounded border-slate-600"
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <div className="w-12 h-12 bg-sky-500 rounded-full flex items-center justify-center">
                        <span className="text-white font-bold text-lg">
                          {user.full_name?.[0]?.toUpperCase() || "U"}
                        </span>
                      </div>
                      <div>
                        <CardTitle className="text-white text-base mb-1">
                          {user.full_name}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge className={`${getRoleBadgeColor(user.role_type)} text-white text-xs`}>
                            {user.role_type}
                          </Badge>
                          <AvailabilityBadge availability={user.ptt_availability} />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 mb-4">
                    {user.badge_number && (
                      <p className="text-slate-400 text-sm">
                        <User className="w-3 h-3 inline mr-1" />
                        Badge: {user.badge_number}
                      </p>
                    )}
                    <p className="text-slate-400 text-sm truncate">
                      {user.email}
                    </p>
                  </div>
                  
                  {!isGroupCallMode && (
                    <div className="flex gap-2">
                      <Button
                        onClick={() => initiateCall(user)}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600"
                        size="sm"
                      >
                        <Phone className="w-4 h-4 mr-2" />
                        Call
                      </Button>
                      <Button
                        onClick={() => navigate(createPageUrl("PTT"))}
                        variant="outline"
                        className="border-slate-600 text-slate-300 hover:bg-slate-700"
                        size="sm"
                      >
                        <Radio className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {activeCall && !activeCall.isGroupCall && (
        <RealtimeVoiceCall
          targetUser={activeCall}
          onClose={() => setActiveCall(null)}
        />
      )}

      {activeCall && activeCall.isGroupCall && (
        <RealtimeVoiceCall
          participants={activeCall.participants}
          isGroupCall={true}
          onClose={() => setActiveCall(null)}
        />
      )}

      {incomingCall && (
        <RealtimeVoiceCall
          targetUser={incomingCall.caller}
          incomingCallId={incomingCall.callId}
          onClose={() => setIncomingCall(null)}
        />
      )}
    </div>
  );
}