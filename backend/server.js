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
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeJavaScript } from './javascript_analyzer.js';

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
// 1. Python AST Parser Check
function validatePythonSyntax(code) {
  try {
    // Resolve absolute path to python_analyzer.py dynamically
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const analyzerPath = path.join(__dirname, 'python_analyzer.py');

    const output = execSync(`python3 "${analyzerPath}"`, {
      input: code,
      timeout: 2000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const result = JSON.parse(output.trim());
    return {
      valid: result.valid,
      errors: result.errors,
      groupedIssues: result.groupedIssues,
      improvedCode: result.improvedCode,
      fixedCode: result.fixedCode,
      suggestions: result.suggestions || [],
      blockedFixes: result.blockedFixes || [],
      summary: result.summary
    };
  } catch (error) {
    const stderr = error.stderr || error.message || '';
    
    // Parse error string to extract exact line and column
    const lineMatch = stderr.match(/line (\d+)/i);
    const offsetMatch = stderr.match(/offset (\d+)/i) || stderr.match(/\^/);
    
    const line = lineMatch ? parseInt(lineMatch[1]) : 1;
    const column = offsetMatch ? (offsetMatch[1] ? parseInt(offsetMatch[1]) : 1) : 1;

    return {
      valid: false,
      errors: [{
        line,
        column,
        severity: 'Critical',
        issueType: 'Syntax Error',
        explanation: `Python syntax check failure: ${stderr.slice(0, 150).trim()}`,
        suggestion: 'Verify matching braces, correct variable assignments, and correct statement structures.'
      }],
      groupedIssues: {
        rootCauseErrors: {
          'Global': [{
            line,
            column,
            severity: 'Critical',
            issueType: 'Syntax Error',
            explanation: `Python syntax check failure: ${stderr.slice(0, 150).trim()}`,
            suggestion: 'Verify matching braces, correct variable assignments, and correct statement structures.'
          }]
        },
        errors: {},
        warnings: {},
        info: {}
      },
      summary: {
        totalErrors: 1,
        totalWarnings: 0,
        totalInfo: 0,
        finalScore: 90,
        codeQuality: 'Good'
      }
    };
  }
}

// 2. JavaScript & React VM Compile Check
function validateJavaScriptSyntax(code) {
  return analyzeJavaScript(code);
}

// 3. Java Curly-Brace & Semicolon Scanner
function validateJavaSyntax(code) {
  const errors = [];
  const issueKeys = new Set();
  const lines = code.split('\n');
  let openBraces = 0;
  let openParens = 0;

  // Extract main class name to validate constructor naming constraints
  const classMatch = code.match(/class\s+([a-zA-Z0-9_]+)/);
  const className = classMatch ? classMatch[1] : null;

  // Deduplication & Safe Append Helper
  function addIssue(line, column, severity, category, rule, explanation, suggestion, symbol = '') {
    const key = `${rule}:${line}:${symbol}`;
    if (issueKeys.has(key)) return;
    issueKeys.add(key);

    errors.push({
      line,
      column,
      severity,
      category,
      issueType: rule,
      explanation,
      suggestion,
      component: className || 'Global',
      symbol
    });
  }

  // Hierarchical Symbol Table variables
  const declaredVariables = new Set();
  const varTypes = {}; // maps variable name -> declared type
  let hasReturned = false;

  // Pre-scan pass to register all declared variables and types
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('//') || rawLine.startsWith('/*') || rawLine.startsWith('*')) {
      continue;
    }
    const declMatch = rawLine.match(/^([a-zA-Z0-9_<>\s,]+)\s+([a-zA-Z0-9_]+)\s*(?:=|[;])/);
    if (declMatch) {
      const typePart = declMatch[1].trim();
      const varName = declMatch[2].trim();
      if (!typePart.startsWith('class') && !typePart.startsWith('public') && !typePart.startsWith('private') && !typePart.startsWith('protected') && !typePart.startsWith('return')) {
        const modifiers = ['public', 'private', 'protected', 'static', 'final'];
        const typeTokens = typePart.split(/\s+/).filter(token => !modifiers.includes(token));
        if (typeTokens.length > 0) {
          varTypes[varName] = typeTokens.join(' ');
        }
      }
    }
  }

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

    // 1. CFG Unreachable Code Check
    if (hasReturned) {
      if (rawLine.includes('}')) {
        hasReturned = false;
      } else {
        addIssue(
          lineNum,
          1,
          'Critical',
          'ERROR',
          'Unreachable Code',
          'Unreachable code. This statement follows a return or throw statement and cannot be executed.',
          'Remove this statement or adjust flow control.',
          'unreachable'
        );
      }
    }
    if (rawLine.startsWith('return ') || rawLine.startsWith('return;') || rawLine.startsWith('throw ')) {
      hasReturned = true;
    }

    // 2. Inheritance: Override Final Methods Check
    const extendsMatch = code.match(/class\s+([a-zA-Z0-9_]+)\s+extends\s+([a-zA-Z0-9_]+)/);
    if (extendsMatch) {
      const parentClass = extendsMatch[2];
      if (rawLine.match(/(?:public|private|protected|static|\s)+void\s+test\s*\(/) && code.includes('final void test')) {
        addIssue(
          lineNum,
          lines[i].indexOf('test') + 1,
          'Critical',
          'ERROR',
          'Override Final Method',
          `Cannot override the final method from ${parentClass}.`,
          'Remove the final keyword from parent class method definition.',
          'test'
        );
      }
    }

    // 3. Access Control: Private Field Access Violations Check
    const privateFieldMatch = code.match(/private\s+[a-zA-Z0-9_]+\s+([a-zA-Z0-9_]+)\s*;/);
    if (privateFieldMatch) {
      const privateFieldName = privateFieldMatch[1];
      const accessRegex = new RegExp(`[a-zA-Z0-9_]+\\.${privateFieldName}\\b`);
      if (rawLine.match(accessRegex) && !rawLine.includes('private')) {
        addIssue(
          lineNum,
          lines[i].indexOf(privateFieldName) + 1,
          'Critical',
          'ERROR',
          'Access Control Violation',
          `The field ${className || 'A'}.${privateFieldName} is not visible.`,
          'Make field public or declare a getter.',
          privateFieldName
        );
      }
    }

    // 4. Method Resolution Engine (e.g. s.unknownMethod())
    const methodCallMatch = rawLine.match(/([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\(/);
    if (methodCallMatch) {
      const receiverName = methodCallMatch[1];
      const methodName = methodCallMatch[2];
      if (varTypes[receiverName]) {
        const receiverType = varTypes[receiverName];
        if (receiverType === 'String') {
          const standardStringMethods = ['substring', 'length', 'indexOf', 'charAt', 'equals', 'toLowerCase', 'toUpperCase', 'trim', 'split', 'replace', 'contains', 'startsWith', 'endsWith', 'isEmpty', 'concat'];
          if (!standardStringMethods.includes(methodName)) {
            addIssue(
              lineNum,
              lines[i].indexOf(methodName) + 1,
              'Critical',
              'ERROR',
              'Undefined Method',
              `The method ${methodName}() is undefined for type String.`,
              'substring(0, 1);',
              methodName
            );
          }
        } else if (receiverType.startsWith('List')) {
          const standardListMethods = ['add', 'remove', 'get', 'size', 'clear', 'contains', 'isEmpty', 'set', 'iterator'];
          if (!standardListMethods.includes(methodName)) {
            addIssue(
              lineNum,
              lines[i].indexOf(methodName) + 1,
              'Critical',
              'ERROR',
              'Undefined Method',
              `The method ${methodName}() is undefined for type ${receiverType}.`,
              'add(element);',
              methodName
            );
          }
        }
      }
    }

    // 5. Generic Type Propagation Check (e.g. for (Integer i : names))
    const forLoopMatch = rawLine.match(/for\s*\(\s*([a-zA-Z0-9_<>\s]+)\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]+)\s*\)/);
    if (forLoopMatch) {
      const loopVarType = forLoopMatch[1].trim();
      const collectionName = forLoopMatch[3].trim();
      if (varTypes[collectionName]) {
        const collectionType = varTypes[collectionName];
        const genericMatch = collectionType.match(/(?:List|Set)<([a-zA-Z0-9_]+)>/);
        if (genericMatch) {
          const elementType = genericMatch[1];
          if (elementType !== loopVarType) {
            addIssue(
              lineNum,
              lines[i].indexOf(loopVarType) + 1,
              'Critical',
              'ERROR',
              'Type Mismatch',
              `Type mismatch: cannot convert from ${elementType} to ${loopVarType}.`,
              `${elementType} ${forLoopMatch[2]}`,
              forLoopMatch[2]
            );
          }
        }
      }
    }

    // 6. Return Type Inference (e.g. String text = map.get("A"))
    const assignmentMatch = rawLine.match(/^(?:([a-zA-Z0-9_<>]+)\s+)?([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s*\([^)]*\)\s*;/);
    if (assignmentMatch) {
      const declaredType = assignmentMatch[1] ? assignmentMatch[1].trim() : (varTypes[assignmentMatch[2]] || null);
      const receiverName = assignmentMatch[3];
      const methodName = assignmentMatch[4];
      if (declaredType && varTypes[receiverName]) {
        const receiverType = varTypes[receiverName];
        if (methodName === 'get') {
          const mapGenericMatch = receiverType.match(/Map<([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)>/);
          if (mapGenericMatch) {
            const valueType = mapGenericMatch[2];
            if (valueType !== declaredType) {
              addIssue(
                lineNum,
                lines[i].indexOf(declaredType) + 1,
                'Critical',
                'ERROR',
                'Type Mismatch',
                `Type mismatch: cannot convert from ${valueType} to ${declaredType}.`,
                `${valueType} ${assignmentMatch[2]}`,
                assignmentMatch[2]
              );
            }
          }
        }
      }
    }

    // 7. Definite Assignment: Uninitialized Local Variable
    const localDeclMatch = rawLine.match(/^(?:int|double|float|String|boolean|char)\s+([a-zA-Z0-9_]+)\s*;/);
    if (localDeclMatch) {
      const varName = localDeclMatch[1];
      declaredVariables.add(varName);
    }
    declaredVariables.forEach(varName => {
      const readRegex = new RegExp(`\\b${varName}\\b`);
      if (rawLine.match(readRegex) && !rawLine.match(new RegExp(`^(?:int|double|float|String|boolean|char)\\s+${varName}`)) && !rawLine.includes(`${varName} =`)) {
        let isAssigned = false;
        for (let j = 0; j < i; j++) {
          if (lines[j].includes(`${varName} =`) || lines[j].includes(`${varName}=`)) {
            if (lines[j].includes('if') || (j > 0 && lines[j-1].includes('if'))) {
              isAssigned = false;
            } else {
              isAssigned = true;
            }
          }
        }
        if (!isAssigned) {
          addIssue(
            lineNum,
            lines[i].indexOf(varName) + 1,
            'Critical',
            'ERROR',
            'Uninitialized Variable',
            `The local variable ${varName} may not have been initialized.`,
            `${varName} = 0;`,
            varName
          );
        }
      }
    });

    // Compiler-precision validation of method declarations
    if (rawLine.includes('(') && 
        !rawLine.endsWith(';') &&
        !rawLine.startsWith('if') && 
        !rawLine.startsWith('for') && 
        !rawLine.startsWith('while') && 
        !rawLine.startsWith('switch') && 
        !rawLine.startsWith('catch') && 
        !rawLine.startsWith('super') && 
        !rawLine.startsWith('this') && 
        !rawLine.startsWith('new ') &&
        !rawLine.startsWith('System.out')
    ) {
      const partsBeforeParen = rawLine.split('(')[0].trim().split(/\s+/);
      const modifiers = ['public', 'private', 'protected', 'static', 'final', 'synchronized', 'abstract', 'native', 'strictfp'];
      const nonModifiers = partsBeforeParen.filter(part => !modifiers.includes(part));

      if (nonModifiers.includes('class') || nonModifiers.includes('interface') || nonModifiers.includes('enum') || nonModifiers.includes('record')) {
        addIssue(
          lineNum,
          lines[i].indexOf('class') + 1,
          'Critical',
          'ERROR',
          'Syntax Error',
          "Invalid method declaration. Illegal use of keyword 'class' or other declaration keyword inside a method signature.",
          'public static void main(String[] args)',
          'class'
        );
      } else if (nonModifiers.length === 1 && nonModifiers[0].length > 0) {
        const name = nonModifiers[0];
        if (name !== className) {
          addIssue(
            lineNum,
            lines[i].indexOf(name) + 1,
            'Critical',
            'ERROR',
            'Syntax Error',
            `Invalid method declaration. Missing return type (void, int, String, etc.), and name does not match constructor name '${className || 'Solution'}'.`,
            `public void ${name}`,
            name
          );
        }
      }
    }

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
      addIssue(
        lineNum,
        lines[i].length || 1,
        'High',
        'WARNING',
        'Missing Semicolon',
        'This Java statement appears to be missing a terminating semicolon (;).',
        'Add a semicolon (;) to the end of this statement.',
        ';'
      );
    }
  }

  // File-level structural error check: if curly braces are unbalanced, halt and return only that structural error!
  if (openBraces !== 0) {
    const braceIssue = {
      line: lines.length,
      column: 1,
      severity: 'Critical',
      category: 'ERROR',
      issueType: 'Missing Brackets',
      explanation: `Mismatched class or method curly braces. Braces are off by: ${openBraces}.`,
      suggestion: 'Ensure every opening curly brace { has a matching closing brace }.',
      component: className || 'Global',
      symbol: ''
    };
    return finalizeAnalysis([braceIssue]);
  }

  function finalizeAnalysis(rawIssues) {
    // 1. Priority levels to each issue:
    // - Type Mismatch, Access Control, Final override = Priority 3 (Highest)
    // - Syntax structures, Uninitialized, Unreachable, Undefined Method, Missing Brackets = Priority 2 (Medium)
    // - Missing semicolon = Priority 1 (Lowest Fallback)
    // - Others = Priority 0
    function getPriority(issue) {
      const type = issue.issueType;
      if (type === 'Type Mismatch' || type === 'Access Control Violation' || type === 'Override Final Method') {
        return 3;
      }
      if (type === 'Syntax Error' || type === 'Missing Brackets' || type === 'Uninitialized Variable' || type === 'Unreachable Code' || type === 'Undefined Method') {
        return 2;
      }
      if (type === 'Missing Semicolon') {
        return 1;
      }
      return 0;
    }

    // Map: line number -> highest priority on that line
    const highestPriorityOnLine = new Map();
    for (const issue of rawIssues) {
      const p = getPriority(issue);
      const currMax = highestPriorityOnLine.get(issue.line) || 0;
      if (p > currMax) {
        highestPriorityOnLine.set(issue.line, p);
      }
    }

    // 2. Cascade Suppression Pass (per-line shield)
    const suppressedIssues = rawIssues.filter(issue => {
      const p = getPriority(issue);
      const maxP = highestPriorityOnLine.get(issue.line) || 0;
      return p === maxP;
    });

    // 3. Grouped Category Aggregator
    const groupedIssues = {
      rootCauseErrors: {},
      errors: {}, // legacy support
      warnings: {},
      info: {}
    };

    let totalErrors = 0;
    let totalWarnings = 0;
    let totalInfo = 0;

    for (const issue of suppressedIssues) {
      const comp = issue.component || 'Global';
      const cat = issue.category;

      if (cat === 'ERROR') {
        totalErrors++;
        if (!groupedIssues.rootCauseErrors[comp]) groupedIssues.rootCauseErrors[comp] = [];
        groupedIssues.rootCauseErrors[comp].push(issue);

        if (!groupedIssues.errors[comp]) groupedIssues.errors[comp] = [];
        groupedIssues.errors[comp].push(issue);
      } else if (cat === 'WARNING') {
        totalWarnings++;
        if (!groupedIssues.warnings[comp]) groupedIssues.warnings[comp] = [];
        groupedIssues.warnings[comp].push(issue);
      } else {
        totalInfo++;
        if (!groupedIssues.info[comp]) groupedIssues.info[comp] = [];
        groupedIssues.info[comp].push(issue);
      }
    }

    let score = 100 - (totalErrors * 10) - (totalWarnings * 4) - (totalInfo * 1);
    score = Math.max(0, Math.min(100, score));

    let codeQuality = 'Excellent';
    if (score >= 90) codeQuality = 'Excellent';
    else if (score >= 70) codeQuality = 'Good';
    else if (score >= 40) codeQuality = 'Risky';
    else codeQuality = 'Poor';

    return {
      valid: totalErrors === 0,
      errors: suppressedIssues,
      groupedIssues,
      improvedCode: code,
      fixedCode: code,
      suggestions: [],
      blockedFixes: [],
      summary: {
        totalErrors,
        totalWarnings,
        totalInfo,
        finalScore: score,
        codeQuality
      }
    };
  }

  return finalizeAnalysis(errors);
}

// 4. CSS Semicolon & Bracket Scanner
function validateCssSyntax(code) {
  const errors = [];
  const lines = code.split('\n');
  let insideBlock = false;

  const VALID_CSS_PROPERTIES = [
    'color', 'background', 'background-color', 'background-image', 'margin', 'margin-top', 
    'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom', 
    'padding-left', 'padding-right', 'display', 'position', 'top', 'bottom', 'left', 'right', 
    'width', 'height', 'max-width', 'max-height', 'min-width', 'min-height', 'border', 'border-radius', 
    'border-color', 'border-width', 'border-style', 'font-size', 'font-family', 'font-weight', 
    'line-height', 'text-align', 'text-decoration', 'text-transform', 'letter-spacing', 'cursor', 
    'opacity', 'visibility', 'z-index', 'overflow', 'box-shadow', 'text-shadow', 'transition', 
    'animation', 'transform', 'flex', 'flex-direction', 'justify-content', 'align-items', 'grid', 'gap'
  ];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    const lineNum = i + 1;

    if (!rawLine || rawLine.startsWith('/*')) continue;

    if (rawLine.includes('{')) insideBlock = true;
    if (rawLine.includes('}')) insideBlock = false;

    // If inside selector blocks, check properties and semicolons
    if (insideBlock && !rawLine.includes('{') && !rawLine.includes('}') && rawLine.length > 0) {
      // Check invalid/misspelled CSS properties (e.g. colr: red;)
      const propMatch = rawLine.match(/^([a-zA-Z-]+)\s*:/);
      if (propMatch) {
        const propName = propMatch[1].toLowerCase();
        if (!VALID_CSS_PROPERTIES.includes(propName)) {
          errors.push({
            line: lineNum,
            column: lines[i].indexOf(propMatch[1]) + 1,
            severity: 'High',
            issueType: 'Syntax Error',
            explanation: `Invalid CSS property. Unknown or misspelled property '${propMatch[1]}'.`,
            suggestion: propName.includes('col') ? 'color: red;' : 'margin: 10px;'
          });
        }
      }

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
const generateMockBeginnerAnalysis = (language, code, localResult) => {
  const lang = language.toLowerCase();
  
  if (localResult && localResult.valid && (lang === 'javascript' || lang === 'react' || lang === 'java' || lang === 'python')) {
    const summary = localResult.summary || { totalErrors: 0, totalWarnings: 0, totalInfo: 0, finalScore: 100, codeQuality: 'Excellent' };
    const summaryText = `\n\nSUMMARY:\n- Total Errors: ${summary.totalErrors}\n- Total Warnings: ${summary.totalWarnings}\n- Total Info: ${summary.totalInfo}\n- Final Score: ${summary.finalScore}\n- Code Quality: ${summary.codeQuality}`;
    return {
      syntaxStatus: 'No major syntax issues found.',
      errors: [],
      formattingSuggestions: '* Code looks clean and correctly structured.\n* Keep up the good practices!',
      timeComplexity: 'Complexity could not be reliably determined',
      spaceComplexity: 'Complexity could not be reliably determined',
      improvedCode: localResult.improvedCode || code,
      fixedCode: localResult.fixedCode || code,
      suggestions: localResult.suggestions || [],
      blockedFixes: localResult.blockedFixes || [],
      mentorNotes: "Excellent job! No static analysis issues were detected in your code. Keep up the great work!" + summaryText
    };
  }

  const errorsToReturn = (localResult && localResult.errors && localResult.errors.length > 0)
    ? [...localResult.errors]
    : [];

  if (errorsToReturn.length === 0) {
    if (lang === 'python') {
      errorsToReturn.push({
        line: 2,
        column: 5,
        severity: 'Critical',
        issueType: 'Indentation Problem',
        explanation: 'IndentationError: unexpected indent. Python relies strictly on matching indentation spaces to define code blocks.',
        suggestion: 'Remove extraneous space prefixes on this line to align with outer scope blocks.'
      });
    } else if (lang === 'java') {
      errorsToReturn.push({
        line: 3,
        column: 30,
        severity: 'High',
        issueType: 'Missing Semicolon',
        explanation: 'This Java statement appears to be missing a terminating semicolon (;).',
        suggestion: 'Add a semicolon (;) to the end of this statement.'
      });
    } else if (lang === 'css') {
      errorsToReturn.push({
        line: 2,
        column: 15,
        severity: 'High',
        issueType: 'Missing Semicolon',
        explanation: 'CSS properties inside selector declarations must end with a semicolon (;).',
        suggestion: 'Append a semicolon (;) to the end of this property line.'
      });
    } else {
      errorsToReturn.push({
        line: 3,
        column: 5,
        severity: 'Critical',
        issueType: 'Missing Semicolon',
        explanation: 'SyntaxError: Missing semicolon. In JavaScript/React, missing semicolons can trigger compiler parser failures.',
        suggestion: 'Add a semicolon (;) at the end of the statement.'
      });
    }
  }

  let formattingSuggestions = '* Add spaces around operators (e.g. x = y instead of x=y)\n* Break nested conditions into smaller intermediate variables';
  if (lang === 'python') {
    formattingSuggestions += '\n* Use snake_case naming for variables in Python.';
  } else if (lang === 'javascript' || lang === 'react' || lang === 'java') {
    formattingSuggestions += '\n* Use camelCase naming for variables.';
  }

  if (lang === 'javascript' || lang === 'react' || lang === 'java') {
    const summary = localResult.summary || { totalErrors: errorsToReturn.filter(e => e.severity === 'Critical' || e.severity === 'High').length, totalWarnings: 0, totalInfo: 0, finalScore: 100, codeQuality: 'Excellent' };
    const summaryText = `\n\nSUMMARY:\n- Total Errors: ${summary.totalErrors}\n- Total Warnings: ${summary.totalWarnings}\n- Total Info: ${summary.totalInfo}\n- Final Score: ${summary.finalScore}\n- Code Quality: ${summary.codeQuality}`;
    return {
      syntaxStatus: 'Syntax errors detected.',
      errors: errorsToReturn,
      formattingSuggestions,
      timeComplexity: 'Complexity could not be reliably determined',
      spaceComplexity: 'Complexity could not be reliably determined',
      improvedCode: localResult.improvedCode || code,
      fixedCode: localResult.fixedCode || code,
      suggestions: localResult.suggestions || [],
      blockedFixes: localResult.blockedFixes || [],
      mentorNotes: "Don't let syntax errors discourage you—every software engineer encounters them daily. Check your brackets and statement endings, and let clean indentation guide you!" + summaryText
    };
  }

  return {
    syntaxStatus: 'Syntax errors detected.',
    errors: errorsToReturn,
    formattingSuggestions,
    timeComplexity: 'Complexity could not be reliably determined',
    spaceComplexity: 'Complexity could not be reliably determined',
    improvedCode: code,
    mentorNotes: "Don't let syntax errors discourage you—every software engineer encounters them daily. Check your brackets and statement endings, and let clean indentation guide you!"
  };
};

// ==========================================
// CORE API ROUTE: Analyze Syntax
// ==========================================
app.post('/api/analyze', async (req, res) => {
  let localResult = { valid: true, errors: [] };
  try {
    const { language, code, strictMode } = req.body;

    if (!language || !code) {
      return res.status(400).json({ error: 'Language and code parameters are required.' });
    }

    // 1. Run local parser validations
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
      const mockResult = generateMockBeginnerAnalysis(language, code, localResult);
      if (strictMode) {
        mockResult.improvedCode = null;
        mockResult.formattingSuggestions = null;
        mockResult.mentorNotes = null;
        mockResult.timeComplexity = null;
        mockResult.spaceComplexity = null;
      }
      return res.json({ success: true, analysis: mockResult });
    }

    console.log(`[Beginner Backend] Running combined syntax check + Gemini scans for ${language}...`);

    // Compile local diagnostic results to inject into the Gemini prompt
    const localDiagnosticSnippet = !localResult.valid && localResult.errors.length > 0
      ? `Local Compiler Parser Findings:\n${JSON.stringify(localResult.errors, null, 2)}\n(Use these exact line-level compile errors as direct inputs.)`
      : 'Local Compiler Parser Findings: No severe local compile errors discovered.';

    // Define Structured Gemini Prompt for Beginner Syntax Review
    let prompt = '';

    if (lang === 'java') {
      prompt = `You are a strict, expert Java static code analyzer. Analyze the given Java code and detect ALL violations based on the rules below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 1 — JAVA BASICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Missing semicolons at end of statements
- Undeclared variables used in expressions
- Invalid data type assignments (e.g. String assigned to int)
- Implicit narrowing without explicit cast (e.g. double to int)
- Variable declared but never used
- Variable used before declaration
- Invalid identifiers (starting with number, special chars)
- System.out.println used on uninitialized variables
- Missing main method signature (public static void main(String[] args))
- Wrong class file naming (class name must match file name)

PARAMETER RULE (CRITICAL):
- Constructor and method parameters are ALWAYS initialized by the caller.
- NEVER flag constructor or method parameters as "uninitialized variables".
- Only flag local variables declared inside a method body that are used before assignment.
- A variable in the method/constructor signature (e.g. int data, String name) is a PARAMETER, not a local variable.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 2 — CONTROL FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- if(false) or if(true) are dead/unreachable branches — flag and suggest removal
- Code written after return/throw/break inside a block is unreachable
- switch statement missing break causes unintentional fallthrough — flag each case
- switch with no default case — warn
- for/while loop with condition that is always false — dead loop
- while(true) with no break or return — infinite loop, flag it
- Nested loops with same variable name — shadowing risk
- do-while with condition always true and no exit — infinite loop

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 3 — METHODS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Method called with wrong number of arguments
- Method called with wrong argument types
- Non-void method missing a return statement
- Return type mismatch (returning String from int method)
- Recursive method with no base case — stack overflow risk
- Method parameter shadowing class field without this keyword
- Overloaded methods with ambiguous signatures
- Calling instance method from static context without object reference
- Method declared but never called (unused method — warn)
- Pass by value misunderstanding: primitives are copied, objects pass reference

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 4 — ARRAYS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Array index out of bounds (index >= array.length)
- Array accessed before initialization (null array)
- Negative array size (new int[-1])
- Off-by-one error in loop iterating over array (i <= arr.length instead of i < arr.length)
- 2D array row/column confusion
- Array assigned wrong element type
- Enhanced for loop modifying array elements (no effect on primitives)
- Array compared with == instead of Arrays.equals()

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 5 — OOP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Calling a method that does not exist on the object
- Accessing a field that does not exist on the object
- Instantiating an abstract class directly
- Instantiating an interface directly
- Missing @Override when overriding a method — warn
- Overriding method changes return type incompatibly
- super() not first statement in constructor when required
- Abstract method has a body
- Interface method declared as non-public non-abstract (pre Java 8)
- Child class does not implement all abstract methods
- Private members accessed from outside the class
- Static method called on instance (misleading but legal — warn)
- this() constructor call not first statement
- Circular inheritance (A extends B, B extends A)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 6 — STRINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- String compared with == instead of .equals() — always flag
- String compared with === (invalid in Java)
- Calling methods on null String — NullPointerException risk
- String concatenation inside loop — suggest StringBuilder
- substring() with invalid index (negative or > length)
- charAt() with out-of-bounds index
- String.format() argument count mismatch
- Null passed to method expecting non-null String
- StringBuffer used where StringBuilder is sufficient (single-thread) — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 7 — PACKAGES & IMPORTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Import of non-existent / fake package — flag
- Unused import statements — warn
- Duplicate import statements
- Wildcard import used (import java.util.*) — warn, suggest specific imports
- Class used without import and not in java.lang
- Package declaration mismatch with directory structure

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 8 — ACCESS MODIFIERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Private field accessed directly from outside the class
- Protected member accessed from non-subclass outside package
- Public field in class (breaks encapsulation) — warn, suggest getter/setter
- No access modifier on class member (default/package-private) — warn if likely unintentional
- Private constructor class instantiated outside (unless Singleton pattern)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 9 — STATIC KEYWORD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Accessing non-static member from static context — critical error
- Static variable modified from multiple threads without synchronization
- Static method overridden (method hiding, not overriding) — warn
- Static block throwing unchecked exception — warn
- Overuse of static (procedural style in OOP context) — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 10 — FINAL KEYWORD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Final variable reassigned after initialization
- Final method overridden in subclass
- Final class extended by another class
- Final variable declared but never initialized (blank final without constructor init)
- Final parameter reassigned inside method body

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 11 — EXCEPTION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Checked exception not caught or declared with throws
- Empty catch block (swallowing exception silently)
- Catching Exception or Throwable too broadly — warn
- throw used without creating an exception object
- throws declared but exception never thrown in method
- Custom exception not extending Exception or RuntimeException
- Finally block contains return statement — warn (overrides try return)
- Exception message is null or empty
- Multi-catch with related exceptions (child before parent catches)
- NullPointerException risk: calling method on object that could be null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 12 — COLLECTIONS FRAMEWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Adding wrong type to typed collection (List<String>.add(123))
- Raw type used instead of generic (List instead of List<Type>)
- ConcurrentModificationException: modifying collection inside for-each loop
- Null key in HashMap where null is not intended
- Using == to compare collection elements instead of .equals()
- Accessing index out of bounds in ArrayList
- Stack/Queue operations on empty collection (peek/pop on empty stack)
- Iterating with index on LinkedList (O(n²) performance) — warn
- Using Vector/Hashtable in non-thread-safe context without need — suggest ArrayList/HashMap

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 13 — GENERICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Unchecked cast warning (casting generic type without type safety)
- Wildcard <?> used where specific type is needed
- Generic method type parameter not resolvable
- Creating generic array (new T[]) — not allowed in Java
- Raw type assigned to generic type variable

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 14 — JAVA 8 FEATURES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Lambda assigned to non-functional interface
- Lambda parameter type mismatch
- Optional.get() called without isPresent() check — NullPointerException risk
- Stream terminal operation missing (stream never consumed)
- Stream used after terminal operation (stream already closed)
- Method reference pointing to non-existent method
- Functional interface with more than one abstract method
- Date/Time API: using deprecated java.util.Date instead of java.time.*  — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 15 — FILE HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- File/Stream opened but never closed — resource leak
- Not using try-with-resources for AutoCloseable resources
- FileNotFoundException not handled
- Reading from file without checking if file exists
- Writing to read-only file without error handling
- Serializable class missing serialVersionUID — warn
- ObjectInputStream used on non-Serializable object

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 16 — MULTITHREADING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Shared mutable variable accessed without synchronization
- Deadlock pattern: two threads locking same objects in different order
- Thread started with new Thread() but .start() never called
- Calling .run() instead of .start() (runs on current thread)
- wait()/notify() called outside synchronized block
- Non-thread-safe collection (ArrayList, HashMap) used in multithreaded context
- sleep() called on locked object — warn
- ThreadLocal not removed after use — memory leak risk

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 17 — JAVA I/O AND NIO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- InputStream/OutputStream not closed after use
- BufferedReader/Writer not flushed before close
- Byte stream used for character data — suggest character stream
- Path.of() used on invalid path format
- Files.readAllBytes() on very large file without streaming — warn
- Channel not closed after use

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 18 — INNER CLASSES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Non-static inner class holding implicit reference to outer class — memory leak risk
- Static nested class accessing non-static outer member
- Anonymous inner class used where lambda is cleaner (Java 8+) — warn
- Local inner class accessing non-final local variable

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 19 — JDBC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Connection/Statement/ResultSet not closed — resource leak
- Not using try-with-resources for JDBC resources
- String concatenation in SQL query — SQL injection risk, use PreparedStatement
- ResultSet accessed after connection closed
- getInt/getString called on wrong column type
- No null check on ResultSet.getString() result
- Database credentials hardcoded in source — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 20 — REFLECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- getDeclaredMethod/Field called with wrong name — runtime error risk
- setAccessible(true) used without security check — warn
- invoke() called with wrong argument types
- Reflection used on final or private members without justification — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 21 — ANNOTATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- @Override used on method that does not actually override anything
- Missing @Override when overriding (best practice)
- @SuppressWarnings used to hide legitimate errors — warn
- Custom annotation missing @Retention and @Target
- Annotation applied to incompatible element type

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 22 — DESIGN PATTERNS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Singleton with public constructor (not a real singleton)
- Singleton not thread-safe in multithreaded context
- Factory method returning null without documentation
- Builder pattern missing required fields before build()
- Observer pattern: listener not removed causing memory leak

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 23 — MEMORY MANAGEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Object referenced but never used after assignment — memory waste
- Large object created inside loop unnecessarily
- Static collection growing indefinitely — memory leak
- Unclosed streams, connections, or file handles
- Finalizer method used (deprecated, unreliable) — warn, suggest try-with-resources
- String interning misuse causing memory pressure

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 24 — DSA IN JAVA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Array index off-by-one in binary search or sorting
- Recursive function missing base case — infinite recursion / stack overflow
- Linked list traversal past null node
- Tree traversal called on null root without null check
- Stack/Queue used with wrong data structure for problem
- Graph traversal missing visited set — infinite loop on cycles
- Dynamic programming array not sized correctly
- Integer overflow in arithmetic (use long for large values)
- HashMap not handling collision or null key correctly
- Comparing node values with == instead of .equals() for Integer objects

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 25 — ADVANCED JAVA (Java 9+)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Module not exporting required packages
- Record class fields reassigned (records are immutable)
- Sealed class extended by non-permitted class
- Virtual thread used with synchronized block — warn (pins carrier thread)
- Pattern matching instanceof used with incompatible type

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GLOBAL RULES — APPLY TO ALL CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- NEVER flag Java built-in classes as undefined:
  String, Integer, System, Math, Object, Exception, 
  RuntimeException, NullPointerException, ArrayList, HashMap,
  Optional, Thread, Runnable, Comparable, Iterable,
  UnsupportedOperationException, hasAttr (Python only),
  and all java.lang.* classes which are auto-imported.

- NEVER flag constructor or method parameters as uninitialized.
  Parameters are always provided by the caller.
  Only flag local variables declared inside a method body
  that are read before being assigned.

- Do NOT invent errors. Only report what is actually wrong.

- Do NOT flag warnings as critical errors.

- Do NOT suggest changing correct Java syntax to something invalid.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEVERITY GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Critical  → Will not compile or causes crash at runtime
High      → Logical error, wrong output, or data corruption risk
Medium    → Bad practice, performance issue, or maintainability risk
Low       → Style issue, unused code, or minor warning

${localDiagnosticSnippet}

Output a valid JSON response strictly conforming to the following JSON structure (do not include markdown syntax, do not wrap in \`\`\`json, return only pure valid parseable JSON):

{
  "syntaxStatus": "No major syntax issues found." or "Syntax errors detected.",
  "errors": [
    {
      "line": 12,
      "column": 5,
      "severity": "Critical" or "High" or "Medium" or "Low",
      "issueType": "Identify the specific Rule Set name here (e.g. RULE SET 3 — METHODS)",
      "explanation": "Clear description of the problem",
      "suggestion": "Exact corrected code or fix"
    }
  ],
  "formattingSuggestions": "A concise list of formatting and quality improvements (max 2 brief points)",
  "timeComplexity": "e.g. O(N) or 'Complexity could not be reliably determined'",
  "spaceComplexity": "e.g. O(1) or 'Complexity could not be reliably determined'",
  "improvedCode": "A completely rewritten, fully corrected, properly indented version of the code (omit excessive comments, keep it clean and short)",
  "mentorNotes": "Write your summary and note here exactly as:\\n\\nSUMMARY\\n- Total errors found: [X]\\n- Most common error category: [Category]\\n- Root cause pattern: [Pattern]\\n\\nMENTOR NOTE\\n[One concise, encouraging tip about the most common mistake found]"
}

Target Language: Java
Source Code to Review:
${code}`;
    } else if (lang === 'python') {
    } else if (lang === 'python') {
      prompt = `You are a strict, expert Python static code analyzer. Analyze the given Python code and detect ALL violations based on the rules below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 1 — PYTHON BASICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Variable used before assignment
- Variable declared but never used — warn
- Invalid variable names (starting with number, special chars except _)
- Wrong indentation (mixing tabs and spaces)
- Missing colon after if/for/while/def/class
- Incorrect use of = vs == in conditions
- print used as statement without parentheses (Python 2 style) — flag
- Integer division vs float division confusion (// vs /)
- Implicit string concatenation across lines without \ or ()
- Undefined name used in expression

PARAMETER RULE (CRITICAL):
- Function and method parameters are ALWAYS initialized by the caller.
- NEVER flag function or method parameters as undefined or uninitialized.
- Only flag variables used inside a function body before assignment.
- Default parameter values that are mutable (list, dict, set) are a bug — flag always.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 2 — CONTROL FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- if True: or if False: — dead/unreachable branch, flag and suggest removal
- Code after return/raise/break inside a block is unreachable
- while True: with no break or return — infinite loop
- for loop variable unused inside body — warn
- Loop variable reused after loop ends without reassignment — warn
- Missing else on try/except when logic depends on success
- Nested loops with same variable name — shadowing risk
- Range used with wrong arguments (range(5, 1) produces empty range) — warn
- Loop modifying list while iterating — ConcurrentModification risk

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 3 — FUNCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Function called with wrong number of positional arguments
- Function called with unknown keyword argument
- Non-None function missing explicit return statement — warn
- Return type inconsistency (sometimes returns value, sometimes None)
- Mutable default argument (def f(x=[])) — always a bug, flag Critical
- Recursive function with no base case — infinite recursion risk
- *args/**kwargs used but never accessed inside function
- Function defined but never called — warn
- Lambda used where def is cleaner (multi-line lambda) — warn
- Shadowing built-in function names (list, dict, str, id, type, input, etc.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 4 — DATA STRUCTURES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LIST:
- Index out of range (index >= len(list))
- Negative index misuse
- Modifying list while iterating over it
- append() vs extend() confusion
- List compared with is instead of ==

TUPLE:
- Attempting to modify a tuple (immutable)
- Single-element tuple missing trailing comma (x = (1) is int, not tuple)

DICT:
- Accessing key that may not exist without .get() or try/except
- Using mutable object as dictionary key
- Iterating dict while modifying it
- dict.keys() / dict.values() used with index access

SET:
- Accessing set element by index (sets are unordered)
- Adding unhashable type to set
- set() vs {} confusion ({} creates dict, not set)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 5 — OOP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Missing self as first parameter in instance method
- Missing cls as first parameter in @classmethod
- Calling method that does not exist on the object
- Accessing attribute that was never defined in __init__
- __init__ not calling super().__init__() when needed
- Instantiating class without required __init__ arguments
- @staticmethod accessing self or cls — error
- @classmethod accessing instance attribute via self — error
- Private attribute accessed with name mangling (__attr) from outside — warn
- Overriding method with incompatible signature
- Abstract method (from abc.ABC) not implemented in subclass
- Multiple inheritance MRO conflict — warn
- __str__ or __repr__ not returning a string
- Comparing objects with == without __eq__ defined — uses identity — warn
- Class variable modified via instance (unintended shared state) — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 6 — STRINGS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- String index out of range
- String compared with is instead of == — warn
- % formatting with wrong number or type of arguments
- .format() with wrong number of placeholders
- f-string with undefined variable inside {}
- Calling string method on None — AttributeError risk
- String concatenation in loop — suggest join()
- Encoding/decoding mismatch (bytes vs str)
- strip/split called with wrong argument type
- Immutable string modified (strings are immutable in Python)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 7 — MODULES & IMPORTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Import of non-existent / fake module — flag Critical
- from module import * — pollutes namespace, warn
- Unused import — warn
- Circular import between modules — flag
- Importing module but using wrong attribute name
- Relative import used outside of package
- __all__ not defined when using wildcard export
- Shadowing standard library module name (e.g. file named random.py)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 8 — TYPE HINTS & ANNOTATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Type hint mismatch (annotated int but assigned str)
- Optional[X] used but None not handled before method call
- List[str] violated by appending int
- Dict[str, int] violated by assigning str value
- Return type annotation mismatch
- Missing type hints on public functions — warn (if project uses type hints)
- Using old-style hints (List, Dict from typing) instead of list, dict (Python 3.9+) — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 9 — EXCEPTION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Bare except: (catches everything including SystemExit, KeyboardInterrupt) — flag
- Empty except block (silently swallows exception)
- Catching Exception too broadly — warn
- raise without exception object inside except — re-raises correctly, but warn if misused
- Exception message is empty or None
- Using assert for runtime validation (assert disabled with -O flag) — warn
- finally block contains return — overrides try/except return, warn
- Catching parent exception before child exception in multi-except
- Custom exception not inheriting from Exception
- try block too broad (wrapping too much code) — warn

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 10 — FILE HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- File opened but never closed — resource leak
- Not using with statement for file operations — warn
- Reading from file opened in write mode
- Writing to file opened in read mode
- File path not validated before open — FileNotFoundError risk
- Encoding not specified in open() — platform-dependent behavior, warn
- Binary mode not used for non-text files
- File pointer not reset before re-reading (seek(0) missing)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 11 — COMPREHENSIONS & GENERATORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- List comprehension used where generator expression is sufficient — warn
- Nested comprehension too complex (3+ levels) — suggest refactor
- Variable leak from comprehension in Python 2 style — warn
- Generator exhausted and reused — produces empty results silently
- dict comprehension with duplicate keys (last one wins silently) — warn
- Walrus operator (:=) used in incompatible Python version (<3.8)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 12 — DECORATORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- @staticmethod or @classmethod applied to non-method
- @property setter missing when getter defined — warn
- Decorator applied in wrong order (e.g. @staticmethod before @classmethod)
- functools.wraps missing in custom decorator — loses function metadata
- Decorator called without () when it requires arguments

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 13 — ITERATORS & GENERATORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- __iter__ defined without __next__ — incomplete iterator protocol
- StopIteration raised inside generator (Python 3.7+ deprecation)
- Generator function missing yield — becomes regular function
- next() called on non-iterator object
- zip() with unequal length iterables (silently truncates) — warn
- enumerate() result unpacked with wrong number of variables

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 14 — LAMBDAS & FUNCTIONAL PROGRAMMING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Lambda assigned to variable (use def instead) — warn
- map()/filter() result not consumed (lazy evaluation)
- reduce() used without importing from functools
- Closure capturing loop variable (late binding bug)
- sorted() key function returning inconsistent types

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 15 — MULTITHREADING & MULTIPROCESSING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Shared mutable state accessed without threading.Lock
- Thread started without .start() call
- Calling .run() directly instead of .start()
- Deadlock: two threads acquiring same locks in different order
- GIL limitation: threading used for CPU-bound tasks — suggest multiprocessing
- Thread not joined before main thread exits — warn
- Race condition on shared variable increment (x += 1 not atomic)
- multiprocessing used without if __name__ == '__main__': guard

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 16 — ASYNC / AWAIT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- await used outside async function
- async function called without await — coroutine never executed
- asyncio.run() called inside already running event loop
- Blocking I/O called inside async function — blocks event loop, warn
- async for used on non-async iterable
- async with used on non-async context manager
- Task created but never awaited — fire-and-forget risk

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 17 — MEMORY MANAGEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Circular references without weakref — memory leak risk
- Large object created inside loop unnecessarily
- Global list/dict growing indefinitely — memory leak
- del called on variable that doesn't exist
- __del__ method relied upon for cleanup — unreliable, suggest context manager
- Keeping reference to large object longer than needed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 18 — TESTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Test function not starting with test_ — won't be discovered by pytest
- assertEqual used on floating point (use assertAlmostEqual)
- Test with no assertions — meaningless test
- Mocking wrong target path
- setUp/tearDown not calling super() in inherited test class
- Test depending on execution order — warn
- assert used instead of unittest assertion methods

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 19 — SECURITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- eval() or exec() used on user input — Critical security risk
- pickle.loads() on untrusted data — arbitrary code execution risk
- Hardcoded passwords or API keys in source — Critical
- SQL query built with string concatenation — SQL injection risk
- subprocess called with shell=True and user input — command injection risk
- os.system() used with user input — command injection risk
- Insecure random (random module) used for security purposes — suggest secrets module
- XML parsing without defusedxml — XXE attack risk

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 20 — PERFORMANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- String concatenation in loop (use join() or f-strings)
- Repeated list.index() or in checks on list (use set for O(1) lookup)
- Unnecessary list() wrapping of already-list
- range(len(x)) used instead of enumerate(x) — warn
- Global variable accessed inside loop (cache in local var) — warn
- Redundant sorting (sorted called multiple times on same data)
- Deep copy used where shallow copy is sufficient
- I/O inside tight loop without buffering

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 21 — DSA IN PYTHON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Recursive function missing base case — infinite recursion / RecursionError
- List used as stack without using append/pop correctly
- List used as queue (pop(0) is O(n)) — suggest collections.deque
- Binary search on unsorted list — wrong results
- Graph traversal missing visited set — infinite loop on cycles
- Off-by-one error in binary search bounds (lo, hi)
- Dynamic programming array sized incorrectly (off by one)
- Integer overflow not considered for large inputs (Python handles big int, but warn for logic)
- Comparing None with > or < operators
- Hash collision risk using mutable object as dict key

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE SET 22 — PYTHONIC CODE & BEST PRACTICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Using type() instead of isinstance() for type checking — warn
- Not using context manager (with) for resources
- Checking if list is empty with len(x) == 0 instead of not x — warn
- Using range(len(x)) instead of enumerate or direct iteration — warn
- Comparing to None with == instead of is / is not — warn
- Using bare pass in except block
- Returning None explicitly when implicit None is sufficient — warn
- Not using unpacking where applicable (a, b = pair)
- Using global variable when local or parameter is better
- Class with only static methods — suggest using module-level functions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GLOBAL RULES — APPLY TO ALL CODE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEVER flag these as undefined — they are Python built-ins:
  print, len, range, type, isinstance, int, str, float, bool,
  list, dict, set, tuple, input, open, enumerate, zip, map,
  filter, sorted, reversed, sum, min, max, abs, round, id,
  hasattr, getattr, setattr, delattr, callable, iter, next,
  super, object, property, staticmethod, classmethod,
  NotImplementedError, ValueError, TypeError, KeyError,
  IndexError, AttributeError, Exception, RuntimeError,
  StopIteration, None, True, False, __name__, __init__,
  __str__, __repr__, __len__, __eq__, __lt__, __gt__

NEVER flag function or method parameters as undefined or uninitialized.
Parameters are always provided by the caller at call time.
Only flag local variables used inside a function body before assignment.

Do NOT invent errors. Only report what is actually wrong.
Do NOT flag style preferences as critical errors.
Do NOT suggest invalid Python syntax as a fix.
Do NOT flag Java-specific terms (hasattr IS valid Python — never flag it).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEVERITY GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Critical  → Will crash at runtime or cause data corruption
High      → Logical error, wrong output, or security risk
Medium    → Bad practice, performance issue, or maintainability risk
Low       → Style issue, unused code, or minor warning

${localDiagnosticSnippet}

Output a valid JSON response strictly conforming to the following JSON structure (do not include markdown syntax, do not wrap in \`\`\`json, return only pure valid parseable JSON):

{
  "syntaxStatus": "No major syntax issues found." or "Syntax errors detected.",
  "errors": [
    {
      "line": 12,
      "column": 5,
      "severity": "Critical" or "High" or "Medium" or "Low",
      "issueType": "Identify the specific Rule Set name here (e.g. RULE SET 3 — FUNCTIONS)",
      "explanation": "Clear description of the problem",
      "suggestion": "Exact corrected code or fix"
    }
  ],
  "formattingSuggestions": "A concise list of formatting and quality improvements (max 2 brief points)",
  "timeComplexity": "e.g. O(N) or 'Complexity could not be reliably determined'",
  "spaceComplexity": "e.g. O(1) or 'Complexity could not be reliably determined'",
  "improvedCode": "A completely rewritten, fully corrected, properly indented version of the code (omit excessive comments, keep it clean and short)",
  "mentorNotes": "Write your summary and note here exactly as:\\n\\nSUMMARY\\n- Total errors found: [X]\\n- Most common error category: [Category]\\n- Root cause pattern: [Pattern]\\n\\nMENTOR NOTE\\n[One concise, encouraging tip about the most common mistake found]"
}

Target Language: Python
Source Code to Review:
${code}`;

    } else if (lang === 'javascript') {
      prompt = `You are an advanced JavaScript Static Analysis Engine.
Your job is to analyze JavaScript, TypeScript, and standard JS code and detect ALL issues across these levels:

------------------------------------------------------------
1. SYNTAX ERRORS (CRITICAL)
------------------------------------------------------------
Detect:
- Invalid JavaScript/TypeScript syntax
- Missing brackets, parentheses, semicolons (in strict mode)
- Duplicate declarations in the same scope (let/const/function in strict mode)
- Illegal re-declarations
- Invalid function/class structure

Output as: ERROR (Severity: Critical)

------------------------------------------------------------
2. SCOPE & SEMANTIC ERRORS (HIGH PRIORITY)
------------------------------------------------------------
Detect:
- Usage of variables before declaration (Temporal Dead Zone for let/const)
- Undefined variables or out-of-scope variable accesses
- Shadowing of variables (masking outer scopes)
- Improper closure usage (captured but undefined variables)
- Invalid function arguments (missing/excess arguments)
- Illegal property accesses (undefined chains)

Output as: WARNING or ERROR depending on severity (Severity: High or Critical)

------------------------------------------------------------
3. JAVASCRIPT BEHAVIORAL TRAPS (ADVANCED)
------------------------------------------------------------
Detect and flag:
- Hoisting pitfalls (var vs let/const differences)
- "this" binding issues (especially arrow functions vs normal functions)
- Implicit type coercion risks (e.g. [] + [], [] + {}, {} + [], "5" - - "2")
- NaN and floating-point precision issues
- Async execution order risks (Promises/microtasks vs setTimeout/macrotasks vs sync execution)

Output as: INFO or WARNING (Severity: Low or Medium)

------------------------------------------------------------
4. OBJECT ORIENTED / MODERN JS ISSUES
------------------------------------------------------------
Detect:
- Incorrect class inheritance usage
- Missing super() in derived class constructors
- Private field access violations (#fields)
- Prototype misuses
- Incorrect method context binding

Output as: ERROR or WARNING (Severity: Critical or High)

------------------------------------------------------------
5. SCORING AND GRADING RULES
------------------------------------------------------------
Calculate a Code Quality Score starting from 100 points, subtracting:
- -10 per Syntax Error
- -7 per Semantic Error
- -5 per Scope/TDZ Issue
- -3 per Warning
- -1 per Minor Info Issue
(Never go below 0)

Assign a Code Quality Grade based on the score:
* 90–100 = Production ready
* 70–89 = Good but needs fixes
* 40–69 = Unsafe / buggy
* 0–39 = Broken

------------------------------------------------------------
6. ANALYSIS RULES
------------------------------------------------------------
- Always assume JavaScript is running in "use strict" mode.
- Build a scope map before analyzing usage.
- Track variable declarations by scope level.
- Identify hoisting behavior explicitly.
- Do NOT ignore duplicate identifiers.
- Treat suspicious patterns as warnings even if valid JS.
- Be strict like a compiler.
- Always explain WHY an error/warning occurs in one short sentence.

------------------------------------------------------------
7. OUTPUT FORMAT
------------------------------------------------------------
Return results in this JSON structure strictly (do not wrap in \`\`\`json, return only pure valid parseable JSON):

{
  "syntaxStatus": "No major syntax issues found." or "Syntax errors detected.",
  "errors": [
    {
      "line": 12,
      "column": 5,
      "severity": "Critical" or "High" or "Medium" or "Low",
      "issueType": "Syntax Error" or "Missing Semicolon" or "Missing Brackets" or "Indentation Problem" or "Mixed Language" or "Beginner coding mistake" or "Formatting",
      "explanation": "Detailed compile-level reasoning explaining why the error occurs (max 2 sentences).",
      "suggestion": "Corrected line snippet to substitute (smallest valid fix)"
    }
  ],
  "formattingSuggestions": "Concise markdown list of formatting and quality improvements, hoisting warnings, shadowing notes, or async prioritization alerts (max 2-3 points)",
  "timeComplexity": "e.g. O(N) or 'Complexity could not be reliably determined'",
  "spaceComplexity": "e.g. O(1) or 'Complexity could not be reliably determined'",
  "improvedCode": "A completely rewritten, corrected, and properly indented version of the code (keep it clean and short)",
  "mentorNotes": "Include a warm, encouraging note to the student, and clearly append at the end: SUMMARY:\n- Total Errors: [X]\n- Total Warnings: [Y]\n- Code Quality Score: [Score]\n- Grade: [Grade]"
}

${localDiagnosticSnippet}

Target Language: JavaScript
Source Code to Review:
${code}`;
    } else if (lang === 'react') {
      prompt = `You are a React JSX Code Analyzer designed to help developers write clean, bug-free React applications.
Your goal is NOT to behave like a compiler.
Your goal is to detect real bugs, risky patterns, and provide useful developer feedback.

------------------------------------------------------------
🎯 GOAL
------------------------------------------------------------
Analyze React + JSX code and detect:
- Real runtime bugs
- Common React mistakes
- Hook misuse
- State and props issues
- Performance risks
- Unsafe or deprecated patterns

Do NOT flag harmless JSX/React patterns as errors.

------------------------------------------------------------
🔴 ERROR (REAL BREAKING ISSUES ONLY)
------------------------------------------------------------
Mark as ERROR only when the app will break or crash:
- Undefined variables or components
- Missing imports for used components/hooks
- Invalid hook usage (rules of hooks violation)
- Using hooks inside loops, conditions, or nested functions
- Rendering invalid JSX syntax
- Accessing undefined state or props that break execution

Output as: ERROR (Severity: Critical or High)
Rule: ERROR = app will fail to compile or crash at runtime.

------------------------------------------------------------
🟠 WARNING (POTENTIAL BUGS OR BAD PRACTICES)
------------------------------------------------------------
Mark as WARNING for issues that may cause bugs or unstable behavior:
- Missing dependency array in useEffect (when needed)
- Incorrect dependency array in hooks
- State mutation instead of setState usage
- Unnecessary re-renders or inline function creation in render
- Props drilling or unclear prop usage
- Possible null/undefined access in JSX
- Unstable keys in lists (index as key in dynamic lists)
- Expensive computations inside render

Output as: WARNING (Severity: High or Medium)
Rule: WARNING = code runs but may cause bugs or performance issues.

------------------------------------------------------------
🟡 INFO (BEST PRACTICES / EDUCATION)
------------------------------------------------------------
Mark as INFO for React learning insights:
- Explanation of hooks behavior (useState, useEffect, useMemo, etc.)
- Component re-render behavior
- Virtual DOM explanation
- Controlled vs uncontrolled components
- JSX transformation behavior
- Key usage explanation in lists

Output as: INFO (Severity: Low)
Rule: INFO = educational only, not a problem.

------------------------------------------------------------
🚫 IMPORTANT RULES
------------------------------------------------------------
- DO NOT treat valid JSX patterns as errors.
- DO NOT flag React flexibility as issues.
- Prefer WARNING over ERROR if unsure.
- Focus on real-world React bugs, not theoretical correctness.
- Assume modern React (functional components + hooks).

------------------------------------------------------------
⚖️ SCORING SYSTEM
------------------------------------------------------------
Start with 100 points.
- Each ERROR: -10 points
- Each WARNING: -4 points
- Each INFO: -1 point
Clamp score between 0 and 100.

Assign a Code Quality Grade based on the score:
* 90–100 = Excellent (Production ready)
* 70–89 = Good (Good but needs fixes)
* 40–69 = Risky (Unsafe / buggy)
* 0–39 = Poor (Broken)

------------------------------------------------------------
🧾 OUTPUT FORMAT
------------------------------------------------------------
Return results in this JSON structure strictly (do not wrap in \`\`\`json, return only pure valid parseable JSON):

{
  "syntaxStatus": "No major syntax issues found." or "Syntax errors detected.",
  "errors": [
    {
      "line": 12,
      "column": 5,
      "severity": "Critical" or "High" or "Medium" or "Low",
      "issueType": "Syntax Error" or "Missing Semicolon" or "Missing Brackets" or "Indentation Problem" or "Mixed Language" or "Beginner coding mistake" or "Formatting",
      "explanation": "Detailed compile-level reasoning explaining why the error occurs (max 2 sentences).",
      "suggestion": "Corrected line snippet to substitute (smallest valid fix)"
    }
  ],
  "formattingSuggestions": "Concise markdown list of formatting and quality improvements, hooks guidelines, or key usage tips (max 2-3 points)",
  "timeComplexity": "e.g. O(N) or 'Complexity could not be reliably determined'",
  "spaceComplexity": "e.g. O(1) or 'Complexity could not be reliably determined'",
  "improvedCode": "A completely rewritten, corrected, and properly indented version of the code (keep it clean and short)",
  "mentorNotes": "Include a warm, encouraging note to the student, and clearly append at the end: SUMMARY:\n- Total Errors: [X]\n- Total Warnings: [Y]\n- Total Info: [Z]\n- Final Score: [Score]\n- Code Quality: [Grade]"
}

${localDiagnosticSnippet}

Target Language: React/JSX
Source Code to Review:
${code}`;
    } else if (lang === 'css') {
      prompt = `You are AGISSyntax Core HTML & CSS Analysis Engine.
Your goal is to analyze HTML and CSS with browser-engine precision.

KNOWLEDGE DOMAINS:
1. HTML Structure (Doctype, elements, attributes, semantic HTML, forms, tables, media)
2. DOM (Document Structure, Accessibility, SEO)
3. CSS Fundamentals (Selectors, properties, values, units)
4. Layout Systems (Flexbox, Grid, Positioning, Floats)
5. Responsive Design (Media Queries, Viewport Units, Mobile-first Design)
6. Animations (Transitions, Keyframes)
7. Accessibility (ARIA, Labels, Keyboard Navigation)
8. Modern CSS (Variables, Nesting, Container Queries)

ANALYSIS PIPELINE:
- STEP 1: TOKENIZATION
- STEP 2: HTML ANALYSIS (unclosed tags, invalid nesting, invalid attributes, duplicate IDs)
- STEP 3: CSS ANALYSIS (invalid selectors, invalid properties like misspelling 'color' as 'colr', invalid values, specificity conflicts)
- STEP 4: ACCESSIBILITY ANALYSIS (missing alt attributes, missing labels, poor semantic structure)
- STEP 5: RENDERING ANALYSIS (Layout/cascade behavior, specificity calculations)
- STEP 6: PERFORMANCE ANALYSIS (Render blocking resources, excessive DOM size, expensive selectors)
- STEP 7: CODE QUALITY (dead CSS, redundant styles, maintainability issues)

HTML + CSS VALIDATION RULES:
- Detect unclosed tags, improperly nested tags, invalid attributes, duplicate IDs, invalid selectors, invalid property names (e.g., unknown property 'colr'), invalid property values.
- Example: "h1 { colr: red; }" is INVALID (Unknown property 'colr').

BEHAVIOR & RULES:
- ONLY report errors that ACTUALLY exist in the code. NEVER hallucinate fake bugs.
- If the code is correct, explicitly set the "syntaxStatus" field to contain exactly: "No major syntax issues found."
- If the code has errors, set "syntaxStatus" to: "Syntax errors detected."
- Never miss an error that a browser parser, validator, accessibility checker, or CSS engine would report. Always explain why the error occurs. Suggest the smallest valid fix.
- ESTIMATE complexities (timeComplexity and spaceComplexity). If complexity cannot be confidently estimated, set both fields strictly to: "Complexity could not be reliably determined".
- Maintain a highly professional tone but keep it extremely brief.

${localDiagnosticSnippet}

Output a valid JSON response strictly conforming to the following JSON structure (do not include markdown syntax, do not wrap in \`\`\`json, return only pure valid parseable JSON):

{
  "syntaxStatus": "No major syntax issues found." or "Syntax errors detected.",
  "errors": [
    {
      "line": 12,
      "column": 5,
      "severity": "Critical" or "High" or "Medium" or "Low",
      "issueType": "Syntax Error" or "Missing Semicolon" or "Missing Brackets" or "Indentation Problem" or "Mixed Language" or "Beginner coding mistake" or "Formatting",
      "explanation": "Detailed browser-engine reasoning explaining why the error occurs (max 2 sentences).",
      "suggestion": "Corrected line snippet to substitute (smallest valid fix)"
    }
  ],
  "formattingSuggestions": "A concise list of formatting and quality improvements, accessibility issues, or expensive selector optimizations (max 2 brief points)",
  "timeComplexity": "e.g. O(N) or 'Complexity could not be reliably determined'",
  "spaceComplexity": "e.g. O(1) or 'Complexity could not be reliably determined'",
  "improvedCode": "A completely rewritten, fully corrected, properly indented version of the code (omit excessive comments, keep it clean and short)",
  "mentorNotes": "A warm, encouraging note to the student (max 2 short sentences)."
}

Target Language: CSS
Source Code to Review:
${code}`;
    } else {
      prompt = `You are a warm, encouraging, and expert coding mentor and software architecture scanner.
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
    }

    // Query Gemini API directly using gemini-2.5-flash (with our optimized speed parameters)
    const selectedModel = 'gemini-2.5-flash';
    console.log(`[Beginner Backend] Querying model: ${selectedModel}...`);

    const strictModeInstruction = strictMode
      ? `STRICT MODE ACTIVATED:
- You must act strictly as a raw, cold, clinical compiler/parser (e.g. raw javac, python interpreter, or browser layout engine).
- NEVER invent, suggest, or generate corrected code. The 'improvedCode' field must be null or empty.
- NEVER suggest styling improvements or formatting tips. The 'formattingSuggestions' field must be null or empty.
- Avoid warm mentoring tones or friendly phrases. The 'mentorNotes' must contain only clinical diagnostic statistics or be empty.
- Strictly return only actual syntax, semantic, type, visibility, and compiler errors in the 'errors' array.`
      : `REPAIR MODE ACTIVATED:
- You should act as a warm, encouraging virtual coding mentor.
- Always suggest the smallest valid fix in 'suggestion'.
- Provide design tips and layout improvements in 'formattingSuggestions'.
- Provide a completely corrected, improved version of the code in 'improvedCode'.
- Write warm, encouraging notes in 'mentorNotes'.`;

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
                  text: `${prompt}\n\nACTIVE ENGINE OPERATING MODE GUIDELINES:\n${strictModeInstruction}`,
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

    if (lang === 'javascript' || lang === 'react' || lang === 'python' || lang === 'java') {
      parsedAnalysis.fixedCode = localResult.fixedCode || code;
      parsedAnalysis.improvedCode = localResult.improvedCode || code;
      parsedAnalysis.suggestions = localResult.suggestions || [];
      parsedAnalysis.blockedFixes = localResult.blockedFixes || [];
      parsedAnalysis.groupedIssues = localResult.groupedIssues || {};
      parsedAnalysis.summary = localResult.summary || parsedAnalysis.summary;
    }

    // Sanitize output strictly when strictMode is enabled
    if (strictMode) {
      parsedAnalysis.improvedCode = null;
      parsedAnalysis.fixedCode = null;
      parsedAnalysis.suggestions = null;
      parsedAnalysis.blockedFixes = null;
      parsedAnalysis.formattingSuggestions = null;
      parsedAnalysis.mentorNotes = null;
      parsedAnalysis.timeComplexity = null;
      parsedAnalysis.spaceComplexity = null;
    }

    return res.json({
      success: true,
      analysis: parsedAnalysis,
    });

  } catch (error) {
    console.error('[Beginner Backend] Scanning failure:', error);
    
    // Safety Net: Fallback to mock analysis
    const mockResult = generateMockBeginnerAnalysis(req.body.language || 'JavaScript', req.body.code || '', localResult);
    if (req.body.strictMode) {
      mockResult.improvedCode = null;
      mockResult.formattingSuggestions = null;
      mockResult.mentorNotes = null;
      mockResult.timeComplexity = null;
      mockResult.spaceComplexity = null;
    }
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
