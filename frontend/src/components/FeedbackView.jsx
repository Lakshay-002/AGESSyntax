import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { 
  ShieldAlert, 
  CheckCircle, 
  Copy, 
  AlertTriangle, 
  Terminal, 
  Sparkles,
  BookOpen,
  Info,
  Layers,
  Wand2
} from 'lucide-react';

export default function FeedbackView({ 
  analysis, 
  language, 
  selectedErrorLine, 
  setSelectedErrorLine 
}) {
  const [activeTab, setActiveTab] = useState('diagnostics');
  const [copied, setCopied] = useState(false);

  if (!analysis) {
    return (
      <div className="glass-card border-slate-900 rounded-2xl p-8 flex flex-col items-center justify-center text-center h-[520px] font-mono text-slate-500 text-xs italic">
        <Terminal className="w-8 h-8 mb-4 text-slate-700 animate-pulse" />
        Input code in the editor and click "Analyze Algorithm" to run the syntax diagnostics scan.
      </div>
    );
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(analysis.improvedCode || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getMonacoLanguage = (lang) => {
    const l = lang.toLowerCase();
    if (l === 'react') return 'typescript';
    if (l === 'javascript') return 'javascript';
    if (l === 'python') return 'python';
    if (l === 'java') return 'java';
    if (l === 'css') return 'css';
    return 'javascript';
  };

  const monacoLanguage = getMonacoLanguage(language);

  // Check if syntax status indicates success
  const isSyntaxClean = analysis.syntaxStatus && 
    analysis.syntaxStatus.toLowerCase().includes('no major syntax issues');

  return (
    <div className="glass-card border-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[520px]">
      
      {/* Tab controls */}
      <div className="h-14 bg-slate-950/80 border-b border-slate-900 px-4 flex items-center justify-between">
        <div className="flex bg-slate-950 border border-slate-900 p-0.5 rounded-lg w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-[10px] font-mono transition-all cursor-pointer ${
              activeTab === 'diagnostics'
                ? 'bg-slate-900 text-blue-400 font-bold border border-slate-800'
                : 'text-slate-500 hover:text-slate-350'
            }`}
          >
            ERRORS & MENTOR
          </button>
          <button
            onClick={() => setActiveTab('formatting')}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-[10px] font-mono transition-all cursor-pointer ${
              activeTab === 'formatting'
                ? 'bg-slate-900 text-blue-400 font-bold border border-slate-800'
                : 'text-slate-500 hover:text-slate-350'
            }`}
          >
            COMPLEXITY & STYLE
          </button>
          <button
            onClick={() => setActiveTab('refactoring')}
            className={`flex-1 sm:flex-none px-4 py-1.5 rounded-md text-[10px] font-mono transition-all cursor-pointer ${
              activeTab === 'refactoring'
                ? 'bg-slate-900 text-blue-400 font-bold border border-slate-800'
                : 'text-slate-500 hover:text-slate-350'
            }`}
          >
            CORRECTED CODE
          </button>
        </div>
      </div>

      {/* Tab panels */}
      <div className="flex-1 overflow-y-auto p-5 custom-scrollbar bg-slate-950/30">
        
        {/* TAB 1: DIAGNOSTICS & MENTOR NOTES */}
        {activeTab === 'diagnostics' && (
          <div className="space-y-6 animate-fadeIn font-mono text-[11px]">
            {/* Syntax Status Banner */}
            <div className="space-y-2">
              <span className="text-[9px] text-slate-500 uppercase tracking-widest block font-bold">Syntax Diagnostic Status</span>
              {isSyntaxClean ? (
                <div className="p-3.5 bg-emerald-950/30 border border-emerald-900/50 text-emerald-400 rounded-xl flex items-center gap-2.5 font-sans font-semibold">
                  <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>No major syntax issues found.</span>
                </div>
              ) : (
                <div className="p-3.5 bg-rose-950/30 border border-rose-900/50 text-rose-450 rounded-xl flex items-center gap-2.5 font-sans font-semibold">
                  <AlertTriangle className="w-4 h-4 text-rose-450 shrink-0" />
                  <span>Syntax errors detected. Click error cards to locate them.</span>
                </div>
              )}
            </div>

            {/* Discovered Errors Feed */}
            <div className="space-y-3">
              <span className="text-[9px] text-slate-500 uppercase tracking-widest block font-bold border-b border-slate-900 pb-2 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                Discovered Errors ({analysis.errors?.length || 0})
              </span>

              {(!analysis.errors || analysis.errors.length === 0) ? (
                <div className="p-4 bg-slate-950/50 border border-dashed border-slate-900 rounded-xl text-slate-650 text-center italic font-sans">
                  The parser verified complete code syntax. No issues.
                </div>
              ) : (
                <div className="space-y-3">
                  {analysis.errors.map((errorItem, idx) => {
                    const isSelected = selectedErrorLine === errorItem.line;
                    
                    let cardBorderColor = 'border-slate-900 hover:border-slate-800 bg-slate-950/50';
                    let severityTextClass = 'text-slate-500';
                    if (errorItem.severity === 'Critical') {
                      cardBorderColor = isSelected ? 'border-rose-800 bg-rose-950/20 shadow-[0_0_12px_rgba(244,63,94,0.15)]' : 'border-rose-950/40 bg-slate-950/80 hover:border-rose-900/40';
                      severityTextClass = 'text-rose-400 font-bold';
                    } else if (errorItem.severity === 'High') {
                      cardBorderColor = isSelected ? 'border-amber-800 bg-amber-950/20 shadow-[0_0_12px_rgba(245,158,11,0.15)]' : 'border-amber-950/40 bg-slate-950/80 hover:border-amber-900/40';
                      severityTextClass = 'text-amber-400 font-bold';
                    } else if (errorItem.severity === 'Medium') {
                      cardBorderColor = isSelected ? 'border-blue-800 bg-blue-950/20 shadow-[0_0_12px_rgba(59,130,246,0.15)]' : 'border-blue-950/40 bg-slate-950/80 hover:border-blue-900/40';
                      severityTextClass = 'text-blue-400 font-bold';
                    }

                    return (
                      <div
                        key={idx}
                        onClick={() => setSelectedErrorLine(errorItem.line)}
                        className={`p-3.5 border rounded-xl cursor-pointer select-none transition-all ${cardBorderColor}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-[9px] uppercase tracking-wider ${severityTextClass}`}>
                            {errorItem.severity} • {errorItem.issueType}
                          </span>
                          <span className="text-[9px] text-slate-500">
                            Line {errorItem.line}:{errorItem.column || 1}
                          </span>
                        </div>

                        <p className="text-[11px] font-sans text-slate-350 leading-relaxed font-semibold">
                          {errorItem.explanation}
                        </p>

                        {errorItem.suggestion && (
                          <div className="mt-2.5 pt-2 border-t border-slate-900/60 text-[10px] text-emerald-400">
                            <span className="text-slate-550 font-bold mr-1 uppercase">Suggestion:</span>
                            <code className="bg-slate-950 px-1.5 py-0.5 rounded border border-slate-900 text-emerald-300 font-mono">
                              {errorItem.suggestion}
                            </code>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Mentor Notes */}
            {analysis.mentorNotes && (
              <div className="p-4 bg-slate-950/60 border border-slate-900 rounded-xl space-y-2 font-sans leading-relaxed">
                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest block font-bold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                  Mentor Notes
                </span>
                <p className="text-slate-400 text-xs italic">
                  "{analysis.mentorNotes}"
                </p>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: COMPLEXITY & STYLING */}
        {activeTab === 'formatting' && (
          <div className="space-y-6 animate-fadeIn font-mono text-[11px]">
            {/* Complexity Estimation */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-950/60 border border-slate-900 rounded-xl space-y-1.5">
                <span className="text-[8px] text-slate-500 uppercase tracking-widest block">Estimated Time Cost</span>
                <span className={`text-sm font-extrabold block truncate ${
                  analysis.timeComplexity && analysis.timeComplexity.includes('determined') ? 'text-slate-500 font-normal italic text-[10px]' : 'text-blue-400'
                }`}>
                  {analysis.timeComplexity}
                </span>
              </div>

              <div className="p-4 bg-slate-950/60 border border-slate-900 rounded-xl space-y-1.5">
                <span className="text-[8px] text-slate-500 uppercase tracking-widest block">Estimated Space Cost</span>
                <span className={`text-sm font-extrabold block truncate ${
                  analysis.spaceComplexity && analysis.spaceComplexity.includes('determined') ? 'text-slate-500 font-normal italic text-[10px]' : 'text-cyan-400'
                }`}>
                  {analysis.spaceComplexity}
                </span>
              </div>
            </div>

            {/* Formatting suggestions */}
            <div className="p-4 bg-slate-950/60 border border-slate-900 rounded-xl space-y-3 font-sans">
              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest block font-bold flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
                Formatting & Styling Suggestions
              </span>

              {(!analysis.formattingSuggestions) ? (
                <p className="text-slate-500 italic text-[11px]">No layout adjustments suggested.</p>
              ) : (
                <div className="text-[11px] text-slate-400 leading-relaxed font-mono whitespace-pre-line bg-slate-950 p-3 rounded-lg border border-slate-900">
                  {analysis.formattingSuggestions}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: REFACTOREDSOLUTION */}
        {activeTab === 'refactoring' && (
          <div className="h-full flex flex-col relative animate-fadeIn">
            {/* Copy button */}
            <button
              onClick={handleCopyCode}
              className="absolute right-3 top-3 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-blue-950 border border-blue-800 text-[10px] font-mono text-blue-300 rounded-lg hover:bg-blue-900 transition-all cursor-pointer shadow-md select-none"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'COPIED!' : 'COPY CODE'}
            </button>

            <div className="flex-1 bg-slate-950 border border-slate-900 rounded-xl overflow-hidden min-h-[380px]">
              <Editor
                height="100%"
                language={monacoLanguage}
                theme="vs-dark"
                value={analysis.improvedCode || '// Corrected solution block.'}
                loading={
                  <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-slate-650">
                    Syncing files...
                  </div>
                }
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6
                  },
                  lineNumbersMinChars: 3,
                  scrollBeyondLastLine: false
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
