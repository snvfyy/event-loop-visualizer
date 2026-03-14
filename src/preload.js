'use strict';

/**
 * Preload script injected via NODE_OPTIONS --require. Instruments all user-code modules
 * loaded via require() and writes captured events to ELV_OUTPUT_DIR on process exit.
 */

/** @typedef {import('./types').InstrumenterResult} InstrumenterResult */
/** @typedef {import('./types').ProcessEventFile} ProcessEventFile */

const outputDir = process.env.ELV_OUTPUT_DIR;
// Top-level return is valid in CJS modules loaded via --require; it acts like
// an early exit without affecting the host process.
if (!outputDir) return;

// Jest/Vitest workers are instrumented via their custom environments instead.
// The preload's Module hook interferes with Jest's own module loader, so bail out.
if (process.env.JEST_WORKER_ID || process.env.VITEST_WORKER_ID) return;

// Skip instrumentation for build tools that inherit NODE_OPTIONS
const _scriptBase = require('path').basename(process.argv[1] || '');
const _BUILD_TOOLS = ['esbuild', 'webpack', 'webpack-cli', 'tsc', 'tsserver', 'eslint', 'prettier', 'babel', 'rollup', 'swc', 'terser', 'postcss'];
if (_BUILD_TOOLS.some(t => _scriptBase === t || _scriptBase.startsWith(t + '.'))) return;

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { createInstrumenter } = require('./instrument');
const { transformSource } = require('./transform');
const { writeEventFile } = require('./write-events');

let focusFile = process.env.ELV_FOCUS_FILE || null;
if (focusFile) { try { focusFile = fs.realpathSync(focusFile); } catch (_) {} }

/** @type {InstrumenterResult} */
const inst = createInstrumenter(global, { mode: 'preload', focusFile: focusFile });
const _setImmediate = inst.originals.setImmediate || setImmediate;

const _ownDir = __dirname + path.sep;

function registerHook(ext) {
  const origHandler = Module._extensions[ext] || Module._extensions['.js'];
  Module._extensions[ext] = function elvRequireHook(mod, filename) {
    if (filename.includes('node_modules') || filename.startsWith(_ownDir)) {
      return origHandler(mod, filename);
    }
    const source = fs.readFileSync(filename, 'utf8');
    const transformed = transformSource(source, filename);
    mod._compile(transformed, filename);
  };
}

registerHook('.js');
registerHook('.cjs');

_setImmediate(() => {
  inst.emit({ type: 'SYNC_START', label: 'process ' + process.pid });
});

process.on('exit', () => {
  if (inst.events.length <= 1) return;
  inst.emit({ type: 'DONE' });
  try {
    writeEventFile(outputDir, '', inst.events);
  } catch (_) {
    // Best-effort write; ignore errors (e.g., dir already cleaned up)
  }
});
