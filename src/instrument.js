'use strict';

/** @typedef {import('./types').ElvEvent} ElvEvent */
/** @typedef {import('./types').InstrumenterOptions} InstrumenterOptions */
/** @typedef {import('./types').InstrumenterResult} InstrumenterResult */
/** @typedef {import('./types').InstrumenterState} InstrumenterState */

const async_hooks = require('async_hooks');
const fs = require('fs');
const _sep = require('path').sep;
const _ownDir = __dirname + _sep;
const _nodeModules = _sep + 'node_modules' + _sep;

/**
 * Parses a single V8 stack frame string into file, line, and optional function name.
 * @param {string} frame
 * @returns {{ file: string, line: number, fnName: string | undefined } | null}
 */
function parseFrame(frame) {
  const named = frame.match(/at (.+?) \((.+):(\d+):\d+\)/);
  if (named) {
    const fnName = named[1] === 'Object.<anonymous>' ? undefined : named[1];
    return { file: named[2], line: parseInt(named[3], 10), fnName };
  }
  const simple = frame.match(/\((.+):(\d+):\d+\)/) || frame.match(/at (.+):(\d+):\d+/);
  if (simple) return { file: simple[1], line: parseInt(simple[2], 10), fnName: undefined };
  return null;
}

const MAX_LABEL_LENGTH = 60;
const TRUNCATION_SUFFIX = '...';
const TRUNCATED_LABEL_LENGTH = MAX_LABEL_LENGTH - TRUNCATION_SUFFIX.length;
const DEFAULT_MAX_EVENTS = 5000;
const DEFAULT_INTERVAL_CAP = 10;
const CONSOLE_METHODS = ['log', 'warn', 'error', 'info'];
const ELV_INTERNAL_PREFIX = '__elv';
const MAX_AWAIT_EXPR_LENGTH = 45;
const TRUNCATED_AWAIT_EXPR_LENGTH = MAX_AWAIT_EXPR_LENGTH - TRUNCATION_SUFFIX.length;

/**
 * Returns a human-readable label for a callback function, falling back to the provided default.
 * @param {Function | null | undefined} fn
 * @param {string} fallback
 * @returns {string}
 */
function getLabel(fn, fallback) {
  if (!fn || typeof fn !== 'function') return fallback;
  if (fn.name && !fn.name.startsWith(ELV_INTERNAL_PREFIX)) return fn.name;
  let fnString = fn.toString().replace(/\s+/g, ' ').trim();
  if (fnString.includes('[native code]')) return fallback;
  fnString = fnString.replace(/;?\s*__elv(?:Track|Step)\([^)]*\)\s*;?/g, '');
  if (fnString.length <= MAX_LABEL_LENGTH) return fnString;
  return fnString.substring(0, TRUNCATED_LABEL_LENGTH) + TRUNCATION_SUFFIX;
}

const MAX_SERIALIZE_DEPTH = 2;
const MAX_ARRAY_ITEMS = 10;
const MAX_OBJ_KEYS = 10;
const MAX_STR_LEN = 80;
const STR_TRUNCATION_OVERHEAD = 5; // accounts for surrounding quotes + '...'

/**
 * Safely serializes a value into a compact display string.
 * Handles circular references, functions, undefined, symbols, and truncation.
 * @param {*} value
 * @param {number} [depth]
 * @param {WeakSet<object>} [seen]
 * @returns {string}
 */
function safeSerialize(value, depth, seen) {
  if (depth === undefined) depth = 0;
  if (seen === undefined) seen = new WeakSet();

  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const valueType = typeof value;
  if (valueType === 'boolean' || valueType === 'number' || valueType === 'bigint') return String(value);
  if (valueType === 'string') {
    if (value.length > MAX_STR_LEN - STR_TRUNCATION_OVERHEAD) {
      return JSON.stringify(value.slice(0, MAX_STR_LEN - STR_TRUNCATION_OVERHEAD) + '...');
    }
    return JSON.stringify(value);
  }
  if (valueType === 'symbol') return value.toString();
  if (valueType === 'function') return value.name ? '[Function: ' + value.name + ']' : '[Function]';

  if (depth >= MAX_SERIALIZE_DEPTH) return Array.isArray(value) ? '[Array]' : '[Object]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(v => safeSerialize(v, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) items.push('...');
    return '[' + items.join(', ') + ']';
  }

  if (value instanceof Map) {
    const items = [];
    let count = 0;
    value.forEach((v, k) => {
      if (count < MAX_OBJ_KEYS) items.push(safeSerialize(k, depth + 1, seen) + ' => ' + safeSerialize(v, depth + 1, seen));
      count++;
    });
    if (count > MAX_OBJ_KEYS) items.push('...');
    return 'Map(' + value.size + ') { ' + items.join(', ') + ' }';
  }

  if (value instanceof Set) {
    const items = [];
    let count = 0;
    value.forEach(v => {
      if (count < MAX_ARRAY_ITEMS) items.push(safeSerialize(v, depth + 1, seen));
      count++;
    });
    if (count > MAX_ARRAY_ITEMS) items.push('...');
    return 'Set(' + value.size + ') { ' + items.join(', ') + ' }';
  }

  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return String(value);
  if (value instanceof Error) return value.name + ': ' + (value.message || '');
  if (value instanceof Promise) return 'Promise {}';

  const keys = Object.keys(value);
  if (keys.length === 0) {
    const proto = Object.getPrototypeOf(value);
    const ctorName = proto && proto.constructor && proto.constructor.name;
    if (ctorName && ctorName !== 'Object') {
      const descriptors = [];
      try {
        const protoKeys = Object.getOwnPropertyNames(proto).filter(k =>
          k !== 'constructor' && typeof Object.getOwnPropertyDescriptor(proto, k).get === 'function'
        );
        for (const k of protoKeys.slice(0, MAX_OBJ_KEYS)) {
          try { descriptors.push(k + ': ' + safeSerialize(value[k], depth + 1, seen)); } catch (_) {}
        }
        if (protoKeys.length > MAX_OBJ_KEYS) descriptors.push('...');
      } catch (_) {}
      if (descriptors.length > 0) return ctorName + ' { ' + descriptors.join(', ') + ' }';
      return '[' + ctorName + ']';
    }
    return '{}';
  }

  const entries = keys.slice(0, MAX_OBJ_KEYS).map(key =>
    key + ': ' + safeSerialize(value[key], depth + 1, seen)
  );
  if (keys.length > MAX_OBJ_KEYS) entries.push('...');
  return '{ ' + entries.join(', ') + ' }';
}

/**
 * Patches all async globals on `target` and records events.
 * @param {object} target - The global object to patch (e.g., `globalThis`, jsdom's `this.global`)
 * @param {InstrumenterOptions} [options]
 * @returns {InstrumenterResult}
 */
function createInstrumenter(target, options = {}) {
  const mode = options.mode || 'file';
  const maxEvents = options.maxEvents || parseInt(process.env.ELV_MAX_EVENTS, 10) || DEFAULT_MAX_EVENTS;
  const intervalCap = options.intervalCap || parseInt(process.env.ELV_INTERVAL_CAP, 10) || DEFAULT_INTERVAL_CAP;
  const filterNoise = mode !== 'file';
  const focusFile = options.focusFile || null;

  /** @type {ElvEvent[]} */
  const events = [];
  let seq = 0;
  let pendingTimers = 0;
  let lastEventTime = Date.now();
  let insideFocusCallback = 0;

  const _focusPathCache = new Map();
  function isFocusFile(file) {
    if (file === focusFile) return true;
    if (_focusPathCache.has(file)) return _focusPathCache.get(file);
    let match = false;
    try { match = fs.realpathSync(file) === focusFile; } catch (_) {}
    _focusPathCache.set(file, match);
    return match;
  }

  /**
   * @param {Partial<ElvEvent> & { type: import('./types').EventType }} event
   * @returns {void}
   */
  let eventCapReached = false;
  function emit(event) {
    if (eventCapReached) return;
    if (events.length >= maxEvents) {
      eventCapReached = true;
      events.push(/** @type {ElvEvent} */ ({ type: 'EVENT_CAP_REACHED', seq: seq++, ts: Date.now(), value: String(maxEvents) }));
      return;
    }
    event.seq = seq++;
    event.ts = Date.now();
    lastEventTime = event.ts;
    events.push(/** @type {ElvEvent} */ (event));
  }

  /** @returns {InstrumenterState} */
  function getState() {
    return { pendingTimers, lastEventTime };
  }

  /**
   * Capture a stack string. Tries the current prepareStackTrace first (which
   * may include Vite's source-map remapping for correct original line numbers).
   * Falls back to raw V8 frames only if the custom handler throws (e.g. on
   * injected __elvTrack code that has no source map entry).
   */
  function getRawStack() {
    try {
      const stack = new Error().stack;
      if (stack) return stack;
    } catch (_) {}
    const prev = Error.prepareStackTrace;
    Error.prepareStackTrace = undefined;
    const stack = new Error().stack;
    Error.prepareStackTrace = prev;
    return stack;
  }

  /**
   * Single stack analysis that combines caller identification, noise detection,
   * and focus-file filtering. Returns everything wrappers need in one pass.
   * @returns {{ loc: { file: string, line: number } | undefined, skip: boolean, external: boolean, focusLine: number | undefined }}
   */
  function checkCall() {
    const stack = getRawStack();
    if (!stack) return { loc: undefined, skip: true, external: false, focusLine: undefined };

    const frames = stack.split('\n');
    let loc = undefined;
    let focusFound = !focusFile;
    let focusLine = undefined;

    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i];
      if (frame.includes(_ownDir) || frame.includes('node:')) continue;
      const parsed = parseFrame(frame);
      if (parsed) {
        if (!loc) loc = { file: parsed.file, line: parsed.line };
        if (focusFile && isFocusFile(parsed.file)) {
          focusFound = true;
          if (focusLine === undefined) focusLine = parsed.line;
        }
      }
    }

    let skip;
    if (focusFile) {
      skip = !focusFound && insideFocusCallback <= 0;
    } else {
      skip = filterNoise && (!loc || loc.file.includes(_nodeModules));
    }

    const external = focusFile ? (!loc || !isFocusFile(loc.file)) : false;

    return { loc, skip, external, focusLine };
  }

  // --- Save originals from the *target* object ---
  const _setTimeout = target.setTimeout;
  const _clearTimeout = target.clearTimeout;
  const _setInterval = target.setInterval;
  const _clearInterval = target.clearInterval;
  const _setImmediate = target.setImmediate;
  const _queueMicrotask = target.queueMicrotask;
  const _nextTick = (target.process && target.process.nextTick)
    ? target.process.nextTick
    : (typeof process !== 'undefined' ? process.nextTick : undefined);
  const _then = Promise.prototype.then;
  const _catch = Promise.prototype.catch;
  const _consoleMethods = {};
  if (target.console) {
    for (const method of CONSOLE_METHODS) {
      _consoleMethods[method] = target.console[method];
    }
  }

  // --- setTimeout ---
  target.setTimeout = function __elvSetTimeout(cb, delay, ...args) {
    const { loc, skip, external, focusLine } = checkCall();
    if (skip) {
      return _setTimeout.call(this, cb, delay, ...args);
    }
    const label = getLabel(cb, 'setTimeout(fn, ' + (delay || 0) + ')');
    const taskId = seq;
    emit({
      type: 'ENQUEUE_MACRO',
      label: label,
      taskId: taskId,
      kind: 'macro',
      subtype: 'setTimeout',
      file: loc && loc.file,
      line: loc && loc.line,
      external: external || undefined,
      focusLine: focusLine,
    });
    pendingTimers++;
    return _setTimeout.call(this, function __elvTimeoutCb() {
      pendingTimers--;
      if (focusFile) insideFocusCallback++;
      emit({ type: 'CALLBACK_START', label: label, taskId: taskId, kind: 'macro', subtype: 'setTimeout', file: loc && loc.file, line: loc && loc.line, external: external || undefined, focusLine: focusLine });
      try {
        cb.apply(this, args);
      } catch (err) {
        emit({ type: 'ERROR', value: err && err.message || String(err) });
        throw err;
      } finally {
        emit({ type: 'CALLBACK_END', taskId: taskId, kind: 'macro', subtype: 'setTimeout' });
        if (focusFile) insideFocusCallback--;
      }
    }, delay);
  };

  // --- setInterval ---
  target.setInterval = function __elvSetInterval(cb, delay, ...args) {
    const { loc, skip, external, focusLine } = checkCall();
    if (skip) {
      return _setInterval.call(this, cb, delay, ...args);
    }
    const label = getLabel(cb, 'setInterval(fn, ' + (delay || 0) + ')');
    let iteration = 0;
    const taskId = seq;
    emit({
      type: 'ENQUEUE_MACRO',
      label: label,
      taskId: taskId,
      kind: 'macro',
      subtype: 'setInterval',
      file: loc && loc.file,
      line: loc && loc.line,
      external: external || undefined,
      focusLine: focusLine,
    });
    pendingTimers++;
    const intervalId = _setInterval.call(this, function __elvIntervalCb() {
      iteration++;
      if (iteration > intervalCap) {
        cb.apply(this, args);
        return;
      }
      if (focusFile) insideFocusCallback++;
      const iterTaskId = iteration === 1 ? taskId : seq;
      if (iteration > 1) {
        emit({
          type: 'ENQUEUE_MACRO',
          label: label + ' (#' + iteration + ')',
          taskId: iterTaskId,
          kind: 'macro',
          subtype: 'setInterval',
        });
      }
      emit({ type: 'CALLBACK_START', label: label + ' (#' + iteration + ')', taskId: iterTaskId, kind: 'macro', subtype: 'setInterval' });
      try {
        cb.apply(this, args);
      } catch (err) {
        emit({ type: 'ERROR', value: err && err.message || String(err) });
        throw err;
      } finally {
        emit({ type: 'CALLBACK_END', taskId: iterTaskId, kind: 'macro', subtype: 'setInterval' });
        if (focusFile) insideFocusCallback--;
      }
    }, delay);
    return intervalId;
  };

  // --- setImmediate ---
  if (_setImmediate) {
    target.setImmediate = function __elvSetImmediate(cb, ...args) {
      const { loc, skip, external, focusLine } = checkCall();
      if (skip) {
        return _setImmediate.call(this, cb, ...args);
      }
      const label = getLabel(cb, 'setImmediate(fn)');
      const taskId = seq;
      emit({
        type: 'ENQUEUE_MACRO',
        label: label,
        taskId: taskId,
        kind: 'macro',
        subtype: 'setImmediate',
        file: loc && loc.file,
        line: loc && loc.line,
        external: external || undefined,
        focusLine: focusLine,
      });
      pendingTimers++;
      return _setImmediate.call(this, function __elvImmediateCb() {
        pendingTimers--;
        if (focusFile) insideFocusCallback++;
        emit({ type: 'CALLBACK_START', label: label, taskId: taskId, kind: 'macro', subtype: 'setImmediate', file: loc && loc.file, line: loc && loc.line, external: external || undefined, focusLine: focusLine });
        try {
          cb.apply(this, args);
        } catch (err) {
          emit({ type: 'ERROR', value: err && err.message || String(err) });
          throw err;
        } finally {
          emit({ type: 'CALLBACK_END', taskId: taskId, kind: 'macro', subtype: 'setImmediate' });
          if (focusFile) insideFocusCallback--;
        }
      });
    };
  }

  // --- queueMicrotask ---
  if (_queueMicrotask) {
    target.queueMicrotask = function __elvQueueMicrotask(cb) {
      const { loc, skip, external, focusLine } = checkCall();
      if (skip) {
        return _queueMicrotask.call(this, cb);
      }
      const label = getLabel(cb, 'queueMicrotask(fn)');
      const taskId = seq;
      emit({
        type: 'ENQUEUE_MICRO',
        label: label,
        taskId: taskId,
        kind: 'micro',
        subtype: 'queueMicrotask',
        file: loc && loc.file,
        line: loc && loc.line,
        external: external || undefined,
        focusLine: focusLine,
      });
      return _queueMicrotask.call(this, function __elvMicrotaskCb() {
        if (focusFile) insideFocusCallback++;
        emit({ type: 'CALLBACK_START', label: label, taskId: taskId, kind: 'micro', subtype: 'queueMicrotask', file: loc && loc.file, line: loc && loc.line, external: external || undefined, focusLine: focusLine });
        try {
          cb();
        } catch (err) {
          emit({ type: 'ERROR', value: err && err.message || String(err) });
          throw err;
        } finally {
          emit({ type: 'CALLBACK_END', taskId: taskId, kind: 'micro', subtype: 'queueMicrotask' });
          if (focusFile) insideFocusCallback--;
        }
      });
    };
  }

  // --- process.nextTick ---
  if (_nextTick) {
    const proc = target.process || process;
    proc.nextTick = function __elvNextTick(cb, ...args) {
      const { loc, skip, external, focusLine } = checkCall();
      if (skip) {
        return _nextTick.call(proc, cb, ...args);
      }
      const label = getLabel(cb, 'process.nextTick(fn)');
      const taskId = seq;
      emit({
        type: 'ENQUEUE_MICRO',
        label: label,
        taskId: taskId,
        kind: 'micro',
        subtype: 'nextTick',
        file: loc && loc.file,
        line: loc && loc.line,
        external: external || undefined,
        focusLine: focusLine,
      });
      return _nextTick.call(proc, function __elvNextTickCb() {
        if (focusFile) insideFocusCallback++;
        emit({ type: 'CALLBACK_START', label: label, taskId: taskId, kind: 'micro', subtype: 'nextTick', file: loc && loc.file, line: loc && loc.line, external: external || undefined, focusLine: focusLine });
        try {
          cb.apply(this, args);
        } catch (err) {
          emit({ type: 'ERROR', value: err && err.message || String(err) });
          throw err;
        } finally {
          emit({ type: 'CALLBACK_END', taskId: taskId, kind: 'micro', subtype: 'nextTick' });
          if (focusFile) insideFocusCallback--;
        }
      });
    };
  }

  // --- await label enrichment via source file cache ---
  const _srcLineCache = new Map();

  function getSourceLineContent(file, line) {
    if (!file || !line) return null;
    if (!_srcLineCache.has(file)) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        _srcLineCache.set(file, content.split('\n'));
      } catch (_) {
        _srcLineCache.set(file, null);
      }
    }
    const lines = _srcLineCache.get(file);
    return lines ? (lines[line - 1] || null) : null;
  }

  function buildAwaitLabel(loc) {
    const srcLine = getSourceLineContent(loc.file, loc.line);
    if (srcLine) {
      const m = srcLine.match(/await\s+(.+)/);
      if (m) {
        let expr = m[1].replace(/;?\s*$/, '').trim();
        if (expr.length > MAX_AWAIT_EXPR_LENGTH) expr = expr.substring(0, TRUNCATED_AWAIT_EXPR_LENGTH) + TRUNCATION_SUFFIX;
        return 'await ' + expr;
      }
    }
    return 'await (line ' + loc.line + ')';
  }

  // --- async_hooks for native await/Promise tracking ---
  const _trackedAsyncIds = new Map();
  const _thenPatchedAsyncIds = new Set();

  /**
   * Returns user-code caller info by walking the stack, skipping frames from
   * this module, node internals, and node_modules.
   * @returns {{ file: string, line: number, fnName: string | undefined } | undefined}
   */
  function getUserCallerFromStack() {
    const stack = getRawStack();
    if (!stack) return undefined;
    const frames = stack.split('\n');
    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i];
      if (frame.includes(_ownDir) || frame.includes('node:') || frame.includes(_nodeModules)) continue;
      if (frame.includes('async_hooks')) continue;
      const parsed = parseFrame(frame);
      if (parsed) return parsed;
    }
    return undefined;
  }

  const _asyncHook = async_hooks.createHook({
    init(asyncId, type) {
      if (type !== 'PROMISE') return;
      if (eventCapReached) return;

      const execId = async_hooks.executionAsyncId();
      if (_thenPatchedAsyncIds.has(execId)) return;

      const loc = getUserCallerFromStack();
      if (!loc) return;

      if (focusFile && !isFocusFile(loc.file) && insideFocusCallback <= 0) return;

      const external = focusFile ? !isFocusFile(loc.file) : false;

      const label = buildAwaitLabel(loc);

      // Defer emission — store candidate info; only emit ENQUEUE + CALLBACK
      // when `before` fires, so intermediate V8 promises don't produce noise.
      _trackedAsyncIds.set(asyncId, { loc, external, label, emitted: false });
    },

    before(asyncId) {
      const tracked = _trackedAsyncIds.get(asyncId);
      if (!tracked) return;

      if (!tracked.emitted) {
        tracked.taskId = seq;
        tracked.emitted = true;
        emit({
          type: 'ENQUEUE_MICRO',
          label: tracked.label,
          taskId: tracked.taskId,
          kind: 'micro',
          subtype: 'promise',
          file: tracked.loc.file,
          line: tracked.loc.line,
          external: tracked.external || undefined,
        });
      }

      if (focusFile) insideFocusCallback++;
      emit({
        type: 'CALLBACK_START',
        label: tracked.label,
        taskId: tracked.taskId,
        kind: 'micro',
        subtype: 'promise',
        file: tracked.loc.file,
        line: tracked.loc.line,
        external: tracked.external || undefined,
      });
    },

    after(asyncId) {
      _thenPatchedAsyncIds.delete(asyncId);
      const tracked = _trackedAsyncIds.get(asyncId);
      if (!tracked || !tracked.emitted) return;
      emit({
        type: 'CALLBACK_END',
        taskId: tracked.taskId,
        kind: 'micro',
        subtype: 'promise',
      });
      if (focusFile) insideFocusCallback--;
      _trackedAsyncIds.delete(asyncId);
    },
  });

  _asyncHook.enable();

  // --- Promise.prototype.then ---
  let microId = 0;

  const alreadyPatched = /** @type {any} */ (Promise.prototype.then).__elvPatched;

  if (!alreadyPatched) {
  Promise.prototype.then = function __elvThen(onFulfilled, onRejected) {
    const hasFulfilled = typeof onFulfilled === 'function';
    const hasRejected = typeof onRejected === 'function';

    if (!hasFulfilled && !hasRejected) {
      return _then.call(this, onFulfilled, onRejected);
    }

    const { loc, skip, external, focusLine } = checkCall();
    if (skip) {
      return _then.call(this, onFulfilled, onRejected);
    }

    const id = microId++;
    const primaryFn = hasFulfilled ? onFulfilled : onRejected;
    const fallback = 'Promise.then(#' + id + ')';
    const label = getLabel(primaryFn, fallback);

    if (filterNoise && label === fallback) {
      return _then.call(this, onFulfilled, onRejected);
    }
    const taskId = seq;

    _thenPatchedAsyncIds.add(async_hooks.executionAsyncId());

    emit({
      type: 'ENQUEUE_MICRO',
      label: label,
      taskId: taskId,
      kind: 'micro',
      subtype: 'promise',
      file: loc && loc.file,
      line: loc && loc.line,
      external: external || undefined,
      focusLine: focusLine,
    });

    const wrappedFulfilled = hasFulfilled
      ? function __elvFulfilled(value) {
          if (focusFile) insideFocusCallback++;
          emit({ type: 'CALLBACK_START', label: label, taskId: taskId, kind: 'micro', subtype: 'promise', file: loc && loc.file, line: loc && loc.line, external: external || undefined, focusLine: focusLine });
          try {
            return onFulfilled(value);
          } catch (err) {
            emit({ type: 'ERROR', value: err && err.message || String(err) });
            throw err;
          } finally {
            emit({ type: 'CALLBACK_END', taskId: taskId, kind: 'micro', subtype: 'promise' });
            if (focusFile) insideFocusCallback--;
          }
        }
      : onFulfilled;

    const wrappedRejected = hasRejected
      ? function __elvRejected(reason) {
          if (focusFile) insideFocusCallback++;
          if (!hasFulfilled) {
            emit({ type: 'CALLBACK_START', label: label, taskId: taskId, kind: 'micro', subtype: 'promise', file: loc && loc.file, line: loc && loc.line, external: external || undefined, focusLine: focusLine });
          }
          try {
            return onRejected(reason);
          } catch (err) {
            emit({ type: 'ERROR', value: err && err.message || String(err) });
            throw err;
          } finally {
            if (!hasFulfilled) {
              emit({ type: 'CALLBACK_END', taskId: taskId, kind: 'micro', subtype: 'promise' });
            }
            if (focusFile) insideFocusCallback--;
          }
        }
      : onRejected;

    return _then.call(this, wrappedFulfilled, wrappedRejected);
  };

  /** @type {any} */ (Promise.prototype.then).__elvPatched = true;

  // --- Promise.prototype.catch ---
  Promise.prototype.catch = function __elvCatch(onRejected) {
    return this.then(undefined, onRejected);
  };
  } // end if (!alreadyPatched)

  // --- console methods ---
  if (target.console) {
    for (const method of CONSOLE_METHODS) {
      const orig = _consoleMethods[method];
      target.console[method] = function __elvConsole(...consoleArgs) {
        const { loc, skip, external, focusLine } = checkCall();
        if (!skip) {
          const value = consoleArgs.map(a => {
            if (typeof a === 'string') return a;
            try { return JSON.stringify(a); } catch { return String(a); }
          }).join(' ');
          emit({ type: 'LOG', value: value, subtype: method, file: loc && loc.file, line: loc && loc.line, external: external || undefined, focusLine: focusLine });
        }
        if (mode !== 'file') {
          orig.apply(target.console, consoleArgs);
        }
      };
    }
  }

  /**
   * Resolves the actual source line/file from the call stack, falling back to
   * the hardcoded values from transform time.
   */
  function resolveCallSite(line, file) {
    let resolvedLine = line;
    let resolvedFile = file || undefined;
    const stack = getRawStack();
    if (stack) {
      const frames = stack.split('\n');
      for (let i = 1; i < frames.length; i++) {
        const frame = frames[i];
        if (frame.includes(_ownDir) || frame.includes('node:')) continue;
        const parsed = parseFrame(frame);
        if (parsed) {
          resolvedLine = parsed.line;
          resolvedFile = parsed.file;
          break;
        }
      }
    }
    return { line: resolvedLine, file: resolvedFile };
  }

  // --- __elvTrack (variable tracking for memory panel) ---
  target.__elvTrack = function __elvTrack(name, value, line, file) {
    // Filter out coverage tool variables: Istanbul (cov_, __coverage),
    // NYC (gcv, actualCoverage), V8/c8 (coverageData)
    if (/^(cov_|__coverage|gcv$|actualCoverage$|coverageData$)/.test(name)) return;
    const site = resolveCallSite(line, file);
    emit({ type: 'MEMORY', label: name, value: safeSerialize(value), line: site.line, file: site.file });
  };

  // --- __elvStep (sync call expression tracking) ---
  target.__elvStep = function __elvStep(line, label, file) {
    const site = resolveCallSite(line, file);
    emit({ type: 'SYNC_STEP', label: label || '', line: site.line, file: site.file });
  };

  /** @returns {void} */
  function restore() {
    _asyncHook.disable();
    _trackedAsyncIds.clear();
    _thenPatchedAsyncIds.clear();
    target.setTimeout = _setTimeout;
    target.setInterval = _setInterval;
    if (_setImmediate) target.setImmediate = _setImmediate;
    if (_queueMicrotask) target.queueMicrotask = _queueMicrotask;
    if (_nextTick) {
      const proc = target.process || process;
      proc.nextTick = _nextTick;
    }
    if (!alreadyPatched) {
      Promise.prototype.then = _then;
      Promise.prototype.catch = _catch;
    }
    if (target.console) {
      for (const method of CONSOLE_METHODS) {
        target.console[method] = _consoleMethods[method];
      }
    }
    delete target.__elvTrack;
    delete target.__elvStep;
  }

  return {
    events,
    emit,
    getState,
    restore,
    originals: {
      setTimeout: _setTimeout,
      clearTimeout: _clearTimeout,
      setInterval: _setInterval,
      clearInterval: _clearInterval,
      setImmediate: _setImmediate,
      queueMicrotask: _queueMicrotask,
      nextTick: _nextTick,
    },
  };
}

module.exports = { createInstrumenter, safeSerialize };
