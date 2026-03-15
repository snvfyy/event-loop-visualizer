import { createElement } from 'react';
import { render as inkRender } from 'ink';
import { App } from './App.mjs';

const h = createElement;

/**
 * Launches the ink TUI for step-through event replay.
 * @param {import('../types').ElvEvent[]} events
 * @param {string | null} sourceCode
 * @param {string | null} [sourcePath]
 * @param {string | null} [focusFile]
 * @returns {void}
 */
export function startTUI(events, sourceCode, sourcePath, focusFile) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  if (cols < 80 || rows < 24) {
    process.stderr.write(
      'Terminal too small (' + cols + 'x' + rows + ', need at least 80x24).\n' +
      'Resize your terminal window and try again.\n'
    );
    process.exit(1);
  }

  process.stdout.write('\x1b[?1049h');
  process.stdout.write('\x1b[?25l');

  const cleanup = () => {
    process.stdout.write('\x1b[?25h');
    process.stdout.write('\x1b[?1049l');
  };
  process.on('exit', cleanup);

  const instance = inkRender(
    h(App, { events, sourceCode, sourcePath, focusFile }),
    { exitOnCtrlC: false }
  );

  instance.waitUntilExit().then(() => {
    process.exit(0);
  });
}

// Re-exports for tests
export { applyEvent, createInitialState } from './state.mjs';
export { pathsMatch } from './helpers.mjs';
export { App } from './App.mjs';
