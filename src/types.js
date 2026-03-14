'use strict';

/**
 * @typedef {'SYNC_START' | 'SYNC_END' | 'LOG' | 'ENQUEUE_MACRO' | 'ENQUEUE_MICRO' | 'CALLBACK_START' | 'CALLBACK_END' | 'ERROR' | 'DONE' | 'MEMORY' | 'SYNC_STEP' | 'TEST_START' | 'TEST_END' | 'EVENT_CAP_REACHED'} EventType
 */

/**
 * @typedef {'micro' | 'macro'} TaskKind
 */

/**
 * @typedef {'setTimeout' | 'setInterval' | 'setImmediate' | 'promise' | 'queueMicrotask' | 'nextTick' | 'log' | 'warn' | 'error' | 'info'} EventSubtype
 */

/**
 * @typedef {'Synchronous' | 'Sync Complete' | 'Microtasks' | 'Macrotasks' | 'Complete' | 'Ready'} Phase
 */

/**
 * @typedef {object} ElvEvent
 * @property {EventType} type
 * @property {number} seq - Monotonically increasing sequence number
 * @property {string} [label] - Human-readable description
 * @property {number} [taskId] - Links ENQUEUE and CALLBACK_START for the same task
 * @property {TaskKind} [kind]
 * @property {EventSubtype} [subtype]
 * @property {string} [value] - For LOG and ERROR events
 * @property {string} [file] - Source file path from stack trace
 * @property {number} [line] - Source line number from stack trace
 * @property {boolean} [external] - True if event originated from a non-focus file but is related via call chain
 * @property {number} [focusLine] - Line in the focus file that triggered this external event
 * @property {number} [ts] - Wall-clock timestamp (Date.now()) when the event was recorded
 */

/**
 * @typedef {object} QueueItem
 * @property {string} label
 * @property {number} taskId
 */

/**
 * @typedef {object} TUIState
 * @property {string[]} callStack
 * @property {QueueItem[]} microQueue
 * @property {QueueItem[]} macroQueue
 * @property {string[]} console
 * @property {string[]} log
 * @property {Phase} phase
 * @property {Map<string, string>} memory
 * @property {number} startTs
 * @property {number} prevTs
 * @property {string | null} currentTest
 */

/**
 * @typedef {'file' | 'preload' | 'jest' | 'vitest'} InstrumentMode
 */

/**
 * @typedef {object} InstrumenterOptions
 * @property {InstrumentMode} [mode]
 * @property {number} [maxEvents]
 * @property {number} [intervalCap]
 * @property {string} [focusFile] - Absolute path to focus file; only events related to this file are recorded
 */

/**
 * @typedef {object} InstrumenterState
 * @property {number} pendingTimers
 * @property {number} lastEventTime
 */

/**
 * @typedef {object} SavedOriginals
 * @property {typeof globalThis.setTimeout} setTimeout
 * @property {typeof globalThis.clearTimeout} clearTimeout
 * @property {typeof globalThis.setInterval} setInterval
 * @property {typeof globalThis.clearInterval} clearInterval
 * @property {typeof globalThis.setImmediate} [setImmediate]
 * @property {typeof globalThis.queueMicrotask} [queueMicrotask]
 * @property {typeof process.nextTick} [nextTick]
 */

/**
 * @typedef {object} InstrumenterResult
 * @property {ElvEvent[]} events
 * @property {(event: Partial<ElvEvent> & { type: EventType }) => void} emit
 * @property {() => InstrumenterState} getState
 * @property {() => void} restore
 * @property {SavedOriginals} originals
 */

/**
 * @typedef {object} ProcessEventFile
 * @property {number} pid
 * @property {string[]} argv
 * @property {string} [label]
 * @property {ElvEvent[]} events
 */

module.exports = {};
