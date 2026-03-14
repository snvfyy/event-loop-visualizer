'use strict';

/** @typedef {import('./types').ElvEvent} ElvEvent */
/** @typedef {import('./types').TUIState} TUIState */
/** @typedef {import('./types').QueueItem} QueueItem */

const blessed = require('blessed');
const fs = require('fs');

const DEFAULT_PLAY_SPEED_MS = 800;
const MIN_PLAY_SPEED_MS = 100;
const MAX_PLAY_SPEED_MS = 3000;
const SPEED_STEP_MS = 100;
const SCROLL_OFFSET_LINES = 4;
const MAX_MEMORY_DISPLAY_LEN = 50;
const SNAPSHOT_INTERVAL = 100;

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

/**
 * Escapes curly braces so blessed doesn't interpret them as formatting tags.
 * Uses blessed's built-in {escape} tags for correct handling.
 * @param {string} str
 * @returns {string}
 */
function escapeBlessed(str) {
  const s = String(str);
  if (s.indexOf('{') === -1 && s.indexOf('}') === -1) return s;
  return '{escape}' + s + '{/escape}';
}

/** @returns {TUIState} */
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
 * NOTE: Log entries embed blessed formatting tags ({bold}, {grey-fg}, etc.)
 * because state is rendered directly by blessed. This couples domain logic to
 * the rendering library — a known trade-off for simplicity.
 * @param {TUIState} state
 * @param {ElvEvent} event
 * @returns {void}
 */
function applyEvent(state, event) {
  const fileTag = (event.external && event.file)
    ? ' {grey-fg}\u21AA ' + event.file.split(/[\/\\]/).pop() + '{/grey-fg}'
    : '';

  const delta = (event.ts && state.prevTs) ? event.ts - state.prevTs : 0;
  const ts = '{grey-fg}+' + delta + 'ms{/grey-fg} ';
  if (event.ts) state.prevTs = event.ts;

  switch (event.type) {
    case 'SYNC_START':
      if (event.ts) { state.startTs = event.ts; state.prevTs = event.ts; }
      state.callStack.push('<script>' + (event.label ? ' ' + event.label : ''));
      state.phase = 'Synchronous';
      state.log.push(ts + '{bold}\u25B6 Script execution started{/bold}');
      break;

    case 'SYNC_END':
      state.callStack = [];
      state.phase = 'Sync Complete';
      state.log.push(ts + '{bold}--- Synchronous execution complete ---{/bold}');
      break;

    case 'LOG': {
      const val = event.value || '';
      state.console.push('> ' + escapeBlessed(val));
      state.log.push(ts + '# ' + escapeBlessed(val) + fileTag);
      break;
    }

    case 'ENQUEUE_MACRO': {
      const label = event.label || 'macrotask';
      state.macroQueue.push({ label: label, taskId: event.taskId });
      state.log.push(ts + '{yellow-fg}[T]{/yellow-fg} \u2192 Macrotask Queue: ' + escapeBlessed(label) + fileTag);
      break;
    }

    case 'ENQUEUE_MICRO': {
      const label = event.label || 'microtask';
      state.microQueue.push({ label: label, taskId: event.taskId });
      state.log.push(ts + '{cyan-fg}[M]{/cyan-fg} \u2192 Microtask Queue: ' + escapeBlessed(label) + fileTag);
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
      state.log.push(ts + '{bold}\u25B6 ' + escapeBlessed(label) + '{/bold}' + fileTag);
      break;
    }

    case 'CALLBACK_END':
      if (state.callStack.length > 0) state.callStack.pop();
      break;

    case 'ERROR': {
      const msg = event.value || 'Unknown error';
      state.log.push(ts + '{red-fg}ERROR: ' + escapeBlessed(msg) + '{/red-fg}');
      break;
    }

    case 'MEMORY':
      if (event.label) {
        const val = event.value || 'undefined';
        state.memory.set(event.label, val);
        const truncatedValue = val.length > MAX_MEMORY_DISPLAY_LEN ? val.substring(0, MAX_MEMORY_DISPLAY_LEN - 3) + '...' : val;
        state.log.push(ts + '{magenta-fg}' + escapeBlessed(event.label) + '{/magenta-fg} = ' + escapeBlessed(truncatedValue) + fileTag);
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
      state.log.push(ts + '{bold}{green-fg}' + bar + ' \u25C9 ' + escapeBlessed(testName) + ' ' + bar + '{/green-fg}{/bold}');
      break;
    }

    case 'TEST_END': {
      const testName = event.label || 'test';
      const passed = event.value === 'pass';
      const icon = passed ? '\u2713' : '\u2717';
      const color = passed ? 'green' : 'red';
      state.log.push(ts + '{' + color + '-fg}{bold}  ' + icon + ' ' + escapeBlessed(testName) + ' ' + (passed ? 'passed' : 'failed') + '{/bold}{/' + color + '-fg}');
      state.currentTest = null;
      break;
    }

    case 'SYNC_STEP': {
      const label = event.label || '';
      state.log.push('  {grey-fg}\u00b7 ' + escapeBlessed(label) + '{/grey-fg}');
      break;
    }

    case 'EVENT_CAP_REACHED': {
      const cap = event.value || '5000';
      state.log.push(ts + '{red-fg}{bold}\u26A0 Event cap reached (' + cap + '). Later events dropped. Set ELV_MAX_EVENTS for a higher limit.{/bold}{/red-fg}');
      break;
    }

    case 'DONE':
      state.phase = 'Complete';
      state.callStack = [];
      state.log.push(ts + '{bold}\u2713 Execution complete{/bold}');
      break;
  }
}

/**
 * Launches the blessed TUI for step-through event replay.
 * @param {ElvEvent[]} events
 * @param {string | null} sourceCode
 * @param {string | null} [sourcePath] - Absolute path to source file, for line highlighting
 * @param {string | null} [focusFile] - Absolute path to focus file (enables multi-file navigation)
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

  const totalSteps = events.length;
  let currentStep = -1;
  let state = createInitialState();
  let playing = false;
  let playTimer = null;
  let speed = DEFAULT_PLAY_SPEED_MS;

  /** @type {Map<number, TUIState>} */
  const snapshots = new Map();

  /** @type {Map<string, string[]>} */
  const sourceCache = new Map();
  if (sourcePath && sourceCode) {
    sourceCache.set(sourcePath, sourceCode.split('\n'));
  }
  let currentDisplayFile = sourcePath;

  /**
   * @param {string} filePath
   * @returns {string[] | null}
   */
  function getSourceLines(filePath) {
    if (!filePath) return null;
    if (sourceCache.has(filePath)) return sourceCache.get(filePath);
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      sourceCache.set(filePath, lines);
      return lines;
    } catch (_) {
      return null;
    }
  }

  const screen = blessed.screen({
    smartCSR: true,
    title: 'Event Loop Visualizer',
    fullUnicode: true,
    mouse: true,
  });

  // --- Header ---
  const header = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' }, bold: true },
    tags: true,
    content: '',
  });

  // --- Left column ---
  const sourceBox = blessed.box({
    parent: screen,
    top: 3,
    left: 0,
    width: '50%',
    height: '50%-3',
    border: { type: 'line' },
    label: ' Source Code ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '\u2588', style: { bg: 'grey' } },
    style: { border: { fg: 'green' }, label: { fg: 'green' } },
    content: '',
  });

  const consoleBox = blessed.box({
    parent: screen,
    top: '50%',
    left: 0,
    width: '50%',
    height: '15%',
    border: { type: 'line' },
    label: ' Console Output ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '\u2588', style: { bg: 'grey' } },
    style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
    content: '',
  });

  const memoryBox = blessed.box({
    parent: screen,
    top: '65%',
    left: 0,
    width: '50%',
    height: '30%',
    border: { type: 'line' },
    label: ' Memory ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '\u2588', style: { bg: 'grey' } },
    style: { border: { fg: 'magenta' }, label: { fg: 'magenta' } },
    content: '{grey-fg}(no variables tracked){/grey-fg}',
  });

  // --- Right column ---
  const callStackBox = blessed.box({
    parent: screen,
    top: 3,
    left: '50%',
    width: '50%',
    height: '18%-3',
    border: { type: 'line' },
    label: ' Call Stack ',
    tags: true,
    scrollable: true,
    style: { border: { fg: 'red' }, label: { fg: 'red' } },
    content: '',
  });

  const microBox = blessed.box({
    parent: screen,
    top: '18%',
    left: '50%',
    width: '25%',
    height: '20%',
    border: { type: 'line' },
    label: ' Microtask Queue ',
    tags: true,
    scrollable: true,
    style: { border: { fg: 'cyan' }, label: { fg: 'cyan' } },
    content: '',
  });

  const macroBox = blessed.box({
    parent: screen,
    top: '18%',
    left: '75%',
    width: '25%',
    height: '20%',
    border: { type: 'line' },
    label: ' Macrotask Queue ',
    tags: true,
    scrollable: true,
    style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
    content: '',
  });

  const eventLogBox = blessed.box({
    parent: screen,
    top: '38%',
    left: '50%',
    width: '50%',
    height: '57%',
    border: { type: 'line' },
    label: ' Event Log ',
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '\u2588', style: { bg: 'grey' } },
    style: { border: { fg: 'blue' }, label: { fg: 'blue' } },
    content: '',
  });

  // --- Footer ---
  const footer = blessed.box({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    tags: true,
    style: { border: { fg: 'grey' } },
    content: '',
  });

  const scrollablePanels = [
    { box: sourceBox, name: 'Source Code', borderFg: 'green' },
    { box: consoleBox, name: 'Console', borderFg: 'yellow' },
    { box: memoryBox, name: 'Memory', borderFg: 'magenta' },
    { box: eventLogBox, name: 'Event Log', borderFg: 'blue' },
    { box: callStackBox, name: 'Call Stack', borderFg: 'red' },
    { box: microBox, name: 'Microtask Queue', borderFg: 'cyan' },
    { box: macroBox, name: 'Macrotask Queue', borderFg: 'yellow' },
  ];
  let focusIndex = 0;

  function updateFocusBorders() {
    for (let i = 0; i < scrollablePanels.length; i++) {
      const panel = scrollablePanels[i];
      const isFocused = i === focusIndex;
      if (isFocused) {
        panel.box.style.border.fg = 'white';
        panel.box.style.border.bold = true;
        panel.box.style.label.fg = 'white';
        panel.box.style.label.bold = true;
      } else {
        panel.box.style.border.fg = panel.borderFg;
        panel.box.style.border.bold = false;
        panel.box.style.label.fg = panel.borderFg;
        panel.box.style.label.bold = false;
      }
      panel.box.label = (isFocused ? ' \u25B8 ' : ' ') + panel.name + ' ';
    }
  }
  updateFocusBorders();

  function render() {
    const stepLabel = currentStep < 0 ? '0' : String(currentStep + 1);
    const playIcon = playing ? '\u25B6 Playing' : '\u23F8 Paused';
    const testInfo = state.currentTest
      ? '      Test: {bold}' + escapeBlessed(state.currentTest) + '{/bold}'
      : '';
    header.setContent(
      ' {bold}Event Loop Visualizer{/bold}      ' +
      'Step ' + stepLabel + '/' + totalSteps + '      ' +
      'Phase: {bold}' + state.phase + '{/bold}      ' +
      playIcon + '      ' +
      'Speed: ' + speed + 'ms' +
      testInfo
    );

    if (state.callStack.length === 0) {
      callStackBox.setContent('{grey-fg}(empty){/grey-fg}');
    } else {
      callStackBox.setContent(
        state.callStack.map((s, i) =>
          (i === state.callStack.length - 1 ? '{bold}\u25B6 ' : '  ') + escapeBlessed(s) + (i === state.callStack.length - 1 ? '{/bold}' : '')
        ).join('\n')
      );
    }

    if (state.microQueue.length === 0) {
      microBox.setContent('{grey-fg}(empty){/grey-fg}');
    } else {
      microBox.setContent(
        state.microQueue.map((item, i) =>
          (i + 1) + '. ' + escapeBlessed(item.label)
        ).join('\n')
      );
    }

    if (state.macroQueue.length === 0) {
      macroBox.setContent('{grey-fg}(empty){/grey-fg}');
    } else {
      macroBox.setContent(
        state.macroQueue.map((item, i) =>
          (i + 1) + '. ' + escapeBlessed(item.label)
        ).join('\n')
      );
    }

    consoleBox.setContent(state.console.join('\n'));
    eventLogBox.setContent(state.log.join('\n'));

    if (state.memory.size === 0) {
      memoryBox.setContent('{grey-fg}(no variables tracked){/grey-fg}');
    } else {
      const entries = [];
      state.memory.forEach((val, name) => {
        entries.push(' {bold}' + escapeBlessed(name) + '{/bold} = ' + escapeBlessed(val));
      });
      memoryBox.setContent(entries.join('\n'));
    }

    // --- Source code with line highlighting and multi-file navigation ---
    const event = currentStep >= 0 ? events[currentStep] : null;
    const eventFile = event && event.file;
    const isExternal = event && event.external;
    const eventFocusLine = event && event.focusLine;

    if (focusFile && isExternal) {
      currentDisplayFile = focusFile;
    } else if (eventFile && !pathsMatch(eventFile, currentDisplayFile || '')) {
      const newLines = getSourceLines(eventFile);
      if (newLines) currentDisplayFile = eventFile;
    }

    const displayLines = getSourceLines(currentDisplayFile) || getSourceLines(sourcePath);
    const displayFileName = currentDisplayFile ? currentDisplayFile.split(/[\/\\]/).pop() : null;
    const isExternalFile = focusFile && currentDisplayFile && currentDisplayFile !== focusFile;
    const externalFileName = (isExternal && eventFile) ? eventFile.split(/[\/\\]/).pop() : null;

    const sourceIsFocused = focusIndex === 0;
    if (isExternal && currentDisplayFile === focusFile) {
      sourceBox.label = (sourceIsFocused ? ' \u25B8 ' : ' ') + (displayFileName || 'Source') + ' \u2192 ' + (externalFileName || '?') + ' ';
      sourceBox.style.label.fg = sourceIsFocused ? 'white' : 'yellow';
      sourceBox.style.border.fg = sourceIsFocused ? 'white' : 'yellow';
    } else if (isExternalFile) {
      sourceBox.label = (sourceIsFocused ? ' \u25B8 ' : ' \u21AA ') + displayFileName + ' ';
      sourceBox.style.label.fg = sourceIsFocused ? 'white' : 'grey';
      sourceBox.style.border.fg = sourceIsFocused ? 'white' : 'grey';
    } else {
      sourceBox.label = (sourceIsFocused ? ' \u25B8 ' : ' ') + (displayFileName || 'Source Code') + ' ';
      sourceBox.style.label.fg = sourceIsFocused ? 'white' : 'green';
      sourceBox.style.border.fg = sourceIsFocused ? 'white' : 'green';
    }
    sourceBox.style.border.bold = sourceIsFocused;
    sourceBox.style.label.bold = sourceIsFocused;

    if (displayLines) {
      let highlightLine = null;
      let highlightExternal = false;
      if (isExternal && currentDisplayFile === focusFile) {
        highlightLine = eventFocusLine || null;
        highlightExternal = true;
      } else if (event && event.line && currentDisplayFile &&
        (!event.file || event.file === currentDisplayFile || pathsMatch(event.file, currentDisplayFile))) {
        highlightLine = event.line;
      }

      const padWidth = String(displayLines.length).length;
      const rendered = displayLines.map((line, i) => {
        const lineNum = i + 1;
        const num = String(lineNum).padStart(Math.max(3, padWidth), ' ');
        const safeLine = line ? '{escape}' + line + '{/escape}' : '';
        if (highlightLine === lineNum) {
          if (highlightExternal) {
            return '{black-fg}{yellow-bg} ' + num + '  ' + safeLine + ' {/yellow-bg}{/black-fg}';
          }
          return '{black-fg}{white-bg}{bold} ' + num + '  ' + safeLine + ' {/bold}{/white-bg}{/black-fg}';
        }
        return '{grey-fg}' + num + '{/grey-fg}  ' + safeLine;
      });
      sourceBox.setContent(rendered.join('\n'));
      if (highlightLine) {
        sourceBox.scrollTo(Math.max(0, highlightLine - SCROLL_OFFSET_LINES));
      }
    } else {
      sourceBox.setContent('{grey-fg}[Command mode \u2014 source not available]{/grey-fg}');
    }

    // Auto-scroll to bottom
    consoleBox.setScrollPerc(100);
    eventLogBox.setScrollPerc(100);

    screen.render();
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

  function goToStep(n) {
    let startFrom = -1;
    state = createInitialState();
    currentDisplayFile = sourcePath;

    // Find the nearest snapshot at or before the target step
    for (const [snapStep] of snapshots) {
      if (snapStep <= n && snapStep > startFrom) startFrom = snapStep;
    }

    if (startFrom >= 0) {
      state = cloneState(snapshots.get(startFrom));
      currentStep = startFrom;
    } else {
      currentStep = -1;
    }

    for (let i = currentStep + 1; i <= n && i < totalSteps; i++) {
      applyEvent(state, events[i]);
      currentStep = i;
      if ((i + 1) % SNAPSHOT_INTERVAL === 0 && !snapshots.has(i)) {
        snapshots.set(i, cloneState(state));
      }
    }
    render();
  }

  function nextStep() {
    if (currentStep >= totalSteps - 1) {
      stopPlaying();
      return;
    }
    currentStep++;
    applyEvent(state, events[currentStep]);
    if ((currentStep + 1) % SNAPSHOT_INTERVAL === 0 && !snapshots.has(currentStep)) {
      snapshots.set(currentStep, cloneState(state));
    }
    render();
  }

  function prevStep() {
    if (currentStep <= -1) return;
    goToStep(Math.max(-1, currentStep - 1));
  }

  function reset() {
    stopPlaying();
    state = createInitialState();
    currentStep = -1;
    currentDisplayFile = sourcePath;
    render();
  }

  function startPlaying() {
    if (playing) return;
    playing = true;
    playTimer = setInterval(() => {
      nextStep();
    }, speed);
    render();
  }

  function stopPlaying() {
    if (!playing) return;
    playing = false;
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    render();
  }

  function togglePlay() {
    if (playing) stopPlaying();
    else startPlaying();
  }

  function changeSpeed(delta) {
    stopPlaying();
    speed = Math.max(MIN_PLAY_SPEED_MS, Math.min(MAX_PLAY_SPEED_MS, speed + delta));
    render();
  }

  // --- Test boundary navigation ---
  const testBoundaries = [];
  for (let i = 0; i < totalSteps; i++) {
    if (events[i].type === 'TEST_START') testBoundaries.push(i);
  }
  const hasTests = testBoundaries.length > 0;

  function nextTest() {
    if (!hasTests) return;
    for (const idx of testBoundaries) {
      if (idx > currentStep) {
        stopPlaying();
        goToStep(idx);
        return;
      }
    }
  }

  function prevTest() {
    if (!hasTests) return;
    for (let i = testBoundaries.length - 1; i >= 0; i--) {
      if (testBoundaries[i] < currentStep) {
        stopPlaying();
        goToStep(testBoundaries[i]);
        return;
      }
    }
  }

  // --- Key bindings ---
  screen.key(['right', 'l'], () => {
    stopPlaying();
    nextStep();
  });
  screen.key(['left', 'h'], () => {
    stopPlaying();
    prevStep();
  });
  screen.key(['up', 'k'], () => {
    scrollablePanels[focusIndex].box.scroll(-1);
    screen.render();
  });
  screen.key(['down', 'j'], () => {
    scrollablePanels[focusIndex].box.scroll(1);
    screen.render();
  });
  screen.key(['tab'], () => {
    focusIndex = (focusIndex + 1) % scrollablePanels.length;
    updateFocusBorders();
    screen.render();
  });
  screen.key(['S-tab'], () => {
    focusIndex = (focusIndex - 1 + scrollablePanels.length) % scrollablePanels.length;
    updateFocusBorders();
    screen.render();
  });
  screen.key(['space'], () => togglePlay());
  screen.key(['=', '+'], () => changeSpeed(-SPEED_STEP_MS));
  screen.key(['-', '_'], () => changeSpeed(SPEED_STEP_MS));
  screen.key(['r'], () => reset());
  screen.key(['n'], () => nextTest());
  screen.key(['S-n'], () => prevTest());
  screen.key(['q', 'escape', 'C-c'], () => {
    screen.destroy();
    process.exit(0);
  });

  const testHint = hasTests ? '  {bold}n/N{/bold} Test' : '';
  footer.setContent(
    ' {bold}\u2190/\u2192{/bold} Step  {bold}\u2191/\u2193{/bold} Scroll  {bold}Tab{/bold} Focus  {bold}Space{/bold} Play/Pause  {bold}+/-{/bold} Speed  {bold}r{/bold} Reset' + testHint + '  {bold}q{/bold} Quit'
  );

  // Initial render
  render();
}

module.exports = { startTUI, applyEvent, createInitialState, pathsMatch, escapeBlessed };
