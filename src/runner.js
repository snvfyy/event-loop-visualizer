'use strict';

/** @typedef {import('./types').InstrumenterResult} InstrumenterResult */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const { createInstrumenter } = require('./instrument');
const { transformSource } = require('./transform');
const { transpileSource, isTypeScriptFile, registerTsRequireHooks } = require('./ts-hooks');

// Idle detection polling: IDLE_THRESHOLD_MS is how long (ms) without new events
// before considering the script "done". POLL_INTERVAL_MS is how often we check.
// The ratio matters: threshold must be > interval to avoid false positives.
// 300/150 balances responsiveness (~450ms worst-case exit delay) against
// correctness (scripts with sub-300ms gaps between async phases keep running).
const IDLE_THRESHOLD_MS = 300;
const POLL_INTERVAL_MS = 150;

const scriptPath = process.argv[2];
if (!scriptPath) {
  process.stderr.write('runner: no script path provided\n');
  process.exit(1);
}

const resolved = path.resolve(scriptPath);
const ext = path.extname(resolved).toLowerCase();

if (ext === '.mts' || ext === '.mjs') {
  process.stderr.write(
    'Error: File mode does not support ES modules (' + ext + ').\n' +
    'Hint: Use "elv vitest run ' + scriptPath + '" for ESM files.\n'
  );
  process.exit(1);
}

function isESMPackage(filePath) {
  let dir = path.dirname(filePath);
  for (;;) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      return pkg.type === 'module';
    } catch (_) {}
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

if (isESMPackage(resolved)) {
  process.stderr.write(
    'Error: File mode does not support ES modules (package.json has "type": "module").\n' +
    'Hint: Use "elv vitest run ' + scriptPath + '" for ESM projects.\n'
  );
  process.exit(1);
}

const isTS = isTypeScriptFile(resolved);
if (isTS) registerTsRequireHooks();

let focusFile = process.env.ELV_FOCUS_FILE || null;
if (focusFile) { try { focusFile = fs.realpathSync(focusFile); } catch (_) {} }

/** @type {InstrumenterResult} */
const inst = createInstrumenter(global, { mode: 'file', focusFile: focusFile });
const _setTimeout = inst.originals.setTimeout;

inst.emit({ type: 'SYNC_START', label: path.basename(resolved) });

try {
  const rawSource = fs.readFileSync(resolved, 'utf8');
  const jsSource = isTS ? transpileSource(rawSource, resolved) : rawSource;
  const instrumented = transformSource(jsSource, resolved);
  if (instrumented === jsSource) {
    inst.emit({ type: 'LOG', value: '[elv] Warning: Could not parse source. Variable tracking unavailable.', subtype: 'warn' });
  }
  const mod = new Module(resolved, module);
  mod.filename = resolved;
  // @ts-ignore — Node internal API, not in @types/node
  mod.paths = Module._nodeModulePaths(path.dirname(resolved));
  // @ts-ignore — Node internal API, not in @types/node
  mod._compile(instrumented, resolved);
} catch (err) {
  inst.emit({ type: 'ERROR', value: err && err.message || String(err) });
}

inst.emit({ type: 'SYNC_END' });

let eventsSent = false;

/** Polls until no pending timers and idle for IDLE_THRESHOLD_MS, then sends events and exits. */
function checkIdleAndFinish() {
  const state = inst.getState();
  if (process.send) {
    try { process.send({ type: 'state', pendingTimers: state.pendingTimers }); } catch (_) {}
  }
  const idle = Date.now() - state.lastEventTime > IDLE_THRESHOLD_MS;
  if (idle && state.pendingTimers <= 0) {
    inst.emit({ type: 'DONE' });
    eventsSent = true;
    if (process.send) {
      process.send({ type: 'events', data: inst.events });
    }
    process.exit(0);
  }
  _setTimeout.call(global, checkIdleAndFinish, POLL_INTERVAL_MS);
}

process.on('exit', () => {
  if (!eventsSent && process.send && inst.events.length > 0) {
    inst.emit({ type: 'DONE' });
    try { process.send({ type: 'events', data: inst.events }); } catch (_) {}
  }
});

_setTimeout.call(global, checkIdleAndFinish, POLL_INTERVAL_MS);
