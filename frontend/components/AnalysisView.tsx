'use client';

import { useState, useEffect } from 'react';

// Helper function to clean markdown and format text professionally
function cleanMarkdown(text: string): string {
  if (!text) return '';
  
  // Remove markdown formatting
  let cleaned = text
    // Remove bold/italic markers
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    // Remove links but keep text
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    // Remove headers (but keep the text)
    .replace(/^#{1,6}\s+(.+)$/gm, '$1')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  return cleaned;
}

interface Feedback {
  _id: string;
  session_id: string;
  user_name: string;
  feedback_text: string;
  sections: Record<string, string>;
  created_at: string;
  interview_mode: string;
  job_description?: string;
}

interface AnalysisViewProps {
  userName: string;
}

export default function AnalysisView({ userName }: AnalysisViewProps) {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [allFeedbacks, setAllFeedbacks] = useState<Feedback[]>([]);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [interviewModeFilter, setInterviewModeFilter] = useState<'all' | 'mock-interview' | 'practice'>('all');

  const applyFilters = (feedbacksToFilter: Feedback[] = allFeedbacks) => {
    let filtered = feedbacksToFilter;
    
    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(feedback =>
        feedback.session_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        feedback.user_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (feedback.job_description && feedback.job_description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    // Apply interview mode filter
    if (interviewModeFilter !== 'all') {
      filtered = filtered.filter(feedback => feedback.interview_mode === interviewModeFilter);
    }
    
    setFeedbacks(filtered);
    
    // Update selected feedback if it's still in filtered list
    if (selectedFeedback && !filtered.find(f => f._id === selectedFeedback._id)) {
      setSelectedFeedback(filtered.length > 0 ? filtered[0] : null);
    } else if (!selectedFeedback && filtered.length > 0) {
      setSelectedFeedback(filtered[0]);
    }
  };

  const fetchFeedbacks = async (silent: boolean = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);
      
      // Build URL - use /api/feedback/user endpoint if userName is empty, otherwise use /api/feedback/user/{userName}
      const url = userName && userName.trim() !== '' 
        ? `http://localhost:8000/api/feedback/user/${encodeURIComponent(userName)}`
        : `http://localhost:8000/api/feedback/user`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        // If it's a 404 or 503, show a user-friendly message instead of error
        if (response.status === 404 || response.status === 503) {
          setAllFeedbacks([]);
          applyFilters([]);
          if (!silent) {
            setError(null); // Don't show error, just show "no feedbacks available"
          }
          return;
        }
        throw new Error('Failed to fetch feedback');
      }
      
      const data = await response.json();
      const feedbacks = data.feedbacks || [];
      setAllFeedbacks(feedbacks);
      applyFilters(feedbacks);
      
      // Select the most recent feedback by default if none selected
      if (!selectedFeedback && feedbacks.length > 0) {
        setSelectedFeedback(feedbacks[0]);
      }
    } catch (err) {
      console.error('Error fetching feedbacks:', err);
      // On error, set empty array and don't show error - just show "no feedbacks available"
      setAllFeedbacks([]);
      applyFilters([]);
      if (!silent) {
        setError(null); // Don't show error message, UI will show "no feedbacks available"
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  // Fetch feedbacks when component mounts or userName changes
  useEffect(() => {
    fetchFeedbacks(false);
  }, [userName]);

  // Apply filters when search or filter changes
  useEffect(() => {
    applyFilters();
  }, [searchQuery, interviewModeFilter, allFeedbacks]);

  const downloadFeedback = (feedback: Feedback) => {
    // Build content with cleaned markdown
    let content = `Interview Feedback Report
Generated: ${new Date(feedback.created_at).toLocaleString()}
Session ID: ${feedback.session_id}
Candidate: ${feedback.user_name}
Interview Mode: ${feedback.interview_mode}

`;

    // Add sections with cleaned markdown
    if (feedback.sections && Object.keys(feedback.sections).length > 0) {
      Object.entries(feedback.sections).forEach(([sectionTitle, sectionContent]) => {
        const cleanedTitle = cleanMarkdown(sectionTitle);
        const cleanedContent = cleanMarkdown(sectionContent);
        content += `\n${cleanedTitle}\n${'='.repeat(cleanedTitle.length)}\n${cleanedContent}\n`;
      });
    } else if (feedback.feedback_text) {
      // Fallback to feedback_text if sections are not available
      content += cleanMarkdown(feedback.feedback_text);
    }

    // Add job description if available
    if (feedback.job_description) {
      content += `\n\n${'='.repeat(50)}\nJob Description\n${'='.repeat(50)}\n${cleanMarkdown(feedback.job_description)}\n`;
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `interview-feedback-${feedback.session_id}-${new Date(feedback.created_at).toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading && allFeedbacks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-12 w-12 text-cyan-400 mx-auto mb-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-400">Loading feedback...</p>
        </div>
      </div>
    );
  }

  // Don't show error state - just show "No feedbacks available" instead

  if (allFeedbacks.length === 0 && !loading && !error) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <svg className="w-16 h-16 text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-xl font-semibold text-gray-300 mb-2">No Feedback Available</h3>
          <p className="text-gray-400">
            Complete a mock interview session to receive detailed feedback and analysis.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with Search and Refresh */}
      <div className="bg-gray-800/50 border-b border-cyan-500/20 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-cyan-400">Interview Analysis</h1>
            <p className="text-sm text-gray-400 mt-1">
              View detailed feedback from your mock interview sessions
            </p>
          </div>
          <button
            onClick={() => fetchFeedbacks(false)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 disabled:opacity-50 transition-all"
            title="Refresh feedback list"
          >
            <svg className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{loading ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        </div>

        {/* Search and Filters */}
        <div className="flex gap-4">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search by session ID, user name, job description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-gray-900/70 border border-cyan-500/30 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white placeholder-gray-500"
            />
          </div>
          
          <select
            value={interviewModeFilter}
            onChange={(e) => setInterviewModeFilter(e.target.value as 'all' | 'mock-interview' | 'practice')}
            className="px-4 py-2 bg-gray-900/70 border border-cyan-500/30 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-white"
          >
            <option value="all">All Sessions</option>
            <option value="mock-interview">Mock Interviews</option>
            <option value="practice">Practice Sessions</option>
          </select>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Feedback List */}
        <div className="w-80 border-r border-cyan-500/20 overflow-y-auto">
          <div className="p-4 border-b border-cyan-500/20">
            <h2 className="text-lg font-semibold text-cyan-400">Feedback Sessions</h2>
            <p className="text-sm text-gray-400 mt-1">
              {feedbacks.length} of {allFeedbacks.length} session{allFeedbacks.length !== 1 ? 's' : ''}
            </p>
          </div>
        
        <div className="p-2">
          {feedbacks.length === 0 ? (
            <div className="p-4 text-center text-gray-400">
              <p className="text-sm">
                {searchQuery || interviewModeFilter !== 'all' 
                  ? 'No feedback matches your search criteria' 
                  : 'No feedback available'}
              </p>
            </div>
          ) : (
            feedbacks.map((feedback) => (
              <button
                key={feedback._id}
                onClick={() => setSelectedFeedback(feedback)}
                className={`w-full text-left p-4 rounded-lg mb-2 transition-all ${
                  selectedFeedback?._id === feedback._id
                    ? 'bg-cyan-500/20 border border-cyan-500/50'
                    : 'bg-gray-800/50 border border-gray-700 hover:border-cyan-500/30'
                }`}
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="text-sm font-medium text-gray-300">
                    {formatDate(feedback.created_at)}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    feedback.interview_mode === 'mock-interview'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}>
                    {feedback.interview_mode === 'mock-interview' ? 'Mock' : 'Practice'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">
                  Session: {feedback.session_id.substring(0, 8)}...
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main Content - Feedback Details */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedFeedback ? (
          <div className="max-w-4xl mx-auto">
            <div className="bg-gray-800/50 backdrop-blur-sm border border-cyan-500/30 rounded-xl p-8 shadow-2xl">
              {/* Header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-cyan-400 mb-2">Interview Feedback</h1>
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span>Session: {selectedFeedback.session_id}</span>
                    <span>•</span>
                    <span>{formatDate(selectedFeedback.created_at)}</span>
                    <span>•</span>
                    <span className={`px-2 py-1 rounded ${
                      selectedFeedback.interview_mode === 'mock-interview'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-blue-500/20 text-blue-400'
                    }`}>
                      {selectedFeedback.interview_mode === 'mock-interview' ? 'Mock Interview' : 'Practice Session'}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => downloadFeedback(selectedFeedback)}
                  className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 transition-all flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
              </div>

              {/* Job Description */}
              {selectedFeedback.job_description && (
                <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-cyan-500/20">
                  <h3 className="text-sm font-semibold text-cyan-400 mb-2">Job Description</h3>
                  <p className="text-sm text-gray-300 whitespace-pre-wrap">{selectedFeedback.job_description}</p>
                </div>
              )}

              {/* Feedback Sections */}
              <div className="space-y-6">
                {Object.entries(selectedFeedback.sections).map(([sectionTitle, sectionContent]) => {
                  // Check if this is a strengths or weaknesses section to highlight scores
                  const isStrengths = sectionTitle.toLowerCase().includes('strength');
                  const isWeaknesses = sectionTitle.toLowerCase().includes('weakness');
                  const isScores = sectionTitle.toLowerCase().includes('score') || sectionTitle.toLowerCase().includes('rating');
                  
                  return (
                    <div key={sectionTitle} className="border-b border-cyan-500/20 pb-6 last:border-b-0">
                      <h2 className={`text-xl font-semibold mb-3 ${
                        isStrengths ? 'text-green-400' : 
                        isWeaknesses ? 'text-red-400' : 
                        isScores ? 'text-yellow-400' : 
                        'text-cyan-400'
                      }`}>
                        {cleanMarkdown(sectionTitle)}
                      </h2>
                      <div className={`leading-relaxed ${
                        isStrengths ? 'text-green-200' : 
                        isWeaknesses ? 'text-red-200' : 
                        'text-gray-300'
                      }`}>
                        {cleanMarkdown(sectionContent).split('\n').map((line, idx) => {
                          const trimmedLine = line.trim();
                          if (!trimmedLine) return null;
                          
                          // Check if line starts with bullet point
                          const isBullet = trimmedLine.startsWith('-') || trimmedLine.startsWith('•');
                          const displayLine = cleanMarkdown(isBullet ? trimmedLine.substring(1).trim() : trimmedLine);
                          
                          // Highlight scores (X/10 pattern)
                          const scoreMatch = displayLine.match(/(\d+\/10)/g);
                          if (scoreMatch) {
                            return (
                              <div key={idx} className={`mb-3 flex items-start gap-2 ${isBullet ? 'pl-4' : ''}`}>
                                {isBullet && (
                                  <span className="text-cyan-400 mt-1">•</span>
                                )}
                                <div className="flex-1">
                                  {displayLine.split(/(\d+\/10)/g).map((part, partIdx) => 
                                    part.match(/^\d+\/10$/) ? (
                                      <span key={partIdx} className="font-bold text-yellow-400 bg-yellow-400/20 px-2 py-1 rounded mx-1">
                                        {part}
                                      </span>
                                    ) : (
                                      <span key={partIdx}>{part}</span>
                                    )
                                  )}
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div key={idx} className={`mb-3 ${isBullet ? 'flex items-start gap-2 pl-4' : ''}`}>
                              {isBullet && (
                                <span className="text-cyan-400 mt-1">•</span>
                              )}
                              <span className={isBullet ? 'flex-1' : ''}>{displayLine}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Only show full feedback text if sections are empty or incomplete */}
                {selectedFeedback.feedback_text && Object.keys(selectedFeedback.sections).length === 0 && (
                  <div className="mt-8 p-6 bg-gray-900/50 rounded-lg border border-cyan-500/20">
                    <h2 className="text-xl font-semibold text-cyan-400 mb-3">Complete Feedback</h2>
                    <div className="text-gray-300 whitespace-pre-wrap leading-relaxed">
                      {cleanMarkdown(selectedFeedback.feedback_text)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400">Select a feedback session to view details</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

