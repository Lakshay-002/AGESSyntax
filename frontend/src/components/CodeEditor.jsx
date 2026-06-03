import React, { useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { FileCode, Sparkles, BookOpen } from 'lucide-react';

// Pre-defined code templates to let students start coding immediately
const INEFFICIENT_TEMPLATES = {
  Python: `def my_function():\n    # Write your Python code here\n    pass`,
  Java: `public class Solution {\n    // Write your Java code here\n}`,
  JavaScript: `function myFunction() {\n    // Write your JavaScript code here\n}`,
  React: `import React from 'react';\n\nexport default function Widget() {\n  // Write your React component here\n  return (\n    <div>\n      {/* Code goes here */}\n    </div>\n  );\n}`,
  CSS: `/* Write your CSS styles here */\n.container {\n  \n}`
};

export default function CodeEditor({ 
  language, 
  setLanguage, 
  code, 
  setCode, 
  onAnalyze, 
  analyzing,
  onMount
}) {
  
  // Set default templates when switching languages if code is empty/default
  const handleLanguageChange = (selectedLang) => {
    setLanguage(selectedLang);
    setCode(INEFFICIENT_TEMPLATES[selectedLang] || '');
  };

  // Seed default template on first load
  useEffect(() => {
    if (!code) {
      setCode(INEFFICIENT_TEMPLATES['JavaScript']);
    }
  }, []);

  const loadTemplate = () => {
    setCode(INEFFICIENT_TEMPLATES[language] || '');
  };

  return (
    <div className="glass-card border-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[520px]">
      {/* Visual top bar tools */}
      <div className="h-14 bg-slate-950/80 border-b border-slate-900 px-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <FileCode className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-mono text-slate-350">
            source_buffer.{language.toLowerCase() === 'python' ? 'py' : language.toLowerCase() === 'java' ? 'java' : 'js'}
          </span>
        </div>

        {/* Dropdown switch */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-[10px] font-mono text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
            title="Reload starter code template"
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            LOAD TEMPLATE
          </button>

          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-[10px] font-mono text-slate-300 outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="JavaScript">JavaScript</option>
            <option value="Python">Python</option>
            <option value="Java">Java</option>
            <option value="React">React (JSX)</option>
            <option value="CSS">CSS</option>
          </select>
        </div>
      </div>

      {/* Monaco Frame */}
      <div className="flex-1 bg-slate-950 relative h-[380px]">
        <Editor
          height="100%"
          language={language === 'React' ? 'javascript' : language.toLowerCase()}
          theme="vs-dark"
          value={code}
          onChange={(val) => setCode(val || '')}
          onMount={onMount}
          loading={
            <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-slate-650">
              Initializing sandbox parser...
            </div>
          }
          options={{
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

      {/* Analyzer trigger bar */}
      <div className="h-14 border-t border-slate-900 bg-slate-950/40 px-5 flex items-center justify-end">
        <button
          onClick={onAnalyze}
          disabled={analyzing || !code}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-slate-950 rounded-xl font-mono text-xs font-bold transition-all hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] disabled:opacity-50 cursor-pointer"
        >
          {analyzing ? 'SCANNING SOLUTION...' : 'ANALYZE ALGORITHM'}
          <Sparkles className="w-3.5 h-3.5 text-slate-950" />
        </button>
      </div>
    </div>
  );
}
