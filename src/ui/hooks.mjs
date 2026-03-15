import { useState, useEffect, useRef } from 'react';
import { useInput, useApp } from 'ink';
import { createInitialState, applyEvent, cloneState } from './state.mjs';
import {
  PANEL_COUNT, SNAPSHOT_INTERVAL,
  DEFAULT_PLAY_SPEED_MS, MIN_PLAY_SPEED_MS, MAX_PLAY_SPEED_MS, SPEED_STEP_MS,
} from './constants.mjs';

/**
 * Manages event stepping, snapshots, and test-boundary navigation.
 *
 * Returns stable functions that operate on refs (safe in stale closures)
 * plus the mutable refs themselves so the render phase can read current values.
 */
export function useNavigation({ events, sourcePath }) {
  const totalSteps = events.length;

  const stateRef = useRef(createInitialState());
  const snapshotsRef = useRef(new Map());
  const currentStepRef = useRef(-1);
  const displayFileRef = useRef(sourcePath);
  const scrollOffsetsRef = useRef(new Array(PANEL_COUNT).fill(0));
  const prevLogLenRef = useRef(0);
  const prevConsoleLenRef = useRef(0);
  const prevMemoryRef = useRef(new Map());

  const [renderTick, setRenderTick] = useState(0);
  void renderTick;

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

  function saveSnapshot(step) {
    if ((step + 1) % SNAPSHOT_INTERVAL === 0 && !snapshotsRef.current.has(step)) {
      snapshotsRef.current.set(step, cloneState(stateRef.current));
    }
  }

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
      saveSnapshot(i);
    }
    prevMemoryRef.current = new Map(stateRef.current.memory);
    setRenderTick(t => t + 1);
  }

  function nextStep() {
    if (currentStepRef.current >= totalSteps - 1) return false;
    currentStepRef.current++;
    applyEvent(stateRef.current, events[currentStepRef.current]);
    saveSnapshot(currentStepRef.current);
    setRenderTick(t => t + 1);
    return true;
  }

  function prevStep() {
    if (currentStepRef.current <= -1) return;
    goToStep(Math.max(-1, currentStepRef.current - 1));
  }

  function reset() {
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
      if (idx > currentStepRef.current) { goToStep(idx); return; }
    }
  }

  function prevTest() {
    if (!hasTests) return;
    const boundaries = testBoundariesRef.current;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (boundaries[i] < currentStepRef.current) { goToStep(boundaries[i]); return; }
    }
  }

  return {
    stateRef, currentStepRef, displayFileRef, scrollOffsetsRef,
    prevLogLenRef, prevConsoleLenRef, prevMemoryRef,
    hasTests, totalSteps,
    nextStep, prevStep, reset, nextTest, prevTest,
    setRenderTick,
  };
}

/**
 * Manages play/pause state and the auto-step interval timer.
 */
export function usePlayback(nextStep) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_PLAY_SPEED_MS);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const advanced = nextStep();
      if (!advanced) setPlaying(false);
    }, speed);
    return () => clearInterval(timer);
  }, [playing, speed]); // eslint-disable-line react-hooks/exhaustive-deps

  function togglePlay() { setPlaying(p => !p); }
  function speedUp() { setSpeed(s => Math.max(MIN_PLAY_SPEED_MS, s - SPEED_STEP_MS)); }
  function speedDown() { setSpeed(s => Math.min(MAX_PLAY_SPEED_MS, s + SPEED_STEP_MS)); }
  function stopPlay() { setPlaying(false); }

  return { playing, speed, togglePlay, speedUp, speedDown, stopPlay };
}

/**
 * Handles all keyboard input, dispatching to navigation/playback/UI actions.
 */
export function useKeyboardInput({
  showHelp, setShowHelp, focusIndex, setFocusIndex,
  scrollOffsetsRef, setRenderTick,
  nextStep, prevStep, reset, nextTest, prevTest,
  stopPlay, togglePlay, speedUp, speedDown,
}) {
  const { exit } = useApp();

  useInput((input, key) => {
    if (showHelp) {
      if (input === '?' || key.escape || input === 'q') setShowHelp(false);
      return;
    }

    if (input === '?') { setShowHelp(true); return; }
    if (input === 'q' || key.escape || (key.ctrl && input === 'c')) { exit(); return; }

    if (key.rightArrow || input === 'l') { stopPlay(); nextStep(); return; }
    if (key.leftArrow || input === 'h') { stopPlay(); prevStep(); return; }

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

    if (input === ' ') { togglePlay(); return; }
    if (input === '=' || input === '+') { speedUp(); return; }
    if (input === '-' || input === '_') { speedDown(); return; }
    if (input === 'r') { stopPlay(); reset(); return; }
    if (input === 'n') { stopPlay(); nextTest(); return; }
    if (input === 'N') { stopPlay(); prevTest(); return; }
  });
}
