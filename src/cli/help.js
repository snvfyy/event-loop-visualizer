'use strict';

function printHelp() {
  process.stdout.write([
    '',
    '  Event Loop Visualizer (js-elv)',
    '',
    '  Usage:',
    '    js-elv <script.js|ts>            Run a JS/TS file and visualize its event loop',
    '    js-elv jest <jest-args>          Run Jest tests and visualize async activity',
    '    js-elv vitest <vitest-args>      Run Vitest tests and visualize async activity',
    '    js-elv --cmd "<command>"         Run any command and visualize captured events',
    '',
    '  Options:',
    '    --focus, -f <file>               Only capture events related to this file',
    '    --help, -h                       Show this help message',
    '    --version, -V                    Show version number',
    '',
    '  Examples:',
    '    js-elv examples/async-await.js',
    '    js-elv jest --testPathPatterns MyTest',
    '    js-elv vitest run src/utils.test.ts',
    '    js-elv jest --testPathPatterns MyTest -f src/__tests__/MyTest.spec.ts',
    '    js-elv --cmd "node server.js"',
    '    js-elv --cmd "pnpm nx run my-project:test --skip-nx-cache"',
    '    js-elv --cmd "node app.js" --focus src/services/auth.js',
    '',
    '  Environment:',
    '    ELV_TIMEOUT        Safety timeout in ms (default: 30000)',
    '    ELV_MAX_EVENTS     Max events per process (default: 5000)',
    '    ELV_INTERVAL_CAP   Max setInterval iterations to record (default: 10)',
    '',
    '  Note: js-elv auto-detects your package manager (pnpm/yarn/npx) from lock files.',
    '',
  ].join('\n') + '\n');
}

module.exports = { printHelp };
