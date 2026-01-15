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
  const ringtoneInterval = useRef(null);
  const audioContext = useRef(null);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ]
  };

  const callParticipants = isGroupCall ? participants : [targetUser];

  useEffect(() => {
    if (incomingCallId) {
      // For incoming calls, start ringing immediately
      startRingtone();
    }
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

  const startRingtone = () => {
    stopRingtone(); // Clear any existing ringtone
    
    try {
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)();
      
      const playRing = () => {
        const oscillator = audioContext.current.createOscillator();
        const gainNode = audioContext.current.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.current.destination);
        
        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.3;
        
        oscillator.start();
        
        setTimeout(() => {
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.current.currentTime + 0.5);
          oscillator.stop(audioContext.current.currentTime + 0.5);
        }, 1000);
      };
      
      // Play immediately
      playRing();
      
      // Continue ringing every 2 seconds
      ringtoneInterval.current = setInterval(playRing, 2000);
      
      // Vibrate if supported
      if ('vibrate' in navigator) {
        navigator.vibrate([300, 200, 300, 200, 300, 200, 300]);
        const vibrateInterval = setInterval(() => {
          navigator.vibrate([300, 200, 300, 200, 300, 200, 300]);
        }, 3000);
        
        setTimeout(() => clearInterval(vibrateInterval), 30000); // Stop after 30s
      }
    } catch (error) {
      console.error('Error starting ringtone:', error);
    }
  };

  const stopRingtone = () => {
    if (ringtoneInterval.current) {
      clearInterval(ringtoneInterval.current);
      ringtoneInterval.current = null;
    }
    if (audioContext.current) {
      audioContext.current.close();
      audioContext.current = null;
    }
  };

  const initializeCall = async () => {
    try {
      // Don't request media access for incoming calls until answered
      if (!incomingCallId) {
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
        await initiateOutgoingCall();
      } else {
        // For incoming calls, just wait for answer
        startPolling();
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
      stopRingtone();
      setCallStatus('connecting');
      
      // Request media access now
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
      
      // Send answer signal
      await base44.functions.invoke('rtcSignaling', {
        action: 'call_answered',
        callId: callId.current
      });
      
      setCallStatus('connected');
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
    stopRingtone();
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
    <div className="fixed inset-0 bg-black/95 backdrop-blur-md z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <Card className="bg-slate-800 border-slate-700 w-full max-w-md shadow-2xl">
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
            <div className="space-y-4">
              <div className="flex gap-4 justify-center items-center">
                <Button
                  onClick={endCall}
                  variant="destructive"
                  size="lg"
                  className="rounded-full w-20 h-20 animate-pulse shadow-lg shadow-red-500/50"
                >
                  <PhoneOff className="w-8 h-8" />
                </Button>
                <Button
                  onClick={answerCall}
                  className="bg-emerald-500 hover:bg-emerald-600 rounded-full w-20 h-20 animate-pulse shadow-lg shadow-emerald-500/50"
                  size="lg"
                >
                  <Phone className="w-8 h-8" />
                </Button>
              </div>
              <div className="text-center">
                <p className="text-slate-300 text-sm">Swipe up to answer • Swipe down to decline</p>
              </div>
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