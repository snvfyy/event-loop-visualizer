import chalk from 'chalk';
import fs from 'node:fs';
import { truncateAnsi } from './ansi-utils.mjs';

const _realPathCache = new Map();

/**
 * Compares two file paths, handling symlinks (e.g. macOS /tmp vs /private/tmp).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function pathsMatch(a, b) {
  if (a === b) return true;
  try {
    if (!_realPathCache.has(a)) _realPathCache.set(a, fs.realpathSync(a));
    if (!_realPathCache.has(b)) _realPathCache.set(b, fs.realpathSync(b));
    return _realPathCache.get(a) === _realPathCache.get(b);
  } catch (_) {
    return a.endsWith(b) || b.endsWith(a);
  }
}

export function getTypeIcon(val) {
  if (val === 'undefined' || val === 'null') return chalk.gray('\u2205');
  if (val === 'true' || val === 'false') return chalk.blue('\u25C6');
  if (!isNaN(Number(val))) return chalk.magenta('#');
  if (val.startsWith('"') || val.startsWith("'") || val.startsWith('`')) return chalk.yellow('\u201C');
  if (val.startsWith('[')) return chalk.cyan('\u2395');
  if (val.startsWith('{')) return chalk.green('\u2687');
  if (val.startsWith('function') || val.includes('=>')) return chalk.red('\u0192');
  return chalk.gray('\u2022');
}

export function getTaskBadge(label) {
  if (label.includes('Promise') || label.includes('then') || label.includes('await')) return chalk.cyan('\u25CF');
  if (label.includes('setTimeout')) return chalk.redBright('\u25D4');
  if (label.includes('setInterval')) return chalk.redBright('\u25D1');
  if (label.includes('queueMicrotask')) return chalk.cyan('\u25CB');
  if (label.includes('nextTick')) return chalk.magenta('\u25C8');
  return chalk.gray('\u25AA');
}

export function sliceContent(lines, panelIdx, contentH, contentW, scrollOffsetsRef) {
  if (contentH <= 0) return [];
  const maxOffset = Math.max(0, lines.length - contentH);
  const offset = Math.min(scrollOffsetsRef.current[panelIdx], maxOffset);
  scrollOffsetsRef.current[panelIdx] = Math.max(0, offset);
  const sliced = lines.slice(offset, offset + contentH);
  return contentW > 0 ? sliced.map(l => truncateAnsi(l, contentW)) : sliced;
}

/**
 * Render a text-based progress bar showing current position in the event stream.
 * Returns a plain string (not a React element).
 */
export function renderProgressBar({ current, total, width, phaseColor }) {
  const barWidth = Math.max(10, width - 12);
  const progress = total > 0 ? Math.min(1, Math.max(0, (current + 1) / total)) : 0;
  const filled = Math.round(progress * barWidth);
  const empty = barWidth - filled;

  const filledBar = chalk[phaseColor || 'cyan']('\u2588'.repeat(filled));
  const emptyBar = chalk.gray('\u2591'.repeat(empty));
  const percentage = Math.round(progress * 100);

  return chalk.gray('[') + filledBar + emptyBar + chalk.gray(']') + ' ' +
         chalk.bold(String(percentage).padStart(3, ' ') + '%');
}
