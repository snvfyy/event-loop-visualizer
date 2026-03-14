/**
 * Vitest setup file that:
 *  1. Creates the elv instrumenter (patches globals, starts async_hooks)
 *  2. Registers beforeEach / afterEach hooks for TEST_START / TEST_END events
 *  3. Writes captured events to ELV_OUTPUT_DIR on afterAll
 *
 * When ELV_OUTPUT_DIR is not set (i.e. not running under elv), this is a no-op.
 */
import { beforeEach, afterEach, afterAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { writeEventFile } = require('./write-events.js');
const outputDir = process.env.ELV_OUTPUT_DIR;

let instrumenter = null;

if (outputDir) {
  const { createInstrumenter } = require('./instrument.js');
  instrumenter = createInstrumenter(globalThis, {
    mode: 'vitest',
    focusFile: process.env.ELV_FOCUS_FILE || null,
  });
  instrumenter.emit({ type: 'SYNC_START', label: 'vitest-worker ' + process.pid });
  globalThis.__elvInstrumenter = instrumenter;
}

function getTestPath(task) {
  const parts = [];
  let current = task;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.name && current.type !== 'collector') parts.unshift(current.name);
    current = current.suite;
  }
  return parts.join(' \u203A ') || task.name || '';
}

if (instrumenter) {
  beforeEach(({ task }) => {
    instrumenter.emit({ type: 'TEST_START', label: getTestPath(task) });
  });

  afterEach(({ task }) => {
    const passed = task.result && task.result.state === 'pass';
    instrumenter.emit({ type: 'TEST_END', label: task.name, value: passed ? 'pass' : 'fail' });
  });

  afterAll(() => {
    instrumenter.emit({ type: 'SYNC_END' });
    instrumenter.emit({ type: 'DONE' });

    let events = instrumenter.events;
    const firstTestIdx = events.findIndex(e => e.type === 'TEST_START');
    // Strip pre-test noise: keep SYNC_START then skip straight to the first test
    if (firstTestIdx > 1) {
      events = [events[0], ...events.slice(firstTestIdx)];
    }

    try {
      writeEventFile(outputDir, 'vitest-', events, 'vitest');
    } catch (_) {}
  });
}
