'use strict';

const path = require('path');

const TS_EXTENSIONS = ['.ts', '.tsx', '.jsx', '.cts'];
const LOADER_MAP = { '.ts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx', '.cts': 'ts' };

/**
 * Transpile TypeScript/JSX source to plain JavaScript (CJS) using esbuild.
 * esbuild is available as a transitive dependency of tsx.
 *
 * @param {string} source - Raw TS/JSX source code
 * @param {string} filename - File path (used to determine loader and for source maps)
 * @returns {string} Plain JavaScript source
 */
function transpileSource(source, filename) {
  const { transformSync } = require('esbuild');
  const ext = path.extname(filename).toLowerCase();
  const loader = LOADER_MAP[ext] || 'ts';
  const result = transformSync(source, {
    loader,
    sourcefile: filename,
    format: 'cjs',
    target: 'node18',
  });
  return result.code;
}

/**
 * @param {string} filename
 * @returns {boolean}
 */
function isTypeScriptFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return TS_EXTENSIONS.includes(ext);
}

/**
 * Register tsx CJS hooks on Module._extensions so that require() calls
 * for TS/JSX files are transparently transpiled.
 * @returns {() => void} Unregister function
 */
function registerTsRequireHooks() {
  const { register } = require('tsx/cjs/api');
  return register();
}

module.exports = { transpileSource, isTypeScriptFile, registerTsRequireHooks, TS_EXTENSIONS };
