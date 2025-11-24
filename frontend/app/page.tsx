'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  RoomAudioRenderer, 
  StartAudio, 
  RoomContext,
  useTrackToggle,
  useLocalParticipant,
  useVoiceAssistant,
  useChat,
  useTranscriptions,
  useRoomContext,
  VideoTrack,
  useTracks,
  BarVisualizer,
  type ReceivedChatMessage,
  type TextStreamData,
  type TrackReference,
  type AgentState,
} from '@livekit/components-react';
import { Room, RoomEvent, RemoteParticipant, RemoteTrack, Track } from 'livekit-client';
import IDE from '../components/IDE';
import MockInterviewView from '../components/MockInterviewView';
import AnalysisView from '../components/AnalysisView';

type TabType = 'practice' | 'mock-interview' | 'analysis';

function cleanText(text: string): string {
  if (!text) return '';
  
  let cleaned = text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[\*\-\+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return cleaned;
}

function transcriptionToChatMessage(
  textStream: TextStreamData,
  room: Room
): ReceivedChatMessage {
  return {
    id: textStream.streamInfo.id,
    timestamp: textStream.streamInfo.timestamp,
    type: 'chatMessage',
    message: cleanText(textStream.text),
    from:
      textStream.participantInfo.identity === room.localParticipant.identity
        ? room.localParticipant
        : Array.from(room.remoteParticipants.values()).find(
            (p) => p.identity === textStream.participantInfo.identity
          ),
  };
}

function ChatEntry({ entry, hideName }: { entry: ReceivedChatMessage; hideName?: boolean }) {
  const isUser = entry.from?.isLocal ?? false;
  let displayName = isUser ? 'You' : 'Nila';
  if (isUser && entry.from?.name) {
    displayName = entry.from.name;
  } else if (!isUser) {
    displayName = 'Nila';
  }
  const time = new Date(entry.timestamp);
  
  const cleanedMessage = cleanText(entry.message);
  
  return (
    <li className="group flex flex-col gap-2 mb-4">
      {!hideName && (
        <div className="flex items-center gap-2 mb-1">
          <div className={`flex items-center gap-2 ${isUser ? 'ml-auto' : ''}`}>
            {!isUser && (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-xs font-semibold">
                N
              </div>
            )}
            <span className={`text-sm font-semibold ${isUser ? 'text-cyan-400' : 'text-blue-400'}`}>
              {displayName}
            </span>
            <span className="text-xs text-gray-500 font-mono">
              {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      )}
      <div
        className={`max-w-[75%] rounded-xl p-4 text-sm leading-relaxed ${
          isUser 
            ? 'ml-auto bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/20' 
            : 'mr-auto bg-gray-800/80 text-gray-100 border border-cyan-500/20 shadow-lg'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{cleanedMessage}</p>
      </div>
    </li>
  );
}

// Chat Input Component
function ChatInput({ onSend, disabled }: { onSend: (message: string) => void; disabled?: boolean }) {
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message.trim());
      setMessage('');
    }
  };

  useEffect(() => {
    if (!disabled) {
      inputRef.current?.focus();
    }
  }, [disabled]);

  return (
    <form onSubmit={handleSubmit} className="flex gap-3 items-center">
      <div className="flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          value={message}
          disabled={disabled}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type your response or question..."
          className="w-full px-5 py-3.5 bg-gray-900/70 border border-cyan-500/30 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        />
      </div>
      <button
        type="submit"
        disabled={disabled || !message.trim()}
        className="px-6 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl hover:from-cyan-600 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20 hover:shadow-xl hover:shadow-cyan-500/30"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
        <span className="hidden sm:inline">Send</span>
      </button>
    </form>
  );
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [jobDescription, setJobDescription] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [isUploadingResume, setIsUploadingResume] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [sessionData, setSessionData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabType>('practice');
  const [isIDEView, setIsIDEView] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleResumeUpload = async (file: File) => {
    setIsUploadingResume(true);
    setUploadProgress(0);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (userName.trim()) {
        formData.append('user_name', userName);
      }

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 200);

      const response = await fetch('http://localhost:8000/api/interview/upload-resume', {
        method: 'POST',
        body: formData,
      });

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (!response.ok) {
        throw new Error('Failed to upload resume');
      }

      const data = await response.json();
      setResumeId(data.resume_id);
      setResumeFile(file);
      
      // Wait a bit to show completion
      await new Promise(resolve => setTimeout(resolve, 500));
      setIsUploadingResume(false);
      setUploadProgress(0);
    } catch (err) {
      setIsUploadingResume(false);
      setUploadProgress(0);
      setError(err instanceof Error ? err.message : 'Failed to upload resume');
    }
  };

  const createRoom = async () => {
    if (!userName.trim()) {
      setError('Please enter your name');
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
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create room');
      }

      const data = await response.json();
      setSessionData(data);

      const newRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
      });

      newRoom.on(RoomEvent.Connected, () => {
        console.log('Connected to room');
        setIsConnecting(false);
      });

      newRoom.on(RoomEvent.Disconnected, () => {
        console.log('Disconnected from room');
        setRoom(null);
      });

      await newRoom.connect(data.livekit_url, data.token);
      await newRoom.localParticipant.setMicrophoneEnabled(true);

      setRoom(newRoom);
    } catch (err) {
      console.error('Error creating room:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setIsConnecting(false);
    }
  };

  const disconnect = async () => {
    if (room) {
      room.disconnect();
      setRoom(null);
      setSessionData(null);
    }
  };

  const updateName = async () => {
    if (!userName.trim()) return;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <div className="flex h-screen">
        {/* Sidebar */}
        <div className={`${isSidebarCollapsed ? 'w-16' : 'w-64'} bg-gray-900 border-r border-cyan-500/20 flex flex-col transition-all duration-300`}>
          <div className="p-6 border-b border-cyan-500/20 flex items-center justify-between">
            {!isSidebarCollapsed && (
              <>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                    TalentFlow
                  </h1>
                  <p className="text-gray-400 text-sm mt-1">Agentic Interview Partner</p>
                </div>
              </>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isSidebarCollapsed ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                )}
              </svg>
            </button>
          </div>

          <nav className="flex-1 p-4 space-y-2">
            <button
              onClick={() => {
                setActiveTab('practice');
                setIsIDEView(false);
              }}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                activeTab === 'practice' && !isIDEView
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                  : 'text-gray-400 hover:text-cyan-400 hover:bg-gray-800'
              }`}
              title={isSidebarCollapsed ? 'Practice with Agent' : ''}
            >
              {isSidebarCollapsed ? '🎤' : '🎤 Practice with Agent'}
            </button>
            <button
              onClick={() => {
                setActiveTab('mock-interview');
                setIsIDEView(false);
              }}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                activeTab === 'mock-interview'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                  : 'text-gray-400 hover:text-cyan-400 hover:bg-gray-800'
              }`}
              title={isSidebarCollapsed ? 'Mock Interviews' : ''}
            >
              {isSidebarCollapsed ? '🎯' : '🎯 Mock Interviews'}
            </button>
            {room && activeTab === 'practice' && (
              <button
                onClick={() => {
                  setActiveTab('practice');
                  setIsIDEView(!isIDEView);
                }}
                className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                  isIDEView
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                    : 'text-gray-400 hover:text-cyan-400 hover:bg-gray-800'
                }`}
                title={isSidebarCollapsed ? 'Code Editor' : ''}
              >
                {isSidebarCollapsed ? '💻' : '💻 Code Editor'}
              </button>
            )}
            <button
              onClick={() => {
                setActiveTab('analysis');
                setIsIDEView(false);
              }}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                activeTab === 'analysis'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                  : 'text-gray-400 hover:text-cyan-400 hover:bg-gray-800'
              }`}
              title={isSidebarCollapsed ? 'Analysis' : ''}
            >
              {isSidebarCollapsed ? '📊' : '📊 Analysis'}
            </button>
          </nav>

          {room && (
            <div className="p-4 border-t border-cyan-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-gray-400">Connected</span>
              </div>
              <button
                onClick={disconnect}
                className="w-full px-4 py-2 bg-red-600/20 text-red-400 rounded-lg hover:bg-red-600/30 transition-colors border border-red-500/30"
              >
                End Session
              </button>
            </div>
          )}
        </div>

                {/* Main Content */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  {activeTab === 'analysis' ? (
                    <div className="flex-1 overflow-y-auto">
                      <AnalysisView userName={userName} />
                    </div>
                  ) : activeTab === 'mock-interview' ? (
                    <div className="flex-1 overflow-y-auto">
                      <MockInterviewView
                        userName={userName}
                        setUserName={setUserName}
                        resumeFile={resumeFile}
                        setResumeFile={setResumeFile}
                        resumeId={resumeId}
                        setResumeId={setResumeId}
                        jobDescription={jobDescription}
                        setJobDescription={setJobDescription}
                        isUploadingResume={isUploadingResume}
                        setIsUploadingResume={setIsUploadingResume}
                        uploadProgress={uploadProgress}
                        setUploadProgress={setUploadProgress}
                        handleResumeUpload={handleResumeUpload}
                      />
                    </div>
                  ) : !room ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="max-w-5xl w-full">
                <div className="bg-gray-800/50 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-10 shadow-2xl">
                  {/* Professional Header */}
                  <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center gap-3 mb-6">
                      <div className="relative">
                        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl blur-lg opacity-50"></div>
                        <div className="relative bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl p-4">
                          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                        </div>
                      </div>
                      <div className="text-left">
                        <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                          Practice Mode
                        </h1>
                        <p className="text-gray-400 text-sm mt-1">Practice with the AI Interviewer</p>
                      </div>
                    </div>
                    <p className="text-gray-300 text-lg">Prepare for your next interview with personalized practice sessions</p>
                  </div>

                  {/* Name Input */}
                  <div className="mb-8">
                    <label className="block text-sm font-semibold text-gray-300 mb-3">
                      Your Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full px-5 py-4 bg-gray-900/70 border border-cyan-500/30 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500 transition-all text-lg"
                      disabled={isConnecting}
                      onKeyPress={(e) => e.key === 'Enter' && !isConnecting && userName.trim() && createRoom()}
                    />
                  </div>

                  {/* Professional Grid Layout for Job Description and Resume */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
                    {/* Job Description Section */}
                    <div className="flex flex-col">
                      <label className="block text-sm font-semibold text-gray-300 mb-3">
                        Job Description <span className="text-gray-500 font-normal">(Optional)</span>
                      </label>
                      <textarea
                        value={jobDescription}
                        onChange={(e) => setJobDescription(e.target.value)}
                        placeholder="Enter job description with the company name for better assistance..."
                        rows={10}
                        className="flex-1 w-full px-5 py-4 bg-gray-900/70 border border-cyan-500/30 rounded-xl focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500 transition-all resize-none"
                        disabled={isConnecting}
                      />
                      <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        Include company name and role details for personalized questions
                      </p>
                    </div>

                    {/* Resume Upload Section */}
                    <div className="flex flex-col">
                      <label className="block text-sm font-semibold text-gray-300 mb-3">
                        Resume <span className="text-gray-500 font-normal">(Optional)</span>
                      </label>
                      <div className="flex-1 border-2 border-dashed border-cyan-500/30 rounded-xl p-8 bg-gray-900/30 hover:border-cyan-500/50 transition-colors">
                        {isUploadingResume ? (
                          <div className="space-y-4 h-full flex flex-col justify-center">
                            <div className="flex items-center gap-3 text-cyan-400">
                              <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                              <span className="text-base font-medium">Analyzing resume...</span>
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-2.5">
                              <div 
                                className="bg-gradient-to-r from-cyan-500 to-blue-600 h-2.5 rounded-full transition-all duration-300"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                            <p className="text-sm text-gray-400 text-center">{uploadProgress}% complete</p>
                          </div>
                        ) : resumeFile ? (
                          <div className="flex flex-col h-full justify-center">
                            <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg border border-green-500/30">
                              <div className="flex items-center gap-3 text-green-400">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                  <span className="text-sm font-medium block">{resumeFile.name}</span>
                                  <span className="text-xs text-gray-400">Ready for analysis</span>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setResumeFile(null);
                                  setResumeId(null);
                                }}
                                className="text-red-400 hover:text-red-300 text-sm px-3 py-1 rounded hover:bg-red-500/10 transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-center">
                            <input
                              type="file"
                              id="resume-upload"
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
                              htmlFor="resume-upload"
                              className="cursor-pointer flex flex-col items-center gap-4 w-full"
                            >
                              <div className="p-4 bg-cyan-500/10 rounded-xl border border-cyan-500/30">
                                <svg className="w-12 h-12 text-cyan-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                              </div>
                              <div>
                                <span className="text-base font-medium text-gray-300 block mb-1">Upload Your Resume</span>
                                <span className="text-sm text-gray-400">PDF, DOC, or DOCX format</span>
                              </div>
                            </label>
                          </div>
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

                  <button
                    onClick={createRoom}
                    disabled={isConnecting || !userName.trim() || isUploadingResume}
                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white py-4 px-8 rounded-xl font-semibold text-lg hover:from-cyan-600 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/20 hover:shadow-xl hover:shadow-cyan-500/30 transform hover:scale-[1.02] active:scale-[0.98]"
                  >
                    {isConnecting ? (
                      <span className="flex items-center justify-center gap-3">
                        <svg className="animate-spin h-6 w-6" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Connecting to Interview Session...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Start Interview Session
                      </span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Tab Content */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === 'practice' && room ? (
                  <>
                    {/* Header */}
                    <div className="bg-gray-800/50 border-b border-cyan-500/20 p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-xl font-semibold text-cyan-400">Interview Session</h2>
                          <p className="text-sm text-gray-400">Candidate: <span className="text-cyan-400">{userName}</span></p>
                        </div>
                      </div>
                    </div>
                    <RoomContext.Provider value={room}>
                      <InterviewAgentView 
                        userName={userName}
                        setUserName={setUserName}
                        isIDEView={isIDEView}
                        setIsIDEView={setIsIDEView}
                        mode="practice"
                      />
                    </RoomContext.Provider>
                  </>
                ) : activeTab === 'practice' ? (
                  <div className="flex-1 flex items-center justify-center p-8">
                    <div className="text-center text-gray-400">
                      <p>Please start an interview session from the Practice with Agent tab.</p>
                    </div>
                  </div>
                ) : null}

              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InterviewAgentView({ 
  userName,
  setUserName,
  isIDEView,
  setIsIDEView,
  mode = 'practice',
}: {
  userName: string;
  setUserName: (name: string) => void;
  isIDEView: boolean;
  setIsIDEView: (value: boolean) => void;
  mode?: 'practice' | 'mock-interview';
}) {
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const room = useRoomContext();
  const microphoneToggle = useTrackToggle({ 
    source: Track.Source.Microphone,
  });
  
  // Camera and Screen Share toggles
  const cameraToggle = useTrackToggle({
    source: Track.Source.Camera,
  });
  
  const screenShareToggle = useTrackToggle({
    source: Track.Source.ScreenShare,
  });
  
  // Get camera and screen share tracks
  const [screenShareTrack] = useTracks([Track.Source.ScreenShare]);
  const cameraPublication = localParticipant?.getTrackPublication(Track.Source.Camera);
  const cameraTrack: TrackReference | undefined = useMemo(() => {
    if (!cameraPublication || !localParticipant) return undefined;
    return {
      participant: localParticipant,
      source: Track.Source.Camera,
      publication: cameraPublication,
    };
  }, [cameraPublication, localParticipant]);
  
  const isCameraEnabled = cameraTrack && !cameraTrack.publication.isMuted;
  const isScreenShareEnabled = screenShareTrack && !screenShareTrack.publication.isMuted;
  const hasVideo = isCameraEnabled || isScreenShareEnabled;
  
  // Get transcriptions and chat messages
  const transcriptions: TextStreamData[] = useTranscriptions();
  const chat = useChat();
  
  // Merge transcriptions and chat messages
  const messages = useMemo(() => {
    const merged: Array<ReceivedChatMessage> = [
      ...transcriptions.map((transcription) => transcriptionToChatMessage(transcription, room)),
      ...chat.chatMessages,
    ];
    return merged.sort((a, b) => a.timestamp - b.timestamp);
  }, [transcriptions, chat.chatMessages, room]);
  
  // Get agent state for indicator
  const { state: agentState, audioTrack: agentAudioTrack } = useVoiceAssistant();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Helper function to get agent state text
  const getAgentStateText = (state: AgentState): string => {
    switch(state) {
      case 'listening': return 'Agent listening';
      case 'thinking': return 'Agent thinking';
      case 'speaking': return 'Agent speaking';
      case 'connecting': return 'Connecting...';
      case 'initializing': return 'Initializing...';
      default: return '';
    }
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (message: string) => {
    if (message.toLowerCase().includes('my name is') || message.toLowerCase().startsWith('i am') || message.toLowerCase().startsWith('i\'m')) {
      const nameMatch = message.match(/(?:my name is|i am|i'm)\s+([a-zA-Z]+)/i);
      if (nameMatch && nameMatch[1]) {
        setUserName(nameMatch[1]);
      }
    }
    chat.send(message);
  };

  const handleSendCode = (code: string, language: string) => {
    // Format code message for agent
    const codeMessage = `Here's my ${language} code:\n\`\`\`${language}\n${code}\n\`\`\`\n\nPlease review this code and provide feedback.`;
    chat.send(codeMessage);
  };

  // Get audio track for visualizer
  const micTrackRef = useMemo(() => {
    if (!microphoneTrack || !localParticipant) return undefined;
    return {
      participant: localParticipant,
      source: Track.Source.Microphone,
      publication: microphoneTrack,
    };
  }, [localParticipant, microphoneTrack]);

  return (
    <>
      <RoomAudioRenderer />
      <StartAudio label="Start Audio" />
      
      <div className="flex-1 flex overflow-hidden">
        {/* IDE View - Split Layout */}
        {isIDEView ? (
          <>
            {/* Left Panel - IDE */}
            <div className="flex-1 flex flex-col overflow-hidden border-r border-cyan-500/20">
              <IDE onSendCode={handleSendCode} isConnected={!!room} />
            </div>
            
            {/* Right Panel - Chat */}
            <div className="w-96 flex flex-col overflow-hidden border-l border-cyan-500/20">
              {/* Chat Header */}
              <div className="bg-gray-800/50 border-b border-cyan-500/20 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Chat</h3>
                  <button
                    onClick={() => setIsIDEView(false)}
                    className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                    title="Close IDE"
                  >
                    Close IDE
                  </button>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 bg-gray-900/30 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-gray-900/50">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-xs font-medium">Code feedback will appear here</p>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {messages.map((msg, idx) => {
                      const prevMsg = idx > 0 ? messages[idx - 1] : null;
                      const hideName = prevMsg !== null && 
                                      prevMsg.from?.identity === msg.from?.identity && 
                                      prevMsg.from?.isLocal === msg.from?.isLocal &&
                                      (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) < 60000;
                      return (
                        <ChatEntry key={msg.id} entry={msg} hideName={hideName} />
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </ul>
                )}
              </div>
              
              {/* Agent State Indicator */}
              {agentState && agentState !== 'disconnected' && (
                <div className="agent-state-indicator bg-gradient-to-r from-cyan-500/25 to-cyan-400/15 border-t-2 border-cyan-400 px-3 py-3 flex items-center gap-3 shadow-lg shadow-cyan-500/20">
                  <div className="flex items-center gap-1.5 h-6 min-w-[60px] justify-center relative">
                    <BarVisualizer
                      barCount={5}
                      state={agentState}
                      trackRef={agentAudioTrack}
                      options={{ minHeight: 10, maxHeight: 20 }}
                      className="flex h-6 w-full items-center justify-center gap-1"
                    >
                      <span className="h-full w-1 origin-center rounded-full bg-cyan-400 data-[lk-highlighted=true]:bg-cyan-300 data-[lk-muted=true]:bg-cyan-500/50" />
                    </BarVisualizer>
                    {/* Fallback bars - always visible */}
                    <div className="flex items-center gap-1.5 absolute inset-0 pointer-events-none justify-center">
                      {[1, 2, 3, 4, 5].map((i) => {
                        const baseHeight = agentState === 'speaking' ? 14 : agentState === 'listening' ? 12 : agentState === 'thinking' ? 10 : 8;
                        return (
                          <div
                            key={i}
                            className="w-1.5 bg-cyan-400 rounded-full"
                            style={{
                              height: `${baseHeight + (i % 3) * 4}px`,
                              boxShadow: '0 0 12px rgba(34, 211, 238, 1), 0 0 24px rgba(34, 211, 238, 0.6)',
                              animation: `pulse ${0.8 + i * 0.15}s ease-in-out infinite`,
                              animationDelay: `${i * 0.1}s`,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <span className="text-sm text-cyan-100 font-bold tracking-wide drop-shadow-[0_0_10px_rgba(34,211,238,0.8)] whitespace-nowrap">
                    {getAgentStateText(agentState)}
                  </span>
                </div>
              )}
              
              {/* Chat Input */}
              <div className="bg-gray-800/50 border-t border-cyan-500/20 p-3">
                <ChatInput onSend={handleSendMessage} disabled={!room} />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Normal View - CHAT */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Chat Header */}
              <div className="bg-gray-800/50 border-b border-cyan-500/20 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Chat</h3>
                  <div className="flex items-center gap-2">
                {/* Camera Toggle */}
                <button
                  onClick={() => cameraToggle.toggle()}
                  disabled={cameraToggle.pending}
                  className={`p-2 rounded transition-all ${
                    isCameraEnabled
                      ? 'bg-blue-600/20 text-blue-400'
                      : 'bg-gray-700/20 text-gray-400'
                  } disabled:opacity-50`}
                  title="Toggle camera"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
                
                {/* Screen Share Toggle */}
                <button
                  onClick={() => screenShareToggle.toggle()}
                  disabled={screenShareToggle.pending}
                  className={`p-2 rounded transition-all ${
                    isScreenShareEnabled
                      ? 'bg-purple-600/20 text-purple-400'
                      : 'bg-gray-700/20 text-gray-400'
                  } disabled:opacity-50`}
                  title="Toggle screen share"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </button>
                
                {/* Mute Button */}
                <button
                  onClick={() => microphoneToggle.toggle()}
                  disabled={microphoneToggle.pending}
                  className={`p-2 rounded transition-all ${
                    microphoneToggle.enabled
                      ? 'bg-green-600/20 text-green-400'
                      : 'bg-red-600/20 text-red-400'
                  } disabled:opacity-50`}
                  title="Toggle microphone"
                >
                  {microphoneToggle.enabled ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-6 bg-gray-900/30 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-gray-900/50">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <svg className="w-16 h-16 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <p className="text-sm font-medium">Conversation will appear here</p>
                <p className="text-xs mt-1 text-gray-500">Start speaking or type a message to begin</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {messages.map((msg, idx) => {
                  const prevMsg = idx > 0 ? messages[idx - 1] : null;
                  const hideName = prevMsg !== null && 
                                  prevMsg.from?.identity === msg.from?.identity && 
                                  prevMsg.from?.isLocal === msg.from?.isLocal &&
                                  (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) < 60000;
                  return (
                    <ChatEntry key={msg.id} entry={msg} hideName={hideName} />
                  );
                })}
                <div ref={messagesEndRef} />
              </ul>
            )}
          </div>
          
          {/* Agent State Indicator */}
          {agentState && agentState !== 'disconnected' && (
            <div className="agent-state-indicator bg-gradient-to-r from-cyan-500/25 to-cyan-400/15 border-t-2 border-cyan-400 px-4 py-3 flex items-center gap-3 shadow-lg shadow-cyan-500/20">
              <div className="flex items-center gap-1.5 h-6 min-w-[60px] justify-center relative">
                <BarVisualizer
                  barCount={5}
                  state={agentState}
                  trackRef={agentAudioTrack}
                  options={{ minHeight: 10, maxHeight: 20 }}
                  className="flex h-6 w-full items-center justify-center gap-1"
                >
                  <span className="h-full w-1 origin-center rounded-full bg-cyan-400 data-[lk-highlighted=true]:bg-cyan-300 data-[lk-muted=true]:bg-cyan-500/50" />
                </BarVisualizer>
                {/* Fallback bars - always visible */}
                <div className="flex items-center gap-1.5 absolute inset-0 pointer-events-none justify-center">
                  {[1, 2, 3, 4, 5].map((i) => {
                    const baseHeight = agentState === 'speaking' ? 14 : agentState === 'listening' ? 12 : agentState === 'thinking' ? 10 : 8;
                    return (
                      <div
                        key={i}
                        className="w-1.5 bg-cyan-400 rounded-full"
                        style={{
                          height: `${baseHeight + (i % 3) * 4}px`,
                          boxShadow: '0 0 12px rgba(34, 211, 238, 1), 0 0 24px rgba(34, 211, 238, 0.6)',
                          animation: `pulse ${0.8 + i * 0.15}s ease-in-out infinite`,
                          animationDelay: `${i * 0.1}s`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <span className="text-sm text-cyan-100 font-bold tracking-wide drop-shadow-[0_0_10px_rgba(34,211,238,0.8)] whitespace-nowrap">
                {getAgentStateText(agentState)}
              </span>
            </div>
          )}
          
          {/* Chat Input */}
          <div className="bg-gray-800/50 border-t border-cyan-500/20 p-4">
            <ChatInput onSend={handleSendMessage} disabled={!room} />
          </div>
        </div>

        {/* Right Panel - SCREEN and CAMERA (split equally) */}
        <div className="w-80 flex flex-col border-l border-cyan-500/20">
          {/* SCREEN Section */}
          <div className="flex-1 flex flex-col border-b border-cyan-500/20">
            <div className="p-3 border-b border-cyan-500/20 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Screen</h3>
              {isScreenShareEnabled && (
                <button
                  onClick={() => screenShareToggle.toggle(false)}
                  className="text-gray-400 hover:text-red-400 transition-colors"
                  title="Stop sharing"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex-1 bg-black flex items-center justify-center p-2">
              {isScreenShareEnabled && screenShareTrack ? (
                <VideoTrack
                  trackRef={screenShareTrack}
                  className="w-full h-full object-contain rounded"
                />
              ) : (
                <div className="text-center text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <p className="text-xs">No screen share</p>
                </div>
              )}
            </div>
          </div>
          
          {/* CAMERA Section */}
          <div className="flex-1 flex flex-col">
            <div className="p-3 border-b border-cyan-500/20 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Camera</h3>
              {isCameraEnabled && cameraTrack && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span>MacBook Air</span>
                </div>
              )}
            </div>
            <div className="flex-1 bg-black flex items-center justify-center p-2">
              {isCameraEnabled && cameraTrack ? (
                <VideoTrack
                  trackRef={cameraTrack}
                  className="w-full h-full object-cover rounded"
                />
              ) : (
                <div className="text-center text-gray-500">
                  <svg className="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <p className="text-xs">No camera</p>
                </div>
              )}
            </div>
          </div>
        </div>
          </>
        )}
      </div>
    </>
  );
}
