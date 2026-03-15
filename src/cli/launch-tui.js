'use strict';

const fs = require('fs');
const path = require('path');
const { extractSourceFromEvents } = require('./detect');

/**
 * @param {import('../types').ElvEvent[]} events
 * @param {string | null} sourcePath
 * @param {string | null} focusFile
 * @returns {Promise<void>}
 */
async function launchTUI(events, sourcePath, focusFile) {
  const { startTUI } = await import('../ui.mjs');
  const effectiveSource = sourcePath || extractSourceFromEvents(events);
  const primaryPath = focusFile || (effectiveSource ? path.resolve(effectiveSource) : null);
  let source = null;
  if (primaryPath) {
    try { source = fs.readFileSync(primaryPath, 'utf8'); } catch (_) {}
  }
  startTUI(events, source, primaryPath, focusFile);
}

module.exports = { launchTUI };
