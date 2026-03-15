'use strict';

const fs = require('fs');
const path = require('path');

/** Escape a file path for embedding in a single-quoted JS string literal. */
function escapeForJS(str) {
  return str
    .replace(/\\/g, '/')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Shell-escape an argument by single-quoting it. */
function shellEscape(arg) {
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/** Detect the project's package manager by looking for lock files. */
function detectPackageRunner() {
  if (fs.existsSync(path.join(process.cwd(), 'pnpm-lock.yaml'))) return 'pnpm exec';
  if (fs.existsSync(path.join(process.cwd(), 'yarn.lock'))) return 'yarn';
  return 'npx';
}

module.exports = { escapeForJS, shellEscape, detectPackageRunner };
