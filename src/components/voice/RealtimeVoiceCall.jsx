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
  const callId = useRef(incomingCallId);
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
      
      // If Audio element didn't play, use Web Audio API
      setTimeout(() => {
        if (ringtoneAudio.current && ringtoneAudio.current.paused) {
          console.log('Audio element failed, using Web Audio API');
        }
      }, 100);
      
      // Vibration
      if ('vibrate' in navigator) {
        const vibratePattern = () => {
          navigator.vibrate([400, 200, 400, 200, 400]);
        };
        vibratePattern();
        ringtoneInterval.current = setInterval(vibratePattern, 2000);
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

      // Initiate call and get callId from backend
      const firstParticipant = callParticipants[0];
      const { data: initData } = await base44.functions.invoke('rtcSignaling', {
        action: 'initiate_call',
        targetUserId: firstParticipant.id,
        isGroupCall: isGroupCall
      });
      
      callId.current = initData.callId;
      console.log('Call initiated with ID:', callId.current);

      // Send push notifications to all participants with correct callId
      for (const participant of callParticipants) {
        await base44.functions.invoke('sendCallNotification', {
          targetUserId: participant.id,
          callerName: currentUser?.full_name || 'Unknown',
          callId: callId.current,
          callType: isGroupCall ? 'group' : 'direct'
        });
      }

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
      
      // For group calls, wait a bit for all participants to be ready
      if (isGroupCall) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
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
          if (recordedChunks.current.length === 0) {
            console.log('No recording data available');
            resolve(null);
            return;
          }
          
          const blob = new Blob(recordedChunks.current, { type: 'audio/webm' });
          const file = new File([blob], `call_${callId.current}_${Date.now()}.webm`, { type: 'audio/webm' });
          
          console.log('Uploading recording, size:', blob.size, 'bytes');
          
          // Upload recording to cloud storage via Base44
          const { data } = await base44.integrations.Core.UploadFile({ file });
          console.log('Recording uploaded successfully:', data.file_url);
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
    console.log('Creating peer connection for', participantId, 'localStream ready:', !!localStream.current);
    
    if (!localStream.current) {
      console.error('Cannot create peer connection without local stream!');
      return;
    }

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.current[participantId] = pc;

    // Add local stream tracks
    localStream.current.getTracks().forEach(track => {
      console.log('Adding local track to peer connection:', track.kind, track.enabled);
      pc.addTrack(track, localStream.current);
    });

    // Handle incoming remote tracks
    pc.ontrack = (event) => {
      console.log('✓ Received remote track from', participantId, 'kind:', event.track.kind);
      
      if (event.track.kind === 'audio') {
        // Ensure old audio is cleaned up
        if (remoteAudios.current[participantId]) {
          remoteAudios.current[participantId].pause();
          remoteAudios.current[participantId].srcObject = null;
        }
        
        const audio = new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        audio.volume = 1.0;
        audio.play().catch(e => console.log('Audio autoplay prevented:', e));
        remoteAudios.current[participantId] = audio;
      }
      
      setConnectedParticipants(prev => 
        prev.includes(participantId) ? prev : [...prev, participantId]
      );
    };

    // Send ICE candidates as they're discovered
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to', participantId);
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
      } else {
        console.log('All ICE candidates sent for', participantId);
      }
    };

    // Monitor connection state
    pc.onconnectionstatechange = () => {
      console.log(`Connection state for ${participantId}: ${pc.connectionState}`);
      
      if (pc.connectionState === 'connected') {
        console.log('✓✓✓ Call connected successfully with', participantId);
        setConnectedParticipants(prev => 
          prev.includes(participantId) ? prev : [...prev, participantId]
        );
        setCallStatus('connected');
      } else if (pc.connectionState === 'disconnected') {
        console.warn('Connection disconnected with', participantId);
        setConnectedParticipants(prev => prev.filter(id => id !== participantId));
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`ICE state for ${participantId}: ${pc.iceConnectionState}`);
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        console.log('✓ ICE connected for', participantId);
        setCallStatus('connected');
      }
    };

    // Wait for ICE gathering to complete before sending offer
    const waitForIceGathering = () => {
      return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
        } else {
          const checkState = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', checkState);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', checkState);
          
          // Timeout after 3 seconds
          setTimeout(() => {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }, 3000);
        }
      });
    };

    // Create and send offer
    try {
      const offer = await pc.createOffer({ 
        offerToReceiveAudio: true,
        offerToReceiveVideo: isVideoOn
      });
      await pc.setLocalDescription(offer);

      console.log('Waiting for ICE gathering...');
      await waitForIceGathering();

      console.log('Sending offer to', participantId, 'callId:', callId.current);
      await base44.functions.invoke('rtcSignaling', {
        action: 'send_offer',
        targetUserId: participantId,
        offer: pc.localDescription,
        callId: callId.current
      });
      console.log('✓ Offer sent successfully with all ICE candidates');
    } catch (error) {
      console.error('✗ Error creating/sending offer:', error);
    }
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
        console.error('Polling error:', error);
      }
    }, 500);
  };

  const handleSignalingMessage = async (message) => {
    try {
      const participantId = message.from;
      console.log('Handling signaling message:', message.type, 'from', participantId, 'callStatus:', callStatus);

      if (message.type === 'call_answered') {
        console.log('Call answered by', participantId);
        stopRingtone();
        if (callStatus === 'calling') {
          console.log('Creating peer connections after answer');
          setCallStatus('connecting');
          for (const participant of callParticipants) {
            await createPeerConnection(participant.id);
          }
          startRecording();
        }
      } else if (message.type === 'offer') {
        console.log('Received offer from', participantId, 'localStream ready:', !!localStream.current);
        
        // Only process offer if we have answered and have media
        if (!localStream.current) {
          console.warn('Received offer but no local stream yet, ignoring');
          return;
        }

        if (!peerConnections.current[participantId]) {
          const pc = new RTCPeerConnection(rtcConfig);
          peerConnections.current[participantId] = pc;

          localStream.current.getTracks().forEach(track => {
            console.log('Adding track to peer connection:', track.kind);
            pc.addTrack(track, localStream.current);
          });

          pc.ontrack = (event) => {
            console.log('Received remote track from', participantId);
            const audio = new Audio();
            audio.srcObject = event.streams[0];
            audio.autoplay = true;
            audio.volume = 1.0;
            remoteAudios.current[participantId] = audio;
            
            setConnectedParticipants(prev => 
              prev.includes(participantId) ? prev : [...prev, participantId]
            );
          };

          pc.onicecandidate = async (event) => {
            if (event.candidate) {
              console.log('Sending ICE candidate to', participantId);
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
              console.log('✓ Call connected successfully');
              setConnectedParticipants(prev => 
                prev.includes(participantId) ? prev : [...prev, participantId]
              );
              setCallStatus('connected');
            } else if (pc.connectionState === 'disconnected') {
              console.warn('Connection disconnected');
            }
          };

          pc.oniceconnectionstatechange = () => {
            console.log(`ICE state for ${participantId}: ${pc.iceConnectionState}`);
            
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
              console.log('✓ ICE connected for', participantId);
              setCallStatus('connected');
            }
          };

          try {
            await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            // Wait for ICE gathering
            const waitForIceGathering = () => {
              return new Promise((resolve) => {
                if (pc.iceGatheringState === 'complete') {
                  resolve();
                } else {
                  const checkState = () => {
                    if (pc.iceGatheringState === 'complete') {
                      pc.removeEventListener('icegatheringstatechange', checkState);
                      resolve();
                    }
                  };
                  pc.addEventListener('icegatheringstatechange', checkState);
                  setTimeout(() => {
                    pc.removeEventListener('icegatheringstatechange', checkState);
                    resolve();
                  }, 3000);
                }
              });
            };

            console.log('Waiting for ICE gathering...');
            await waitForIceGathering();

            console.log('Sending answer to', participantId);
            await base44.functions.invoke('rtcSignaling', {
              action: 'send_answer',
              targetUserId: participantId,
              answer: pc.localDescription,
              callId: callId.current
            });
            console.log('✓ Answer sent successfully with all ICE candidates');
          } catch (error) {
            console.error('Error processing offer:', error);
          }
        }
      } else if (message.type === 'answer') {
        console.log('Received answer from', participantId);
        const pc = peerConnections.current[participantId];
        if (pc) {
          if (pc.signalingState !== 'stable') {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
              console.log('✓ Answer applied successfully');
            } catch (error) {
              console.error('Error applying answer:', error);
            }
          } else {
            console.warn('Ignoring answer, connection already stable');
          }
        }
      } else if (message.type === 'candidate') {
        const pc = peerConnections.current[participantId];
        if (pc && message.candidate) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
            console.log('✓ ICE candidate added for', participantId);
          } catch (e) {
            console.error('✗ ICE candidate error:', e);
          }
        }
      } else if (message.type === 'call_ended') {
        console.log('Call ended by remote party');
        stopRingtone();
        cleanup();
        onClose();
      }
    } catch (error) {
      console.error('Error handling signaling:', error);
      setCallStatus('error');
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
      videoTrack.stop();
      localStream.current.removeTrack(videoTrack);
      setIsVideoOn(false);
      
      Object.values(peerConnections.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          pc.removeTrack(sender);
        }
      });
    } else {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user'
          } 
        });
        const newVideoTrack = videoStream.getVideoTracks()[0];
        localStream.current.addTrack(newVideoTrack);
        setIsVideoOn(true);
        
        Object.values(peerConnections.current).forEach(pc => {
          pc.addTrack(newVideoTrack, localStream.current);
        });
      } catch (error) {
        console.error('Error enabling video:', error);
        alert('Unable to access camera. Please check camera permissions.');
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
      
      // Notify all participants (use service role to ensure delivery)
      const notifyPromises = callParticipants.map(participant => 
        base44.functions.invoke('rtcSignaling', {
          action: 'end_call',
          callId: callId.current,
          targetUserId: participant.id
        }).catch(err => console.error('Failed to notify participant:', err))
      );
      
      await Promise.all(notifyPromises);
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
              <div className="flex flex-wrap justify-center gap-3 mb-4 max-h-64 overflow-y-auto">
                {callParticipants.map(participant => (
                  <div key={participant.id} className="text-center">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-1 transition-all ${
                      connectedParticipants.includes(participant.id) 
                        ? 'bg-emerald-500 ring-2 ring-emerald-400 animate-pulse' 
                        : 'bg-slate-600'
                    }`}>
                      <span className="text-white text-xl font-bold">
                        {participant.full_name?.[0]?.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-white text-xs font-medium">{participant.full_name?.split(' ')[0]}</p>
                    {connectedParticipants.includes(participant.id) && (
                      <p className="text-emerald-400 text-xs">Active</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="bg-slate-700/50 rounded-lg p-3 mb-2">
                <p className="text-slate-300 text-sm font-semibold">
                  {connectedParticipants.length} of {callParticipants.length} participants connected
                </p>
                {callStatus === 'connected' && (
                  <p className="text-emerald-400 text-lg font-bold mt-1">{formatDuration(callDuration)}</p>
                )}
                {callStatus === 'connecting' && (
                  <p className="text-yellow-400 text-sm mt-1">Connecting...</p>
                )}
              </div>
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