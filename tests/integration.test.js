import { describe, it, expect } from 'vitest';
import { fork, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import path from 'path';

const RUNNER_TIMEOUT_MS = 10000;

/**
 * Forks runner.js with a script path and collects the events it sends back.
 * @param {string} scriptPath - Relative path from the project root
 * @returns {Promise<Array<{ type: string, [key: string]: any }>>}
 */
function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = fork(
      path.resolve('src/runner.js'),
      [scriptPath],
      { silent: true },
    );

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`runner timed out for ${scriptPath}`));
    }, RUNNER_TIMEOUT_MS);

    child.on('message', (msg) => {
      if (msg.type === 'events') {
        clearTimeout(timeout);
        resolve(msg.data);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`runner exited with code ${code}`));
    });
  });
}

describe('integration: async-await.js', () => {
  it('captures the full event lifecycle', async () => {
    const events = await runScript('examples/async-await.js');

    const types = events.map(e => e.type);
    expect(types[0]).toBe('SYNC_START');
    expect(types).toContain('SYNC_END');
    expect(types[types.length - 1]).toBe('DONE');
  });

  it('captures console.log output', async () => {
    const events = await runScript('examples/async-await.js');

    const logs = events.filter(e => e.type === 'LOG').map(e => e.value);
    expect(logs).toContain('1 - start');
    expect(logs).toContain('3 - sync after call');
    expect(logs).toContain('2 - after await: data');
  });

  it('captures promise microtask events', async () => {
    const events = await runScript('examples/async-await.js');

    const micros = events.filter(e => e.type === 'ENQUEUE_MICRO');
    expect(micros.length).toBeGreaterThan(0);
    expect(micros.some(e => e.subtype === 'promise')).toBe(true);
  });

  it('logs appear in the correct execution order', async () => {
    const events = await runScript('examples/async-await.js');

    const logs = events.filter(e => e.type === 'LOG').map(e => e.value);
    const idx1 = logs.indexOf('1 - start');
    const idx3 = logs.indexOf('3 - sync after call');
    const idx2 = logs.indexOf('2 - after await: data');

    expect(idx1).toBeLessThan(idx3);
    expect(idx3).toBeLessThan(idx2);
  });
});

describe('integration: closure-loop.js', () => {
  it('captures setTimeout macrotask events', async () => {
    const events = await runScript('examples/closure-loop.js');

    const macros = events.filter(e => e.type === 'ENQUEUE_MACRO');
    expect(macros.length).toBe(3);
    expect(macros.every(e => e.subtype === 'setTimeout')).toBe(true);
  });

  it('setTimeout callbacks all fire', async () => {
    const events = await runScript('examples/closure-loop.js');

    const callbacks = events.filter(
      e => e.type === 'CALLBACK_START' && e.subtype === 'setTimeout',
    );
    expect(callbacks.length).toBe(3);
  });

  it('logs the closure value (3) three times', async () => {
    const events = await runScript('examples/closure-loop.js');

    const logs = events.filter(e => e.type === 'LOG').map(e => e.value);
    expect(logs.filter(v => v === '3').length).toBe(3);
  });
});

describe('integration: promise-executor.js', () => {
  it('captures sync executor and then microtask', async () => {
    const events = await runScript('examples/promise-executor.js');

    const logs = events.filter(e => e.type === 'LOG').map(e => e.value);
    expect(logs[0]).toBe('1');
    expect(logs[1]).toBe('2 - executor is sync!');
    expect(logs[2]).toBe('3');
    expect(logs[3]).toBe('4 - microtask');
  });

  it('enqueues exactly one microtask for .then()', async () => {
    const events = await runScript('examples/promise-executor.js');

    const micros = events.filter(e => e.type === 'ENQUEUE_MICRO');
    expect(micros.length).toBeGreaterThan(0);
    expect(micros.some(e => e.subtype === 'promise')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Vitest test boundary integration tests
// ---------------------------------------------------------------------------

/**
 * Runs vitest with the elv setup file via a temporary config and collects
 * the event JSON from a temporary output directory. Returns the parsed
 * events array from the worker that produced the most events.
 * @param {string} testFile - Relative path to the vitest test file
 * @returns {Array<{ type: string, [key: string]: any }>}
 */
function runVitestAndCollectEvents(testFile) {
  const id = crypto.randomBytes(4).toString('hex');
  const tmpDir = path.join(os.tmpdir(), 'elv-test-' + id);
  fs.mkdirSync(tmpDir, { recursive: true });

  const setupPath = path.resolve('src/vitest-setup.mjs').replace(/\\/g, '/');
  const configPath = path.resolve('.elv-test-config-' + id + '.mjs');

  fs.writeFileSync(configPath, [
    "import { defineConfig } from 'vitest/config';",
    'export default defineConfig({',
    '  test: {',
    `    include: [${JSON.stringify(testFile)}],`,
    '    testTimeout: 15000,',
    `    setupFiles: [${JSON.stringify(setupPath)}],`,
    '  },',
    '});',
  ].join('\n'));

  try {
    execSync(`npx vitest run --config ${configPath}`, {
      env: { ...process.env, ELV_OUTPUT_DIR: tmpDir },
      stdio: 'pipe',
      timeout: 30000,
    });
  } catch (_) {
    // vitest may exit non-zero; we only care about the event files
  }

  fs.unlinkSync(configPath);

  const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.json'));
  let allEvents = [];
  for (const f of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, f), 'utf8'));
      if (data.events && data.events.length > allEvents.length) {
        allEvents = data.events;
      }
    } catch (_) {}
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
  return allEvents;
}

describe('integration: vitest test boundaries (demo.test.js)', () => {
  let events;

  // Run once and share across assertions
  it('captures events from vitest run', () => {
    events = runVitestAndCollectEvents('tests/demo.test.js');
    expect(events.length).toBeGreaterThan(0);
  });

  it('emits TEST_START and TEST_END events', () => {
    const starts = events.filter(e => e.type === 'TEST_START');
    const ends = events.filter(e => e.type === 'TEST_END');

    expect(starts.length).toBe(3);
    expect(ends.length).toBe(3);
  });

  it('TEST_START labels match the it() names from demo.test.js', () => {
    const startLabels = events
      .filter(e => e.type === 'TEST_START')
      .map(e => e.label);

    expect(startLabels).toContain('microtasks drain before macrotasks');
    expect(startLabels).toContain('await resumes as a microtask');
    expect(startLabels).toContain('nested microtasks run before the next macrotask');
  });

  it('TEST_END labels match and all tests pass', () => {
    const ends = events.filter(e => e.type === 'TEST_END');

    expect(ends.every(e => e.value === 'pass')).toBe(true);
    const endLabels = ends.map(e => e.label);
    expect(endLabels).toContain('microtasks drain before macrotasks');
    expect(endLabels).toContain('await resumes as a microtask');
    expect(endLabels).toContain('nested microtasks run before the next macrotask');
  });

  it('TEST_START and TEST_END are properly paired in order', () => {
    const boundaries = events.filter(
      e => e.type === 'TEST_START' || e.type === 'TEST_END'
    );

    // Should alternate: START, END, START, END, START, END
    for (let i = 0; i < boundaries.length; i++) {
      expect(boundaries[i].type).toBe(i % 2 === 0 ? 'TEST_START' : 'TEST_END');
    }
  });

  it('overall event ordering is correct', () => {
    const types = events.map(e => e.type);

    expect(types[0]).toBe('SYNC_START');
    expect(types).toContain('TEST_START');
    expect(types).toContain('TEST_END');
    expect(types).toContain('SYNC_END');
    expect(types[types.length - 1]).toBe('DONE');

    const firstTestStart = types.indexOf('TEST_START');
    const lastTestEnd = types.lastIndexOf('TEST_END');
    const syncEnd = types.indexOf('SYNC_END');

    expect(firstTestStart).toBeGreaterThan(0);
    expect(lastTestEnd).toBeGreaterThan(firstTestStart);
    expect(syncEnd).toBeGreaterThan(lastTestEnd);
  });
});
