import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installWorkspaceTiming, summarizeWorkspaceTiming } from './workspace-timing.mjs';

test('request identities correlate timings and concurrent backend intervals count once', () => {
  const phase = { name: 'workspace', start: 100, action: 110, ready: 200, painted: 230, observed: 250 };
  const call = (/** @type {string} */ request) => ({ command: 'open_project_session', request, start: 120, response: 180, audited: 185 });
  const native = (/** @type {string} */ request, /** @type {number} */ start, /** @type {number} */ duration, cat = 'backend') => ({
    name: 'open_project_session',
    cat,
    ts: start * 1000,
    dur: duration * 1000,
    args: { request },
  });
  const result = summarizeWorkspaceTiming(
    [phase],
    [call('a'), call('b'), call('missing')],
    [native('b', 140, 30), native('a', 125, 30), native('a', 130, 20, 'stage'), native('later', 300, 10, 'stage')],
  );
  assert.deepEqual(
    result.commands.map((call) => call.backendMs),
    [30, 30, null],
  );
  assert.deepEqual(
    result.commands.map((call) => call.deliveryMs),
    [30, 30, null],
  );
  assert.equal(result.commands[0]?.auditBodyMs, 5);
  assert.equal(result.stages.length, 1);
  assert.deepEqual(result.metrics, {
    'workspace.actionDelay': 10,
    'workspace.actionToPaint': 120,
    'workspace.responseToState': 20,
    'workspace.paintFrames': 30,
    'workspace.driverObservation': 20,
    'workspace.backendBusy': 45,
  });
});

test('page readiness precedes driver observation and releases frame and click observers', () => {
  const original = new Map(
    ['window', 'document', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  /** @type {Map<number,()=>void>} */
  const frames = new Map();
  /** @type {Set<()=>void>} */
  const listeners = new Set();
  let clock = 0,
    sequence = 0,
    ready = false;
  try {
    for (const [key, value] of Object.entries({
      window: {},
      document: {
        addEventListener: (/** @type {string} */ _name, /** @type {()=>void} */ listener) => listeners.add(listener),
        removeEventListener: (/** @type {string} */ _name, /** @type {()=>void} */ listener) => listeners.delete(listener),
      },
      performance: { timeOrigin: 1000, now: () => clock },
      requestAnimationFrame: (/** @type {()=>void} */ callback) => {
        frames.set(++sequence, callback);
        return sequence;
      },
      cancelAnimationFrame: (/** @type {number} */ id) => frames.delete(id),
    }))
      Object.defineProperty(globalThis, key, { value, configurable: true });
    installWorkspaceTiming();
    const timing = Reflect.get(globalThis.window, '__openingTiming');
    timing.begin('directory', () => ready);
    clock = 10;
    for (const listener of listeners) listener();
    ready = true;
    for (clock = 20; clock <= 40; clock += 10) {
      const batch = [...frames.values()];
      frames.clear();
      for (const frame of batch) frame();
    }
    clock = 100;
    assert.deepEqual(timing.finish('directory'), {
      name: 'directory',
      start: 1000,
      action: 1010,
      ready: 1020,
      painted: 1040,
      observed: 1100,
    });
    timing.begin('pending', () => false);
    timing.stop();
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
