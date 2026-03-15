'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tries to resolve a test file from --testPathPatterns or a file-like argument.
 * @param {string[]} runnerArgs
 * @returns {string | null}
 */
function autoDetectFocusFromArgs(runnerArgs) {
  const patternIdx = runnerArgs.findIndex(a => a === '--testPathPatterns' || a === '--testPathPattern');
  const pattern = patternIdx !== -1 ? runnerArgs[patternIdx + 1] : null;

  const candidates = [];

  for (const arg of runnerArgs) {
    if (arg.startsWith('-')) continue;
    if (/\.(js|ts|mjs|cjs|jsx|tsx)$/.test(arg)) candidates.push(arg);
  }

  if (pattern) {
    const extensions = ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx', '.spec.js', '.test.js', '.ts', '.js'];
    for (const ext of extensions) {
      candidates.push(pattern.endsWith(ext) ? pattern : pattern + ext);
    }
  }

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    try {
      fs.accessSync(resolved, fs.constants.R_OK);
      return fs.realpathSync(resolved);
    } catch (_) {}
  }

  return null;
}

/**
 * Try to find a source file path from the command string.
 * @param {string} command
 * @returns {string | null}
 */
function guessSourceFromCommand(command) {
  const tokens = command.split(/\s+/);
  for (const token of tokens) {
    if (/\.(js|ts|mjs|cjs|jsx|tsx)$/.test(token) && !token.startsWith('-')) {
      const resolved = path.resolve(token);
      try {
        fs.accessSync(resolved, fs.constants.R_OK);
        return resolved;
      } catch (_) {}
    }
  }
  return null;
}

/**
 * Scans events for the most frequently referenced user-code file.
 * @param {import('../types').ElvEvent[]} events
 * @returns {string | null}
 */
function extractSourceFromEvents(events) {
  const counts = new Map();
  for (const event of events) {
    if (!event.file) continue;
    if (event.file.includes('node_modules')) continue;
    counts.set(event.file, (counts.get(event.file) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [file, count] of counts) {
    if (count > bestCount) { best = file; bestCount = count; }
  }
  return best;
}

module.exports = { autoDetectFocusFromArgs, guessSourceFromCommand, extractSourceFromEvents };
