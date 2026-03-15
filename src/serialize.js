'use strict';

const MAX_SERIALIZE_DEPTH = 2;
const MAX_ARRAY_ITEMS = 10;
const MAX_OBJ_KEYS = 10;
const MAX_STR_LEN = 80;
const STR_TRUNCATION_OVERHEAD = 5;

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

module.exports = { safeSerialize };
