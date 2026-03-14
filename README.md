# Event Loop Visualizer (`elv`)

**Step through JavaScript execution one event at a time.**

See exactly how the call stack, microtask queue, macrotask queue, and variables change at each step — right in your terminal.

```
┌────────────────── Header ───────────────────┐
│ Step 5/17   Phase: Microtasks   ▶ Playing   │
├─── Source Code ──┬─── Call Stack ───────────┤
│  1  console.log  │ ▶ Promise.then(fn)       │
│ [2  setTimeout]  ├── Micro Q ──┬─ Macro Q ──┤
│  3  ...          │ (empty)     │ 1. set...  │
├── Console Out ───┼─── Event Log ────────────┤
│ > start          │ ▶ Script started         │
│ > end            │ [T] → setTimeout(fn, 0)  │
├── Memory ────────┤                          │
│ count = 3        │ +1ms ▶ fn()              │
│ result = "ok"    │ +2ms [M] → .then(cb)     │
├─────────────────────────────────────────────┤
│ ←/→ Step ↑/↓ Scroll Tab Focus Space Play    │
└─────────────────────────────────────────────┘
```

---

## Why?

JavaScript's event loop is invisible. You can read about how `setTimeout`, `Promise.then`, and `await` schedule work — but you can't *see* it happening.

Web-based visualizers like [Loupe](http://latentflip.com/loupe/) and [JS Visualizer 9000](https://www.jsv9000.app/) are great for learning, but they only run toy snippets in the browser. `elv` runs **in your terminal**, against **your actual code** — real scripts, real tests, real projects.

- **Watch** microtasks and macrotasks enter their queues and drain in order
- **See** the call stack grow and shrink as callbacks execute
- **Track** variable values at every step in the Memory panel
- **Follow** `async/await` continuations as they resume via the microtask queue
- **Debug** Jest and Vitest tests with clear per-test boundaries

---

## Install

**Globally:**

```bash
npm install -g event-loop-visualizer
```

**As a dev dependency:**

```bash
npm install -D event-loop-visualizer
```

**Without installing:**

```bash
npx event-loop-visualizer examples/async-await.js
```

---

## Usage

### Standalone scripts

```bash
elv script.js
```

### Jest and Vitest tests

```bash
elv jest --testPathPatterns MyTest
elv vitest run src/utils.test.ts
```

`elv` automatically detects your package manager (pnpm/yarn/npx) from lock files, injects the test environment, instruments user-code, and filters out framework noise. Each `it()` / `test()` block gets a clear visual boundary in the TUI — use `n` / `N` to jump between tests.

### Any command

```bash
elv --cmd "node server.js"
elv --cmd "pnpm nx run my-project:test --skip-nx-cache"
```

### Focus mode

Narrow capture to a single file. Only events originating from (or passing through) the focused file are recorded — everything else is filtered out:

```bash
elv script.js --focus src/services/auth.js
elv jest --testPathPatterns MyTest --focus src/__tests__/MyTest.spec.ts
```

External calls are dimmed and tagged with `↪ filename` so you can trace the flow across files.

---

## TUI Controls

| Key         | Action                        |
| ----------- | ----------------------------- |
| `→` / `l`   | Step forward                  |
| `←` / `h`   | Step backward                 |
| `↑` / `k`   | Scroll focused panel up       |
| `↓` / `j`   | Scroll focused panel down     |
| `Tab`       | Cycle focus to next panel     |
| `Shift+Tab` | Cycle focus to previous panel |
| `Space`     | Toggle auto-play              |
| `+` / `=`   | Speed up (min 100ms)          |
| `-` / `_`   | Slow down (max 3000ms)        |
| `n`         | Jump to next test             |
| `N`         | Jump to previous test         |
| `r`         | Reset to beginning            |
| `q` / `Esc` | Quit                          |

The **Source** panel highlights the currently executing line and switches files automatically. The **Memory** panel tracks variable declarations, assignments, and function parameters in real time.

---

## Examples

The `examples/` directory has scripts that demonstrate core event loop concepts. Run any of them and step through interactively.

### async/await

```bash
elv examples/async-await.js
```

```js
async function fetchData() {
  console.log('1 - start');
  const result = await Promise.resolve('data');
  console.log('2 - after await: ' + result);
}
fetchData();
console.log('3 - sync after call');
// Output: 1 - start, 3 - sync after call, 2 - after await: data
```

Everything after `await` resumes as a **microtask**. Watch `"1 - start"` and `"3 - sync after call"` log during synchronous execution, then `"2 - after await: data"` fires when the microtask queue drains.

### Closure in a loop

```bash
elv examples/closure-loop.js
```

```js
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
// Output: 3, 3, 3
```

The classic `var` + `setTimeout` trap. Three callbacks are enqueued during the `for` loop, but by the time they execute, `i` is already `3`. Watch the macrotask queue fill during sync execution and drain afterward — the Memory panel shows `i = 3` for every callback.

### Microtask vs macrotask ordering

```bash
elv examples/nested-async.js
```

```js
console.log('1');
setTimeout(() => {
  console.log('5');
  Promise.resolve().then(() => console.log('6'));
}, 0);
Promise.resolve().then(() => {
  console.log('3');
  setTimeout(() => console.log('7'), 0);
});
Promise.resolve().then(() => console.log('4'));
console.log('2');
// Output: 1, 2, 3, 4, 5, 6, 7
```

Microtasks drain **completely** between each macrotask. Microtasks scheduled *inside* microtasks also run before the next macrotask. The output order becomes obvious when you watch the queues.

### Promise executor

```bash
elv examples/promise-executor.js
```

```js
console.log('1');
new Promise(resolve => {
  console.log('2 - executor is sync!');
  resolve();
}).then(() => console.log('4 - microtask'));
console.log('3');
// Output: 1, 2 - executor is sync!, 3, 4 - microtask
```

The `new Promise(executor)` callback runs **synchronously** — only the `.then()` callback is queued as a microtask.

---

## Limitations

| Limitation                      | Details                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pending promise timing**      | `.then(fn)` on a pending promise shows `fn` entering the queue immediately. In reality it's enqueued on resolve. Execution order is still correct. |
| **Jest fake timers**            | `jest.useFakeTimers()` replaces timers after elv's patches — timer events won't be captured. Promise + variable tracking still work.               |
| **TypeScript/JSX in file mode** | `elv script.ts` is not supported — TypeScript and JSX require a build step. Use `elv vitest run` or `elv jest` which handle TS/JSX natively.      |
| **TypeScript line numbers**     | In test mode, line numbers come from compiled JS. Minimal type annotations match perfectly; heavy generics/decorators may drift slightly.           |
| **setInterval cap**             | Capped at 10 iterations to prevent infinite events. Configurable via `ELV_INTERVAL_CAP`.                                                           |
| **Event cap**                   | 5000 events per process. Beyond this, a warning is shown. Configurable via `ELV_MAX_EVENTS`.                                                       |
| **Worker threads**              | `worker_threads` don't inherit `NODE_OPTIONS` — code in workers won't be instrumented.                                                             |
| **ESM in command mode**         | `.mjs` files loaded via `--cmd` aren't transformed (only `.js` and `.cjs` are hooked via `require`). Vitest/Jest modes handle ESM natively.        |
| **Windows**                     | Command mode uses `sh -c` which requires a POSIX shell. On Windows, use WSL or Git Bash.                                                           |
| **Bun / Deno**                  | Only Node.js is supported.                                                                                                                         |

---

## Environment Variables

| Variable           | Default | Description                                           |
| ------------------ | ------- | ----------------------------------------------------- |
| `ELV_TIMEOUT`      | `30000` | Safety timeout in ms for the `elv <script>` file mode |
| `ELV_MAX_EVENTS`   | `5000`  | Max events per process before capture stops           |
| `ELV_INTERVAL_CAP` | `10`    | Max `setInterval` iterations to record per interval   |

---

## How It Works

`elv` instruments your code using three layers:

1. **AST transform** — Acorn parses your source and injects `__elvTrack()` / `__elvStep()` calls after variable mutations and function calls, enabling the Memory and Sync Step panels.
2. **Global patching** — `setTimeout`, `setInterval`, `queueMicrotask`, `process.nextTick`, `Promise.prototype.then/catch`, and `console.*` are monkey-patched to emit events when callbacks are enqueued and executed.
3. **async_hooks** — Node's `async_hooks` API tracks native `await` / `Promise` continuations that don't go through `.then()` directly.

Events are collected into a JSON array, then replayed step-by-step in the ink TUI.

> **Note:** `async_hooks` is stability 1 (experimental) in Node.js. Promise tracking behavior may differ slightly across Node 18, 20, and 22. `elv` is tested against Node 18+ and works best with Node 20 or 22.

---

## Node.js Compatibility

| Version    | Status                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| Node 22    | Recommended. Full support.                                               |
| Node 20    | Full support.                                                            |
| Node 18    | Supported. Some `async_hooks` edge cases may produce extra/fewer events. |
| Node < 18  | Not supported.                                                           |

---

## Contributing

Contributions are welcome! Check out the [Contributing Guide](CONTRIBUTING.md) for setup instructions, project structure, and PR guidelines.

---

**MIT License** · by [Snvfyy](https://github.com/snvfyy)
