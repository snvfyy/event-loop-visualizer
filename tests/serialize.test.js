import { describe, it, expect } from 'vitest';
import { safeSerialize } from '../src/instrument.js';

describe('safeSerialize', () => {
  it('serializes primitives', () => {
    expect(safeSerialize(null)).toBe('null');
    expect(safeSerialize(undefined)).toBe('undefined');
    expect(safeSerialize(true)).toBe('true');
    expect(safeSerialize(42)).toBe('42');
    expect(safeSerialize(3.14)).toBe('3.14');
    expect(safeSerialize('hello')).toBe('"hello"');
  });

  it('serializes symbols', () => {
    expect(safeSerialize(Symbol('test'))).toBe('Symbol(test)');
  });

  it('serializes functions', () => {
    expect(safeSerialize(function myFn() {})).toBe('[Function: myFn]');
    expect(safeSerialize(() => {})).toBe('[Function]');
  });

  it('serializes plain objects with own keys', () => {
    const result = safeSerialize({ a: 1, b: 'two' });
    expect(result).toBe('{ a: 1, b: "two" }');
  });

  it('serializes empty plain objects as {}', () => {
    expect(safeSerialize({})).toBe('{}');
  });

  it('serializes arrays', () => {
    expect(safeSerialize([1, 2, 3])).toBe('[1, 2, 3]');
    expect(safeSerialize([])).toBe('[]');
  });

  it('serializes Maps', () => {
    const m = new Map([['key', 'value'], [42, true]]);
    const result = safeSerialize(m);
    expect(result).toContain('Map(2)');
    expect(result).toContain('"key" => "value"');
    expect(result).toContain('42 => true');
  });

  it('serializes Sets', () => {
    const s = new Set([1, 'two', true]);
    const result = safeSerialize(s);
    expect(result).toContain('Set(3)');
    expect(result).toContain('1');
    expect(result).toContain('"two"');
    expect(result).toContain('true');
  });

  it('serializes Dates as ISO strings', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(safeSerialize(d)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('serializes RegExp', () => {
    expect(safeSerialize(/test/gi)).toBe('/test/gi');
  });

  it('serializes Errors', () => {
    const e = new TypeError('bad input');
    expect(safeSerialize(e)).toBe('TypeError: bad input');
  });

  it('serializes Promises', () => {
    expect(safeSerialize(Promise.resolve())).toBe('Promise {}');
  });

  it('serializes built-in objects with prototype getters', () => {
    const url = new URL('https://example.com/path');
    const result = safeSerialize(url);
    expect(result).toContain('URL');
    expect(result).toContain('href');
    expect(result).toContain('https://example.com/path');
  });

  it('handles circular references', () => {
    const obj = { a: 1 };
    obj.self = obj;
    const result = safeSerialize(obj);
    expect(result).toContain('[Circular]');
    expect(result).toContain('a: 1');
  });

  it('truncates long strings', () => {
    const long = 'x'.repeat(200);
    const result = safeSerialize(long);
    expect(result).toContain('...');
    expect(result.length).toBeLessThan(200);
  });

  it('truncates large arrays', () => {
    const arr = Array.from({ length: 20 }, (_, i) => i);
    const result = safeSerialize(arr);
    expect(result).toContain('...');
  });

  it('truncates objects with many keys', () => {
    const obj = {};
    for (let i = 0; i < 20; i++) obj['k' + i] = i;
    const result = safeSerialize(obj);
    expect(result).toContain('...');
  });

  it('limits depth for nested objects', () => {
    const nested = { a: { b: { c: { d: 1 } } } };
    const result = safeSerialize(nested);
    expect(result).toContain('[Object]');
  });
});
