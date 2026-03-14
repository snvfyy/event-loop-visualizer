import { describe, it, expect } from 'vitest';
import { applyEvent, createInitialState, pathsMatch, escapeBlessed } from '../src/ui.js';

describe('escapeBlessed', () => {
  it('returns the string unchanged when no braces are present', () => {
    expect(escapeBlessed('hello world')).toBe('hello world');
  });

  it('wraps strings containing { in escape tags', () => {
    expect(escapeBlessed('obj = { a: 1 }')).toBe('{escape}obj = { a: 1 }{/escape}');
  });

  it('wraps strings containing } in escape tags', () => {
    expect(escapeBlessed('end }')).toBe('{escape}end }{/escape}');
  });

  it('coerces non-string values', () => {
    expect(escapeBlessed(42)).toBe('42');
    expect(escapeBlessed(null)).toBe('null');
  });
});

describe('createInitialState', () => {
  it('returns a fresh state with empty queues', () => {
    const state = createInitialState();
    expect(state.callStack).toEqual([]);
    expect(state.microQueue).toEqual([]);
    expect(state.macroQueue).toEqual([]);
    expect(state.console).toEqual([]);
    expect(state.log).toEqual([]);
    expect(state.phase).toBe('Ready');
    expect(state.memory.size).toBe(0);
    expect(state.currentTest).toBeNull();
  });

  it('returns independent instances', () => {
    const a = createInitialState();
    const b = createInitialState();
    a.callStack.push('test');
    expect(b.callStack).toEqual([]);
  });
});

describe('pathsMatch', () => {
  it('returns true for identical paths', () => {
    expect(pathsMatch('/a/b/c.js', '/a/b/c.js')).toBe(true);
  });

  it('returns false for different paths', () => {
    expect(pathsMatch('/a/b/c.js', '/a/b/d.js')).toBe(false);
  });
});

describe('applyEvent', () => {
  it('handles SYNC_START', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'SYNC_START', ts: 1000, label: 'test' });
    expect(state.callStack).toEqual(['<script> test']);
    expect(state.phase).toBe('Synchronous');
    expect(state.startTs).toBe(1000);
    expect(state.log.length).toBe(1);
  });

  it('handles SYNC_END', () => {
    const state = createInitialState();
    state.callStack.push('<script>');
    applyEvent(state, { type: 'SYNC_END', ts: 2000 });
    expect(state.callStack).toEqual([]);
    expect(state.phase).toBe('Sync Complete');
  });

  it('handles LOG events', () => {
    const state = createInitialState();
    state.prevTs = 1000;
    applyEvent(state, { type: 'LOG', value: 'hello', ts: 1001 });
    expect(state.console).toEqual(['> hello']);
    expect(state.log.length).toBe(1);
    expect(state.log[0]).toContain('hello');
  });

  it('handles ENQUEUE_MACRO', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'ENQUEUE_MACRO', label: 'setTimeout(fn, 0)', taskId: 1, ts: 1000 });
    expect(state.macroQueue).toEqual([{ label: 'setTimeout(fn, 0)', taskId: 1 }]);
    expect(state.log[0]).toContain('Macrotask Queue');
  });

  it('handles ENQUEUE_MICRO', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'ENQUEUE_MICRO', label: '.then(cb)', taskId: 2, ts: 1000 });
    expect(state.microQueue).toEqual([{ label: '.then(cb)', taskId: 2 }]);
    expect(state.log[0]).toContain('Microtask Queue');
  });

  it('handles CALLBACK_START for microtask', () => {
    const state = createInitialState();
    state.microQueue.push({ label: '.then(cb)', taskId: 2 });
    applyEvent(state, { type: 'CALLBACK_START', label: '.then(cb)', taskId: 2, kind: 'micro', ts: 1000 });
    expect(state.microQueue).toEqual([]);
    expect(state.callStack).toEqual(['.then(cb)']);
    expect(state.phase).toBe('Microtasks');
  });

  it('handles CALLBACK_START for macrotask', () => {
    const state = createInitialState();
    state.macroQueue.push({ label: 'setTimeout(fn)', taskId: 3 });
    applyEvent(state, { type: 'CALLBACK_START', label: 'setTimeout(fn)', taskId: 3, kind: 'macro', ts: 1000 });
    expect(state.macroQueue).toEqual([]);
    expect(state.callStack).toEqual(['setTimeout(fn)']);
    expect(state.phase).toBe('Macrotasks');
  });

  it('handles CALLBACK_END', () => {
    const state = createInitialState();
    state.callStack.push('fn');
    applyEvent(state, { type: 'CALLBACK_END' });
    expect(state.callStack).toEqual([]);
  });

  it('handles CALLBACK_END on empty stack gracefully', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'CALLBACK_END' });
    expect(state.callStack).toEqual([]);
  });

  it('handles ERROR', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'ERROR', value: 'oops', ts: 1000 });
    expect(state.log[0]).toContain('ERROR');
    expect(state.log[0]).toContain('oops');
  });

  it('handles MEMORY', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'MEMORY', label: 'x', value: '42', ts: 1000 });
    expect(state.memory.get('x')).toBe('42');
  });

  it('handles TEST_START', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'TEST_START', label: 'my test', ts: 1000 });
    expect(state.currentTest).toBe('my test');
    expect(state.phase).toBe('Synchronous');
    expect(state.callStack).toEqual([]);
  });

  it('handles TEST_END pass', () => {
    const state = createInitialState();
    state.currentTest = 'my test';
    applyEvent(state, { type: 'TEST_END', label: 'my test', value: 'pass', ts: 1000 });
    expect(state.currentTest).toBeNull();
    expect(state.log[0]).toContain('\u2713');
  });

  it('handles TEST_END fail', () => {
    const state = createInitialState();
    state.currentTest = 'my test';
    applyEvent(state, { type: 'TEST_END', label: 'my test', value: 'fail', ts: 1000 });
    expect(state.log[0]).toContain('\u2717');
  });

  it('handles DONE', () => {
    const state = createInitialState();
    state.callStack.push('something');
    applyEvent(state, { type: 'DONE', ts: 1000 });
    expect(state.phase).toBe('Complete');
    expect(state.callStack).toEqual([]);
  });

  it('escapes braces in log values', () => {
    const state = createInitialState();
    applyEvent(state, { type: 'LOG', value: '{ a: 1 }', ts: 1000 });
    expect(state.console[0]).toContain('{escape}');
  });
});
