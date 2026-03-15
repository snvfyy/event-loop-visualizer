'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { classifyProcess } = require('../classify');
const { escapeForJS, shellEscape } = require('./utils');
const { guessSourceFromCommand } = require('./detect');
const { launchTUI } = require('./launch-tui');

const EVENT_FILE_PREFIX = 'events-';

/**
 * Generates a temporary Vitest config that wraps the user's existing config
 * with elv's transform plugin and setup file.
 * @param {string | null} focusFile
 * @returns {string} Path to the generated config file
 */
function generateVitestConfig(focusFile) {
  const vitestSetupPath = escapeForJS(path.join(__dirname, '..', 'vitest-setup.mjs'));
  const pluginPath = escapeForJS(path.join(__dirname, '..', 'vite-plugin-elv.mjs'));
  const elvSrcDir = escapeForJS(path.join(__dirname, '..'));
  const focusLiteral = focusFile ? "'" + escapeForJS(focusFile) + "'" : 'null';

  const configCandidates = [
    'vitest.config.ts', 'vitest.config.mts', 'vitest.config.js', 'vitest.config.mjs',
    'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs',
  ];
  const userConfigFile = configCandidates.find(f => fs.existsSync(path.join(process.cwd(), f)));

  const lines = [
    "import { elvTransformPlugin } from '" + pluginPath + "';",
  ];
  if (userConfigFile) {
    lines.push("import userConfigDefault from './" + userConfigFile + "';");
    lines.push('');
    lines.push('const _raw = typeof userConfigDefault === "function" ? userConfigDefault() : userConfigDefault;');
    lines.push('const base = (_raw && _raw.default) || _raw || {};');
  } else {
    lines.push('');
    lines.push('const base = {};');
  }
  lines.push(
    'const baseTest = (base && base.test) || {};',
    'const baseSetup = Array.isArray(baseTest.setupFiles) ? baseTest.setupFiles : (baseTest.setupFiles ? [baseTest.setupFiles] : []);',
    'const baseServer = (base && base.server) || {};',
    'const baseFsAllow = (baseServer.fs && baseServer.fs.allow) || [];',
    '',
    'export default {',
    '  ...base,',
    "  server: { ...baseServer, fs: { ...(baseServer.fs || {}), allow: [...baseFsAllow, '" + elvSrcDir + "'] } },",
    "  plugins: [...(base.plugins || []), elvTransformPlugin({ focusFile: " + focusLiteral + " })],",
    '  test: {',
    '    ...baseTest,',
    "    setupFiles: [...baseSetup, '" + vitestSetupPath + "'],",
    '  },',
    '};',
    '',
  );

  const configPath = path.join(process.cwd(), '.elv-vitest.config.mjs');
  fs.writeFileSync(configPath, lines.join('\n'));
  return configPath;
}

/**
 * Spawn a shell command with instrumentation env vars, collect event files, and launch the TUI.
 * @param {string} command
 * @param {string | null} focusFile
 */
function runCommandMode(command, focusFile) {
  const tmpDir = path.join(os.tmpdir(), 'elv-' + crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(tmpDir, { recursive: true });

  const preloadPath = path.join(__dirname, '..', 'preload.js');
  const jestEnvPath = path.join(__dirname, '..', 'jest-environment.js');

  let effectiveCmd = command;
  const isVitest = /\bvitest\b/i.test(command);
  const isJest = /\bjest\b/i.test(command);
  const isNxTest = /\bnx\b.*\btest\b/i.test(command) || /:\s*test\b/.test(command);
  const looksLikeTest = isJest || isVitest || isNxTest;

  // Vitest config injection
  let elvVitestConfig = null;
  if (isVitest && !command.includes('--config')) {
    elvVitestConfig = generateVitestConfig(focusFile);
    effectiveCmd += ' --config ' + shellEscape(elvVitestConfig);
  }

  if (elvVitestConfig) {
    const configToClean = elvVitestConfig;
    const cleanupConfig = () => { try { fs.unlinkSync(configToClean); } catch (_) {} };
    process.on('exit', cleanupConfig);
    process.on('SIGINT', () => { cleanupConfig(); process.exit(130); });
    process.on('SIGTERM', () => { cleanupConfig(); process.exit(143); });
  }

  // Jest / Nx test environment injection
  if (isJest && !command.includes('--testEnvironment')) {
    effectiveCmd += ' --testEnvironment=' + jestEnvPath;
  } else if (isNxTest && !command.includes('--testEnvironment')) {
    if (effectiveCmd.includes(' -- ')) {
      effectiveCmd = effectiveCmd.replace(' -- ', ' -- --testEnvironment=' + jestEnvPath + ' ');
    } else {
      effectiveCmd += ' -- --testEnvironment=' + jestEnvPath;
    }
  }

  if ((isJest || isNxTest) && !command.includes('--coverage')) {
    if (effectiveCmd.includes(' -- ')) {
      effectiveCmd = effectiveCmd.replace(' -- ', ' -- --coverage=false ');
    } else {
      effectiveCmd += ' --coverage=false';
    }
  }

  // Build env and spawn
  const existingNodeOptions = process.env.NODE_OPTIONS || '';
  const nodeOptions = (existingNodeOptions + ' --require ' + preloadPath).trim();

  const env = Object.assign({}, process.env, {
    NODE_OPTIONS: nodeOptions,
    ELV_OUTPUT_DIR: tmpDir,
    NX_DAEMON: 'false',
  });
  if (focusFile) env.ELV_FOCUS_FILE = focusFile;

  const child = spawn('sh', ['-c', effectiveCmd], { env, stdio: 'inherit' });

  child.on('exit', (code) => {
    let allEvents = [];
    try {
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(EVENT_FILE_PREFIX) && f.endsWith('.json'));
      for (const filename of files) {
        try {
          const raw = fs.readFileSync(path.join(tmpDir, filename), 'utf8');
          allEvents.push(JSON.parse(raw));
        } catch (_) {}
      }
    } catch (_) {}

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    if (elvVitestConfig) { try { fs.unlinkSync(elvVitestConfig); } catch (_) {} }

    if (allEvents.length === 0) {
      process.stderr.write('No events captured from command.\n');
      process.exit(code || 1);
    }

    if (looksLikeTest) {
      const testWorkerEvents = allEvents.filter(pd =>
        pd.label === 'jest-worker' || pd.label === 'vitest'
      );
      if (testWorkerEvents.length > 0) allEvents = testWorkerEvents;
    }

    const guessedSource = guessSourceFromCommand(command);

    if (allEvents.length === 1) {
      launchTUI(allEvents[0].events, guessedSource, focusFile);
      return;
    }

    allEvents.sort((a, b) => (b.events ? b.events.length : 0) - (a.events ? a.events.length : 0));

    if (!process.stdin.isTTY) {
      launchTUI(allEvents[0].events, guessedSource, focusFile);
      return;
    }

    process.stdout.write('\nCaptured events from ' + allEvents.length + ' processes:\n\n');
    allEvents.forEach((processData, i) => {
      const label = classifyProcess(processData.argv, processData.label);
      const count = processData.events ? processData.events.length : 0;
      process.stdout.write(
        '  ' + (i + 1) + '. ' + label + ' (pid ' + processData.pid + ', ' + count + ' events)\n'
      );
    });
    process.stdout.write('\nSelect process [1-' + allEvents.length + ']: ');

    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      process.stdin.removeAllListeners('data');
      const choice = parseInt(data.trim(), 10);
      if (choice >= 1 && choice <= allEvents.length) {
        launchTUI(allEvents[choice - 1].events, guessedSource, focusFile);
      } else {
        process.stderr.write('Invalid selection.\n');
        process.exit(1);
      }
    });
  });
}

module.exports = { runCommandMode };
