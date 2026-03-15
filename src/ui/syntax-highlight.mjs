import chalk from 'chalk';

const JS_KEYWORDS = new Set([
  'async', 'await', 'function', 'const', 'let', 'var', 'return', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'new', 'class', 'extends', 'import', 'export', 'default',
  'from', 'of', 'in', 'typeof', 'instanceof', 'this', 'super', 'null', 'undefined',
  'true', 'false', 'void', 'delete', 'yield', 'static', 'get', 'set',
]);

const JS_BUILTINS = new Set([
  'Promise', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'queueMicrotask', 'console', 'process', 'JSON', 'Math',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Error', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Proxy', 'Reflect', 'Intl', 'fetch',
]);

// Matches strings, comments, numbers, identifiers, arrows, or single chars.
// Order matters -- strings and comments are matched first so their contents aren't tokenized.
const TOKEN_RE = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|\/\/.*$|\/\*[\s\S]*?\*\/|\b\d+\.?\d*\b|=>|\b[a-zA-Z_$][\w$]*\b|./g;

/**
 * Apply syntax highlighting to a line of JavaScript code.
 * Tokenizes first, then colors each token -- avoids double-styling bugs
 * (e.g. keywords inside strings) and eliminates per-call RegExp allocations.
 * @param {string} line
 * @returns {string}
 */
export function highlightSyntax(line) {
  if (!line) return line;

  return line.replace(TOKEN_RE, (tok) => {
    const ch = tok.charCodeAt(0);
    if (ch === 0x22 || ch === 0x27 || ch === 0x60) return chalk.yellow(tok);
    if (ch === 0x2F && tok.length > 1 && (tok.charCodeAt(1) === 0x2F || tok.charCodeAt(1) === 0x2A))
      return chalk.gray.italic(tok);
    if (tok === '=>') return chalk.red(tok);
    if (ch >= 0x30 && ch <= 0x39) return chalk.magenta(tok);
    if ((ch >= 0x41 && ch <= 0x5A) || (ch >= 0x61 && ch <= 0x7A) || ch === 0x5F || ch === 0x24) {
      if (JS_KEYWORDS.has(tok)) return chalk.red(tok);
      if (JS_BUILTINS.has(tok)) return chalk.cyan(tok);
    }
    return tok;
  });
}
