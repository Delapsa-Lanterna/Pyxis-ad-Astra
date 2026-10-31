import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { capabilityBoundaryRule } from './capability-boundary.mjs';

test('event transport stays at the actual notification consumers', () => {
  const provider = { 'src/shared/runtime/event.runtime.ts': 'export function listenAppEvent() {}' };
  for (const path of [
    'src/services/app-log.service.ts',
    'src/services/app-settings.service.ts',
    'src/windows/window-context.window.ts',
    'src/app/composables/use-dirty-window-close-guard.ts',
  ]) {
    const context = architectureFixtures({ ...provider, [path]: "import {listenAppEvent} from '@/shared/runtime/event.runtime';" });
    assert.deepEqual(capabilityBoundaryRule.check(context), []);
  }
  for (const path of ['src/services/sample.service.ts', 'src/windows/sample.window.ts', 'src/app/composables/use-sample.ts']) {
    const context = architectureFixtures({ ...provider, [path]: "import {listenAppEvent} from '@/shared/runtime/event.runtime';" });
    assert.equal(capabilityBoundaryRule.check(context).length, 1);
  }
});

test('event aliases and reexports retain the original capability boundary', () => {
  const context = architectureFixtures({
    'src/shared/runtime/event.runtime.ts': 'export function listenAppEvent() {}',
    'src/shared/runtime/sample.ts': "export {listenAppEvent as observe} from './event.runtime';",
    'src/windows/sample.window.ts': "import {observe as run} from '@/shared/runtime/sample'; run();",
  });
  const failures = capabilityBoundaryRule.check(context).filter((item) => item.file === 'src/windows/sample.window.ts');
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.equal(failures[0].symbol, 'listenAppEvent');
});

test('raw event listening belongs to the shared transport and keeps type imports available', () => {
  const context = architectureFixtures({
    'src/shared/runtime/event.runtime.ts':
      "import {listen} from '@tauri-apps/api/event'; export async function listenAppEvent() {return listen('sample', handler);}",
    'src/windows/current.window.ts': "import type {UnlistenFn} from '@tauri-apps/api/event';",
  });
  assert.deepEqual(capabilityBoundaryRule.check(context), []);
  const invalid = architectureFixtures({ 'src/windows/sample.window.ts': "import {listen as observe} from '@tauri-apps/api/event';" });
  const [diagnostic] = capabilityBoundaryRule.check(invalid);
  assert.ok(diagnostic);
  assert.equal(diagnostic.symbol, 'listen');
});
