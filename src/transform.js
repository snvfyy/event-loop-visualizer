'use strict';

const acorn = require('acorn');
const walk = require('acorn-walk');

// Independent of MAX_LABEL_LENGTH in instrument.js; both happen to be 60 but
// serve different purposes (sync step label vs async callback label).
const MAX_STEP_LABEL = 60;

/**
 * Parses source and collects all instrumentation insertions (variable tracking
 * + sync step tracking). Returns the sorted insertion list, or null if no
 * instrumentation was needed.
 *
 * @param {string} source
 * @param {string} [filename]
 * @returns {{ insertions: { pos: number, text: string }[] } | null}
 */
function collectInsertions(source, filename) {
  /** @type {import('acorn').Node} */
  let ast;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowReturnOutsideFunction: true,
    });
  } catch (_e1) {
    try {
      ast = acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
      });
    } catch (_e2) {
      return null;
    }
  }

  /** @type {{ pos: number, text: string }[]} */
  const insertions = [];
  const trackedLines = new Set();

  function insertAfter(pos, text) {
    insertions.push({ pos, text });
  }

  const fileArg = filename ? ', ' + JSON.stringify(filename) : '';

  function trackSnippet(names, line) {
    trackedLines.add(line);
    return names
      .map(name => '; __elvTrack(' + JSON.stringify(name) + ', ' + name + ', ' + line + fileArg + ');')
      .join('');
  }

  function stepSnippet(line, snippet) {
    return '; __elvStep(' + line + ', ' + JSON.stringify(snippet) + fileArg + ');';
  }

  walk.ancestor(ast, {
    VariableDeclaration(node, _state, ancestors) {
      if (isInsideForInit(node, ancestors)) return;
      const names = node.declarations
        .filter(decl => decl.init)
        .flatMap(decl => extractNames(decl.id));
      if (names.length > 0) {
        insertAfter(node.end, trackSnippet(names, node.loc.start.line));
      }
    },

    ForStatement(node) {
      if (node.init && node.init.type === 'VariableDeclaration') {
        const names = node.init.declarations
          .filter(decl => decl.init)
          .flatMap(decl => extractNames(decl.id));
        if (names.length > 0 && node.body) {
          const bodyStart = getBlockBodyStart(node.body);
          if (bodyStart !== null) {
            insertAfter(bodyStart, trackSnippet(names, node.init.loc.start.line));
          }
          if (node.init.kind === 'var') {
            insertAfter(node.end, trackSnippet(names, node.loc.end.line));
          }
        }
      }
    },

    ForInStatement(node) {
      injectForInOfTracking(node, insertAfter, trackSnippet);
    },

    ForOfStatement(node) {
      injectForInOfTracking(node, insertAfter, trackSnippet);
    },

    AssignmentExpression(node, _state, ancestors) {
      if (node.left.type !== 'Identifier') return;
      const parent = ancestors[ancestors.length - 2];
      if (parent && parent.type === 'ExpressionStatement') {
        insertAfter(parent.end, trackSnippet([node.left.name], node.loc.start.line));
      }
    },

    UpdateExpression(node, _state, ancestors) {
      if (node.argument.type !== 'Identifier') return;
      const parent = ancestors[ancestors.length - 2];
      if (parent && parent.type === 'ExpressionStatement') {
        insertAfter(parent.end, trackSnippet([node.argument.name], node.loc.start.line));
      }
    },

    FunctionDeclaration(node) {
      injectParamTracking(node, insertAfter, trackSnippet);
    },

    FunctionExpression(node) {
      injectParamTracking(node, insertAfter, trackSnippet);
    },

    ArrowFunctionExpression(node) {
      if (node.body.type === 'BlockStatement') {
        injectParamTracking(node, insertAfter, trackSnippet);
      }
    },

    ExpressionStatement(node) {
      const expr = node.expression;
      if (expr.type === 'AssignmentExpression') return;
      if (expr.type === 'UpdateExpression') return;
      if (expr.type === 'AwaitExpression') return;
      if (expr.type !== 'CallExpression') return;
      if (isElvCall(expr)) return;
      if (isConsoleCall(expr)) return;
      if (isAsyncSchedulingCall(expr)) return;

      const line = node.loc.start.line;
      let raw = source.slice(node.start, node.end).replace(/;?\s*$/, '').replace(/\s+/g, ' ');
      if (raw.length > MAX_STEP_LABEL) raw = raw.substring(0, MAX_STEP_LABEL - 3) + '...';
      insertAfter(node.end, stepSnippet(line, raw));
    },
  });

  if (insertions.length === 0) return null;
  insertions.sort((a, b) => a.pos - b.pos);

  // Remove SYNC_STEP insertions on lines that already have a MEMORY track
  const filtered = insertions.filter(ins => {
    if (!ins.text.includes('__elvStep')) return true;
    const lineMatch = ins.text.match(/__elvStep\((\d+)/);
    return !lineMatch || !trackedLines.has(Number(lineMatch[1]));
  });

  return filtered.length > 0 ? { insertions: filtered } : null;
}

/**
 * Parses a JS source string and returns an instrumented version that injects
 * `__elvTrack(name, value, line)` calls after variable mutations and
 * `__elvStep(line, label)` calls after untracked call expression statements.
 *
 * @param {string} source - Original JS source code
 * @param {string} [filename] - Optional file path to include in tracking calls
 * @returns {string} Instrumented source code
 */
function transformSource(source, filename) {
  const result = collectInsertions(source, filename);
  if (!result) return source;

  let output = '';
  let cursor = 0;
  for (const ins of result.insertions) {
    output += source.slice(cursor, ins.pos) + ins.text;
    cursor = ins.pos;
  }
  output += source.slice(cursor);
  return output;
}

/**
 * Like transformSource but returns the raw insertion list instead of applying it.
 * The caller can apply these via MagicString for proper source map generation.
 *
 * @param {string} source
 * @param {string} [filename]
 * @returns {{ insertions: { pos: number, text: string }[] } | null}
 */
function getTransformInsertions(source, filename) {
  return collectInsertions(source, filename);
}

/**
 * Returns true if the call expression is one of our own injected calls.
 * @param {import('acorn').Node} expr
 * @returns {boolean}
 */
function isElvCall(expr) {
  if (expr.type !== 'CallExpression') return false;
  const callee = expr.callee;
  if (callee.type === 'Identifier') {
    return callee.name === '__elvTrack' || callee.name === '__elvStep';
  }
  return false;
}

/**
 * Returns true if the call is console.log/warn/error/info (already tracked as LOG).
 * @param {import('acorn').Node} expr
 * @returns {boolean}
 */
function isConsoleCall(expr) {
  if (expr.type !== 'CallExpression') return false;
  const callee = expr.callee;
  return callee.type === 'MemberExpression' &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'console';
}

const ASYNC_SCHEDULING_NAMES = new Set([
  'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask',
]);

/**
 * Returns true if the call is an async scheduling function already tracked
 * as ENQUEUE_MACRO/ENQUEUE_MICRO by the instrumenter.
 * @param {import('acorn').Node} expr
 * @returns {boolean}
 */
function isAsyncSchedulingCall(expr) {
  if (expr.type !== 'CallExpression') return false;
  const callee = expr.callee;
  if (callee.type === 'Identifier') return ASYNC_SCHEDULING_NAMES.has(callee.name);
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    if (callee.object.type === 'Identifier' && callee.object.name === 'process' &&
        callee.property.name === 'nextTick') return true;
  }
  return false;
}

/**
 * Extract declared names from a pattern node (handles identifiers,
 * object destructuring, array destructuring, rest elements, and assignment patterns).
 * @param {import('acorn').Node} pattern
 * @returns {string[]}
 */
function extractNames(pattern) {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name];
    case 'ObjectPattern':
      return pattern.properties.flatMap(prop =>
        prop.type === 'RestElement' ? extractNames(prop.argument) : extractNames(prop.value)
      );
    case 'ArrayPattern':
      return pattern.elements
        .filter(Boolean)
        .flatMap(element => element.type === 'RestElement' ? extractNames(element.argument) : extractNames(element));
    case 'AssignmentPattern':
      return extractNames(pattern.left);
    case 'RestElement':
      return extractNames(pattern.argument);
    default:
      return [];
  }
}

/**
 * @param {import('acorn').Node} node
 * @param {import('acorn').Node[]} ancestors
 * @returns {boolean}
 */
function isInsideForInit(node, ancestors) {
  const parent = ancestors[ancestors.length - 2];
  if (!parent) return false;
  return (
    (parent.type === 'ForStatement' && parent.init === node) ||
    parent.type === 'ForInStatement' ||
    parent.type === 'ForOfStatement'
  );
}

/**
 * Returns the character offset right after the opening `{` of a block body,
 * or null for non-block bodies.
 * @param {import('acorn').Node} body
 * @returns {number | null}
 */
function getBlockBodyStart(body) {
  if (body.type === 'BlockStatement') {
    return body.start + 1;
  }
  return null;
}

/**
 * Injects param tracking at the start of a function body.
 * @param {import('acorn').Node} node
 * @param {(pos: number, text: string) => void} insertAfter
 * @param {(names: string[], line: number) => string} trackSnippet
 */
function injectParamTracking(node, insertAfter, trackSnippet) {
  if (!node.params || node.params.length === 0) return;
  const names = node.params.flatMap(param => extractNames(param));
  if (names.length === 0) return;
  const body = node.body;
  if (body.type !== 'BlockStatement') return;
  insertAfter(body.start + 1, trackSnippet(names, node.loc.start.line));
}

/**
 * Handles for-in / for-of left-hand variable tracking.
 * @param {import('acorn').Node} node
 * @param {(pos: number, text: string) => void} insertAfter
 * @param {(names: string[], line: number) => string} trackSnippet
 */
function injectForInOfTracking(node, insertAfter, trackSnippet) {
  const left = node.left;
  let names = [];
  if (left.type === 'VariableDeclaration') {
    names = left.declarations.flatMap(decl => {
      if (!decl.id) return [];
      return extractNames(decl.id);
    });
  } else if (left.type === 'Identifier') {
    names = [left.name];
  }
  if (names.length > 0 && node.body) {
    const bodyStart = getBlockBodyStart(node.body);
    if (bodyStart !== null) {
      const line = left.loc ? left.loc.start.line : node.loc.start.line;
      insertAfter(bodyStart, trackSnippet(names, line));
    }
  }
}

module.exports = { transformSource, getTransformInsertions };
