import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX, Users, Video, VideoOff } from "lucide-react";

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
  const [isVideoOn, setIsVideoOn] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [connectedParticipants, setConnectedParticipants] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const callStartTime = useRef(null);

  const peerConnections = useRef({});
  const localStream = useRef(null);
  const remoteAudios = useRef({});
  const callId = useRef(incomingCallId || `call_${Date.now()}_${Math.random()}`);
  const pollingInterval = useRef(null);
  const durationInterval = useRef(null);
  const ringtoneInterval = useRef(null);
  const audioContext = useRef(null);
  const ringtoneAudio = useRef(null);
  const mediaRecorder = useRef(null);
  const recordedChunks = useRef([]);

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
  };

  const callParticipants = isGroupCall ? participants : [targetUser];

  useEffect(() => {
    loadCurrentUser();
    if (incomingCallId) {
      // For incoming calls, start ringing immediately
      // Add a small delay to ensure component is mounted
      setTimeout(() => startRingtone(), 100);
    }
    initializeCall();
    return () => cleanup();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const user = await base44.auth.me();
      setCurrentUser(user);
    } catch (error) {
      console.error('Failed to load user:', error);
    }
  };

  useEffect(() => {
    if (callStatus === 'connected' && !callStartTime.current) {
      callStartTime.current = new Date().toISOString();
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
    stopRingtone();
    
    try {
      // Method 1: Try Web Audio API
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioContext.current = new AudioContext();
        
        // Force resume if suspended
        audioContext.current.resume().then(() => {
          console.log('AudioContext resumed, state:', audioContext.current.state);
        });
      }
      
      // Method 2: Fallback to HTML5 Audio with data URL ringtone
      const createRingtoneDataURL = () => {
        // Create a simple beep sound using data URL
        return 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVqzn77BdGAg+ltryxnMpBSl+zPLaizsIGGS57OihUBELTKXh8bllHAU2jdXzzn0vBSF1xe/glEILElyx6+6nVBML';
      };
      
      ringtoneAudio.current = new Audio(createRingtoneDataURL());
      ringtoneAudio.current.loop = true;
      ringtoneAudio.current.volume = 1.0;
      
      // Try to play immediately
      const playPromise = ringtoneAudio.current.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log('Ringtone playing via Audio element');
          })
          .catch(error => {
            console.log('Audio autoplay blocked, using Web Audio API fallback', error);
            playWebAudioRingtone();
          });
      }
      
      // Method 3: Web Audio API fallback
      const playWebAudioRingtone = () => {
        if (!audioContext.current) return;
        
        const playRingPattern = () => {
          try {
            if (!audioContext.current || audioContext.current.state === 'closed') return;
            
            const now = audioContext.current.currentTime;
            const oscillator1 = audioContext.current.createOscillator();
            const oscillator2 = audioContext.current.createOscillator();
            const gainNode = audioContext.current.createGain();
            
            oscillator1.connect(gainNode);
            oscillator2.connect(gainNode);
            gainNode.connect(audioContext.current.destination);
            
            oscillator1.frequency.value = 800;
            oscillator2.frequency.value = 1000;
            oscillator1.type = 'sine';
            oscillator2.type = 'sine';
            
            gainNode.gain.setValueAtTime(0, now);
            gainNode.gain.linearRampToValueAtTime(0.8, now + 0.05);
            gainNode.gain.linearRampToValueAtTime(0.8, now + 0.4);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
            
            oscillator1.start(now);
            oscillator2.start(now);
            oscillator1.stop(now + 0.5);
            oscillator2.stop(now + 0.5);
            
            setTimeout(() => {
              if (!audioContext.current || audioContext.current.state === 'closed') return;
              
              const now2 = audioContext.current.currentTime;
              const osc1 = audioContext.current.createOscillator();
              const osc2 = audioContext.current.createOscillator();
              const gain = audioContext.current.createGain();
              
              osc1.connect(gain);
              osc2.connect(gain);
              gain.connect(audioContext.current.destination);
              
              osc1.frequency.value = 800;
              osc2.frequency.value = 1000;
              osc1.type = 'sine';
              osc2.type = 'sine';
              
              gain.gain.setValueAtTime(0, now2);
              gain.gain.linearRampToValueAtTime(0.8, now2 + 0.05);
              gain.gain.linearRampToValueAtTime(0.8, now2 + 0.4);
              gain.gain.linearRampToValueAtTime(0, now2 + 0.5);
              
              osc1.start(now2);
              osc2.start(now2);
              osc1.stop(now2 + 0.5);
              osc2.stop(now2 + 0.5);
            }, 600);
          } catch (error) {
            console.error('Error in ring pattern:', error);
          }
        };
        
        playRingPattern();
        ringtoneInterval.current = setInterval(playRingPattern, 2000);
      };
      
      // If Audio element didn't play, use Web Audio API
      setTimeout(() => {
        if (ringtoneAudio.current && ringtoneAudio.current.paused) {
          playWebAudioRingtone();
        }
      }, 100);
      
      // Vibration
      if ('vibrate' in navigator) {
        const vibratePattern = () => {
          navigator.vibrate([400, 200, 400, 200, 400]);
        };
        vibratePattern();
        const vibrateInt = setInterval(vibratePattern, 2000);
        setTimeout(() => clearInterval(vibrateInt), 60000);
      }
      
      console.log('Ringtone initialization complete');
    } catch (error) {
      console.error('Error starting ringtone:', error);
    }
  };

  const stopRingtone = () => {
    if (ringtoneInterval.current) {
      clearInterval(ringtoneInterval.current);
      ringtoneInterval.current = null;
    }
    if (ringtoneAudio.current) {
      ringtoneAudio.current.pause();
      ringtoneAudio.current.currentTime = 0;
      ringtoneAudio.current = null;
    }
    if (audioContext.current && audioContext.current.state !== 'closed') {
      audioContext.current.close();
      audioContext.current = null;
    }
    if ('vibrate' in navigator) {
      navigator.vibrate(0);
    }
  };

  const initializeCall = async () => {
    try {
      // Don't request media access for incoming calls until answered
      if (!incomingCallId) {
        try {
          localStream.current = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: { ideal: true },
              noiseSuppression: { ideal: true },
              autoGainControl: { ideal: true },
              sampleRate: { ideal: 48000 },
              channelCount: 1
            },
            video: isVideoOn
          });
        } catch (mediaError) {
          console.error('Media access error:', mediaError);
          if (mediaError.name === 'NotAllowedError') {
            alert('Microphone access denied. Please allow microphone permissions in your browser settings.');
          } else if (mediaError.name === 'NotFoundError') {
            alert('No microphone found. Please connect a microphone and try again.');
          } else {
            alert('Unable to access microphone: ' + mediaError.message);
          }
          cleanup();
          onClose();
          return;
        }
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

      // Send push notifications to all participants
      for (const participant of callParticipants) {
        await base44.functions.invoke('sendCallNotification', {
          targetUserId: participant.id,
          callerName: currentUser?.full_name || 'Unknown',
          callId: callId.current,
          callType: isGroupCall ? 'group' : 'direct'
        });
        
        // Also send RTC signaling
        await base44.functions.invoke('rtcSignaling', {
          action: 'initiate_call',
          targetUserId: participant.id,
          callId: callId.current,
          isGroupCall: isGroupCall
        });
      }

      // Don't create peer connections yet - wait for recipient to answer
      startPolling();
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
      try {
        localStream.current = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            sampleRate: { ideal: 48000 },
            channelCount: 1
          },
          video: isVideoOn
        });
      } catch (mediaError) {
        console.error('Media access error:', mediaError);
        if (mediaError.name === 'NotAllowedError') {
          alert('Microphone access denied. Please allow microphone permissions in your browser settings.');
        } else if (mediaError.name === 'NotFoundError') {
          alert('No microphone found. Please connect a microphone and try again.');
        } else {
          alert('Unable to access microphone: ' + mediaError.message);
        }
        cleanup();
        onClose();
        return;
      }
      
      // Send answer signal to all participants
      for (const participant of callParticipants) {
        await base44.functions.invoke('rtcSignaling', {
          action: 'call_answered',
          callId: callId.current,
          targetUserId: participant.id
        });
      }
      
      setCallStatus('connected');
      
      // Start recording
      startRecording();
    } catch (error) {
      console.error('Error answering call:', error);
      setCallStatus('error');
    }
  };

  const startRecording = () => {
    try {
      if (!localStream.current) return;
      
      // Create a mixed stream with local audio
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();
      
      // Add local stream
      const localSource = audioContext.createMediaStreamSource(localStream.current);
      localSource.connect(destination);
      
      // Add remote streams
      Object.values(remoteAudios.current).forEach(audio => {
        if (audio.srcObject) {
          const remoteSource = audioContext.createMediaStreamSource(audio.srcObject);
          remoteSource.connect(destination);
        }
      });
      
      mediaRecorder.current = new MediaRecorder(destination.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorder.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.current.push(event.data);
        }
      };
      
      mediaRecorder.current.start(1000); // Collect data every second
    } catch (error) {
      console.error('Error starting recording:', error);
    }
  };

  const stopRecording = async () => {
    return new Promise((resolve) => {
      if (!mediaRecorder.current || mediaRecorder.current.state === 'inactive') {
        resolve(null);
        return;
      }
      
      mediaRecorder.current.onstop = async () => {
        try {
          const blob = new Blob(recordedChunks.current, { type: 'audio/webm' });
          const file = new File([blob], `call_${callId.current}.webm`, { type: 'audio/webm' });
          
          // Upload recording
          const { data } = await base44.integrations.Core.UploadFile({ file });
          resolve(data.file_url);
        } catch (error) {
          console.error('Error uploading recording:', error);
          resolve(null);
        }
      };
      
      mediaRecorder.current.stop();
    });
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
        try {
          await base44.functions.invoke('rtcSignaling', {
            action: 'send_candidate',
            targetUserId: participantId,
            candidate: event.candidate,
            callId: callId.current
          });
        } catch (error) {
          console.error('Failed to send ICE candidate:', error);
        }
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${participantId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setCallStatus('connected');
      } else if (pc.connectionState === 'failed') {
        console.error('Connection failed');
        setCallStatus('error');
      }
    };

    // Handle connection state
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`Connection state for ${participantId}: ${state}`);

      if (state === 'connected') {
        setConnectedParticipants(prev => 
          prev.includes(participantId) ? prev : [...prev, participantId]
        );
        setCallStatus('connected');
      } else if (state === 'failed') {
        console.error(`Connection failed for ${participantId}`);
        // Try to restart ICE
        if (pc.restartIce) {
          console.log('Attempting to restart ICE...');
          pc.restartIce();
        }
      } else if (state === 'disconnected') {
        setConnectedParticipants(prev => prev.filter(id => id !== participantId));
        // If all participants disconnected, end call after delay
        setTimeout(() => {
          const allPeers = Object.values(peerConnections.current);
          const allDisconnected = allPeers.every(p => 
            ['disconnected', 'failed', 'closed'].includes(p.connectionState)
          );
          if (allDisconnected && allPeers.length > 0) {
            cleanup();
            onClose();
          }
        }, 3000);
      } else if (state === 'closed') {
        setConnectedParticipants(prev => prev.filter(id => id !== participantId));
      }
    };

    // Add ICE connection state monitoring
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE connection state for ${participantId}: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === 'failed') {
        console.error('ICE connection failed, attempting restart...');
        if (pc.restartIce) {
          pc.restartIce();
        }
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

      if (message.type === 'call_answered') {
        // Recipient has answered - now create peer connections
        if (callStatus === 'calling') {
          setCallStatus('connecting');
          for (const participant of callParticipants) {
            await createPeerConnection(participant.id);
          }
          setCallStatus('connected');
          
          // Start recording for caller
          startRecording();
        }
      } else if (message.type === 'offer' && incomingCallId) {
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
      cleanup();
      onClose();
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

  const toggleVideo = async () => {
    if (!localStream.current) return;
    
    const videoTrack = localStream.current.getVideoTracks()[0];
    
    if (isVideoOn && videoTrack) {
      // Turn off video
      videoTrack.stop();
      localStream.current.removeTrack(videoTrack);
      setIsVideoOn(false);
      
      // Update peer connections
      Object.values(peerConnections.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          pc.removeTrack(sender);
        }
      });
    } else {
      // Turn on video
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        localStream.current.addTrack(newVideoTrack);
        setIsVideoOn(true);
        
        // Update peer connections
        Object.values(peerConnections.current).forEach(pc => {
          pc.addTrack(newVideoTrack, localStream.current);
        });
      } catch (error) {
        console.error('Error enabling video:', error);
      }
    }
  };

  const endCall = async () => {
    try {
      // Stop ringtone immediately
      stopRingtone();
      
      // Stop and upload recording
      const recordingUrl = await stopRecording();
      
      // Log call to history with recording
      await logCallHistory(incomingCallId && callStatus === 'incoming' ? 'declined' : 'completed', recordingUrl);
      
      // Notify all participants
      for (const participant of callParticipants) {
        await base44.functions.invoke('rtcSignaling', {
          action: 'end_call',
          callId: callId.current,
          targetUserId: participant.id
        });
      }
    } catch (error) {
      console.error('Error ending call:', error);
    } finally {
      cleanup();
      onClose();
    }
  };

  const logCallHistory = async (status, recordingUrl = null) => {
    if (!currentUser || !callStartTime.current) return;
    
    try {
      const callData = {
        call_id: callId.current,
        caller_id: currentUser.id,
        caller_name: currentUser.full_name,
        call_type: isGroupCall ? 'group' : 'direct',
        duration_seconds: callDuration,
        status: status,
        started_at: callStartTime.current,
        ended_at: new Date().toISOString(),
        recording_url: recordingUrl,
        has_recording: !!recordingUrl
      };

      if (isGroupCall) {
        callData.participants = callParticipants.map(p => ({
          user_id: p.id,
          user_name: p.full_name
        }));
      } else if (targetUser) {
        callData.receiver_id = targetUser.id;
        callData.receiver_name = targetUser.full_name;
      }

      await base44.entities.CallHistory.create(callData);
    } catch (error) {
      console.error('Failed to log call history:', error);
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
                  onTouchStart={() => {
                    // Ensure ringtone plays on touch
                    if (ringtoneAudio.current && ringtoneAudio.current.paused) {
                      ringtoneAudio.current.play().catch(console.error);
                    }
                  }}
                >
                  <PhoneOff className="w-8 h-8" />
                </Button>
                <Button
                  onClick={answerCall}
                  className="bg-emerald-500 hover:bg-emerald-600 rounded-full w-20 h-20 animate-pulse shadow-lg shadow-emerald-500/50"
                  size="lg"
                  onTouchStart={() => {
                    // Ensure audio context is resumed on user interaction
                    if (audioContext.current && audioContext.current.state === 'suspended') {
                      audioContext.current.resume();
                    }
                  }}
                >
                  <Phone className="w-8 h-8" />
                </Button>
              </div>
              <div className="text-center">
                <p className="text-slate-300 text-sm animate-pulse">📞 Incoming Call - Tap to interact</p>
              </div>
            </div>
          )}

          {(callStatus === 'connected' || callStatus === 'calling' || callStatus === 'connecting') && (
            <div className="flex gap-3 justify-center">
              <Button
                onClick={toggleMute}
                variant={isMuted ? "destructive" : "outline"}
                size="lg"
                className="rounded-full w-14 h-14"
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </Button>

              <Button
                onClick={toggleVideo}
                variant={isVideoOn ? "default" : "outline"}
                size="lg"
                className="rounded-full w-14 h-14"
              >
                {isVideoOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
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