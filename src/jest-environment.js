'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** @type {new (config: any, context: any) => any} */
let BaseEnvironment;
const envCandidates = ['jest-environment-jsdom', 'jest-environment-node'];
for (const envName of envCandidates) {
  try {
    const resolved = require.resolve(envName, { paths: [process.cwd()] });
    const jestEnvModule = require(resolved);
    BaseEnvironment = jestEnvModule.TestEnvironment || jestEnvModule;
    break;
  } catch (_) {
    try {
      const jestEnvModule = require(envName);
      BaseEnvironment = jestEnvModule.TestEnvironment || jestEnvModule;
      break;
    } catch (__) {}
  }
}
if (!BaseEnvironment) {
  process.stderr.write('[elv] Could not load jest-environment-jsdom or jest-environment-node\n');
  process.exit(1);
}

const { createInstrumenter } = require('./instrument');
const { transformSource } = require('./transform');
const { writeEventFile } = require('./write-events');

const NODE_MODULES_SEG = path.sep + 'node_modules' + path.sep;

/**
 * Creates a filter function that returns true only for source files inside
 * the test project directory (the rootDir from Jest config).  This avoids
 * instrumenting shared setup scripts, config files, and other infrastructure.
 * @param {string | null} projectRoot
 * @returns {(filename: string | undefined) => boolean}
 */
function createUserCodeFilter(projectRoot) {
  return function isUserCodeFile(filename) {
    if (!filename) return false;
    if (filename.includes(NODE_MODULES_SEG)) return false;
    if (filename.startsWith('node:')) return false;
    if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(filename)) return false;
    if (projectRoot && !filename.startsWith(projectRoot)) return false;
    return true;
  };
}

class InstrumentedEnvironment extends BaseEnvironment {
  /** @type {string | undefined} */
  _elvOutputDir;
  /** @type {import('./types').InstrumenterResult | null} */
  _inst = null;
  /** @type {typeof vm.compileFunction | null} */
  _originalCompileFunction = null;
  /** @type {(filename: string | undefined) => boolean} */
  _isUserCodeFile;

  /**
   * @param {any} config
   * @param {any} context
   */
  constructor(config, context) {
    super(config, context);
    const projectRoot = (config.projectConfig && config.projectConfig.rootDir)
      || (config.globalConfig && config.globalConfig.rootDir)
      || null;
    this._isUserCodeFile = createUserCodeFilter(projectRoot);
    this._elvOutputDir = process.env.ELV_OUTPUT_DIR;
    if (this._elvOutputDir) {
      this._inst = createInstrumenter(this.global, { mode: 'jest', focusFile: process.env.ELV_FOCUS_FILE || null });
      this._inst.emit({ type: 'SYNC_START', label: 'jest-worker ' + process.pid });
      this._patchVmCompileFunction();
    }
  }

  /**
   * Monkey-patches vm.compileFunction (used by Jest 30+ to execute modules)
   * so that every user-code file goes through our acorn-based source transform
   * before execution.  By this point SWC/Babel has already stripped TypeScript,
   * so the code is vanilla JS that acorn can parse.
   */
  _patchVmCompileFunction() {
    const originalCompileFunction = vm.compileFunction;
    this._originalCompileFunction = originalCompileFunction;
    const isUserCode = this._isUserCodeFile;

    vm.compileFunction = function elvCompileFunction(code, params, options) {
      const filename = options && options.filename;
      if (typeof code === 'string' && isUserCode(filename)) {
        try {
          code = transformSource(code, filename);
        } catch (_) {
          // acorn parse failure — fall back to untransformed code
        }
      }
      return originalCompileFunction.call(this, code, params, options);
    };
  }

  /**
   * @param {any} test
   * @returns {string}
   */
  _getTestPath(test) {
    const parts = [];
    let current = test;
    const seen = new Set();
    while (current && !seen.has(current)) {
      seen.add(current);
      if (current.name && current.name !== 'ROOT_DESCRIBE_BLOCK') {
        parts.unshift(current.name);
      }
      current = current.parent;
    }
    return parts.join(' \u203A ');
  }

  /** @param {{ name: string, test?: any }} event */
  handleTestEvent(event) {
    if (!this._inst) return;
    const test = event.test;
    if (!test || !test.name) return;
    if (event.name === 'test_start') {
      this._inst.emit({ type: 'TEST_START', label: this._getTestPath(test) });
    } else if (event.name === 'test_done') {
      const passed = !test.errors || test.errors.length === 0;
      this._inst.emit({ type: 'TEST_END', label: test.name, value: passed ? 'pass' : 'fail' });
    }
  }

  async teardown() {
    if (this._originalCompileFunction) {
      vm.compileFunction = this._originalCompileFunction;
      this._originalCompileFunction = null;
    }

    if (this._inst && this._elvOutputDir) {
      this._inst.emit({ type: 'SYNC_END' });
      this._inst.emit({ type: 'DONE' });
      try {
        writeEventFile(this._elvOutputDir, 'jest-', this._inst.events, 'jest-worker');
      } catch (_) {}
    }
    return super.teardown();
  }
}

module.exports = InstrumentedEnvironment;
module.exports.TestEnvironment = InstrumentedEnvironment;
module.exports.default = InstrumentedEnvironment;
