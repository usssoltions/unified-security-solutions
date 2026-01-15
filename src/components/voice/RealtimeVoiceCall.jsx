import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX } from "lucide-react";

export default function RealtimeVoiceCall({ targetUser, onClose, incomingCallId = null }) {
    const [callStatus, setCallStatus] = useState(incomingCallId ? 'incoming' : 'initiating');
    const [isMuted, setIsMuted] = useState(false);
    const [isSpeakerOn, setIsSpeakerOn] = useState(true);
    const [callDuration, setCallDuration] = useState(0);

    const peerConnection = useRef(null);
    const localStream = useRef(null);
    const remoteAudio = useRef(null);
    const callId = useRef(incomingCallId || null);
    const pollingInterval = useRef(null);
    const durationInterval = useRef(null);

    // WebRTC configuration with STUN servers
    const rtcConfig = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    };

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
            // Get user media with high-quality audio settings
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

            // Create peer connection
            peerConnection.current = new RTCPeerConnection(rtcConfig);

            // Add local stream tracks
            localStream.current.getTracks().forEach(track => {
                peerConnection.current.addTrack(track, localStream.current);
            });

            // Handle incoming tracks
            peerConnection.current.ontrack = (event) => {
                if (remoteAudio.current) {
                    remoteAudio.current.srcObject = event.streams[0];
                }
            };

            // Handle ICE candidates
            peerConnection.current.onicecandidate = async (event) => {
                if (event.candidate) {
                    await base44.functions.invoke('rtcSignaling', {
                        action: 'send_candidate',
                        targetUserId: targetUser.id,
                        candidate: event.candidate,
                        callId: callId.current
                    });
                }
            };

            // Handle connection state changes
            peerConnection.current.onconnectionstatechange = () => {
                const state = peerConnection.current.connectionState;
                if (state === 'connected') {
                    setCallStatus('connected');
                } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                    endCall();
                }
            };

            // Start signaling based on call type
            if (incomingCallId) {
                // Incoming call - wait for offer
                startPolling();
            } else {
                // Outgoing call - create offer
                await initiateOutgoingCall();
            }
        } catch (error) {
            console.error('Error initializing call:', error);
            setCallStatus('error');
        }
    };

    const initiateOutgoingCall = async () => {
        try {
            // Notify target user
            const { data } = await base44.functions.invoke('rtcSignaling', {
                action: 'initiate_call',
                targetUserId: targetUser.id
            });

            callId.current = data.callId;
            setCallStatus('calling');

            // Create and send offer
            const offer = await peerConnection.current.createOffer();
            await peerConnection.current.setLocalDescription(offer);

            await base44.functions.invoke('rtcSignaling', {
                action: 'send_offer',
                targetUserId: targetUser.id,
                offer: offer,
                callId: callId.current
            });

            // Start polling for answer
            startPolling();
        } catch (error) {
            console.error('Error initiating call:', error);
            setCallStatus('error');
        }
    };

    const answerCall = async () => {
        try {
            setCallStatus('connecting');
            startPolling();
        } catch (error) {
            console.error('Error answering call:', error);
            setCallStatus('error');
        }
    };

    const startPolling = () => {
        pollingInterval.current = setInterval(async () => {
            try {
                const { data } = await base44.functions.invoke('rtcSignaling', {
                    action: 'poll_messages'
                });

                if (data.messages && data.messages.length > 0) {
                    for (const message of data.messages) {
                        await handleSignalingMessage(message);
                    }
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, 500); // Poll every 500ms for low latency
    };

    const handleSignalingMessage = async (message) => {
        try {
            if (message.type === 'offer' && incomingCallId) {
                // Received offer - create answer
                await peerConnection.current.setRemoteDescription(new RTCSessionDescription(message.offer));
                const answer = await peerConnection.current.createAnswer();
                await peerConnection.current.setLocalDescription(answer);

                await base44.functions.invoke('rtcSignaling', {
                    action: 'send_answer',
                    targetUserId: message.from,
                    answer: answer,
                    callId: callId.current
                });
            } else if (message.type === 'answer' && !incomingCallId) {
                // Received answer
                await peerConnection.current.setRemoteDescription(new RTCSessionDescription(message.answer));
            } else if (message.type === 'candidate') {
                // Received ICE candidate
                await peerConnection.current.addIceCandidate(new RTCIceCandidate(message.candidate));
            } else if (message.type === 'call_ended') {
                endCall();
            }
        } catch (error) {
            console.error('Error handling signaling message:', error);
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
        if (remoteAudio.current) {
            remoteAudio.current.muted = !remoteAudio.current.muted;
            setIsSpeakerOn(!remoteAudio.current.muted);
        }
    };

    const endCall = async () => {
        try {
            if (callId.current) {
                await base44.functions.invoke('rtcSignaling', {
                    action: 'end_call',
                    callId: callId.current
                });
            }
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
        if (peerConnection.current) {
            peerConnection.current.close();
        }
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
                        {callStatus === 'incoming' && 'Incoming Call'}
                        {callStatus === 'initiating' && 'Initiating Call...'}
                        {callStatus === 'calling' && 'Calling...'}
                        {callStatus === 'connecting' && 'Connecting...'}
                        {callStatus === 'connected' && 'Call In Progress'}
                        {callStatus === 'error' && 'Call Failed'}
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
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

                    <audio ref={remoteAudio} autoPlay />

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