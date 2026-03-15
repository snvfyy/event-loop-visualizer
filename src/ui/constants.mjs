export const DEFAULT_PLAY_SPEED_MS = 500;
export const MIN_PLAY_SPEED_MS = 100;
export const MAX_PLAY_SPEED_MS = 3000;
export const SPEED_STEP_MS = 100;
export const SCROLL_OFFSET_LINES = 4;
export const MAX_MEMORY_DISPLAY_LEN = 50;
export const SNAPSHOT_INTERVAL = 100;
// Source, Call Stack, Macro Queue, Micro Queue, Render Queue, Console, Memory
export const PANEL_COUNT = 7;

// Layout ratios for panel height distribution
export const CALL_STACK_RATIO = 0.18;
export const QUEUES_RATIO = 0.22;
export const CONSOLE_RATIO = 0.17;

// Panel height = 2 (border) + 1 (label line) = 3 lines of chrome
export const PANEL_CHROME = 3;
