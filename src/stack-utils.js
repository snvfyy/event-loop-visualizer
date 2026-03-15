'use strict';

/**
 * Parses a single V8 stack frame string into file, line, and optional function name.
 * @param {string} frame
 * @returns {{ file: string, line: number, fnName: string | undefined } | null}
 */
function parseFrame(frame) {
  const named = frame.match(/at (.+?) \((.+):(\d+):\d+\)/);
  if (named) {
    const fnName = named[1] === 'Object.<anonymous>' ? undefined : named[1];
    return { file: named[2], line: parseInt(named[3], 10), fnName };
  }
  const simple = frame.match(/\((.+):(\d+):\d+\)/) || frame.match(/at (.+):(\d+):\d+/);
  if (simple) return { file: simple[1], line: parseInt(simple[2], 10), fnName: undefined };
  return null;
}

/**
 * Capture a stack string. Tries the current prepareStackTrace first (which
 * may include Vite's source-map remapping for correct original line numbers).
 * Falls back to raw V8 frames only if the custom handler throws.
 * @returns {string | undefined}
 */
function getRawStack() {
  try {
    const stack = new Error().stack;
    if (stack) return stack;
  } catch (_) {}
  const prev = Error.prepareStackTrace;
  Error.prepareStackTrace = undefined;
  const stack = new Error().stack;
  Error.prepareStackTrace = prev;
  return stack;
}

module.exports = { parseFrame, getRawStack };
