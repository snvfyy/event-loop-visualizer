import { describe, it, expect } from 'vitest';
import { transformSource } from '../src/transform.js';

describe('transformSource', () => {
  it('injects tracking after a simple variable declaration', () => {
    const output = transformSource('const x = 1;');
    expect(output).toContain('__elvTrack');
    expect(output).toContain('"x"');
  });

  it('tracks multiple declarations on one line', () => {
    const output = transformSource('const a = 1, b = 2;');
    expect(output).toContain('"a"');
    expect(output).toContain('"b"');
  });

  it('tracks object destructuring', () => {
    const output = transformSource('const { a, b } = obj;');
    expect(output).toContain('"a"');
    expect(output).toContain('"b"');
  });

  it('tracks array destructuring', () => {
    const output = transformSource('const [x, y] = arr;');
    expect(output).toContain('"x"');
    expect(output).toContain('"y"');
  });

  it('tracks assignment expressions', () => {
    const output = transformSource('let x = 0;\nx = 5;');
    const matches = output.match(/__elvTrack/g);
    expect(matches.length).toBe(2);
  });

  it('tracks update expressions', () => {
    const output = transformSource('let i = 0;\ni++;');
    const matches = output.match(/__elvTrack/g);
    expect(matches.length).toBe(2);
  });

  it('tracks for-loop init variables', () => {
    const output = transformSource('for (let i = 0; i < 3; i++) { console.log(i); }');
    expect(output).toContain('"i"');
  });

  it('tracks for-of loop variables', () => {
    const output = transformSource('for (const item of list) { console.log(item); }');
    expect(output).toContain('"item"');
  });

  it('tracks function parameters', () => {
    const output = transformSource('function greet(name) { return name; }');
    expect(output).toContain('"name"');
  });

  it('tracks arrow function parameters', () => {
    const output = transformSource('const fn = (a, b) => { return a + b; };');
    expect(output).toContain('"a"');
    expect(output).toContain('"b"');
  });

  it('does not track declarations without initializers', () => {
    const output = transformSource('let x;');
    expect(output).not.toContain('__elvTrack');
  });

  it('returns source unchanged for unparseable code', () => {
    const input = 'this is not valid js %%%';
    expect(transformSource(input)).toBe(input);
  });

  it('returns source unchanged when there is nothing to track', () => {
    const input = 'console.log("hello");';
    expect(transformSource(input)).toBe(input);
  });

  it('produces valid JS that can be evaluated', () => {
    const output = transformSource('var x = 1;\nvar y = x + 2;');
    globalThis.__elvTrack = () => {};
    try {
      expect(() => new Function(output)()).not.toThrow();
    } finally {
      delete globalThis.__elvTrack;
    }
  });

  it('injects __elvStep for call expression statements', () => {
    const output = transformSource('expect(x).toBe(1);');
    expect(output).toContain('__elvStep');
    expect(output).toContain('expect(x).toBe(1)');
  });

  it('does not inject __elvStep for console calls', () => {
    const output = transformSource('console.log("hi");\nconsole.warn("w");');
    expect(output).not.toContain('__elvStep');
  });

  it('does not inject __elvStep for assignment expressions', () => {
    const output = transformSource('let x = 0;\nx = 5;');
    expect(output).not.toContain('__elvStep');
  });

  it('does not inject __elvStep for await expressions', () => {
    const output = transformSource('async function f() { await fetch("/api"); }');
    expect(output).not.toContain('__elvStep');
  });

  it('does not duplicate __elvStep on lines with __elvTrack', () => {
    const output = transformSource('const x = getValue();\nexpect(x).toBe(1);');
    expect(output).toContain('__elvTrack');
    expect(output).toContain('__elvStep');
    const trackLine = output.match(/__elvTrack\([^,]+,[^,]+,\s*(\d+)/);
    const stepLine = output.match(/__elvStep\((\d+)/);
    expect(trackLine[1]).not.toBe(stepLine[1]);
  });

  it('produces valid JS with __elvStep that can be evaluated', () => {
    const output = transformSource('var x = 1;\nfoo(x);');
    globalThis.__elvTrack = () => {};
    globalThis.__elvStep = () => {};
    try {
      globalThis.foo = () => {};
      expect(() => new Function(output)()).not.toThrow();
    } finally {
      delete globalThis.__elvTrack;
      delete globalThis.__elvStep;
      delete globalThis.foo;
    }
  });
});
