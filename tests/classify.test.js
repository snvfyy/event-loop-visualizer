import { describe, it, expect } from 'vitest';
import { classifyProcess } from '../src/classify.js';

describe('classifyProcess', () => {
  it('returns [JEST-TEST] when label is jest-worker', () => {
    expect(classifyProcess([], 'jest-worker')).toBe('[JEST-TEST]');
  });

  it('returns [VITEST-TEST] when label is vitest', () => {
    expect(classifyProcess([], 'vitest')).toBe('[VITEST-TEST]');
  });

  it('returns [unknown] when argv is missing', () => {
    expect(classifyProcess(null)).toBe('[unknown]');
    expect(classifyProcess(undefined)).toBe('[unknown]');
  });

  it('detects jest-worker from argv', () => {
    expect(classifyProcess(['node', 'jest-worker/processChild.js'])).toBe('[jest-worker]');
  });

  it('detects nx cli from argv', () => {
    expect(classifyProcess(['node', '/path/to/nx/bin/nx.js', 'run', 'test'])).toBe('[nx-cli]');
  });

  it('detects pnpm from argv', () => {
    expect(classifyProcess(['node', 'pnpm', 'run', 'test'])).toBe('[pnpm]');
  });

  it('detects vitest from argv', () => {
    expect(classifyProcess(['node', '/path/to/vitest/bin'])).toBe('[vitest]');
  });

  it('falls back to script basename', () => {
    expect(classifyProcess(['node', '/app/server.js'])).toBe('[server.js]');
  });

  it('falls back to [node] when argv has no script', () => {
    expect(classifyProcess(['node', ''])).toBe('[node]');
  });
});
