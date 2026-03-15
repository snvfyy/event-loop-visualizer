/**
 * Strip ANSI SGR escape codes from a string to get visible text only.
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Truncate a string containing ANSI codes to a maximum visible width.
 * Preserves escape sequences before the cut point and resets formatting after.
 * @param {string} str
 * @param {number} maxWidth
 * @returns {string}
 */
export function truncateAnsi(str, maxWidth) {
  if (maxWidth <= 0) return '';
  if (stripAnsi(str).length <= maxWidth) return str;

  const target = Math.max(0, maxWidth - 1);
  let visible = 0;
  let i = 0;

  while (i < str.length && visible < target) {
    if (str.charCodeAt(i) === 0x1b && i + 1 < str.length && str.charCodeAt(i + 1) === 0x5b) {
      const mIdx = str.indexOf('m', i + 2);
      if (mIdx !== -1) { i = mIdx + 1; continue; }
    }
    visible++;
    i++;
  }

  return str.slice(0, i) + '\x1b[0m\u2026';
}
