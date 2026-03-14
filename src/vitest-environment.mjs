import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createInstrumenter } = require('./instrument.js');
const { writeEventFile } = require('./write-events.js');

export default {
  name: 'elv-node',
  viteEnvironment: 'ssr',

  async setup(global) {
    const outputDir = process.env.ELV_OUTPUT_DIR;
    let instrumenter = null;
    if (outputDir) {
      instrumenter = createInstrumenter(global, { mode: 'vitest', focusFile: process.env.ELV_FOCUS_FILE || null });
      instrumenter.emit({ type: 'SYNC_START', label: 'vitest-worker ' + process.pid });
      global.__elvInstrumenter = instrumenter;
    }

    return {
      teardown() {
        if (instrumenter && outputDir) {
          instrumenter.emit({ type: 'SYNC_END' });
          instrumenter.emit({ type: 'DONE' });
          try {
            writeEventFile(outputDir, 'vitest-', instrumenter.events, 'vitest');
          } catch (_) {}
        }
      },
    };
  },
};
