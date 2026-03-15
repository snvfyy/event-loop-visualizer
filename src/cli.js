'use strict';

const fs = require('fs');
const path = require('path');

const { printHelp } = require('./cli/help');
const { shellEscape, detectPackageRunner } = require('./cli/utils');
const { autoDetectFocusFromArgs } = require('./cli/detect');
const { runFileMode } = require('./cli/file-mode');
const { runCommandMode } = require('./cli/command-mode');

/**
 * CLI entry point. Parses argv and dispatches to the appropriate mode.
 * @param {string[]} argv - Arguments (typically process.argv.slice(2))
 */
function main(argv) {
  const args = argv.slice();

  if (process.platform === 'win32') {
    process.stderr.write(
      'Error: js-elv does not support Windows natively.\n' +
      'Hint: Use WSL (Windows Subsystem for Linux) or Git Bash.\n'
    );
    process.exit(1);
  }

  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-V')) {
    const { version } = require('../package.json');
    process.stdout.write('js-elv v' + version + '\n');
    process.exit(0);
  }

  // Parse --focus flag
  const focusIndex = args.indexOf('--focus');
  let focusFile = null;
  if (focusIndex !== -1) {
    focusFile = args[focusIndex + 1];
    if (!focusFile) {
      process.stderr.write('Error: --focus requires a file path.\n');
      process.exit(1);
    }
    focusFile = path.resolve(focusFile);
    if (!fs.existsSync(focusFile)) {
      process.stderr.write('Error: focus file not found: ' + focusFile + '\n');
      process.exit(1);
    }
    try { focusFile = fs.realpathSync(focusFile); } catch (_) {}
    args.splice(focusIndex, 2);
  }

  const firstArg = args[0];

  // Jest / Vitest mode
  if (firstArg === 'jest' || firstArg === 'vitest') {
    const runner = firstArg;
    const runnerArgs = args.slice(1);

    if (runner === 'vitest' && !runnerArgs.includes('run') && !runnerArgs.includes('bench')) {
      process.stderr.write(
        'Warning: `js-elv vitest` without "run" starts watch mode, which is not supported.\n' +
        'Hint:    js-elv vitest run' + (runnerArgs.length ? ' ' + runnerArgs.join(' ') : '') + '\n'
      );
      process.exit(1);
    }

    const pkgRunner = detectPackageRunner();
    const command = pkgRunner + ' ' + runner + (runnerArgs.length ? ' ' + runnerArgs.map(shellEscape).join(' ') : '');

    if (!focusFile) focusFile = autoDetectFocusFromArgs(runnerArgs);

    runCommandMode(command, focusFile);
    return;
  }

  // Raw command mode
  if (firstArg === '--cmd') {
    const command = args[1];
    if (!command) {
      process.stderr.write('Error: --cmd requires a command string.\nHint:  js-elv --cmd "node server.js"\n');
      process.exit(1);
    }
    runCommandMode(command, focusFile);
    return;
  }

  // File mode (default)
  const scriptPath = firstArg;
  if (!fs.existsSync(scriptPath)) {
    const suggestion = scriptPath.includes('test') || scriptPath.includes('spec')
      ? '\nHint:  js-elv vitest run ' + scriptPath + '  (for test files)'
      : '\nHint:  js-elv <script.js>  or  js-elv --help';
    process.stderr.write('Error: file not found: ' + scriptPath + suggestion + '\n');
    process.exit(1);
  }
  runFileMode(scriptPath, focusFile);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { main };
