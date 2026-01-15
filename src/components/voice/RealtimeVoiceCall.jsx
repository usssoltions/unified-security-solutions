import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Users } from "lucide-react";

export default function RealtimeVoiceCall({ 
  targetUser = null, 
  participants = [], 
  isGroupCall = false, 
  onClose, 
  incomingCallId = null 
}) {
  const [callStatus, setCallStatus] = useState(incomingCallId ? 'incoming' : 'initiating');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [connectedParticipants, setConnectedParticipants] = useState([]);

  const peerConnections = useRef({});
  const localStream = useRef(null);
  const remoteAudios = useRef({});
  const callId = useRef(incomingCallId || `call_${Date.now()}_${Math.random()}`);
  const pollingInterval = useRef(null);
  const durationInterval = useRef(null);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  const callParticipants = isGroupCall ? participants : [targetUser];

  useEffect(() => {
    initializeCall();
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (callStatus === 'connected') {
      durationInterval.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
    };
  }, [callStatus]);

  const initializeCall = async () => {
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1
        },
        video: false
      });

      if (incomingCallId) {
        startPolling();
      } else {
        await initiateOutgoingCall();
      }
    } catch (error) {
      console.error('Error initializing call:', error);
      setCallStatus('error');
    }
  };

  const initiateOutgoingCall = async () => {
    try {
      setCallStatus('calling');

      // Notify all participants
      for (const participant of callParticipants) {
        await base44.functions.invoke('rtcSignaling', {
          action: 'initiate_call',
          targetUserId: participant.id,
          callId: callId.current,
          isGroupCall: isGroupCall
        });
      }

      // Start creating peer connections
      for (const participant of callParticipants) {
        await createPeerConnection(participant.id);
      }

      startPolling();
      setCallStatus('connected');
    } catch (error) {
      console.error('Error initiating call:', error);
      setCallStatus('error');
    }
  };

  const answerCall = async () => {
    try {
      setCallStatus('connecting');
      startPolling();
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Error answering call:', error);
      setCallStatus('error');
    }
  };

  const createPeerConnection = async (participantId) => {
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current[participantId] = pc;

    // Add local stream
    localStream.current.getTracks().forEach(track => {
      pc.addTrack(track, localStream.current);
    });

    // Handle incoming tracks
    pc.ontrack = (event) => {
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      remoteAudios.current[participantId] = audio;
      
      setConnectedParticipants(prev => 
        prev.includes(participantId) ? prev : [...prev, participantId]
      );
    };

    // Handle ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        await base44.functions.invoke('rtcSignaling', {
          action: 'send_candidate',
          targetUserId: participantId,
          candidate: event.candidate,
          callId: callId.current
        });
      }
    };

    // Handle connection state
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        setConnectedParticipants(prev => 
          prev.includes(participantId) ? prev : [...prev, participantId]
        );
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        setConnectedParticipants(prev => prev.filter(id => id !== participantId));
      }
    };

    // Create offer
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    await base44.functions.invoke('rtcSignaling', {
      action: 'send_offer',
      targetUserId: participantId,
      offer: offer,
      callId: callId.current
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
            if (message.callId === callId.current) {
              await handleSignalingMessage(message);
            }
          }
        }
      } catch (error) {
        // Silent
      }
    }, 300);
  };

  const handleSignalingMessage = async (message) => {
    try {
      const participantId = message.from;

      if (message.type === 'offer' && incomingCallId) {
        if (!peerConnections.current[participantId]) {
          const pc = new RTCPeerConnection(rtcConfig);
          peerConnections.current[participantId] = pc;

          localStream.current.getTracks().forEach(track => {
            pc.addTrack(track, localStream.current);
          });

          pc.ontrack = (event) => {
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            remoteAudios.current[participantId] = audio;
            
            setConnectedParticipants(prev => 
              prev.includes(participantId) ? prev : [...prev, participantId]
            );
          };

          pc.onicecandidate = async (event) => {
            if (event.candidate) {
              await base44.functions.invoke('rtcSignaling', {
                action: 'send_candidate',
                targetUserId: participantId,
                candidate: event.candidate,
                callId: callId.current
              });
            }
          };

          await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          await base44.functions.invoke('rtcSignaling', {
            action: 'send_answer',
            targetUserId: participantId,
            answer: answer,
            callId: callId.current
          });
        }
      } else if (message.type === 'answer') {
        const pc = peerConnections.current[participantId];
        if (pc && pc.signalingState !== 'stable') {
          await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        }
      } else if (message.type === 'candidate') {
        const pc = peerConnections.current[participantId];
        if (pc && message.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
          } catch (e) {
            console.warn('ICE candidate error:', e);
          }
        }
      } else if (message.type === 'call_ended') {
        endCall();
      }
    } catch (error) {
      console.error('Error handling signaling:', error);
    }
  };

  const toggleMute = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  const toggleSpeaker = () => {
    Object.values(remoteAudios.current).forEach(audio => {
      audio.muted = isSpeakerOn;
    });
    setIsSpeakerOn(!isSpeakerOn);
  };

  const endCall = async () => {
    try {
      await base44.functions.invoke('rtcSignaling', {
        action: 'end_call',
        callId: callId.current
      });
    } catch (error) {
      console.error('Error ending call:', error);
    } finally {
      cleanup();
      onClose();
    }
  };

  const cleanup = () => {
    if (pollingInterval.current) {
      clearInterval(pollingInterval.current);
    }
    if (durationInterval.current) {
      clearInterval(durationInterval.current);
    }
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
    }
    Object.values(peerConnections.current).forEach(pc => pc.close());
    Object.values(remoteAudios.current).forEach(audio => {
      audio.pause();
      audio.srcObject = null;
    });
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="bg-slate-800 border-slate-700 w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-white text-center">
            {isGroupCall && <Users className="w-6 h-6 inline mr-2" />}
            {callStatus === 'incoming' && 'Incoming Call'}
            {callStatus === 'initiating' && 'Initiating Call...'}
            {callStatus === 'calling' && 'Calling...'}
            {callStatus === 'connecting' && 'Connecting...'}
            {callStatus === 'connected' && (isGroupCall ? 'Group Call' : 'Call In Progress')}
            {callStatus === 'error' && 'Call Failed'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {isGroupCall ? (
            <div className="text-center">
              <div className="flex flex-wrap justify-center gap-3 mb-4">
                {callParticipants.map(participant => (
                  <div key={participant.id} className="text-center">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-1 ${
                      connectedParticipants.includes(participant.id) 
                        ? 'bg-emerald-500' 
                        : 'bg-slate-600'
                    }`}>
                      <span className="text-white text-xl font-bold">
                        {participant.full_name?.[0]?.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-white text-xs">{participant.full_name?.split(' ')[0]}</p>
                  </div>
                ))}
              </div>
              <p className="text-slate-400 text-sm">
                {connectedParticipants.length} / {callParticipants.length} connected
              </p>
              {callStatus === 'connected' && (
                <p className="text-emerald-400 text-sm mt-2">{formatDuration(callDuration)}</p>
              )}
            </div>
          ) : targetUser && (
            <div className="text-center">
              <div className="w-24 h-24 bg-sky-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-white text-3xl font-bold">
                  {targetUser.full_name?.[0]?.toUpperCase()}
                </span>
              </div>
              <h3 className="text-xl font-semibold text-white">{targetUser.full_name}</h3>
              <p className="text-slate-400 text-sm">{targetUser.badge_number || targetUser.email}</p>
              {callStatus === 'connected' && (
                <p className="text-emerald-400 text-sm mt-2">{formatDuration(callDuration)}</p>
              )}
            </div>
          )}

          {callStatus === 'incoming' && (
            <div className="flex gap-3 justify-center">
              <Button
                onClick={endCall}
                variant="destructive"
                size="lg"
                className="rounded-full w-16 h-16"
              >
                <PhoneOff className="w-6 h-6" />
              </Button>
              <Button
                onClick={answerCall}
                className="bg-emerald-500 hover:bg-emerald-600 rounded-full w-16 h-16"
                size="lg"
              >
                <Phone className="w-6 h-6" />
              </Button>
            </div>
          )}

          {(callStatus === 'connected' || callStatus === 'calling' || callStatus === 'connecting') && (
            <div className="flex gap-4 justify-center">
              <Button
                onClick={toggleMute}
                variant={isMuted ? "destructive" : "outline"}
                size="lg"
                className="rounded-full w-14 h-14"
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>

              <Button
                onClick={toggleSpeaker}
                variant={!isSpeakerOn ? "destructive" : "outline"}
                size="lg"
                className="rounded-full w-14 h-14"
              >
                {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </Button>

              <Button
                onClick={endCall}
                variant="destructive"
                size="lg"
                className="rounded-full w-14 h-14"
              >
                <PhoneOff className="w-5 h-5" />
              </Button>
            </div>
          )}

          {callStatus === 'error' && (
            <div className="text-center">
              <p className="text-rose-400 mb-4">Unable to connect call</p>
              <Button onClick={onClose} variant="outline" className="border-slate-600">
                Close
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}