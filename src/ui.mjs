import { createElement, useState, useEffect, useRef } from 'react';
import { render as inkRender, Box, Text, useInput, useApp, useStdout } from 'ink';
import chalk from 'chalk';
import fs from 'node:fs';

const h = createElement;

const DEFAULT_PLAY_SPEED_MS = 800;
const MIN_PLAY_SPEED_MS = 100;
const MAX_PLAY_SPEED_MS = 3000;
const SPEED_STEP_MS = 100;
const SCROLL_OFFSET_LINES = 4;
const MAX_MEMORY_DISPLAY_LEN = 50;
const SNAPSHOT_INTERVAL = 100;
const PANEL_COUNT = 7;

// Phase-based color themes
const PHASE_COLORS = {
  'Ready': { primary: 'gray', accent: 'white' },
  'Synchronous': { primary: 'green', accent: 'greenBright' },
  'Sync Complete': { primary: 'green', accent: 'greenBright' },
  'Microtasks': { primary: 'cyan', accent: 'cyanBright' },
  'Macrotasks': { primary: 'yellow', accent: 'yellowBright' },
  'Complete': { primary: 'gray', accent: 'white' },
};

// JavaScript syntax highlighting keywords
const JS_KEYWORDS = [
  'async', 'await', 'function', 'const', 'let', 'var', 'return', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch',
  'finally', 'throw', 'new', 'class', 'extends', 'import', 'export', 'default',
  'from', 'of', 'in', 'typeof', 'instanceof', 'this', 'super', 'null', 'undefined',
  'true', 'false', 'void', 'delete', 'yield', 'static', 'get', 'set',
];

const JS_BUILTINS = [
  'Promise', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'setImmediate', 'queueMicrotask', 'console', 'process', 'JSON', 'Math',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Error', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Proxy', 'Reflect', 'Intl', 'fetch',
];

/**
 * Apply syntax highlighting to a line of JavaScript code
 * @param {string} line
 * @returns {string}
 */
function highlightSyntax(line) {
  if (!line) return line;
  
  let result = line;
  
  // Highlight strings (single and double quotes, backticks)
  result = result.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*?\1/g, match => chalk.yellow(match));
  
  // Highlight comments
  result = result.replace(/(\/\/.*$)/gm, match => chalk.gray.italic(match));
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, match => chalk.gray.italic(match));
  
  // Highlight numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, match => chalk.magenta(match));
  
  // Highlight keywords
  for (const kw of JS_KEYWORDS) {
    const regex = new RegExp(`\\b(${kw})\\b`, 'g');
    result = result.replace(regex, chalk.red(kw));
  }
  
  // Highlight builtins
  for (const builtin of JS_BUILTINS) {
    const regex = new RegExp(`\\b(${builtin})\\b`, 'g');
    result = result.replace(regex, chalk.cyan(builtin));
  }
  
  // Highlight arrow functions
  result = result.replace(/(=>)/g, chalk.red('=>'));
  
  return result;
}

/**
 * Strip ANSI SGR escape codes from a string to get visible text only.
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Truncate a string containing ANSI codes to a maximum visible width.
 * Preserves escape sequences before the cut point and resets formatting after.
 * @param {string} str
 * @param {number} maxWidth
 * @returns {string}
 */
function truncateAnsi(str, maxWidth) {
  if (maxWidth <= 0) return '';
  if (stripAnsi(str).length <= maxWidth) return str;

  const target = Math.max(0, maxWidth - 1);
  let visible = 0;
  let i = 0;

  while (i < str.length && visible < target) {
    if (str.charCodeAt(i) === 0x1b && i + 1 < str.length && str.charCodeAt(i + 1) === 0x5b) {
      const mIdx = str.indexOf('m', i + 2);
      if (mIdx !== -1) { i = mIdx + 1; continue; }
    }
    visible++;
    i++;
  }

  return str.slice(0, i) + '\x1b[0m\u2026';
}

const _realPathCache = new Map();
/**
 * Compares two file paths, handling symlinks (e.g. macOS /tmp vs /private/tmp).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function pathsMatch(a, b) {
  if (a === b) return true;
  try {
    if (!_realPathCache.has(a)) _realPathCache.set(a, fs.realpathSync(a));
    if (!_realPathCache.has(b)) _realPathCache.set(b, fs.realpathSync(b));
    return _realPathCache.get(a) === _realPathCache.get(b);
  } catch (_) {
    return a.endsWith(b) || b.endsWith(a);
  }
}

/** @returns {import('./types').TUIState} */
function createInitialState() {
  return {
    callStack: [],
    microQueue: [],
    macroQueue: [],
    console: [],
    log: [],
    phase: 'Ready',
    memory: new Map(),
    startTs: 0,
    prevTs: 0,
    currentTest: null,
  };
}

/**
 * Mutates state based on an event, updating queues, call stack, phase, and log.
 * Log entries use chalk formatting (ANSI escape codes) for colored terminal output.
 * @param {import('./types').TUIState} state
 * @param {import('./types').ElvEvent} event
 * @returns {void}
 */
function applyEvent(state, event) {
  const fileTag = (event.external && event.file)
    ? ' ' + chalk.gray('\u21AA ' + event.file.split(/[\/\\]/).pop())
    : '';

  const delta = (event.ts && state.prevTs) ? event.ts - state.prevTs : 0;
  const ts = chalk.gray(('+' + delta + 'ms').padStart(7)) + ' ';
  if (event.ts) state.prevTs = event.ts;

  switch (event.type) {
    case 'SYNC_START':
      if (event.ts) { state.startTs = event.ts; state.prevTs = event.ts; }
      state.callStack.push('<script>' + (event.label ? ' ' + event.label : ''));
      state.phase = 'Synchronous';
      state.log.push(ts + chalk.bgGreen.black.bold(' START ') + ' Script execution started');
      break;

    case 'SYNC_END':
      state.callStack = [];
      state.phase = 'Sync Complete';
      state.log.push(ts + chalk.green('\u2500\u2500\u2500') + chalk.green.bold(' Synchronous phase complete ') + chalk.green('\u2500\u2500\u2500'));
      break;

    case 'LOG': {
      const val = event.value || '';
      state.console.push('> ' + val);
      state.log.push(ts + chalk.gray('\u2502') + ' ' + chalk.white(val) + fileTag);
      break;
    }

    case 'ENQUEUE_MACRO': {
      const label = event.label || 'macrotask';
      state.macroQueue.push({ label, taskId: event.taskId });
      state.log.push(ts + chalk.bgYellow.black('  +T   ') + ' ' + chalk.yellow('\u2192') + ' ' + label + fileTag);
      break;
    }

    case 'ENQUEUE_MICRO': {
      const label = event.label || 'microtask';
      state.microQueue.push({ label, taskId: event.taskId });
      state.log.push(ts + chalk.bgCyan.black('  +M   ') + ' ' + chalk.cyan('\u2192') + ' ' + label + fileTag);
      break;
    }

    case 'CALLBACK_START': {
      const label = event.label || 'callback';
      if (event.kind === 'micro') {
        state.microQueue = state.microQueue.filter(item => item.taskId !== event.taskId);
        state.phase = 'Microtasks';
        state.log.push(ts + chalk.bgCyan.black('  \u25B6M   ') + ' ' + chalk.cyanBright.bold(label) + fileTag);
      } else {
        state.macroQueue = state.macroQueue.filter(item => item.taskId !== event.taskId);
        state.phase = 'Macrotasks';
        state.log.push(ts + chalk.bgYellow.black('  \u25B6T   ') + ' ' + chalk.yellowBright.bold(label) + fileTag);
      }
      state.callStack.push(label);
      break;
    }

    case 'CALLBACK_END':
      if (state.callStack.length > 0) state.callStack.pop();
      break;

    case 'ERROR': {
      const msg = event.value || 'Unknown error';
      state.log.push(ts + chalk.bgRed.white.bold(' ERROR ') + ' ' + chalk.red(msg));
      break;
    }

    case 'MEMORY':
      if (event.label) {
        const val = event.value || 'undefined';
        state.memory.set(event.label, val);
        const truncatedValue = val.length > MAX_MEMORY_DISPLAY_LEN
          ? val.substring(0, MAX_MEMORY_DISPLAY_LEN - 3) + '...'
          : val;
        state.log.push(ts + chalk.bgMagenta.white('  VAR  ') + ' ' + chalk.magentaBright(event.label) + ' = ' + chalk.white(truncatedValue) + fileTag);
      }
      break;

    case 'TEST_START': {
      const testName = event.label || 'test';
      state.currentTest = testName;
      state.callStack = [];
      state.memory = new Map();
      state.phase = 'Synchronous';
      state.log.push('');
      state.log.push(ts + chalk.bgGreen.black.bold(' TEST  ') + ' ' + chalk.greenBright.bold(testName));
      break;
    }

    case 'TEST_END': {
      const testName = event.label || 'test';
      const passed = event.value === 'pass';
      if (passed) {
        state.log.push(ts + chalk.bgGreen.black.bold(' PASS  ') + ' ' + chalk.green(testName));
      } else {
        state.log.push(ts + chalk.bgRed.white.bold(' FAIL  ') + ' ' + chalk.red(testName));
      }
      state.currentTest = null;
      break;
    }

    case 'SYNC_STEP': {
      const label = event.label || '';
      state.log.push('        ' + chalk.gray('\u2502 ') + chalk.dim(label));
      break;
    }

    case 'EVENT_CAP_REACHED': {
      const cap = event.value || '5000';
      state.log.push(ts + chalk.bgRed.white.bold(' WARN  ') + ' ' + chalk.red('Event cap reached (' + cap + '). Set ELV_MAX_EVENTS for higher.'));
      break;
    }

    case 'DONE':
      state.phase = 'Complete';
      state.callStack = [];
      state.log.push(ts + chalk.bgWhite.black.bold(' DONE  ') + ' ' + chalk.green('\u2713 Execution complete'));
      break;
  }
}

function cloneState(s) {
  return {
    callStack: s.callStack.slice(),
    microQueue: s.microQueue.map(item => ({ ...item })),
    macroQueue: s.macroQueue.map(item => ({ ...item })),
    console: s.console.slice(),
    log: s.log.slice(),
    phase: s.phase,
    memory: new Map(s.memory),
    startTs: s.startTs,
    prevTs: s.prevTs,
    currentTest: s.currentTest,
  };
}

// ---------------------------------------------------------------------------
// React components (using createElement instead of JSX to avoid a build step)
// ---------------------------------------------------------------------------

function Panel({ label, color, focused, content, height, width, phaseColor, badge, isActive }) {
  const borderColor = focused ? 'white' : color;
  const borderStyle = focused ? 'double' : 'single';
  const activeIndicator = isActive ? chalk.bold[phaseColor || 'green'](' *') : '';
  const badgeText = badge ? chalk[badge.color || 'gray'](' [' + badge.text + ']') : '';
  const contentLines = content ? content.split('\n') : [];
  
  return h(Box, {
    borderStyle,
    borderColor,
    height,
    width,
    flexDirection: 'column',
    overflow: 'hidden',
  },
    h(Text, { bold: focused, color: borderColor, wrap: 'truncate' },
      (focused ? '\u25B8 ' : '') + label + badgeText + activeIndicator
    ),
    ...contentLines.map((line, i) =>
      h(Text, { key: String(i), wrap: 'truncate' }, line || ' ')
    )
  );
}

/**
 * Progress bar component showing current position in the event stream
 */
function ProgressBar({ current, total, width, phaseColor }) {
  const barWidth = Math.max(10, width - 12);
  const progress = total > 0 ? Math.min(1, Math.max(0, (current + 1) / total)) : 0;
  const filled = Math.round(progress * barWidth);
  const empty = barWidth - filled;
  
  const filledBar = chalk[phaseColor || 'cyan']('\u2588'.repeat(filled));
  const emptyBar = chalk.gray('\u2591'.repeat(empty));
  const percentage = Math.round(progress * 100);
  
  return chalk.gray('[') + filledBar + emptyBar + chalk.gray(']') + ' ' + 
         chalk.bold(String(percentage).padStart(3, ' ') + '%');
}

/**
 * Help overlay component showing all keybindings and concepts
 */
function HelpOverlay({ width, height }) {
  const helpContent = [
    '',
    chalk.bold.cyan('  EVENT LOOP VISUALIZER - HELP'),
    chalk.gray('  ' + '\u2500'.repeat(40)),
    '',
    chalk.bold.white('  NAVIGATION'),
    '    ' + chalk.yellow('\u2190 / h') + '    Previous step',
    '    ' + chalk.yellow('\u2192 / l') + '    Next step',
    '    ' + chalk.yellow('\u2191 / k') + '    Scroll up (focused panel)',
    '    ' + chalk.yellow('\u2193 / j') + '    Scroll down (focused panel)',
    '    ' + chalk.yellow('Tab') + '       Cycle panel focus',
    '    ' + chalk.yellow('Shift+Tab') + ' Reverse cycle focus',
    '',
    chalk.bold.white('  PLAYBACK'),
    '    ' + chalk.yellow('Space') + '     Play/Pause automatic stepping',
    '    ' + chalk.yellow('+') + '         Increase speed (faster)',
    '    ' + chalk.yellow('-') + '         Decrease speed (slower)',
    '    ' + chalk.yellow('r') + '         Reset to beginning',
    '',
    chalk.bold.white('  TESTS'),
    '    ' + chalk.yellow('n') + '         Jump to next test',
    '    ' + chalk.yellow('N') + '         Jump to previous test',
    '',
    chalk.bold.white('  OTHER'),
    '    ' + chalk.yellow('?') + '         Toggle this help',
    '    ' + chalk.yellow('q / Esc') + '   Quit',
    '',
    chalk.gray('  ' + '\u2500'.repeat(40)),
    '',
    chalk.bold.white('  EVENT LOOP PHASES'),
    '    ' + chalk.green('\u25CF Synchronous') + '   Main script execution',
    '    ' + chalk.cyan('\u25CF Microtasks') + '    Promise callbacks, queueMicrotask',
    '    ' + chalk.yellow('\u25CF Macrotasks') + '   setTimeout, setInterval callbacks',
    '',
    chalk.bold.white('  QUEUE INDICATORS'),
    '    ' + chalk.cyan('\u25CF') + ' Promise/then/await',
    '    ' + chalk.yellow('\u25D4') + ' setTimeout',
    '    ' + chalk.yellow('\u25D1') + ' setInterval',
    '    ' + chalk.cyan('\u25CB') + ' queueMicrotask',
    '    ' + chalk.magenta('\u25C8') + ' process.nextTick',
    '',
    chalk.gray.italic('  Press ? or Esc to close'),
  ];

  const boxWidth = Math.min(60, width - 4);
  const boxHeight = Math.min(helpContent.length + 2, height - 4);
  const paddingTop = Math.floor((height - boxHeight) / 2);
  const paddingLeft = Math.floor((width - boxWidth) / 2);

  const blankLines = new Array(height).fill(' '.repeat(width)).join('\n');

  return h(Box, {
    position: 'absolute',
    width: width,
    height: height,
    flexDirection: 'column',
  },
    h(Text, null, blankLines),
    h(Box, {
      position: 'absolute',
      marginLeft: paddingLeft,
      marginTop: paddingTop,
      width: boxWidth,
      height: boxHeight,
      borderStyle: 'double',
      borderColor: 'cyan',
      flexDirection: 'column',
    },
      h(Text, { wrap: 'truncate' }, helpContent.slice(0, boxHeight - 2).join('\n'))
    )
  );
}

function App({ events, sourceCode, sourcePath, focusFile }) {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [termSize, setTermSize] = useState({
    rows: stdout.rows || 24,
    cols: stdout.columns || 80,
  });

  useEffect(() => {
    const onResize = () =>
      setTermSize({ rows: stdout.rows || 24, cols: stdout.columns || 80 });
    stdout.on('resize', onResize);
    return () => stdout.off('resize', onResize);
  }, [stdout]);

  const { rows, cols } = termSize;
  const totalSteps = events.length;

  // Mutable state in refs (applyEvent mutates in place)
  const stateRef = useRef(createInitialState());
  const snapshotsRef = useRef(new Map());
  const sourceCacheRef = useRef(new Map());
  const displayFileRef = useRef(sourcePath);
  const currentStepRef = useRef(-1);
  const scrollOffsetsRef = useRef(new Array(PANEL_COUNT).fill(0));

  // React state that triggers re-renders
  const [renderTick, setRenderTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_PLAY_SPEED_MS);
  const [focusIndex, setFocusIndex] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  
  // Track previous lengths for scroll-on-grow only
  const prevLogLenRef = useRef(0);
  const prevConsoleLenRef = useRef(0);
  const prevMemoryRef = useRef(new Map());

  // Prevent unused-variable warnings while keeping renderTick in scope
  void renderTick;

  if (sourcePath && sourceCode && !sourceCacheRef.current.has(sourcePath)) {
    sourceCacheRef.current.set(sourcePath, sourceCode.split('\n'));
  }

  function getSourceLines(filePath) {
    if (!filePath) return null;
    const cache = sourceCacheRef.current;
    if (cache.has(filePath)) return cache.get(filePath);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      cache.set(filePath, lines);
      return lines;
    } catch (_) {
      return null;
    }
  }

  // Test boundaries (computed once)
  const testBoundariesRef = useRef(null);
  if (testBoundariesRef.current === null) {
    const boundaries = [];
    for (let i = 0; i < totalSteps; i++) {
      if (events[i].type === 'TEST_START') boundaries.push(i);
    }
    testBoundariesRef.current = boundaries;
  }
  const hasTests = testBoundariesRef.current.length > 0;

  // --- Navigation ---

  function goToStep(n) {
    let startFrom = -1;
    stateRef.current = createInitialState();
    displayFileRef.current = sourcePath;
    prevMemoryRef.current = new Map();

    for (const [snapStep] of snapshotsRef.current) {
      if (snapStep <= n && snapStep > startFrom) startFrom = snapStep;
    }

    if (startFrom >= 0) {
      stateRef.current = cloneState(snapshotsRef.current.get(startFrom));
      currentStepRef.current = startFrom;
    } else {
      currentStepRef.current = -1;
    }

    for (let i = currentStepRef.current + 1; i <= n && i < totalSteps; i++) {
      applyEvent(stateRef.current, events[i]);
      currentStepRef.current = i;
      if ((i + 1) % SNAPSHOT_INTERVAL === 0 && !snapshotsRef.current.has(i)) {
        snapshotsRef.current.set(i, cloneState(stateRef.current));
      }
    }
    setRenderTick(t => t + 1);
  }

  function nextStep() {
    if (currentStepRef.current >= totalSteps - 1) {
      setPlaying(false);
      return;
    }
    currentStepRef.current++;
    applyEvent(stateRef.current, events[currentStepRef.current]);
    if ((currentStepRef.current + 1) % SNAPSHOT_INTERVAL === 0
      && !snapshotsRef.current.has(currentStepRef.current)) {
      snapshotsRef.current.set(currentStepRef.current, cloneState(stateRef.current));
    }
    setRenderTick(t => t + 1);
  }

  function prevStep() {
    if (currentStepRef.current <= -1) return;
    goToStep(Math.max(-1, currentStepRef.current - 1));
  }

  function reset() {
    setPlaying(false);
    stateRef.current = createInitialState();
    currentStepRef.current = -1;
    displayFileRef.current = sourcePath;
    scrollOffsetsRef.current = new Array(PANEL_COUNT).fill(0);
    prevLogLenRef.current = 0;
    prevConsoleLenRef.current = 0;
    prevMemoryRef.current = new Map();
    setRenderTick(t => t + 1);
  }

  function nextTest() {
    if (!hasTests) return;
    for (const idx of testBoundariesRef.current) {
      if (idx > currentStepRef.current) {
        setPlaying(false);
        goToStep(idx);
        return;
      }
    }
  }

  function prevTest() {
    if (!hasTests) return;
    const boundaries = testBoundariesRef.current;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (boundaries[i] < currentStepRef.current) {
        setPlaying(false);
        goToStep(boundaries[i]);
        return;
      }
    }
  }

  // --- Play timer (nextStep uses only refs + stable setters, safe in stale closure) ---

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(nextStep, speed);
    return () => clearInterval(timer);
  }, [playing, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Key input ---

  useInput((input, key) => {
    // Help overlay takes priority
    if (showHelp) {
      if (input === '?' || key.escape || input === 'q') {
        setShowHelp(false);
      }
      return;
    }
    
    if (input === '?') {
      setShowHelp(true);
      return;
    }
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (key.rightArrow || input === 'l') {
      setPlaying(false);
      nextStep();
      return;
    }
    if (key.leftArrow || input === 'h') {
      setPlaying(false);
      prevStep();
      return;
    }
    if (key.upArrow || input === 'k') {
      scrollOffsetsRef.current[focusIndex] =
        Math.max(0, scrollOffsetsRef.current[focusIndex] - 1);
      setRenderTick(t => t + 1);
      return;
    }
    if (key.downArrow || input === 'j') {
      scrollOffsetsRef.current[focusIndex]++;
      setRenderTick(t => t + 1);
      return;
    }
    if (key.tab) {
      setFocusIndex(prev =>
        key.shift
          ? (prev - 1 + PANEL_COUNT) % PANEL_COUNT
          : (prev + 1) % PANEL_COUNT
      );
      return;
    }
    if (input === ' ') {
      setPlaying(p => !p);
      return;
    }
    if (input === '=' || input === '+') {
      setPlaying(false);
      setSpeed(s => Math.max(MIN_PLAY_SPEED_MS, s - SPEED_STEP_MS));
      return;
    }
    if (input === '-' || input === '_') {
      setPlaying(false);
      setSpeed(s => Math.min(MAX_PLAY_SPEED_MS, s + SPEED_STEP_MS));
      return;
    }
    if (input === 'r') { reset(); return; }
    if (input === 'n') { nextTest(); return; }
    if (input === 'N') { prevTest(); return; }
  });

  // --- Layout ---

  const headerHeight = 3;
  const footerHeight = 3;
  const mainHeight = rows - headerHeight - footerHeight;

  const callStackHeight = Math.max(4, Math.round(rows * 0.18) - 3);
  const queuesHeight = Math.max(4, Math.round(rows * 0.20));
  const sourceHeight = Math.max(5, callStackHeight + queuesHeight);

  const consoleHeight = Math.max(5, Math.round(rows * 0.15));
  const memoryHeight = Math.max(5, mainHeight - sourceHeight - consoleHeight);
  const eventLogHeight = Math.max(5, mainHeight - callStackHeight - queuesHeight);

  // Inner content rows: panel height − 2 (border) − 1 (label line)
  const sourceContentH = Math.max(0, sourceHeight - 3);
  const consoleContentH = Math.max(0, consoleHeight - 3);
  const memoryContentH = Math.max(0, memoryHeight - 3);
  const callStackContentH = Math.max(0, callStackHeight - 3);
  const microContentH = Math.max(0, queuesHeight - 3);
  const macroContentH = Math.max(0, queuesHeight - 3);
  const eventLogContentH = Math.max(0, eventLogHeight - 3);

  // Content widths for pre-truncation (ANSI codes inflate Yoga layout measurement)
  const leftColWidth = Math.floor(cols / 2);
  const rightColWidth = cols - leftColWidth;
  const leftContentW = Math.max(0, leftColWidth - 2);
  const rightContentW = Math.max(0, rightColWidth - 2);
  const queueContentW = Math.max(0, Math.floor(rightColWidth / 2) - 2);

  // --- Build panel content ---

  const state = stateRef.current;
  const phaseTheme = PHASE_COLORS[state.phase] || PHASE_COLORS['Ready'];
  const currentStep = currentStepRef.current;
  const evt = currentStep >= 0 ? events[currentStep] : null;
  const eventFile = evt && evt.file;
  const isExternal = evt && evt.external;
  const eventFocusLine = evt && evt.focusLine;

  // Multi-file navigation
  if (focusFile && isExternal) {
    displayFileRef.current = focusFile;
  } else if (eventFile && !pathsMatch(eventFile, displayFileRef.current || '')) {
    if (getSourceLines(eventFile)) displayFileRef.current = eventFile;
  }

  const displayLines = getSourceLines(displayFileRef.current) || getSourceLines(sourcePath);
  const displayFileName = displayFileRef.current
    ? displayFileRef.current.split(/[\/\\]/).pop()
    : null;
  const isExternalFile = focusFile && displayFileRef.current && displayFileRef.current !== focusFile;
  const externalFileName = (isExternal && eventFile)
    ? eventFile.split(/[\/\\]/).pop()
    : null;

  let sourceLabel;
  if (isExternal && displayFileRef.current === focusFile) {
    sourceLabel = 'Source: ' + (displayFileName || '?') + ' \u2192 ' + (externalFileName || '?');
  } else if (isExternalFile) {
    sourceLabel = 'Source: \u21AA ' + displayFileName;
  } else {
    sourceLabel = 'Source: ' + (displayFileName || 'untitled');
  }
  const sourceColor = isExternalFile ? 'gray' : phaseTheme.primary;

  // Source lines with highlighting
  let sourceLines = [];
  let highlightLine = null;
  if (displayLines) {
    let highlightExternal = false;
    if (isExternal && displayFileRef.current === focusFile) {
      highlightLine = eventFocusLine || null;
      highlightExternal = true;
    } else if (
      evt && evt.line && displayFileRef.current &&
      (!evt.file || evt.file === displayFileRef.current || pathsMatch(evt.file, displayFileRef.current))
    ) {
      highlightLine = evt.line;
    }

    const padWidth = String(displayLines.length).length;
    sourceLines = displayLines.map((line, i) => {
      const lineNum = i + 1;
      const num = String(lineNum).padStart(Math.max(3, padWidth), ' ');
      const highlightedLine = highlightSyntax(line || '');
      
      if (highlightLine === lineNum) {
        return highlightExternal
          ? chalk.bgYellow.black(' ' + num + '  ' + (line || '') + ' ')
          : chalk.bgWhite.black.bold(' ' + num + '  ' + (line || '') + ' ');
      }
      return chalk.gray(num) + '  ' + highlightedLine;
    });
  } else {
    sourceLines = [chalk.gray('[Command mode \u2014 source not available]')];
  }

  // Auto-scroll source to highlighted line
  if (highlightLine) {
    scrollOffsetsRef.current[0] = Math.max(0, highlightLine - 1 - SCROLL_OFFSET_LINES);
  }

  // Auto-scroll console and event log only when new entries are added
  if (state.console.length > prevConsoleLenRef.current && state.console.length > consoleContentH) {
    scrollOffsetsRef.current[2] = state.console.length - consoleContentH;
  }
  prevConsoleLenRef.current = state.console.length;

  if (state.log.length > prevLogLenRef.current && state.log.length > eventLogContentH) {
    scrollOffsetsRef.current[3] = state.log.length - eventLogContentH;
  }
  prevLogLenRef.current = state.log.length;

  function sliceContent(lines, panelIdx, contentH, contentW) {
    if (contentH <= 0) return '';
    const maxOffset = Math.max(0, lines.length - contentH);
    const offset = Math.min(scrollOffsetsRef.current[panelIdx], maxOffset);
    scrollOffsetsRef.current[panelIdx] = Math.max(0, offset);
    const sliced = lines.slice(offset, offset + contentH);
    return (contentW > 0
      ? sliced.map(l => truncateAnsi(l, contentW))
      : sliced
    ).join('\n');
  }

  const sourceContent = sliceContent(sourceLines, 0, sourceContentH, leftContentW);
  const consoleContent = sliceContent(state.console, 2, consoleContentH, leftContentW);

  // Detect recently changed variables
  const changedVars = new Set();
  for (const [name, val] of state.memory) {
    if (!prevMemoryRef.current.has(name) || prevMemoryRef.current.get(name) !== val) {
      changedVars.add(name);
    }
  }
  // Update previous memory state
  prevMemoryRef.current = new Map(state.memory);

  const memoryLines = state.memory.size === 0
    ? [chalk.gray('(no variables tracked)')]
    : Array.from(state.memory, ([name, val]) => {
        const isChanged = changedVars.has(name);
        const typeIcon = getTypeIcon(val);
        const nameText = isChanged 
          ? chalk.bgYellow.black.bold(' ' + name + ' ')
          : chalk.bold.white(name);
        const valText = isChanged ? chalk.yellowBright(val) : val;
        return ' ' + typeIcon + ' ' + nameText + ' = ' + valText;
      });
  const memoryContent = sliceContent(memoryLines, 1, memoryContentH, leftContentW);
  
  // Helper to get type icon for values
  function getTypeIcon(val) {
    if (val === 'undefined' || val === 'null') return chalk.gray('\u2205');
    if (val === 'true' || val === 'false') return chalk.blue('\u25C6');
    if (!isNaN(Number(val))) return chalk.magenta('#');
    if (val.startsWith('"') || val.startsWith("'") || val.startsWith('`')) return chalk.yellow('\u201C');
    if (val.startsWith('[')) return chalk.cyan('\u2395');
    if (val.startsWith('{')) return chalk.green('\u2687');
    if (val.startsWith('function') || val.includes('=>')) return chalk.red('\u0192');
    return chalk.gray('\u2022');
  }

  const eventLogContent = sliceContent(state.log, 3, eventLogContentH, rightContentW);

  // Enhanced call stack with visual depth indicators
  const callStackLines = state.callStack.length === 0
    ? [chalk.gray('(empty)')]
    : state.callStack.map((s, i) => {
        const isTop = i === state.callStack.length - 1;
        const indent = '\u2502 '.repeat(i);
        const prefix = isTop ? chalk.green('\u25B6') : chalk.gray('\u2502');
        const text = isTop ? chalk.bold.white(s) : chalk.gray(s);
        return ' ' + indent + prefix + ' ' + text;
      });
  const callStackContent = sliceContent(callStackLines, 4, callStackContentH, rightContentW);

  // Enhanced queue display with source badges
  const getTaskBadge = (label) => {
    if (label.includes('Promise') || label.includes('then') || label.includes('await')) return chalk.cyan('\u25CF');
    if (label.includes('setTimeout')) return chalk.yellow('\u25D4');
    if (label.includes('setInterval')) return chalk.yellow('\u25D1');
    if (label.includes('queueMicrotask')) return chalk.cyan('\u25CB');
    if (label.includes('nextTick')) return chalk.magenta('\u25C8');
    return chalk.gray('\u25AA');
  };

  const microLines = state.microQueue.length === 0
    ? [chalk.gray('(empty)')]
    : state.microQueue.map((item, i) => {
        const badge = getTaskBadge(item.label);
        const isFirst = i === 0;
        const text = isFirst ? chalk.bold.cyanBright(item.label) : item.label;
        return ' ' + badge + ' ' + (i + 1) + '. ' + text;
      });
  const microContent = sliceContent(microLines, 5, microContentH, queueContentW);

  const macroLines = state.macroQueue.length === 0
    ? [chalk.gray('(empty)')]
    : state.macroQueue.map((item, i) => {
        const badge = getTaskBadge(item.label);
        const isFirst = i === 0;
        const text = isFirst ? chalk.bold.yellowBright(item.label) : item.label;
        return ' ' + badge + ' ' + (i + 1) + '. ' + text;
      });
  const macroContent = sliceContent(macroLines, 6, macroContentH, queueContentW);

  const phaseColorFn = chalk[phaseTheme.primary] || chalk.white;
  const phaseAccentFn = chalk[phaseTheme.accent] || chalk.white;

  // Header / footer text with enhanced visuals
  const stepLabel = currentStep < 0 ? '0' : String(currentStep + 1);
  const playIcon = playing 
    ? chalk.green('\u25B6') + ' Playing' 
    : chalk.yellow('\u23F8') + ' Paused';
  const testInfo = state.currentTest ? '  Test: ' + chalk.bold(state.currentTest) : '';
  
  // Phase indicator with color
  const phaseIndicator = phaseAccentFn('\u25CF') + ' ' + phaseColorFn.bold(state.phase);
  
  // Speed indicator with visual bars
  const speedNormalized = (speed - MIN_PLAY_SPEED_MS) / (MAX_PLAY_SPEED_MS - MIN_PLAY_SPEED_MS);
  const speedBars = 5;
  const filledBars = Math.round((1 - speedNormalized) * speedBars);
  const speedVisual = chalk.cyan('\u25AE'.repeat(filledBars)) + chalk.gray('\u25AF'.repeat(speedBars - filledBars));
  
  const headerText =
    ' ' + chalk.bold.white('Event Loop Visualizer') + '  ' +
    chalk.gray('Step ') + chalk.bold(stepLabel + '/' + totalSteps) + '  ' +
    phaseIndicator + '  ' +
    playIcon + '  ' + speedVisual + ' ' + speed + 'ms' + testInfo;

  // Progress bar for timeline
  const progressBarWidth = Math.floor(cols / 3);
  const progressBar = ProgressBar({ current: currentStep, total: totalSteps, width: progressBarWidth, phaseColor: phaseTheme.primary });

  const testHint = hasTests ? '  ' + chalk.bold('n/N') + ' Test' : '';
  const footerText =
    ' ' + progressBar + '  ' +
    chalk.bold('\u2190/\u2192') + ' Step  ' +
    chalk.bold('\u2191/\u2193') + ' Scroll  ' +
    chalk.bold('Tab') + ' Focus  ' +
    chalk.bold('Space') + ' Play  ' +
    chalk.bold('+/-') + ' Speed  ' +
    chalk.bold('r') + ' Reset  ' +
    chalk.bold('?') + ' Help' + testHint + '  ' + chalk.bold('q') + ' Quit';

  // --- Render tree ---

  // Determine active panels based on phase
  const isMicroActive = state.phase === 'Microtasks';
  const isMacroActive = state.phase === 'Macrotasks';
  const isStackActive = state.callStack.length > 0;

  return h(Box, { flexDirection: 'column', width: cols, height: rows },
    h(Box, { borderStyle: 'single', borderColor: phaseTheme.primary, height: headerHeight },
      h(Text, { bold: true, wrap: 'truncate' }, headerText)
    ),

    h(Box, { flexDirection: 'row', height: mainHeight },
      h(Box, { flexDirection: 'column', width: '50%' },
        h(Panel, { label: sourceLabel, color: sourceColor, focused: focusIndex === 0,
          content: sourceContent, height: sourceHeight, phaseColor: phaseTheme.primary }),
        h(Panel, { label: 'Memory', color: 'magenta', focused: focusIndex === 1,
          content: memoryContent, height: memoryHeight, 
          badge: state.memory.size > 0 ? { text: String(state.memory.size), color: 'magenta' } : null }),
        h(Panel, { label: 'Console Output', color: 'yellow', focused: focusIndex === 2,
          content: consoleContent, height: consoleHeight }),
      ),

      h(Box, { flexDirection: 'column', width: '50%' },
        h(Panel, { label: 'Call Stack', color: 'red', focused: focusIndex === 4,
          content: callStackContent, height: callStackHeight, isActive: isStackActive,
          badge: state.callStack.length > 0 ? { text: String(state.callStack.length), color: 'red' } : null }),
        h(Box, { flexDirection: 'row', height: queuesHeight },
          h(Panel, { label: 'Microtask Queue', color: 'cyan', focused: focusIndex === 5,
            content: microContent, width: '50%', height: queuesHeight, isActive: isMicroActive,
            badge: state.microQueue.length > 0 ? { text: String(state.microQueue.length), color: 'cyan' } : null }),
          h(Panel, { label: 'Macrotask Queue', color: 'yellow', focused: focusIndex === 6,
            content: macroContent, width: '50%', height: queuesHeight, isActive: isMacroActive,
            badge: state.macroQueue.length > 0 ? { text: String(state.macroQueue.length), color: 'yellow' } : null }),
        ),
        h(Panel, { label: 'Event Log', color: 'blue', focused: focusIndex === 3,
          content: eventLogContent, height: eventLogHeight,
          badge: state.log.length > 0 ? { text: String(state.log.length), color: 'blue' } : null }),
      ),
    ),

    h(Box, { borderStyle: 'single', borderColor: 'gray', height: footerHeight },
      h(Text, { wrap: 'truncate' }, footerText)
    ),

    // Help overlay (rendered on top when active)
    showHelp && h(HelpOverlay, { width: cols, height: rows }),
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Launches the ink TUI for step-through event replay.
 * @param {import('./types').ElvEvent[]} events
 * @param {string | null} sourceCode
 * @param {string | null} [sourcePath]
 * @param {string | null} [focusFile]
 * @returns {void}
 */
function startTUI(events, sourceCode, sourcePath, focusFile) {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  if (cols < 80 || rows < 24) {
    process.stderr.write(
      'Terminal too small (' + cols + 'x' + rows + ', need at least 80x24).\n' +
      'Resize your terminal window and try again.\n'
    );
    process.exit(1);
  }

  // Alternate screen buffer + hide cursor for a clean full-screen experience
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

export { startTUI, applyEvent, createInitialState, pathsMatch, App };
