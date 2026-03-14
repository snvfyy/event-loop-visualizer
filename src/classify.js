'use strict';

/**
 * Classifies a Node.js process by its argv to produce a human-readable label.
 * @param {string[]} argv
 * @param {string} [label] - Explicit label from the event file (e.g., 'jest-worker', 'vitest')
 * @returns {string}
 */
function classifyProcess(argv, label) {
  if (label === 'jest-worker') return '[JEST-TEST]';
  if (label === 'vitest') return '[VITEST-TEST]';
  if (!argv || !Array.isArray(argv)) return '[unknown]';
  const joined = argv.join(' ');

  if (joined.includes('jest-worker') || joined.includes('processChild')) return '[jest-worker]';
  if (argv.some(arg => arg.includes('/nx/bin/nx.js'))) return '[nx-cli]';
  if (joined.includes('plugin-worker')) return '[nx-plugin]';
  if (joined.includes('pnpm')) return '[pnpm]';
  if (joined.includes('vitest')) return '[vitest]';

  const script = argv[1] || '';
  if (script) {
    const base = script.split('/').pop().split('\\').pop();
    return '[' + base + ']';
  }

  return '[node]';
}

module.exports = { classifyProcess };
