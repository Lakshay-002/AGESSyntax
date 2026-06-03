import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const parser = require('../frontend/node_modules/@babel/parser');

// ============================================================
// LAYER 2 — SCOPE & SYMBOL TABLE BUILDER
// ============================================================
class Scope {
  constructor(parent = null, scopeType = 'global', name = '') {
    this.parent = parent;
    this.scopeType = scopeType; // 'global', 'function', 'arrow_function', 'block', 'class'
    this.name = name;
    this.symbols = new Map(); // name -> symbolInfo
    this.assignedStates = new Map(); // name -> 'ASSIGNED' | 'POSSIBLY_ASSIGNED' | 'UNASSIGNED'
    this.boundNames = new Set();
    this.privateMembers = new Set(); // For class private fields tracking (#fields)
  }

  define(name, kind, typeHint = null, node = null) {
    this.symbols.set(name, { name, kind, typeHint, node });
    this.boundNames.add(name);
  }

  lookup(name) {
    let curr = this;
    while (curr) {
      if (curr.symbols.has(name)) {
        return curr.symbols.get(name);
      }
      curr = curr.parent;
    }
    return null;
  }
}

// AST general traversal helper
function traverse(node, callback, parent = null) {
  if (!node) return;
  
  callback(node, parent);
  
  for (const key in node) {
    const child = node[key];
    if (child && typeof child === 'object') {
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && item.type) {
            traverse(item, callback, node);
          }
        }
      } else if (child.type) {
        traverse(child, callback, node);
      }
    }
  }
}

// Pre-builder to construct Scope hierarchy and attach scope pointer to each node
function buildScopeTree(ast, globalScope) {
  let currentScope = globalScope;
  const scopeStack = [globalScope];

  function registerPattern(pattern, scope, kind, initNode = null) {
    if (!pattern) return;

    if (pattern.type === 'Identifier') {
      scope.define(pattern.name, kind, null, pattern);
      scope.assignedStates.set(pattern.name, initNode ? 'ASSIGNED' : 'UNASSIGNED');
    } else if (pattern.type === 'ObjectPattern') {
      for (const prop of pattern.properties) {
        if (prop.type === 'ObjectProperty') {
          registerPattern(prop.value, scope, kind, initNode);
        } else if (prop.type === 'RestElement') {
          registerPattern(prop.argument, scope, kind, initNode);
        }
      }
    } else if (pattern.type === 'ArrayPattern') {
      for (let i = 0; i < pattern.elements.length; i++) {
        const elem = pattern.elements[i];
        if (elem) {
          let actualKind = kind;
          // State variables E.g. const [count, setCount] = useState(0)
          if (initNode && initNode.type === 'CallExpression' && initNode.callee.name === 'useState') {
            actualKind = i === 1 ? 'state_setter' : 'state_variable';
          }
          registerPattern(elem, scope, actualKind, initNode);
        }
      }
    } else if (pattern.type === 'AssignmentPattern') {
      registerPattern(pattern.left, scope, kind, initNode || pattern.right);
    } else if (pattern.type === 'RestElement') {
      registerPattern(pattern.argument, scope, kind, initNode);
    }
  }

  function visit(node, parent) {
    if (!node) return;

    node.scope = currentScope;

    let createdScope = null;

    if (node.type === 'Program') {
      // Global scope already present
    } else if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ClassMethod' || node.type === 'ObjectMethod') {
      const name = node.id ? node.id.name : (node.key ? node.key.name : '');
      createdScope = new Scope(currentScope, 'function', name);

      if (node.params) {
        for (const param of node.params) {
          let kind = 'parameter';
          if (parent && parent.type === 'CallExpression' && parent.callee.type === 'MemberExpression') {
            const method = parent.callee.property.name;
            if ((method === 'map' || method === 'forEach' || method === 'filter') && node.params.indexOf(param) === 1) {
              kind = 'loop_index';
            }
          }
          if (param.type === 'Identifier' && (param.name === 'index' || param.name === 'idx' || param.name === 'i')) {
            kind = 'loop_index';
          }
          registerPattern(param, createdScope, kind);
        }
      }

      if (node.type === 'FunctionDeclaration' && node.id && node.id.name) {
        currentScope.define(node.id.name, 'function', null, node);
        currentScope.assignedStates.set(node.id.name, 'ASSIGNED');
      }
    } else if (node.type === 'ArrowFunctionExpression') {
      createdScope = new Scope(currentScope, 'arrow_function', '');
      if (node.params) {
        for (const param of node.params) {
          let kind = 'parameter';
          if (param.type === 'Identifier' && (param.name === 'index' || param.name === 'idx' || param.name === 'i')) {
            kind = 'loop_index';
          }
          registerPattern(param, createdScope, kind);
        }
      }
    } else if (node.type === 'ClassDeclaration') {
      const className = node.id ? node.id.name : '';
      if (className) {
        currentScope.define(className, 'class', null, node);
        currentScope.assignedStates.set(className, 'ASSIGNED');
      }
      createdScope = new Scope(currentScope, 'class', className);
    } else if (node.type === 'BlockStatement') {
      createdScope = new Scope(currentScope, 'block', 'block');
    } else if (node.type === 'CatchClause') {
      createdScope = new Scope(currentScope, 'block', 'catch');
      if (node.param) {
        registerPattern(node.param, createdScope, 'let');
      }
    }

    if (createdScope) {
      currentScope = createdScope;
      node.scope = currentScope;
      scopeStack.push(createdScope);
    }

    // Register bindings
    if (node.type === 'VariableDeclaration') {
      const isBlockScoped = node.kind === 'let' || node.kind === 'const';
      for (const decl of node.declarations) {
        let targetScope = currentScope;
        if (!isBlockScoped) {
          let temp = currentScope;
          while (temp && temp.parent && temp.scopeType !== 'function' && temp.scopeType !== 'arrow_function') {
            temp = temp.parent;
          }
          targetScope = temp;
        }
        registerPattern(decl.id, targetScope, node.kind, decl.init);
      }
    } else if (node.type === 'ImportDeclaration') {
      for (const spec of node.specifiers) {
        if (spec.local && spec.local.name) {
          currentScope.define(spec.local.name, 'import', null, spec);
          currentScope.assignedStates.set(spec.local.name, 'ASSIGNED');
        }
      }
    }

    // Traverse children
    for (const key in node) {
      const child = node[key];
      if (child && typeof child === 'object') {
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && item.type) {
              visit(item, node);
            }
          }
        } else if (child.type) {
          visit(child, node);
        }
      }
    }

    if (createdScope) {
      scopeStack.pop();
      currentScope = scopeStack[scopeStack.length - 1];
    }
  }

  visit(ast, null);
}

// Check standard identifier lookup validity (to filter false positive member keys etc.)
function isVariableLookup(node, parent) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'VariableDeclarator' && parent.id === node) {
    return false;
  }
  if (parent.type === 'FunctionDeclaration' && parent.id === node) {
    return false;
  }
  if (parent.type === 'FunctionExpression' && parent.id === node) {
    return false;
  }
  if (parent.type === 'ClassDeclaration' && parent.id === node) {
    return false;
  }
  if (parent.type === 'ClassMethod' && parent.key === node) {
    return false;
  }
  if (parent.type === 'ObjectMethod' && parent.key === node) {
    return false;
  }
  if (parent.type === 'ObjectProperty' && parent.key === node && !parent.computed) {
    return false;
  }
  if (parent.type === 'ImportSpecifier' || parent.type === 'ImportDefaultSpecifier' || parent.type === 'ImportNamespaceSpecifier') {
    return false;
  }
  if (parent.type === 'RestElement' || parent.type === 'ObjectPattern' || parent.type === 'ArrayPattern') {
    return false;
  }
  if (parent.params && parent.params.includes(node)) {
    return false;
  }
  if (parent.type === 'JSXAttribute' && parent.name === node) {
    return false;
  }
  return true;
}

export function analyzeJavaScript(code) {
  const errors = [];
  const issueKeys = new Set();

  // Mode-based auto-fix data structures
  const safeReplacements = [];
  const suggestions = [];
  const blockedFixes = [];

  // Deduplication & safe append
  function addIssue(node, severity, category, rule, explanation, suggestion, symbol = '') {
    const line = node.loc ? node.loc.start.line : 1;
    const column = node.loc ? node.loc.start.column + 1 : 1;

    let componentName = 'Global';
    let curr = node.scope;
    while (curr) {
      if (curr.scopeType === 'function' && curr.name) {
        if (/^[A-Z]/.test(curr.name) || curr.name === 'App' || curr.name === 'Component') {
          componentName = curr.name;
          break;
        }
        componentName = curr.name;
      }
      curr = curr.parent;
    }

    // Deduplication Key using: rule + line + symbol
    const key = `${rule}:${line}:${symbol}`;
    if (issueKeys.has(key)) {
      return;
    }
    issueKeys.add(key);

    errors.push({
      line,
      column,
      severity,
      category,
      issueType: rule,
      explanation,
      suggestion,
      component: componentName,
      symbol
    });
  }

  // Final Aggregator Helper implementing strict error priority system
  function finalizeAnalysis(rawIssues) {
    // 1. Assign Priority levels to each issue:
    // - Unknown type / symbol = Priority 3 (Highest) E.g. Unknown Identifier, Undefined Component
    // - Syntax structure error = Priority 2 (Medium) E.g. TDZ, Hook Rules, State Mutation, Syntax Error
    // - Missing semicolon = Priority 1 (Lowest Fallback) E.g. Missing Semicolon
    // - Others = Priority 0
    function getPriority(issue) {
      const type = issue.issueType;
      if (type === 'Unknown Identifier' || type === 'Undefined Component') {
        return 3;
      }
      if (type === 'Syntax Error' || type === 'TDZ Error' || type === 'Hook Rules Violation' || type === 'State Mutation Error' || type === 'Missing Super Call' || type === 'Unreachable Code') {
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

    // 2. Cascade Suppression Pass
    // Suppress lower priority issues on any line that has a higher priority root-cause issue
    const suppressedIssues = rawIssues.filter(issue => {
      const p = getPriority(issue);
      const maxP = highestPriorityOnLine.get(issue.line) || 0;
      // Keep only issues that equal the highest priority for that line,
      // which prioritizes semantic errors over syntactic guesses.
      return p === maxP;
    });

    // 3. Final Aggregation Grouping
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

    // Sort safe replacements in descending order of start offset
    let fixedCode = code;
    try {
      safeReplacements.sort((a, b) => b.start - a.start);
      for (const repl of safeReplacements) {
        if (repl.start <= fixedCode.length && repl.end <= fixedCode.length) {
          fixedCode = fixedCode.slice(0, repl.start) + repl.replacement + fixedCode.slice(repl.end);
        }
      }
    } catch (err) {
      console.error('Failed to apply safe auto-fixes statically:', err);
      fixedCode = code;
    }

    // Deduct points: Error (-10), Warning (-4), Info (-1)
    let score = 100 - (totalErrors * 10) - (totalWarnings * 4) - (totalInfo * 1);
    score = Math.max(0, Math.min(100, score));

    let codeQuality = 'Excellent';
    if (score >= 90) codeQuality = 'Excellent';
    else if (score >= 70) codeQuality = 'Good';
    else if (score >= 40) codeQuality = 'Risky';
    else codeQuality = 'Poor';

    const uniqueSuggestions = [];
    const suggestionSeen = new Set();
    for (const s of suggestions) {
      const k = `${s.rule}:${s.explanation}`;
      if (!suggestionSeen.has(k)) {
        suggestionSeen.add(k);
        uniqueSuggestions.push(s);
      }
    }

    const uniqueBlocked = [];
    const blockedSeen = new Set();
    for (const b of blockedFixes) {
      const k = `${b.rule}:${b.explanation}`;
      if (!blockedSeen.has(k)) {
        blockedSeen.add(k);
        uniqueBlocked.push(b);
      }
    }

    return {
      valid: totalErrors === 0,
      errors: suppressedIssues, // Flat list
      groupedIssues,
      improvedCode: fixedCode,
      fixedCode: fixedCode,
      suggestions: uniqueSuggestions,
      blockedFixes: uniqueBlocked,
      summary: {
        totalErrors,
        totalWarnings,
        totalInfo,
        finalScore: score,
        codeQuality
      }
    };
  }

  try {
    // ============================================================
    // LAYER 1 — PARSER (ERROR-AWARE RECOVERY LAYER)
    // ============================================================
    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true // Token-level recovery skips invalid tokens and constructs partial AST
    });

    // Record syntax errors but do NOT return early; allow full scope/semantic walking
    if (ast.errors && ast.errors.length > 0) {
      for (const err of ast.errors) {
        const line = err.loc ? err.loc.line : 1;
        const column = err.loc ? err.loc.column + 1 : 1;
        errors.push({
          line,
          column,
          severity: 'Critical',
          category: 'ERROR',
          issueType: 'Syntax Error',
          explanation: err.message.replace(/\s*\(\d+:\d+\)$/, ''),
          suggestion: 'Fix strict-mode syntax errors',
          component: 'Global',
          symbol: ''
        });
      }
    }

    // ============================================================
    // LAYER 2 — SCOPE TREE PRE-BUILD & TYPE-RESOLUTION PASS
    // ============================================================
    const globalScope = new Scope(null, 'global', 'global');
    buildScopeTree(ast, globalScope);

    // Initial scans for React detection
    let hasJSXElement = false;
    let isReactImported = false;
    traverse(ast, (node) => {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        hasJSXElement = true;
      }
      if (node.type === 'ImportDeclaration' && node.source.value === 'react') {
        isReactImported = true;
      }
    });

    let hasTimeout = false;
    let hasPromise = false;

    const classes = new Map();
    traverse(ast, (node) => {
      if (node.type === 'ClassDeclaration' && node.id) {
        const methods = new Set();
        if (node.body && node.body.body) {
          for (const item of node.body.body) {
            if (item.type === 'ClassMethod') {
              methods.add(item.key.name);
            }
          }
        }
        classes.set(node.id.name, methods);
      }
    });

    // ============================================================
    // LAYER 3 — RULE ENGINE (INDEPENDENT, NO EARLY EXIT)
    // ============================================================
    function getEnclosingFunctionChain(node) {
      const chain = [];
      let curr = node.scope;
      while (curr) {
        if (curr.scopeType === 'function' || curr.scopeType === 'arrow_function') {
          chain.push(curr);
        }
        curr = curr.parent;
      }
      return chain;
    }

    // Rule: Hook rules & Missing dependency arrays
    traverse(ast, (node, parent) => {
      if (node.type === 'CallExpression') {
        let hookName = null;
        if (node.callee.type === 'Identifier' && /^use[A-Z]/.test(node.callee.name)) {
          hookName = node.callee.name;
        }

        if (hookName) {
          const funcChain = getEnclosingFunctionChain(node);
          if (funcChain.length === 0) {
            addIssue(
              node.callee,
              'Critical',
              'ERROR',
              'Hook Rules Violation',
              `React Hook '${hookName}' cannot be called outside functional React components or custom hooks.`,
              'Move Hook call inside functional React component.',
              hookName
            );
            blockedFixes.push({
              rule: 'Hook Rules Violation',
              explanation: `React Hook '${hookName}' is called outside a function. Auto-fixing this is unsafe because hooks rely strictly on functional components.`
            });
          } else {
            const enclosingFunc = funcChain[0];
            const isComponent = /^[A-Z]/.test(enclosingFunc.name) || enclosingFunc.name === 'App' || enclosingFunc.name === 'Component';
            const isCustomHook = /^use[A-Z]/.test(enclosingFunc.name);

            if (funcChain.length > 1) {
              addIssue(
                node.callee,
                'Critical',
                'ERROR',
                'Hook Rules Violation',
                `React Hook '${hookName}' cannot be called inside a nested function (like event callbacks).`,
                'Move Hook call to React component function top level.',
                hookName
              );
              blockedFixes.push({
                rule: 'Hook Rules Violation',
                explanation: `React Hook '${hookName}' is called inside a nested function callback. Auto-fixes are blocked to maintain stable hook execution counts.`
              });
            }
            else if (!isComponent && !isCustomHook) {
              addIssue(
                node.callee,
                'Critical',
                'ERROR',
                'Hook Rules Violation',
                `React Hook '${hookName}' cannot be called inside function '${enclosingFunc.name}' (must be React component or custom hook).`,
                'Rename function starting with uppercase letter, or move Hook call.',
                hookName
              );
              blockedFixes.push({
                rule: 'Hook Rules Violation',
                explanation: `React Hook '${hookName}' is called in non-React function '${enclosingFunc.name}'. Auto-fixing is blocked to prevent breaking structural component contracts.`
              });
            }
          }

          let ancestor = parent;
          let insideLoop = false;
          let insideCondition = false;
          while (ancestor) {
            if (['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'].includes(ancestor.type)) {
              insideLoop = true;
            }
            if (['IfStatement', 'SwitchStatement', 'SwitchCase', 'ConditionalExpression', 'LogicalExpression'].includes(ancestor.type)) {
              insideCondition = true;
            }
            ancestor = ancestor.parent;
          }

          if (insideLoop) {
            addIssue(
              node.callee,
              'Critical',
              'ERROR',
              'Hook Rules Violation',
              `React Hook '${hookName}' cannot be called inside a loop. React relies on the call order of Hooks.`,
              'Move Hook call outside loop blocks.',
              hookName
            );
            blockedFixes.push({
              rule: 'Hook Rules Violation',
              explanation: `React Hook '${hookName}' is called inside a loop. Automatically restructuring hook orders is highly destructive and blocked.`
            });
          }
          if (insideCondition) {
            addIssue(
              node.callee,
              'Critical',
              'ERROR',
              'Hook Rules Violation',
              `React Hook '${hookName}' cannot be called inside a condition. React relies on consistent call order.`,
              'Move Hook call to top level of the component.',
              hookName
            );
            blockedFixes.push({
              rule: 'Hook Rules Violation',
              explanation: `React Hook '${hookName}' is called inside a condition block. Restructuring is dangerous and blocked.`
            });
          }

          if (hookName === 'useEffect' && node.arguments.length === 1) {
            addIssue(
              node.callee,
              'High',
              'WARNING',
              'Missing useEffect Dependency',
              'Warning: Missing dependency array in useEffect. Effect callback runs on every single render. Consider passing empty array [] or dependent state variables.',
              'useEffect(() => {}, [])',
              'useEffect'
            );
            const callback = node.arguments[0];
            safeReplacements.push({
              start: callback.end,
              end: callback.end,
              replacement: ', []'
            });
          }
        }
      }
    });

    // Rule: State Mutation
    traverse(ast, (node) => {
      if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
        const name = node.left.name;
        const sym = node.scope.lookup(name);
        if (sym && sym.kind === 'state_variable') {
          addIssue(
            node.left,
            'Critical',
            'ERROR',
            'State Mutation Error',
            `React hook rule violation: Direct mutation/reassignment of state variable '${name}' is illegal. Use its setter function instead.`,
            `Use the state setter function for '${name}'.`,
            name
          );
          blockedFixes.push({
            rule: 'State Mutation',
            explanation: `Direct assignment mutation to state variable '${name}' detected. Auto-fixing state mutations requires business logic changes, which are blocked.`
          });
        }
      }
      if (node.type === 'UpdateExpression' && node.argument.type === 'Identifier') {
        const name = node.argument.name;
        const sym = node.scope.lookup(name);
        if (sym && sym.kind === 'state_variable') {
          addIssue(
            node.argument,
            'Critical',
            'ERROR',
            'State Mutation Error',
            `React hook rule violation: Direct mutation/reassignment of state variable '${name}' is illegal. Use its setter function instead.`,
            `Use the state setter function for '${name}'.`,
            name
          );
          blockedFixes.push({
            rule: 'State Mutation',
            explanation: `Direct increment/decrement mutation to state variable '${name}' detected. Auto-fixes are blocked.`
          });
        }
      }
    });

    // Rule: Undefined COMPONENT reference
    traverse(ast, (node) => {
      if (node.type === 'JSXOpeningElement' && node.name && node.name.type === 'JSXIdentifier') {
        const name = node.name.name;
        if (/^[A-Z]/.test(name)) {
          const sym = node.scope.lookup(name);
          if (!sym) {
            addIssue(
              node.name,
              'Critical',
              'ERROR',
              'Undefined Component',
              `ReferenceError: Undefined component reference '${name}' is used but not declared or imported.`,
              `Import or declare component '${name}' before rendering.`,
              name
            );
            blockedFixes.push({
              rule: 'Undefined Component',
              explanation: `React component tag '<${name} />' is not declared or imported in scope tree. Statically inventing imports is blocked.`
            });
          }
        }
      }
    });

    // Rule: Missing required React import
    if (hasJSXElement && !isReactImported) {
      addIssue(
        ast,
        'Critical',
        'ERROR',
        'Missing Import',
        "Missing required import: React must be imported from 'react' when using JSX components.",
        "import React from 'react';",
        'React'
      );
      safeReplacements.push({
        start: 0,
        end: 0,
        replacement: "import React from 'react';\n"
      });
    }

    // Rule: Component Capitalization
    traverse(ast, (node) => {
      if (node.type === 'FunctionDeclaration' && node.id) {
        const name = node.id.name;
        if (/^[a-z]/.test(name)) {
          let returnsJSX = false;
          traverse(node.body, (subNode) => {
            if (subNode.type === 'JSXElement' || subNode.type === 'JSXFragment') {
              returnsJSX = true;
            }
          });
          if (returnsJSX) {
            addIssue(
              node.id,
              'High',
              'ERROR',
              'Component Capitalization',
              `React component name '${name}' must start with an uppercase letter to differentiate from HTML tags.`,
              `Rename function to '${name.charAt(0).toUpperCase() + name.slice(1)}'`,
              name
            );
            safeReplacements.push({
              start: node.id.start,
              end: node.id.end,
              replacement: name.charAt(0).toUpperCase() + name.slice(1)
            });
          }
        }
      }
      if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
        const name = node.id.name;
        if (/^[a-z]/.test(name) && node.init && (node.init.type === 'ArrowFunctionExpression' || node.init.type === 'FunctionExpression')) {
          let returnsJSX = false;
          traverse(node.init.body, (subNode) => {
            if (subNode.type === 'JSXElement' || subNode.type === 'JSXFragment') {
              returnsJSX = true;
            }
          });
          if (returnsJSX) {
            addIssue(
              node.id,
              'High',
              'ERROR',
              'Component Capitalization',
              `React component name '${name}' must start with an uppercase letter to differentiate from HTML tags.`,
              `Rename variable to '${name.charAt(0).toUpperCase() + name.slice(1)}'`,
              name
            );
            safeReplacements.push({
              start: node.id.start,
              end: node.id.end,
              replacement: name.charAt(0).toUpperCase() + name.slice(1)
            });
          }
        }
      }
    });

    // Rule: Unstable List Keys
    traverse(ast, (node) => {
      if (node.type === 'JSXAttribute' && node.name.name === 'key' && node.value && node.value.type === 'JSXExpressionContainer') {
        const expr = node.value.expression;
        if (expr.type === 'Identifier') {
          const name = expr.name;
          const sym = node.scope.lookup(name);
          if (sym && sym.kind === 'loop_index') {
            addIssue(
              expr,
              'High',
              'WARNING',
              'Unstable Key',
              `Warning: Unstable key in dynamic lists. Avoid using loop index '${name}' as a key in list renders. Use a stable unique ID instead.`,
              'key={item.id}',
              name
            );
            suggestions.push({
              rule: 'Unstable Key',
              explanation: `Loop index '${name}' is used as a list key in rendering list items. Index keys trigger structural refresh glitches if sorting shifts indices.`,
              suggestion: 'key={item.id || item.uuid}'
            });
          }
        }
      }
    });

    // Rule: Inline functions in render
    traverse(ast, (node) => {
      if (node.type === 'JSXAttribute' && node.value && node.value.type === 'JSXExpressionContainer') {
        const expr = node.value.expression;
        if (expr && (expr.type === 'ArrowFunctionExpression' || expr.type === 'FunctionExpression')) {
          addIssue(
            node.name,
            'High',
            'WARNING',
            'Inline Function in Render',
            `Warning: Inline function passed to prop '${node.name.name}' will be recreated on every single render, causing component re-render.`,
            'const handleCallback = useCallback(() => {}, []);',
            node.name.name
          );
          suggestions.push({
            rule: 'Inline Function in Render',
            explanation: `Inline handler in '${node.name.name}' generates new callback allocations on every single render, bypassing memoizations.`,
            suggestion: `const handle${node.name.name.charAt(0).toUpperCase() + node.name.name.slice(1)} = useCallback((e) => {\n  // Action logic here\n}, []);`
          });
        }
      }
    });

    // Rule: Deep Unsafe Property Access
    traverse(ast, (node) => {
      if (node.type === 'MemberExpression' && !node.computed && !node.optional) {
        let depth = 0;
        let temp = node;
        while (temp && temp.type === 'MemberExpression') {
          depth++;
          temp = temp.object;
        }
        if (depth >= 2) {
          const codeSlice = code.slice(node.start, node.end);
          addIssue(
            node,
            'High',
            'WARNING',
            'Deep Unsafe Access',
            `Warning: Unsafe deep property access. Accessing '${codeSlice}' without optional chaining (?.) may crash at runtime if parent fields are null/undefined.`,
            `Use optional chaining: ${codeSlice.replace(/\./g, '?.')}`,
            codeSlice
          );
          safeReplacements.push({
            start: node.start,
            end: node.end,
            replacement: codeSlice.replace(/\.(?!\?)/g, '?.')
          });
        }
      }
    });

    // Rule: Expensive computation in render
    traverse(ast, (node) => {
      const isLoop = ['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement'].includes(node.type);
      const isArrayOp = node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
                        ['map', 'filter', 'reduce'].includes(node.callee.property.name);

      if (isLoop || isArrayOp) {
        let enclosingFunc = null;
        let curr = node.scope;
        while (curr) {
          if (curr.scopeType === 'function') {
            enclosingFunc = curr;
            break;
          }
          curr = curr.parent;
        }

        if (enclosingFunc && (/^[A-Z]/.test(enclosingFunc.name) || enclosingFunc.name === 'App' || enclosingFunc.name === 'Component')) {
          let ancestor = node.parent;
          let inMemo = false;
          let inEventHandler = false;

          while (ancestor) {
            if (ancestor.type === 'CallExpression' && ancestor.callee.name === 'useMemo') {
              inMemo = true;
            }
            if (ancestor.type === 'JSXAttribute' && ancestor.name && /^on[A-Z]/.test(ancestor.name.name)) {
              inEventHandler = true;
            }
            ancestor = ancestor.parent;
          }

          if (!inMemo && !inEventHandler) {
            addIssue(
              node,
              'High',
              'WARNING',
              'Expensive Computation',
              'Warning: Unmemoized array loop or computation in render. This operation runs on every single render. Consider wrapping it inside useMemo.',
              'const results = useMemo(() => data.map(...), [data]);',
              isLoop ? 'loop' : node.callee.property.name
            );
            suggestions.push({
              rule: 'Expensive Computation',
              explanation: 'Loops or high-iteration array mappings run on every component render. Moving these to useMemo prevents rendering lag.',
              suggestion: 'const memoizedResults = useMemo(() => {\n  return items.map(item => item);\n}, [items]);'
            });
          }
        }
      }
    });

    // Rule: Missing cleanup in useEffect
    traverse(ast, (node) => {
      if (node.type === 'CallExpression' && node.callee.name === 'useEffect' && node.arguments.length > 0) {
        const callback = node.arguments[0];
        if (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') {
          let hasInterval = false;
          let hasListener = false;
          let timerVarName = 'timer';

          traverse(callback.body, (sub) => {
            if (sub.type === 'CallExpression') {
              if (sub.callee.name === 'setInterval') hasInterval = true;
              if (sub.callee.type === 'MemberExpression' && sub.callee.property.name === 'addEventListener') hasListener = true;
            }
            if (sub.type === 'VariableDeclarator' && sub.init && sub.init.type === 'CallExpression' && sub.init.callee.name === 'setInterval') {
              if (sub.id && sub.id.type === 'Identifier') {
                timerVarName = sub.id.name;
              }
            }
          });

          if (hasInterval || hasListener) {
            let hasReturnFunc = false;
            traverse(callback.body, (sub) => {
              if (sub.type === 'ReturnStatement' && sub.argument) {
                if (['ArrowFunctionExpression', 'FunctionExpression', 'Identifier'].includes(sub.argument.type)) {
                  hasReturnFunc = true;
                }
              }
            });

            if (!hasReturnFunc) {
              addIssue(
                node.callee,
                'High',
                'WARNING',
                'Missing Cleanup',
                `Warning: Missing cleanup function in useEffect. Effect sets up ${hasInterval ? 'setInterval' : 'addEventListener'} but does not return cleanup callback.`,
                'return () => clearInterval(timer);',
                'useEffect'
              );
              
              if (callback.body.type === 'BlockStatement') {
                safeReplacements.push({
                  start: callback.body.end - 1,
                  end: callback.body.end - 1,
                  replacement: hasInterval 
                    ? `\n    return () => clearInterval(${timerVarName});\n  `
                    : `\n    return () => window.removeEventListener('resize', handleResize);\n  `
                });
              }
            }
          }
        }
      }
    });

    // Rule: TDZ checks
    traverse(ast, (node, parent) => {
      if (node.type === 'Identifier' && isVariableLookup(node, parent)) {
        const name = node.name;
        const sym = node.scope.lookup(name);

        if (sym && (sym.kind === 'let' || sym.kind === 'const' || sym.kind === 'class') && sym.node) {
          if (node.start < sym.node.start) {
            addIssue(
              node,
              'Critical',
              'ERROR',
              'TDZ Error',
              `ReferenceError: Cannot access '${name}' before initialization (Temporal Dead Zone violation).`,
              `Move declaration of '${name}' before using it.`,
              name
            );
            blockedFixes.push({
              rule: 'TDZ Error',
              explanation: `Temporal Dead Zone violation: Variable '${name}' accessed before its initialization line. Rearranging source initializations statically can introduce breaking reference dependencies, hence auto-fixing is blocked.`
            });
          }
        }
      }
    });

    // Rule: Unreachable code
    traverse(ast, (node) => {
      if (['ReturnStatement', 'BreakStatement', 'ContinueStatement', 'ThrowStatement'].includes(node.type)) {
        let parentBlock = node.parent;
        if (parentBlock && parentBlock.type === 'BlockStatement') {
          const idx = parentBlock.body.indexOf(node);
          if (idx !== -1 && idx < parentBlock.body.length - 1) {
            const nextNode = parentBlock.body[idx + 1];
            if (nextNode.type !== 'EmptyStatement') {
              addIssue(
                nextNode,
                'Critical',
                'ERROR',
                'Unreachable Code',
                'Unreachable code detected. This code will never be executed as it follows a termination statement.',
                'Remove the unreachable code block.',
                'unreachable'
              );
              blockedFixes.push({
                rule: 'Unreachable Code',
                explanation: `Unreachable statements follow termination flow ('${node.type}'). Automatically purging user code is unsafe and is blocked.`
              });
            }
          }
        }
      }
    });

    // Rule: Missing super() in derived class constructor
    traverse(ast, (node) => {
      if (node.type === 'ClassDeclaration' && node.superClass) {
        if (node.body && node.body.body) {
          const constructorMethod = node.body.body.find(m => m.type === 'ClassMethod' && m.key.name === 'constructor');
          if (constructorMethod) {
            let calledSuper = false;
            traverse(constructorMethod.body, (subNode) => {
              if (subNode.type === 'CallExpression' && subNode.callee.type === 'Super') {
                calledSuper = true;
              }
            });
            if (!calledSuper) {
              addIssue(
                constructorMethod.key,
                'Critical',
                'ERROR',
                'Missing Super Call',
                `ReferenceError: Derived class constructor must call super() before accessing 'this'.`,
                'super();',
                'super'
              );
              safeReplacements.push({
                start: constructorMethod.body.start + 1,
                end: constructorMethod.body.start + 1,
                replacement: '\n    super();\n  '
              });
            }
          }
        }
      }
    });

    // Rule: Unknown Identifiers
    traverse(ast, (node, parent) => {
      if (node.type === 'Identifier' && isVariableLookup(node, parent)) {
        const name = node.name;
        if (parent && parent.type === 'JSXOpeningElement' && parent.name === node) {
          return;
        }

        const sym = node.scope.lookup(name);
        if (!sym) {
          const isTypeOf = parent && parent.type === 'UnaryExpression' && parent.operator === 'typeof';
          if (!isTypeOf) {
            addIssue(
              node,
              'High',
              'WARNING',
              'Unknown Identifier',
              `Warning: Unknown identifier '${name}' (not found in any static scope).`,
              `Declare or import '${name}' before usage.`,
              name
            );
            blockedFixes.push({
              rule: 'Unknown Identifier',
              explanation: `Variable '${name}' is undefined in static scope tree. Statically injecting declarations without domain logic is blocked.`
            });
          }
        }
      }
    });

    // Rule: Type Coercion Traps
    traverse(ast, (node) => {
      if (node.type === 'BinaryExpression') {
        const isArr = (n) => n.type === 'ArrayExpression' && n.elements.length === 0;
        const isObj = (n) => n.type === 'ObjectExpression' && n.properties.length === 0;

        if (node.operator === '+') {
          if (isArr(node.left) && isArr(node.right)) {
            addIssue(
              node,
              'High',
              'WARNING',
              'Type Coercion Trap',
              'Type coercion risk: [] + [] implicitly coerces to an empty string "".',
              'Avoid implicit array addition coercion.',
              '[]+[]'
            );
            suggestions.push({
              rule: 'Type Coercion Trap',
              explanation: 'Explicit string conversions prevent confusing implicit JS runtime coercions.',
              suggestion: 'String([]) + String([])'
            });
          } else if (isArr(node.left) && isObj(node.right)) {
            addIssue(
              node,
              'High',
              'WARNING',
              'Type Coercion Trap',
              'Type coercion risk: [] + {} evaluates to "[object Object]" due to implicit type coercion.',
              'Avoid adding array to object.',
              '[]+{}'
            );
            suggestions.push({
              rule: 'Type Coercion Trap',
              explanation: 'Array addition to object implicitly casts both structures.',
              suggestion: 'JSON.stringify({})'
            });
          } else if (isObj(node.left) && isArr(node.right)) {
            addIssue(
              node,
              'High',
              'WARNING',
              'Type Coercion Trap',
              'Type coercion risk: {} + [] evaluates to "[object Object]" due to implicit type coercion.',
              'Avoid adding object to array.',
              '{}+[]'
            );
            suggestions.push({
              rule: 'Type Coercion Trap',
              explanation: 'Object addition to array implicitly casts both structures.',
              suggestion: 'JSON.stringify({})'
            });
          }
        } else if (node.operator === '-') {
          if (node.left.type === 'StringLiteral' && node.right.type === 'UnaryExpression' && node.right.operator === '-' && node.right.argument.type === 'StringLiteral') {
            addIssue(
              node,
              'High',
              'WARNING',
              'Type Coercion Trap',
              'Type coercion risk: implicit coercion in math operations (e.g. subtraction of string values).',
              'Perform explicit number casts: Number("5") - Number("-2")',
              'string-string'
            );
          }
        }
      }
    });

    // Rule: Event loop prioritization timeout vs Promise (INFO)
    traverse(ast, (node) => {
      if (node.type === 'CallExpression') {
        if (node.callee.name === 'setTimeout') {
          hasTimeout = true;
        }
        if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'then') {
          hasPromise = true;
        }
      }
    });

    if (hasTimeout && hasPromise) {
      addIssue(
        ast,
        'Low',
        'INFO',
        'Event Loop Traps',
        'Info: Event loop async ordering risk detected. Promises (microtasks) execute before setTimeout (macrotasks).',
        'Understand execution priorities in JS event loop.',
        'event-loop'
      );
    }

    // Rule: Closure scope access (INFO)
    traverse(ast, (node, parent) => {
      if (node.type === 'Identifier' && isVariableLookup(node, parent)) {
        const name = node.name;
        const sym = node.scope.lookup(name);
        if (sym && sym.kind !== 'builtin' && sym.node) {
          let definedScope = null;
          let temp = node.scope.parent;
          while (temp) {
            if (temp.symbols.has(name)) {
              definedScope = temp;
              break;
            }
            temp = temp.parent;
          }
          if (definedScope && definedScope.scopeType !== 'global') {
            addIssue(
              node,
              'Low',
              'INFO',
              'Closure Scope',
              `Info: Closure access of variable '${name}' from enclosing ${definedScope.scopeType} scope.`,
              'Safe closure reference.',
              name
            );
          }
        }
      }
    });

    // Rule: JSX Behavior (true &&, false &&, 0 &&) (INFO)
    traverse(ast, (node) => {
      if (node.type === 'LogicalExpression' && node.operator === '&&') {
        const left = node.left;
        if (left.type === 'NumericLiteral' && left.value === 0) {
          addIssue(
            left,
            'Low',
            'INFO',
            'JSX Render Traps',
            'Info: Rendering 0 && JSX will display "0" on the screen in React. Consider ternary operator or explicit casts.',
            'Use double negation or ternary: !!count && <Component />',
            '0&&'
          );
        }
      }
    });

  } catch (error) {
    const lineno = error.loc ? error.loc.line : 1;
    const column = error.loc ? error.loc.column + 1 : 1;
    errors.push({
      line: lineno,
      column,
      severity: 'Critical',
      category: 'ERROR',
      issueType: 'Syntax Error',
      explanation: error.message || 'JavaScript compilation failed.',
      suggestion: 'Verify matching braces, correct variable scopes, and balanced JSX tags.',
      component: 'Global',
      symbol: ''
    });
  }

  return finalizeAnalysis(errors);
}
