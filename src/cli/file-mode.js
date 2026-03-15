'use strict';

const { fork } = require('child_process');
const path = require('path');
const { launchTUI } = require('./launch-tui');

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Fork runner.js, collect events via IPC, and launch the TUI.
 * @param {string} scriptPath
 * @param {string | null} focusFile
 */
function runFileMode(scriptPath, focusFile) {
  const resolved = path.resolve(scriptPath);
  const timeout = parseInt(process.env.ELV_TIMEOUT, 10) || DEFAULT_TIMEOUT_MS;

  const env = Object.assign({}, process.env);
  if (focusFile) env.ELV_FOCUS_FILE = focusFile;

  const child = fork(path.join(__dirname, '..', 'runner.js'), [resolved], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env,
  });

  let events = null;
  let lastPendingTimers = 0;
  const timer = setTimeout(() => {
    const hint = lastPendingTimers > 0
      ? ' (' + lastPendingTimers + ' timer' + (lastPendingTimers > 1 ? 's' : '') + ' still pending)'
      : '';
    process.stderr.write(
      'Timeout: script did not complete within ' + timeout + 'ms' + hint + '.\n' +
      'Hint: Set ELV_TIMEOUT=60000 for longer scripts.\n'
    );
    child.kill();
    process.exit(1);
  }, timeout);

  child.on('message', (msg) => {
    if (msg && msg.type === 'events') events = msg.data;
    if (msg && msg.type === 'state') lastPendingTimers = msg.pendingTimers || 0;
  });

  child.on('exit', () => {
    clearTimeout(timer);
    if (!events || events.length === 0) {
      process.stderr.write('No events captured.\n');
      process.exit(1);
    }
    launchTUI(events, resolved, focusFile);
  });
}

module.exports = { runFileMode };
