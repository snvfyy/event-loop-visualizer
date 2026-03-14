'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Writes captured event data to a JSON file in the output directory.
 * Centralizes the event-writing pattern used by preload, jest-environment,
 * vitest-environment, and vitest-setup.
 *
 * @param {string} outputDir - Directory to write the event file into
 * @param {string} prefix - File prefix after 'events-' (e.g. '', 'jest-', 'vitest-')
 * @param {Array<import('./types').ElvEvent>} events
 * @param {string} [label] - Optional label (e.g. 'jest-worker', 'vitest')
 */
function writeEventFile(outputDir, prefix, events, label) {
  const payload = {
    pid: process.pid,
    argv: process.argv,
  };
  if (label) payload.label = label;
  payload.events = events;
  fs.writeFileSync(
    path.join(outputDir, 'events-' + prefix + process.pid + '.json'),
    JSON.stringify(payload)
  );
}

module.exports = { writeEventFile };
