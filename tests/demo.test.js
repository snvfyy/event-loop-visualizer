// Visualize this test with: elv vitest run tests/demo.test.js
//
// Each it() block exercises a different async pattern.
// Step through with the TUI to see how the event loop processes them.
// Use n/N to jump between tests.

import { it, expect } from 'vitest';

it('microtasks drain before macrotasks', () => {
  let step = 'init';

  setTimeout(() => { step = 'timeout'; }, 0);
  Promise.resolve().then(() => { step = 'promise'; });
  queueMicrotask(() => { step = 'microtask'; });
  step = 'sync';

  return new Promise((resolve) => {
    setTimeout(() => {
      expect(step).toBe('timeout');
      resolve();
    }, 50);
  });
});

it('await resumes as a microtask', async () => {
  let phase = 'start';

  phase = 'before await';
  await Promise.resolve();
  phase = 'after await';

  expect(phase).toBe('after await');
});

it('nested microtasks run before the next macrotask', () => {
  let depth = 0;

  setTimeout(() => { depth = -1; }, 0);
  Promise.resolve()
    .then(() => { depth = 1; return Promise.resolve(); })
    .then(() => { depth = 2; });

  return new Promise((resolve) => {
    setTimeout(() => {
      expect(depth).toBe(-1);
      resolve();
    }, 50);
  });
});
