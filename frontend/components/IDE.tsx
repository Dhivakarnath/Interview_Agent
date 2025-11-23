'use client';

import { useState, useRef } from 'react';
import Editor from '@monaco-editor/react';

type Language = 'python' | 'javascript' | 'typescript' | 'java' | 'cpp' | 'csharp';

interface IDEProps {
  onSendCode: (code: string, language: string) => void;
  isConnected: boolean;
}

export default function IDE({ onSendCode, isConnected }: IDEProps) {
  const [code, setCode] = useState(`# Welcome to the Coding Practice IDE!
# Write your code here and click "Send Code" to get feedback from Nila

def example_function():
    # Your code here
    pass
`);
  const [language, setLanguage] = useState<Language>('python');
  const editorRef = useRef<any>(null);

  const languages: { value: Language; label: string }[] = [
    { value: 'python', label: 'Python' },
    { value: 'javascript', label: 'JavaScript' },
    { value: 'typescript', label: 'TypeScript' },
    { value: 'java', label: 'Java' },
    { value: 'cpp', label: 'C++' },
    { value: 'csharp', label: 'C#' },
  ];

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  const handleSendCode = () => {
    if (code.trim()) {
      onSendCode(code, language);
    }
  };

  const handleClear = () => {
    setCode('');
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-cyan-500/20 rounded-lg overflow-hidden">
      {/* IDE Header */}
      <div className="flex items-center justify-between p-3 bg-gray-800/50 border-b border-cyan-500/20">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-gray-300">Code Editor</h3>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="px-3 py-1 bg-gray-700 border border-cyan-500/30 rounded text-sm text-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
          >
            {languages.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
          >
            Clear
          </button>
          <button
            onClick={handleSendCode}
            disabled={!isConnected || !code.trim()}
            className="px-4 py-1.5 text-sm bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white rounded font-semibold transition-all disabled:from-gray-700 disabled:to-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send Code
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          value={code}
          onChange={(value) => setCode(value || '')}
          onMount={handleEditorDidMount}
          theme="vs-dark"
          options={{
            minimap: { enabled: true },
            fontSize: 14,
            lineNumbers: 'on',
            roundedSelection: false,
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            wordWrap: 'on',
            formatOnPaste: true,
            formatOnType: true,
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnEnter: 'on',
            quickSuggestions: true,
          }}
        />
      </div>

      {/* Footer Info */}
      <div className="p-2 bg-gray-800/30 border-t border-cyan-500/20 text-xs text-gray-400">
        💡 Tip: Write your code here and click "Send Code" to get real-time feedback from Nila
      </div>
    </div>
  );
}

