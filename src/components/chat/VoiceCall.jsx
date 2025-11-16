import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX } from "lucide-react";

export default function VoiceCall({ caller, recipient, onEnd, isInitiator }) {
  const [callState, setCallState] = useState(isInitiator ? "calling" : "incoming");
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const callTimerRef = useRef(null);

  const configuration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    if (callState === "connected") {
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }

    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
      }
    };
  }, [callState]);

  const setupMediaStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }, 
        video: false 
      });
      
      localStreamRef.current = stream;
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }
      
      return stream;
    } catch (error) {
      console.error("Failed to get media stream:", error);
      alert("Failed to access microphone. Please check permissions.");
      handleEndCall();
    }
  };

  const createPeerConnection = async () => {
    const pc = new RTCPeerConnection(configuration);
    
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        // In production, send ICE candidate to other peer via signaling server
        console.log("ICE candidate:", event.candidate);
      }
    };

    pc.ontrack = (event) => {
      remoteStreamRef.current = event.streams[0];
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (pc.connectionState === "connected") {
        setCallState("connected");
      } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        handleEndCall();
      }
    };

    const stream = await setupMediaStream();
    if (stream) {
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });
    }

    peerConnectionRef.current = pc;
    return pc;
  };

  const initiateCall = async () => {
    try {
      const pc = await createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      // In production, send offer to recipient via signaling server
      console.log("Call offer created:", offer);
      
      // Simulate connection for demo
      setTimeout(() => {
        setCallState("connected");
      }, 2000);
      
    } catch (error) {
      console.error("Failed to initiate call:", error);
      handleEndCall();
    }
  };

  const answerCall = async () => {
    try {
      const pc = await createPeerConnection();
      
      // In production, receive offer from caller via signaling server
      // const offer = await receiveOfferFromSignalingServer();
      // await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      // In production, send answer to caller via signaling server
      console.log("Call answer created:", answer);
      
      setCallState("connected");
      
    } catch (error) {
      console.error("Failed to answer call:", error);
      handleEndCall();
    }
  };

  const handleEndCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }
    onEnd();
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleSpeaker = () => {
    setIsSpeakerOn(!isSpeakerOn);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = isSpeakerOn ? 0 : 1;
    }
  };

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (isInitiator && callState === "calling") {
      initiateCall();
    }
  }, [isInitiator]);

  return (
    <div className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center">
      <Card className="w-full max-w-md bg-slate-800 border-slate-700">
        <CardHeader className="text-center border-b border-slate-700">
          <div className="w-24 h-24 mx-auto mb-4 bg-gradient-to-br from-sky-400 to-sky-600 rounded-full flex items-center justify-center">
            <span className="text-white text-3xl font-bold">
              {(isInitiator ? recipient.full_name : caller.full_name)?.[0]?.toUpperCase() || "U"}
            </span>
          </div>
          <CardTitle className="text-white text-xl">
            {isInitiator ? recipient.full_name : caller.full_name}
          </CardTitle>
          <p className="text-sm text-slate-400">
            {callState === "calling" && "Calling..."}
            {callState === "incoming" && "Incoming Call"}
            {callState === "connected" && formatDuration(callDuration)}
          </p>
        </CardHeader>

        <CardContent className="p-6">
          {callState === "incoming" && (
            <div className="flex gap-4">
              <Button
                onClick={handleEndCall}
                className="flex-1 bg-rose-600 hover:bg-rose-700 h-14"
              >
                <PhoneOff className="w-6 h-6 mr-2" />
                Decline
              </Button>
              <Button
                onClick={answerCall}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 h-14"
              >
                <Phone className="w-6 h-6 mr-2" />
                Answer
              </Button>
            </div>
          )}

          {(callState === "calling" || callState === "connected") && (
            <>
              {callState === "calling" && (
                <div className="text-center mb-6">
                  <div className="w-16 h-16 mx-auto mb-4">
                    <div className="animate-pulse">
                      <Phone className="w-16 h-16 text-sky-400" />
                    </div>
                  </div>
                </div>
              )}

              {callState === "connected" && (
                <div className="flex justify-center gap-4 mb-6">
                  <Button
                    onClick={toggleMute}
                    size="lg"
                    variant="outline"
                    className={`rounded-full w-16 h-16 ${isMuted ? 'bg-rose-600 border-rose-600' : 'border-slate-600'}`}
                  >
                    {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                  </Button>
                  
                  <Button
                    onClick={toggleSpeaker}
                    size="lg"
                    variant="outline"
                    className={`rounded-full w-16 h-16 ${!isSpeakerOn ? 'bg-slate-700' : 'border-slate-600'}`}
                  >
                    {isSpeakerOn ? <Volume2 className="w-6 h-6" /> : <VolumeX className="w-6 h-6" />}
                  </Button>
                </div>
              )}

              <Button
                onClick={handleEndCall}
                className="w-full bg-rose-600 hover:bg-rose-700 h-14"
              >
                <PhoneOff className="w-6 h-6 mr-2" />
                End Call
              </Button>
            </>
          )}

          {/* Hidden audio elements for WebRTC */}
          <audio ref={localAudioRef} muted autoPlay style={{ display: 'none' }} />
          <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
        </CardContent>
      </Card>
    </div>
  );
}