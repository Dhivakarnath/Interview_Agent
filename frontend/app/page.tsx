'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  RoomAudioRenderer, 
  StartAudio, 
  RoomContext,
  BarVisualizer,
  useTrackToggle,
  useLocalParticipant,
  useVoiceAssistant,
  useChat,
  useTranscriptions,
  useRoomContext,
  type ReceivedChatMessage,
  type TextStreamData,
} from '@livekit/components-react';
import { Room, RoomEvent, RemoteParticipant, RemoteTrack, Track } from 'livekit-client';

type TabType = 'interview' | 'settings';

// Helper function to convert transcription to chat message
function transcriptionToChatMessage(
  textStream: TextStreamData,
  room: Room
): ReceivedChatMessage {
  return {
    id: textStream.streamInfo.id,
    timestamp: textStream.streamInfo.timestamp,
    type: 'chatMessage',
    message: textStream.text,
    from:
      textStream.participantInfo.identity === room.localParticipant.identity
        ? room.localParticipant
        : Array.from(room.remoteParticipants.values()).find(
            (p) => p.identity === textStream.participantInfo.identity
          ),
  };
}

// Chat Entry Component
function ChatEntry({ entry, hideName }: { entry: ReceivedChatMessage; hideName?: boolean }) {
  const isUser = entry.from?.isLocal ?? false;
  // Use "Nila" as agent name, fallback to name or identity
  let displayName = isUser ? 'You' : 'Nila';
  if (isUser && entry.from?.name) {
    displayName = entry.from.name;
  } else if (!isUser) {
    // Always show "Nila" for agent, regardless of identity
    displayName = 'Nila';
  }
  const time = new Date(entry.timestamp);
  
  return (
    <li className="group flex flex-col gap-0.5">
      {!hideName && (
        <span className="text-gray-400 flex text-xs mb-1">
          <strong>{displayName}</strong>
          <span className="ml-auto font-mono text-xs opacity-70">
            {time.toLocaleTimeString('en-US', { timeStyle: 'short' })}
          </span>
        </span>
      )}
      <span
        className={`max-w-[80%] rounded-[20px] p-3 text-sm ${
          isUser 
            ? 'ml-auto bg-gradient-to-r from-cyan-500 to-blue-600 text-white' 
            : 'mr-auto bg-gray-700/70 text-gray-200 border border-cyan-500/30'
        }`}
      >
        {entry.message}
      </span>
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
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        ref={inputRef}
        type="text"
        value={message}
        disabled={disabled}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your message..."
        className="flex-1 px-4 py-3 bg-gray-800/50 border border-cyan-500/30 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      <button
        type="submit"
        disabled={disabled || !message.trim()}
        className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all flex items-center justify-center"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      </button>
    </form>
  );
}

export default function Home() {
  const [room, setRoom] = useState<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [sessionData, setSessionData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<TabType>('interview');
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        <div className="w-64 bg-gray-900 border-r border-cyan-500/20 flex flex-col">
          <div className="p-6 border-b border-cyan-500/20">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Interview Practice
            </h1>
            <p className="text-gray-400 text-sm mt-1">AI-Powered Mock Interviews</p>
          </div>

          <nav className="flex-1 p-4 space-y-2">
            <button
              onClick={() => setActiveTab('interview')}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                activeTab === 'interview'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                  : 'text-gray-400 hover:text-cyan-400 hover:bg-gray-800'
              }`}
            >
              🎤 Interview Agent
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full text-left px-4 py-3 rounded-lg transition-all ${
                activeTab === 'settings'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                  : 'text-gray-400 hover:text-cyan-400 hover:bg-gray-800'
              }`}
            >
              ⚙️ Settings
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
          {!room ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="max-w-md w-full">
                <div className="bg-gray-800/50 backdrop-blur-sm border border-cyan-500/30 rounded-2xl p-8 shadow-2xl">
                  <div className="text-center mb-8">
                    <div className="inline-block p-4 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl mb-4">
                      <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </div>
                    <h2 className="text-3xl font-bold mb-2 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                      Start Your Interview
                    </h2>
                    <p className="text-gray-400">Enter your name to begin practicing</p>
                  </div>

                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Your Name
                    </label>
                    <input
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Enter your name"
                      className="w-full px-4 py-3 bg-gray-900/50 border border-cyan-500/30 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500 transition-all"
                      disabled={isConnecting}
                      onKeyPress={(e) => e.key === 'Enter' && !isConnecting && userName.trim() && createRoom()}
                    />
                  </div>

                  {error && (
                    <div className="mb-4 p-4 bg-red-900/30 border border-red-500/50 rounded-lg text-red-300">
                      {error}
                    </div>
                  )}

                  <button
                    onClick={createRoom}
                    disabled={isConnecting || !userName.trim()}
                    className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white py-3 px-6 rounded-lg font-semibold hover:from-cyan-600 hover:to-blue-700 disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/20"
                  >
                    {isConnecting ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Connecting...
                      </span>
                    ) : (
                      'Start Interview Session'
                    )}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header */}
              <div className="bg-gray-800/50 border-b border-cyan-500/20 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-semibold text-cyan-400">Interview Session</h2>
                    <p className="text-sm text-gray-400">Candidate: <span className="text-cyan-400">{userName}</span></p>
                  </div>
                </div>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {activeTab === 'interview' && room && (
                  <RoomContext.Provider value={room}>
                    <InterviewAgentView 
                      userName={userName}
                      setUserName={setUserName}
                    />
                  </RoomContext.Provider>
                )}

                {activeTab === 'settings' && (
                  <div className="flex-1 overflow-auto p-6">
                    <div className="max-w-4xl mx-auto">
                      <div className="bg-gray-800/50 backdrop-blur-sm border border-cyan-500/30 rounded-xl p-8">
                        <h3 className="text-xl font-semibold mb-6 text-cyan-400 flex items-center gap-2">
                          <span>⚙️</span> Settings
                        </h3>
                        
                        <div className="space-y-6">
                          <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                              Your Name
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                                placeholder="Enter your name"
                                className="flex-1 px-4 py-3 bg-gray-900/50 border border-cyan-500/30 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500"
                                onKeyPress={(e) => e.key === 'Enter' && updateName()}
                              />
                              <button
                                onClick={updateName}
                                className="px-6 py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 transition-all"
                              >
                                Update
                              </button>
                            </div>
                          </div>

                          <div className="border-t border-cyan-500/20 pt-6">
                            <h4 className="text-sm font-semibold text-gray-300 mb-4">Session Information</h4>
                            <div className="space-y-2 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Room Name:</span>
                                <span className="font-mono text-cyan-400">{sessionData?.room_name}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Session ID:</span>
                                <span className="font-mono text-cyan-400">{sessionData?.session_id}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Status:</span>
                                <span className="text-green-400">Active</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
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
}: {
  userName: string;
  setUserName: (name: string) => void;
}) {
  const { localParticipant, microphoneTrack } = useLocalParticipant();
  const room = useRoomContext();
  const microphoneToggle = useTrackToggle({ 
    source: Track.Source.Microphone,
  });
  
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
  
  // Create track reference for microphone visualizer
  const micTrackRef = useMemo(() => {
    if (!microphoneTrack || !localParticipant) return undefined;
    return {
      participant: localParticipant,
      source: Track.Source.Microphone,
      publication: microphoneTrack,
    };
  }, [localParticipant, microphoneTrack]);
  
  const { state: agentState, audioTrack: agentAudioTrack } = useVoiceAssistant();
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  return (
    <>
      <RoomAudioRenderer />
      <StartAudio label="Start Audio" />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Audio Visualizer Section */}
        <div className="bg-gray-800/50 border-b border-cyan-500/20 p-6">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-cyan-400">Voice Activity</h3>
              <div className="flex items-center gap-3">
                {/* Mute Button */}
                <button
                  onClick={() => microphoneToggle.toggle()}
                  disabled={microphoneToggle.pending}
                  className={`px-4 py-2 rounded-lg transition-all flex items-center gap-2 ${
                    microphoneToggle.enabled
                      ? 'bg-green-600/20 text-green-400 border border-green-500/50 hover:bg-green-600/30'
                      : 'bg-red-600/20 text-red-400 border border-red-500/50 hover:bg-red-600/30'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {microphoneToggle.pending ? (
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : microphoneToggle.enabled ? (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                      <span>Unmuted</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      </svg>
                      <span>Muted</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            
            {/* Audio Visualizer - 5 bars like LiveKit */}
            <div className="bg-gray-900/50 border border-cyan-500/30 rounded-xl p-6 flex items-center justify-center gap-3 h-32 min-h-[128px]">
              {/* User Microphone Visualizer */}
              {micTrackRef ? (
                <div className="flex flex-col items-center gap-2 flex-1">
                  <div className="text-xs text-gray-400 mb-2">You</div>
                  <div className="flex items-end justify-center gap-1 h-16">
                    <BarVisualizer
                      barCount={5}
                      options={{ minHeight: 8 }}
                      trackRef={micTrackRef}
                      className="flex h-full items-end justify-center gap-1"
                    >
                      <span className="h-full w-2 origin-bottom rounded-full bg-gradient-to-t from-cyan-500 to-blue-500 transition-all duration-150" />
                    </BarVisualizer>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 flex-1">
                  <div className="text-xs text-gray-400 mb-2">You</div>
                  <div className="flex items-end justify-center gap-1 h-16">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="w-2 bg-gray-700/30 rounded-full"
                        style={{ height: '8px' }}
                      />
                    ))}
                  </div>
                </div>
              )}
              
              {/* Agent Audio Visualizer */}
              {agentAudioTrack ? (
                <div className="flex flex-col items-center gap-2 ml-4 pl-4 border-l border-cyan-500/30 flex-1">
                  <div className="text-xs text-gray-400 mb-2">Nila</div>
                  <div className="flex items-end justify-center gap-1 h-16">
                    <BarVisualizer
                      barCount={5}
                      state={agentState}
                      options={{ minHeight: 8 }}
                      trackRef={agentAudioTrack}
                      className="flex h-full items-end justify-center gap-1"
                    >
                      <span className="h-full w-2 origin-bottom rounded-full bg-gradient-to-t from-blue-500 to-cyan-500 transition-all duration-150" />
                    </BarVisualizer>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 ml-4 pl-4 border-l border-cyan-500/30 flex-1">
                  <div className="text-xs text-gray-400 mb-2">Nila</div>
                  <div className="flex items-end justify-center gap-1 h-16">
                    {[...Array(5)].map((_, i) => (
                      <div
                        key={i}
                        className="w-2 bg-gray-700/30 rounded-full"
                        style={{ height: '8px' }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat & Transcript Section */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-900/30">
          <div className="max-w-4xl mx-auto w-full flex-1 flex flex-col p-6">
            <h3 className="text-lg font-semibold mb-4 text-cyan-400 flex items-center gap-2">
              <span>💬</span> Chat & Transcript
            </h3>
            
            <div className="flex-1 overflow-y-auto mb-4 p-4 bg-gray-800/50 rounded-lg border border-cyan-500/10 scrollbar-thin scrollbar-thumb-cyan-500/30 scrollbar-track-gray-900/50" style={{ maxHeight: 'calc(100vh - 500px)', minHeight: '300px' }}>
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <p className="text-sm">No messages yet. Start speaking or type a message.</p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {messages.map((msg, idx) => {
                    const prevMsg = idx > 0 ? messages[idx - 1] : null;
                    const hideName = prevMsg?.from?.identity === msg.from?.identity && 
                                    prevMsg?.from?.isLocal === msg.from?.isLocal;
                    return (
                      <ChatEntry key={msg.id} entry={msg} hideName={hideName} />
                    );
                  })}
                  <div ref={messagesEndRef} />
                </ul>
              )}
            </div>
            
            <ChatInput onSend={handleSendMessage} disabled={!room} />
          </div>
        </div>
      </div>
    </>
  );
}
