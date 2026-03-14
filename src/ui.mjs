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
  const ts = chalk.gray('+' + delta + 'ms') + ' ';
  if (event.ts) state.prevTs = event.ts;

  switch (event.type) {
    case 'SYNC_START':
      if (event.ts) { state.startTs = event.ts; state.prevTs = event.ts; }
      state.callStack.push('<script>' + (event.label ? ' ' + event.label : ''));
      state.phase = 'Synchronous';
      state.log.push(ts + chalk.bold('\u25B6 Script execution started'));
      break;

    case 'SYNC_END':
      state.callStack = [];
      state.phase = 'Sync Complete';
      state.log.push(ts + chalk.bold('--- Synchronous execution complete ---'));
      break;

    case 'LOG': {
      const val = event.value || '';
      state.console.push('> ' + val);
      state.log.push(ts + '# ' + val + fileTag);
      break;
    }

    case 'ENQUEUE_MACRO': {
      const label = event.label || 'macrotask';
      state.macroQueue.push({ label, taskId: event.taskId });
      state.log.push(ts + chalk.yellow('[T]') + ' \u2192 Macrotask Queue: ' + label + fileTag);
      break;
    }

    case 'ENQUEUE_MICRO': {
      const label = event.label || 'microtask';
      state.microQueue.push({ label, taskId: event.taskId });
      state.log.push(ts + chalk.cyan('[M]') + ' \u2192 Microtask Queue: ' + label + fileTag);
      break;
    }

    case 'CALLBACK_START': {
      const label = event.label || 'callback';
      if (event.kind === 'micro') {
        state.microQueue = state.microQueue.filter(item => item.taskId !== event.taskId);
        state.phase = 'Microtasks';
      } else {
        state.macroQueue = state.macroQueue.filter(item => item.taskId !== event.taskId);
        state.phase = 'Macrotasks';
      }
      state.callStack.push(label);
      state.log.push(ts + chalk.bold('\u25B6 ' + label) + fileTag);
      break;
    }

    case 'CALLBACK_END':
      if (state.callStack.length > 0) state.callStack.pop();
      break;

    case 'ERROR': {
      const msg = event.value || 'Unknown error';
      state.log.push(ts + chalk.red('ERROR: ' + msg));
      break;
    }

    case 'MEMORY':
      if (event.label) {
        const val = event.value || 'undefined';
        state.memory.set(event.label, val);
        const truncatedValue = val.length > MAX_MEMORY_DISPLAY_LEN
          ? val.substring(0, MAX_MEMORY_DISPLAY_LEN - 3) + '...'
          : val;
        state.log.push(ts + chalk.magenta(event.label) + ' = ' + truncatedValue + fileTag);
      }
      break;

    case 'TEST_START': {
      const testName = event.label || 'test';
      state.currentTest = testName;
      state.callStack = [];
      state.memory = new Map();
      state.phase = 'Synchronous';
      const bar = '\u2500'.repeat(3);
      state.log.push('');
      state.log.push(ts + chalk.bold.green(bar + ' \u25C9 ' + testName + ' ' + bar));
      break;
    }

    case 'TEST_END': {
      const testName = event.label || 'test';
      const passed = event.value === 'pass';
      const icon = passed ? '\u2713' : '\u2717';
      const colorFn = passed ? chalk.bold.green : chalk.bold.red;
      state.log.push(ts + colorFn('  ' + icon + ' ' + testName + ' ' + (passed ? 'passed' : 'failed')));
      state.currentTest = null;
      break;
    }

    case 'SYNC_STEP': {
      const label = event.label || '';
      state.log.push('  ' + chalk.gray('\u00b7 ' + label));
      break;
    }

    case 'EVENT_CAP_REACHED': {
      const cap = event.value || '5000';
      state.log.push(ts + chalk.red.bold('\u26A0 Event cap reached (' + cap + '). Later events dropped. Set ELV_MAX_EVENTS for a higher limit.'));
      break;
    }

    case 'DONE':
      state.phase = 'Complete';
      state.callStack = [];
      state.log.push(ts + chalk.bold('\u2713 Execution complete'));
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

function Panel({ label, color, focused, content, height, width }) {
  const borderColor = focused ? 'white' : color;
  return h(Box, {
    borderStyle: 'single',
    borderColor,
    height,
    width,
    flexDirection: 'column',
    overflow: 'hidden',
  },
    h(Text, { bold: focused, color: borderColor, wrap: 'truncate' },
      (focused ? '\u25B8 ' : '') + label
    ),
    h(Text, { wrap: 'truncate' }, content)
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

  const consoleHeight = Math.max(5, Math.round(rows * 0.15));
  const memoryHeight = Math.max(5, Math.round(rows * 0.30));
  const sourceHeight = Math.max(5, mainHeight - consoleHeight - memoryHeight);

  const callStackHeight = Math.max(4, Math.round(rows * 0.18) - 3);
  const queuesHeight = Math.max(4, Math.round(rows * 0.20));
  const eventLogHeight = Math.max(5, mainHeight - callStackHeight - queuesHeight);

  // Inner content rows: panel height − 2 (border) − 1 (label line)
  const sourceContentH = Math.max(0, sourceHeight - 3);
  const consoleContentH = Math.max(0, consoleHeight - 3);
  const memoryContentH = Math.max(0, memoryHeight - 3);
  const callStackContentH = Math.max(0, callStackHeight - 3);
  const microContentH = Math.max(0, queuesHeight - 3);
  const macroContentH = Math.max(0, queuesHeight - 3);
  const eventLogContentH = Math.max(0, eventLogHeight - 3);

  // --- Build panel content ---

  const state = stateRef.current;
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

  let sourceLabel, sourceColor;
  if (isExternal && displayFileRef.current === focusFile) {
    sourceLabel = (displayFileName || 'Source') + ' \u2192 ' + (externalFileName || '?');
    sourceColor = 'yellow';
  } else if (isExternalFile) {
    sourceLabel = '\u21AA ' + displayFileName;
    sourceColor = 'gray';
  } else {
    sourceLabel = displayFileName || 'Source Code';
    sourceColor = 'green';
  }

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
      if (highlightLine === lineNum) {
        return highlightExternal
          ? chalk.bgYellow.black(' ' + num + '  ' + (line || '') + ' ')
          : chalk.bgWhite.black.bold(' ' + num + '  ' + (line || '') + ' ');
      }
      return chalk.gray(num) + '  ' + (line || '');
    });
  } else {
    sourceLines = [chalk.gray('[Command mode \u2014 source not available]')];
  }

  // Auto-scroll source to highlighted line
  if (highlightLine) {
    scrollOffsetsRef.current[0] = Math.max(0, highlightLine - 1 - SCROLL_OFFSET_LINES);
  }

  // Auto-scroll console and event log to bottom
  if (state.console.length > consoleContentH) {
    scrollOffsetsRef.current[1] = state.console.length - consoleContentH;
  }
  if (state.log.length > eventLogContentH) {
    scrollOffsetsRef.current[3] = state.log.length - eventLogContentH;
  }

  function sliceContent(lines, panelIdx, contentH) {
    if (contentH <= 0) return '';
    const maxOffset = Math.max(0, lines.length - contentH);
    const offset = Math.min(scrollOffsetsRef.current[panelIdx], maxOffset);
    scrollOffsetsRef.current[panelIdx] = Math.max(0, offset);
    return lines.slice(offset, offset + contentH).join('\n');
  }

  const sourceContent = sliceContent(sourceLines, 0, sourceContentH);
  const consoleContent = sliceContent(state.console, 1, consoleContentH);

  const memoryLines = state.memory.size === 0
    ? [chalk.gray('(no variables tracked)')]
    : Array.from(state.memory, ([name, val]) =>
        ' ' + chalk.bold(name) + ' = ' + val);
  const memoryContent = sliceContent(memoryLines, 2, memoryContentH);

  const eventLogContent = sliceContent(state.log, 3, eventLogContentH);

  const callStackLines = state.callStack.length === 0
    ? [chalk.gray('(empty)')]
    : state.callStack.map((s, i) =>
        i === state.callStack.length - 1 ? chalk.bold('\u25B6 ' + s) : '  ' + s);
  const callStackContent = sliceContent(callStackLines, 4, callStackContentH);

  const microLines = state.microQueue.length === 0
    ? [chalk.gray('(empty)')]
    : state.microQueue.map((item, i) => (i + 1) + '. ' + item.label);
  const microContent = sliceContent(microLines, 5, microContentH);

  const macroLines = state.macroQueue.length === 0
    ? [chalk.gray('(empty)')]
    : state.macroQueue.map((item, i) => (i + 1) + '. ' + item.label);
  const macroContent = sliceContent(macroLines, 6, macroContentH);

  // Header / footer text
  const stepLabel = currentStep < 0 ? '0' : String(currentStep + 1);
  const playIcon = playing ? '\u25B6 Playing' : '\u23F8 Paused';
  const testInfo = state.currentTest ? '  Test: ' + chalk.bold(state.currentTest) : '';
  const headerText =
    ' ' + chalk.bold('Event Loop Visualizer') + '  ' +
    'Step ' + stepLabel + '/' + totalSteps + '  ' +
    'Phase: ' + chalk.bold(state.phase) + '  ' +
    playIcon + '  Speed: ' + speed + 'ms' + testInfo;

  const testHint = hasTests ? '  ' + chalk.bold('n/N') + ' Test' : '';
  const footerText =
    ' ' + chalk.bold('\u2190/\u2192') + ' Step  ' +
    chalk.bold('\u2191/\u2193') + ' Scroll  ' +
    chalk.bold('Tab') + ' Focus  ' +
    chalk.bold('Space') + ' Play/Pause  ' +
    chalk.bold('+/-') + ' Speed  ' +
    chalk.bold('r') + ' Reset' + testHint + '  ' + chalk.bold('q') + ' Quit';

  // --- Render tree ---

  return h(Box, { flexDirection: 'column', width: cols, height: rows },
    h(Box, { borderStyle: 'single', borderColor: 'cyan', height: headerHeight },
      h(Text, { bold: true, wrap: 'truncate' }, headerText)
    ),

    h(Box, { flexDirection: 'row', height: mainHeight },
      h(Box, { flexDirection: 'column', width: '50%' },
        h(Panel, { label: sourceLabel, color: sourceColor, focused: focusIndex === 0,
          content: sourceContent, height: sourceHeight }),
        h(Panel, { label: 'Console Output', color: 'yellow', focused: focusIndex === 1,
          content: consoleContent, height: consoleHeight }),
        h(Panel, { label: 'Memory', color: 'magenta', focused: focusIndex === 2,
          content: memoryContent, height: memoryHeight }),
      ),

      h(Box, { flexDirection: 'column', width: '50%' },
        h(Panel, { label: 'Call Stack', color: 'red', focused: focusIndex === 4,
          content: callStackContent, height: callStackHeight }),
        h(Box, { flexDirection: 'row', height: queuesHeight },
          h(Panel, { label: 'Microtask Queue', color: 'cyan', focused: focusIndex === 5,
            content: microContent, width: '50%', height: queuesHeight }),
          h(Panel, { label: 'Macrotask Queue', color: 'yellow', focused: focusIndex === 6,
            content: macroContent, width: '50%', height: queuesHeight }),
        ),
        h(Panel, { label: 'Event Log', color: 'blue', focused: focusIndex === 3,
          content: eventLogContent, height: eventLogHeight }),
      ),
    ),

    h(Box, { borderStyle: 'single', borderColor: 'gray', height: footerHeight },
      h(Text, { wrap: 'truncate' }, footerText)
    ),
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

export { startTUI, applyEvent, createInitialState, pathsMatch };
