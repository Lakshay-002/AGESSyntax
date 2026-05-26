/**
 * Aegis Syntax & Code Quality Reviewer - Backend Server Engine
 * Developed using Node.js & Express.js
 * Combines local compiler parsers (Python AST, Node VM) with Google Gemini AI.
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { execSync } from 'child_process';
import vm from 'vm';

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable CORS so the React frontend can talk to this server
app.use(cors());
// Parse incoming requests with JSON payloads
app.use(express.json());

// Simple health-check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'Operational', message: 'Aegis Beginner Auditor is active.' });
});

// Friendly root endpoint for the API server
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>AegisSyntax Backend API</title>
        <style>
          body {
            background-color: #020617;
            color: #f8fafc;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
          }
          .card {
            background-color: #0b1329;
            border: 1px solid #1e293b;
            padding: 2.5rem;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
            text-align: center;
            max-width: 480px;
          }
          h1 {
            color: #3b82f6;
            margin-top: 0;
            font-size: 1.8rem;
          }
          p {
            color: #94a3b8;
            line-height: 1.6;
            margin-bottom: 2rem;
          }
          .btn {
            background-color: #3b82f6;
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 500;
            transition: background-color 0.2s;
          }
          .btn:hover {
            background-color: #2563eb;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>🛡️ AegisSyntax API</h1>
          <p>The backend server is running successfully! It provides real-time AST validation and connects directly to the Google Gemini AI model.</p>
          <a class="btn" href="http://localhost:5174" target="_blank">Open AegisSyntax Web App</a>
        </div>
      </body>
    </html>
  `);
});


// ==========================================
// LOCAL SYNTAX VALIDATION ENGINES (Rule-Based)
// ==========================================

// 1. Python AST Parser Check
function validatePythonSyntax(code) {
  try {
    // Run Python 3 AST parser passing code directly into standard input
    // This is 100% safe from command-line injections and character escaping bugs
    execSync('python3 -c "import sys, ast; ast.parse(sys.stdin.read())"', {
      input: code,
      timeout: 1500,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'] // capture stdin, stdout, stderr
    });
    return { valid: true, errors: [] };
  } catch (error) {
    const stderr = error.stderr || error.message || '';
    
    // Parse error string to extract exact line and column
    const lineMatch = stderr.match(/line (\d+)/i);
    const offsetMatch = stderr.match(/offset (\d+)/i) || stderr.match(/\^/);
    
    const line = lineMatch ? parseInt(lineMatch[1]) : 1;
    const column = offsetMatch ? (offsetMatch[1] ? parseInt(offsetMatch[1]) : 1) : 1;
    
    // Clean up python error message
    let cleanMessage = 'Python syntax validation failed.';
    const lines = stderr.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('SyntaxError') || lines[i].includes('IndentationError') || lines[i].includes('TabError')) {
        cleanMessage = lines[i].trim();
        break;
      }
    }

    return {
      valid: false,
      errors: [{
        line,
        column,
        severity: 'Critical',
        issueType: cleanMessage.includes('Indentation') ? 'Indentation Problem' : 'Syntax Error',
        explanation: cleanMessage,
        suggestion: 'Verify structure indentations, colons after statements, and correct function declarations.'
      }]
    };
  }
}

// 2. JavaScript & React VM Compile Check
function validateJavaScriptSyntax(code) {
  try {
    // Strip imports/exports since Node VM considers them ES6 modules and throws syntax errors
    const cleanedCode = code
      .replace(/^\s*import\s+.*$/gm, '')
      .replace(/^\s*export\s+.*$/gm, '');

    // Compile script in a closed VM context
    new vm.Script(cleanedCode);
    return { valid: true, errors: [] };
  } catch (error) {
    let line = 1;
    let column = 1;

    // Node VM syntax errors expose position details in the stack trace
    if (error.stack) {
      const lineMatch = error.stack.split('\n')[0].match(/:(\d+)/);
      if (lineMatch) line = parseInt(lineMatch[1]);
    }

    // Try to guess column from arrow cursor '^'
    if (error.stack && error.stack.includes('^')) {
      const parts = error.stack.split('\n');
      const arrowLineIdx = parts.findIndex(line => line.includes('^'));
      if (arrowLineIdx > 0) {
        column = parts[arrowLineIdx].indexOf('^') + 1;
      }
    }

    return {
      valid: false,
      errors: [{
        line,
        column,
        severity: 'Critical',
        issueType: 'Syntax Error',
        explanation: error.message || 'JavaScript syntax compilation failed.',
        suggestion: 'Verify matching braces, correct variable declarations (let/const), and correct semicolon placements.'
      }]
    };
  }
}

// 3. Java Curly-Brace & Semicolon Scanner
function validateJavaSyntax(code) {
  const errors = [];
  const lines = code.split('\n');
  let openBraces = 0;
  let openParens = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    const lineNum = i + 1;

    // Ignore comment and empty lines
    if (!rawLine || rawLine.startsWith('//') || rawLine.startsWith('/*') || rawLine.startsWith('*')) {
      continue;
    }

    // Count brackets
    openBraces += (rawLine.match(/{/g) || []).length;
    openBraces -= (rawLine.match(/}/g) || []).length;
    openParens += (rawLine.match(/\(/g) || []).length;
    openParens -= (rawLine.match(/\)/g) || []).length;

    // Check missing Java Semicolons
    // Statements must end in semicolons unless they are block declarations
    if (
      rawLine.length > 0 &&
      !rawLine.endsWith(';') &&
      !rawLine.endsWith('{') &&
      !rawLine.endsWith('}') &&
      !rawLine.startsWith('import ') &&
      !rawLine.startsWith('package ') &&
      !rawLine.startsWith('@') &&
      !rawLine.startsWith('public class ') &&
      !rawLine.startsWith('class ') &&
      !rawLine.startsWith('public interface ') &&
      !rawLine.startsWith('interface ') &&
      !rawLine.startsWith('public static void main') &&
      !rawLine.includes('if (') &&
      !rawLine.includes('for (') &&
      !rawLine.includes('while (') &&
      !rawLine.includes('switch (')
    ) {
      errors.push({
        line: lineNum,
        column: lines[i].length || 1,
        severity: 'High',
        issueType: 'Missing Semicolon',
        explanation: 'This Java statement appears to be missing a terminating semicolon (;).',
        suggestion: 'Add a semicolon (;) to the end of this statement.'
      });
    }
  }

  if (openBraces !== 0) {
    errors.push({
      line: lines.length,
      column: 1,
      severity: 'Critical',
      issueType: 'Missing Brackets',
      explanation: `Mismatched class or method curly braces. Braces are off by: ${openBraces}.`,
      suggestion: 'Ensure every opening curly brace { has a matching closing brace }.'
    });
  }

  return { valid: errors.length === 0, errors };
}

// 4. CSS Semicolon & Bracket Scanner
function validateCssSyntax(code) {
  const errors = [];
  const lines = code.split('\n');
  let insideBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    const lineNum = i + 1;

    if (!rawLine || rawLine.startsWith('/*')) continue;

    if (rawLine.includes('{')) insideBlock = true;
    if (rawLine.includes('}')) insideBlock = false;

    // If inside selector blocks, properties should end with semicolons
    if (insideBlock && !rawLine.includes('{') && !rawLine.includes('}') && rawLine.length > 0) {
      if (!rawLine.endsWith(';') && !rawLine.endsWith(',')) {
        errors.push({
          line: lineNum,
          column: lines[i].length || 1,
          severity: 'High',
          issueType: 'Missing Semicolon',
          explanation: 'CSS properties inside selector declarations must end with a semicolon (;).',
          suggestion: 'Append a semicolon (;) to the end of this property line.'
        });
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ==========================================
// OFFLINE SANDBOX MOCK GENERATOR
// ==========================================
const generateMockBeginnerAnalysis = (language, code) => {
  const isPython = language.toLowerCase() === 'python';
  const isJS = language.toLowerCase() === 'javascript' || language.toLowerCase() === 'react';

  return {
    syntaxStatus: 'Syntax errors detected.',
    errors: [
      {
        line: isPython ? 4 : 5,
        column: 5,
        severity: 'Critical',
        issueType: isPython ? 'Indentation Problem' : 'Missing Semicolon',
        explanation: isPython 
          ? 'IndentationError: unexpected indent. Python relies strictly on matching indentation spaces to define code blocks.'
          : 'SyntaxError: Missing semicolon. In JavaScript/React, missing semicolons can trigger compiler parser failures on statement bound maps.',
        suggestion: isPython 
          ? 'Remove extraneous space prefixes on this line to align with outer scope blocks.' 
          : 'Add a semicolon (;) at the end of the statement.'
      },
      {
        line: isPython ? 5 : 9,
        column: 8,
        severity: 'Medium',
        issueType: 'Beginner coding mistake',
        explanation: 'Discovered a potential spelling typo or invalid keyword reference.',
        suggestion: 'Verify standard built-in keyword spellings.'
      }
    ],
    formattingSuggestions: '* Add spaces around operators (e.g. x = y instead of x=y)\n* Break nested conditions into smaller intermediate variables\n* Use camelCase naming for variables in JavaScript, and snake_case in Python.',
    timeComplexity: 'Complexity could not be reliably determined',
    spaceComplexity: 'Complexity could not be reliably determined',
    improvedCode: isPython 
      ? `def calculate_sum(nums):\n    total_sum = 0 # Clean initialized local variable\n    for num in nums:\n        total_sum += num\n    return total_sum`
      : `function calculateSum(nums) {\n    let totalSum = 0; // Correctly declared block variable\n    for (let i = 0; i < nums.length; i++) {\n        totalSum += nums[i];\n    }\n    return totalSum;\n}`,
    mentorNotes: "You are doing great! Don't let syntax errors discourage you—every software engineer encounters them daily. Focus on checking matching brackets and statement endings, and let clean indentations guide your blocks. Keep coding!"
  };
};

// ==========================================
// CORE API ROUTE: Analyze Syntax
// ==========================================
app.post('/api/analyze', async (req, res) => {
  try {
    const { language, code } = req.body;

    if (!language || !code) {
      return res.status(400).json({ error: 'Language and code parameters are required.' });
    }

    // 1. Run local parser validations
    let localResult = { valid: true, errors: [] };
    const lang = language.toLowerCase();

    if (lang === 'python') {
      localResult = validatePythonSyntax(code);
    } else if (lang === 'javascript' || lang === 'react') {
      localResult = validateJavaScriptSyntax(code);
    } else if (lang === 'java') {
      localResult = validateJavaSyntax(code);
    } else if (lang === 'css') {
      localResult = validateCssSyntax(code);
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // FALLBACK: If API Key is unconfigured, run Mock Sandbox Engine
    if (!apiKey) {
      console.log('[Beginner Backend] GEMINI_API_KEY is not set. Executing local mock analysis.');
      await new Promise(resolve => setTimeout(resolve, 2000));
      const mockResult = generateMockBeginnerAnalysis(language, code);
      
      // Merge local parser diagnostics into mock results if any were found
      if (!localResult.valid && localResult.errors.length > 0) {
        mockResult.errors = [...localResult.errors, ...mockResult.errors.slice(1)];
      }

      return res.json({ success: true, analysis: mockResult });
    }

    console.log(`[Beginner Backend] Running combined syntax check + Gemini scans for ${language}...`);

    // Compile local diagnostic results to inject into the Gemini prompt
    const localDiagnosticSnippet = !localResult.valid && localResult.errors.length > 0
      ? `Local Compiler Parser Findings:\n${JSON.stringify(localResult.errors, null, 2)}\n(Use these exact line-level compile errors as direct inputs.)`
      : 'Local Compiler Parser Findings: No severe local compile errors discovered.';

    // Define Structured Gemini Prompt for Beginner Syntax Review
    const prompt = `You are a warm, encouraging, and expert coding mentor and software architecture scanner.
Your task is to analyze the user's code for syntax mistakes, beginner errors, and styling improvements.

VERY IMPORTANT BEHAVIOR & RULES:
- ONLY report errors that ACTUALLY exist in the code.
- NEVER hallucinate fake bugs or invent syntax problems.
- Avoid generic, static-analysis warnings. Focus on spelling typos, missing brackets/semicolons, mixed syntax, and invalid declarations.
- Be EXTREMELY concise. Avoid verbose paragraphs. Every word saved reduces analysis time!
- If the code is correct, explicitly set the "syntaxStatus" field to contain exactly: "No major syntax issues found."
- If the code has errors, set "syntaxStatus" to: "Syntax errors detected."
- ESTIMATE complexities (timeComplexity and spaceComplexity) ONLY if possible. If complexity cannot be confidently estimated (e.g. due to broken syntax or simple non-algorithmic templates), set both fields strictly to: "Complexity could not be reliably determined".
- Maintain a highly supportive, beginner-friendly tone, but keep it extremely brief.

${localDiagnosticSnippet}

Output a valid JSON response strictly conforming to the following JSON structure (do not include markdown syntax, do not wrap in \`\`\`json, return only pure valid parseable JSON):

{
  "syntaxStatus": "No major syntax issues found." or "Syntax errors detected.",
  "errors": [
    {
      "line": 12, // The exact line number containing the error
      "column": 5, // The exact column position if known, otherwise 1
      "severity": "Critical" or "High" or "Medium" or "Low",
      "issueType": "Syntax Error" or "Missing Semicolon" or "Missing Brackets" or "Indentation Problem" or "Mixed Language" or "Beginner coding mistake" or "Formatting",
      "explanation": "Extremely brief description of what is wrong (max 1-2 sentences). Keep it highly concise.",
      "suggestion": "Corrected line snippet to substitute"
    }
  ],
  "formattingSuggestions": "A concise, clean markdown list of formatting improvements (max 2 brief bullet points)",
  "timeComplexity": "e.g. O(N) or 'Complexity could not be reliably determined'",
  "spaceComplexity": "e.g. O(1) or 'Complexity could not be reliably determined'",
  "improvedCode": "A completely rewritten, fully corrected, properly indented version of the code (omit excessive comments, keep it clean and short)",
  "mentorNotes": "A warm, encouraging note to the student (max 2 short sentences)."
}

Target Language: ${language}
Source Code to Review:
${code}`;

    // Query Gemini API directly using gemini-2.5-flash (with our optimized speed parameters)
    const selectedModel = 'gemini-2.5-flash';
    console.log(`[Beginner Backend] Querying model: ${selectedModel}...`);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API responded with status ${response.status} using model ${selectedModel}: ${errText}`);
    }

    const data = await response.json();
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resultText) {
      throw new Error('Gemini API returned an empty response.');
    }

    // Parse the JSON emitted by Gemini
    const parsedAnalysis = JSON.parse(resultText.trim());

    // Proactively merge local compile errors if Gemini missed them or if they are highly critical
    if (!localResult.valid && localResult.errors.length > 0) {
      const mergedErrors = [...localResult.errors];
      // Append any distinct Gemini-detected errors
      if (parsedAnalysis.errors && parsedAnalysis.errors.length > 0) {
        parsedAnalysis.errors.forEach(gErr => {
          if (!mergedErrors.some(mErr => mErr.line === gErr.line && mErr.issueType === gErr.issueType)) {
            mergedErrors.push(gErr);
          }
        });
      }
      parsedAnalysis.errors = mergedErrors;
      parsedAnalysis.syntaxStatus = 'Syntax errors detected.';
    }

    return res.json({
      success: true,
      analysis: parsedAnalysis,
    });

  } catch (error) {
    console.error('[Beginner Backend] Scanning failure:', error);
    
    // Safety Net: Fallback to mock analysis
    const mockResult = generateMockBeginnerAnalysis(req.body.language || 'JavaScript', req.body.code || '');
    return res.json({
      success: true,
      analysis: {
        ...mockResult,
        syntaxStatus: `[Connection Error Fallback] ${mockResult.syntaxStatus}`
      }
    });
  }
});

// Launch server listener
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`🚀 Aegis Beginner Syntax Reviewer Running on Port ${PORT}`);
  console.log(`🔒 Mode: ${process.env.GEMINI_API_KEY ? 'LIVE API ONLINE' : 'SANDBOX DEMO MODE'}`);
  console.log(`==================================================`);
});
