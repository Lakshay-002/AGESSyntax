import React, { useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { FileCode, Sparkles, BookOpen } from 'lucide-react';

// Pre-defined inefficient DSA problem templates to let students test the app immediately
const INEFFICIENT_TEMPLATES = {
  Python: `def contains_duplicate(nums):\n    # Inefficient O(N^2) Time check using nested loops\n    # Highly suboptimal for large contest arrays!\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] == nums[j]:\n                return True\n    return False\n\n# Test input\nprint(contains_duplicate([1, 2, 3, 1]))`,
  Java: `public class Solution {\n    // Exponential recursive Fibonacci (O(2^N))\n    // Repeatedly computes overlapping subproblems without cache!\n    public int fibonacci(int n) {\n        if (n <= 1) {\n            return n;\n        }\n        return fibonacci(n - 1) + fibonacci(n - 2);\n    }\n}`,
  JavaScript: `function twoSum(nums, target) {\n    // Inefficient nested loops checking all index pairs (O(N^2))\n    // Bypasses HashMaps completely!\n    for (let i = 0; i < nums.length; i++) {\n        for (let j = i + 1; j < nums.length; j++) {\n            if (nums[i] + nums[j] === target) {\n                return [i, j];\n            }\n        }\n    }\n    return [];\n}`,
  React: `import React from 'react';\n\nexport default function BadWidget({ items }) {\n  // Anti-Pattern: Using array indices as loop keys\n  // Exploit: Rendering unsanitized HTML opening XSS risks!\n  return (\n    <div className="list-container">\n      {items.map((item, idx) => (\n        <div key={idx} dangerouslySetInnerHTML={{ __html: item.bio }} />\n      ))}\n    </div>\n  );\n}`,
  CSS: `/* Bloated, overlapping and redundant CSS layout */\n.main-container {\n  background-color: #ffffff;\n  background-color: #f3f3f3; /* Overlapping */\n  margin: 10px 10px 10px 10px;\n  padding: 5px;\n}\n\n#unique-header {\n  color: #3b82f6 !important; /* Avoid !important overrides */\n  font-size: 14px;\n}`
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
            title="Reload target inefficient algorithm template"
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
