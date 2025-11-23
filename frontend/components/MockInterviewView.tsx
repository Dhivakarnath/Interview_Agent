'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  RoomAudioRenderer, 
  StartAudio, 
  RoomContext,
  useTrackToggle,
  useLocalParticipant,
  useVoiceAssistant,
  useTranscriptions,
  useRoomContext,
  useRemoteParticipants,
  VideoTrack,
  useTracks,
  useChat,
  type TrackReference,
} from '@livekit/components-react';
import { Room, RoomEvent, Track } from 'livekit-client';
import IDE from './IDE';

interface MockInterviewViewProps {
  userName: string;
  setUserName: (name: string) => void;
  resumeFile: File | null;
  setResumeFile: (file: File | null) => void;
  resumeId: string | null;
  setResumeId: (id: string | null) => void;
  jobDescription: string;
  setJobDescription: (desc: string) => void;
  isUploadingResume: boolean;
  setIsUploadingResume: (value: boolean) => void;
  uploadProgress: number;
  setUploadProgress: (value: number) => void;
  handleResumeUpload: (file: File) => Promise<void>;
}

export default function MockInterviewView({
  userName,
  setUserName,
  resumeFile,
  setResumeFile,
  resumeId,
  setResumeId,
  jobDescription,
  setJobDescription,
  isUploadingResume,
  setIsUploadingResume,
  uploadProgress,
  setUploadProgress,
  handleResumeUpload,
}: MockInterviewViewProps) {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [hasStarted, setHasStarted] = useState(false);

  const createMockInterviewRoom = async () => {
    if (!userName.trim()) {
      setError('Please enter your name');
      return;
    }

    if (!resumeFile) {
      setError('Resume is required for mock interviews');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:8000/api/interview/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_name: userName,
          job_description: jobDescription.trim() || undefined,
          resume_id: resumeId || undefined,
          language: 'en-US',
          mode: 'mock-interview',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to create room');
      }

      const data = await response.json();
      setSessionData(data);

      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      newRoom.on(RoomEvent.Connected, async () => {
        console.log('Connected to mock interview room');
        setIsConnecting(false);
        
        // Force enable microphone, camera, and screen share
        await newRoom.localParticipant.setMicrophoneEnabled(true);
        await newRoom.localParticipant.setCameraEnabled(true);
        
        setHasStarted(true);
      });

      newRoom.on(RoomEvent.Disconnected, () => {
        console.log('Disconnected from room');
        setRoom(null);
        setHasStarted(false);
      });

      await newRoom.connect(data.livekit_url, data.token);
      setRoom(newRoom);
    } catch (err) {
      console.error('Error creating mock interview room:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      setSessionData(null);
      setHasStarted(false);
    }
  };

  // Auto-start when resume is uploaded and user name is provided
  useEffect(() => {
    if (resumeFile && userName.trim() && !room && !isConnecting && !hasStarted && !isUploadingResume) {
      // Small delay to ensure UI is ready
      const timer = setTimeout(() => {
        createMockInterviewRoom();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resumeFile, userName, isUploadingResume]);

  if (!room) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full flex items-center justify-center p-8">
          <div className="max-w-4xl w-full py-8">
            <div className="bg-gray-800/50 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-8 shadow-2xl">
              <div className="text-center mb-8">
                <div className="inline-block p-4 bg-gradient-to-br from-red-500 to-orange-600 rounded-2xl mb-4">
                  <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-3xl font-bold mb-2 bg-gradient-to-r from-red-400 to-orange-500 bg-clip-text text-transparent">
                  Mock Interview Mode
                </h2>
                <p className="text-gray-400">Real Interview Simulation - Video, Screen Share & Voice Required</p>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Your Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your full name"
                  className="w-full px-5 py-4 bg-gray-900/70 border border-cyan-500/30 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500 transition-all text-lg"
                  disabled={isConnecting}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 items-start">
                <div className="flex flex-col h-full">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Job Description <span className="text-gray-500">(Optional but Recommended)</span>
                  </label>
                  <textarea
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    placeholder="Enter job description for personalized interview..."
                    rows={10}
                    className="w-full px-5 py-4 bg-gray-900/70 border border-cyan-500/30 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500 transition-all resize-none"
                    disabled={isConnecting}
                  />
                </div>

                <div className="flex flex-col h-full">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Resume <span className="text-red-500">*</span> <span className="text-gray-500">(Required)</span>
                  </label>
                  <div className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl text-gray-400 transition-colors cursor-pointer flex-1 min-h-[200px] ${
                    isUploadingResume ? 'opacity-70 cursor-not-allowed' : resumeFile ? 'border-green-500/50 bg-green-900/20' : 'border-gray-700 hover:border-cyan-500/50 bg-gray-900/70'
                  }`}>
                    {isUploadingResume ? (
                      <div className="flex flex-col items-center">
                        <svg className="animate-spin h-8 w-8 text-cyan-400 mb-3" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <p className="text-sm text-cyan-400">Analyzing resume... {uploadProgress}%</p>
                        <div className="w-full bg-gray-800 rounded-full h-2 mt-3">
                          <div 
                            className="bg-gradient-to-r from-cyan-500 to-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                      </div>
                    ) : resumeFile ? (
                      <div className="flex flex-col items-center gap-3">
                        <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="text-sm text-green-400">{resumeFile.name} uploaded</p>
                        <button
                          onClick={() => {
                            setResumeFile(null);
                            setResumeId(null);
                          }}
                          className="text-red-400 hover:text-red-300 text-sm mt-2"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          type="file"
                          id="mock-resume-upload"
                          accept=".pdf,.doc,.docx"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              handleResumeUpload(file);
                            }
                          }}
                          className="hidden"
                        />
                        <label
                          htmlFor="mock-resume-upload"
                          className="cursor-pointer flex flex-col items-center gap-3"
                        >
                          <svg className="w-10 h-10 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                          </svg>
                          <span className="text-sm text-gray-300">Upload Resume (Required)</span>
                          <span className="text-xs text-gray-400">PDF, DOC, DOCX up to 5MB</span>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-xl text-red-300 flex items-center gap-2">
                  <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-xl p-4 mb-6">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <h3 className="text-yellow-400 font-semibold mb-1">Mock Interview Requirements</h3>
                    <ul className="text-sm text-yellow-200 space-y-1">
                      <li>• Resume is mandatory</li>
                      <li>• Camera, microphone, and screen share will be automatically enabled</li>
                      
                      <li>• Code Editor available for coding questions</li>
                      <li>• Interview starts automatically once you connect</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                onClick={createMockInterviewRoom}
                disabled={isConnecting || !userName.trim() || !resumeFile || isUploadingResume}
                className="w-full bg-gradient-to-r from-red-500 to-orange-600 text-white py-4 px-8 rounded-xl font-semibold text-lg hover:from-red-600 hover:to-orange-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all shadow-lg shadow-red-500/20 hover:shadow-xl hover:shadow-red-500/30 transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {isConnecting ? (
                  <span className="flex items-center justify-center gap-3">
                    <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Starting Mock Interview...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Start Mock Interview
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Mock Interview Active View
  return (
    <RoomContext.Provider value={room}>
      <MockInterviewActiveView 
        room={room}
        disconnect={disconnect}
      />
    </RoomContext.Provider>
  );
}

function MockInterviewActiveView({ 
  room: roomProp, 
  disconnect 
}: { 
  room: Room; 
  disconnect: () => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext() || roomProp;
  const chat = useChat();
  const microphoneToggle = useTrackToggle({ source: Track.Source.Microphone });
  const cameraToggle = useTrackToggle({ source: Track.Source.Camera });
  const screenShareToggle = useTrackToggle({ source: Track.Source.ScreenShare });

  const handleSendCode = (code: string, language: string) => {
    const codeMessage = `Here's my ${language} code:\n\`\`\`${language}\n${code}\n\`\`\`\n\nPlease review this code.`;
    chat.send(codeMessage);
  };

  // Get screen share track - check both local and remote participants
  const allTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: false });
  
  // Check local participant's screen share publication first
  const localScreenSharePublication = localParticipant?.getTrackPublication(Track.Source.ScreenShare);
  const localScreenShareTrack: TrackReference | undefined = useMemo(() => {
    if (!localScreenSharePublication || !localParticipant) return undefined;
    // Check if track exists and is not muted
    const hasTrack = localScreenSharePublication.track !== null;
    const isNotMuted = !localScreenSharePublication.isMuted;
    if (hasTrack && isNotMuted) {
      return {
        participant: localParticipant,
        source: Track.Source.ScreenShare,
        publication: localScreenSharePublication,
      };
    }
    return undefined;
  }, [localScreenSharePublication, localParticipant]);
  
  // Get remote screen share track
  const remoteScreenShareTrack = useMemo(() => {
    return allTracks.find(t => 
      t.source === Track.Source.ScreenShare && 
      t.participant !== localParticipant &&
      t.publication.track !== null &&
      !t.publication.isMuted
    );
  }, [allTracks, localParticipant]);
  
  // Get camera track from local participant
  const cameraPublication = localParticipant?.getTrackPublication(Track.Source.Camera);
  const cameraTrack: TrackReference | undefined = useMemo(() => {
    if (!cameraPublication || !localParticipant) return undefined;
    if (cameraPublication.track && !cameraPublication.isMuted) {
      return {
        participant: localParticipant,
        source: Track.Source.Camera,
        publication: cameraPublication,
      };
    }
    return undefined;
  }, [cameraPublication, localParticipant]);

  // Use local screen share track if available, otherwise use remote track
  const finalScreenShareTrack = localScreenShareTrack || remoteScreenShareTrack;
  const isCameraEnabled = cameraTrack && cameraTrack.publication.track && !cameraTrack.publication.isMuted;
  const isScreenShareEnabled = finalScreenShareTrack && 
                               finalScreenShareTrack.publication && 
                               finalScreenShareTrack.publication.track !== null && 
                               !finalScreenShareTrack.publication.isMuted;
  
  // Debug logging
  useEffect(() => {
    console.log('Screen share detection:', {
      localPublication: !!localScreenSharePublication,
      localTrack: !!localScreenShareTrack,
      remoteTrack: !!remoteScreenShareTrack,
      finalTrack: !!finalScreenShareTrack,
      isEnabled: isScreenShareEnabled,
      allTracksCount: allTracks.length,
      localTrackDetails: localScreenSharePublication ? {
        hasTrack: !!localScreenSharePublication.track,
        isMuted: localScreenSharePublication.isMuted,
        subscribed: localScreenSharePublication.isSubscribed,
      } : null
    });
  }, [localScreenSharePublication, localScreenShareTrack, remoteScreenShareTrack, finalScreenShareTrack, isScreenShareEnabled, allTracks.length]);

  // Force enable tracks on mount
  useEffect(() => {
    if (room && localParticipant) {
      const enableTracks = async () => {
        try {
          await localParticipant.setMicrophoneEnabled(true);
          await localParticipant.setCameraEnabled(true);
          // Note: Screen share needs to be started manually by user via browser prompt
          // We can't auto-enable it, but we can prompt or ensure it's ready
          console.log("Microphone and camera enabled for mock interview");
        } catch (error) {
          console.error("Error enabling tracks:", error);
        }
      };
      enableTracks();
    }
  }, [room, localParticipant]);

  useVoiceAssistant();
  useTranscriptions();

  return (
    <div className="h-full flex flex-col">
      <RoomAudioRenderer />
      <StartAudio label="Start Audio" />
      
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Panel - IDE (replaces chat) */}
        <div className="flex-[2] flex flex-col overflow-hidden border-r border-cyan-500/20 min-h-0">
          <div className="bg-gray-800/50 border-b border-cyan-500/20 p-3 flex items-center justify-between flex-shrink-0">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Code Editor</h3>
            <button
              onClick={disconnect}
              className="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors border border-red-500/30 text-sm"
            >
              End Interview
            </button>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <IDE onSendCode={handleSendCode} isConnected={!!room} />
          </div>
        </div>

        {/* Right Panel - Video Previews (equal split) */}
        <div className="flex-[1] flex flex-col border-l border-cyan-500/20 min-h-0">
          {/* Screen Share */}
          <div className="flex-1 flex flex-col border-b border-cyan-500/20 overflow-hidden min-h-0">
            <div className="p-2 border-b border-cyan-500/20 flex items-center justify-between flex-shrink-0">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Screen</h3>
            </div>
            <div className="flex-1 bg-black flex items-center justify-center p-1 min-h-0 relative">
              {isScreenShareEnabled && finalScreenShareTrack && finalScreenShareTrack.publication.track ? (
                <VideoTrack
                  trackRef={finalScreenShareTrack}
                  className="w-full h-full object-contain rounded"
                />
              ) : (
                <div className="text-center text-gray-500">
                  <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-xs">Screen share required</p>
                  <button
                    onClick={() => screenShareToggle.toggle()}
                    className="mt-2 px-3 py-1 bg-cyan-600/20 text-cyan-400 rounded text-xs hover:bg-cyan-600/30 transition-colors"
                  >
                    Start Screen Share
                  </button>
                </div>
              )}
            </div>
          </div>
          
          {/* Camera */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="p-2 border-b border-cyan-500/20 flex-shrink-0">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Camera</h3>
            </div>
            <div className="flex-1 bg-black flex items-center justify-center p-1 min-h-0">
              {isCameraEnabled && cameraTrack ? (
                <VideoTrack
                  trackRef={cameraTrack}
                  className="w-full h-full object-cover rounded"
                />
              ) : (
                <div className="text-center text-gray-500">
                  <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-xs">Camera required</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
