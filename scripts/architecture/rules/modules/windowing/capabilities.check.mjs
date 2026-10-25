import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';

import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
import { frontendLayerBoundaryRule } from '../../dependencies/frontend-layer-boundary.mjs';

const cases = [
  [
    'window-close-provider',
    'src/app/composables/use-app-lifecycle-assembly.ts',
    'src/app/composables/use-window-close-state.ts',
    'provideWindowCloseState',
  ],
  ['window-batch-begin', 'src/app/composables/use-app-lifecycle-assembly.ts', 'src/services/app-lifecycle.service.ts', 'requestClose'],
  [
    'window-batch-release',
    'src/app/composables/use-app-lifecycle-assembly.ts',
    'src/services/app-lifecycle.service.ts',
    'replyNativeClose',
  ],
  ['window-open', 'src/windows/managed.window.ts', 'src/services/window.service.ts', 'requestNativeWindow'],
  ['window-focus', 'src/orchestrators/window-target-focus.orchestrator.ts', 'src/services/window.service.ts', 'focusNativeManagedWindow'],
  ['window-status', 'src/app/composables/use-dirty-window-close-guard.ts', 'src/services/window.service.ts', 'updateNativeWindowStatus'],
  ['window-close-cancel', 'src/app/composables/use-app-lifecycle-assembly.ts', 'src/services/app-lifecycle.service.ts', 'readyNativeClose'],
  ['window-session-close', 'src/app/composables/use-app-lifecycle-assembly.ts', 'src/services/app-lifecycle.service.ts', 'requestClose'],
  ['window-reserve', 'src/orchestrators/entity-identity.orchestrator.ts', 'src/services/window.service.ts', 'reserveNativeWindowTargets'],
  ['window-release', 'src/orchestrators/csv-save.orchestrator.ts', 'src/services/window.service.ts', 'releaseNativeWindowTargets'],
  ['window-retarget', 'src/orchestrators/entity-identity.orchestrator.ts', 'src/services/window.service.ts', 'retargetNativeWindow'],
];

for (const [capability, from, target, name] of cases) {
  test(`${capability} is accepted at its formal owner`, () => {
    const source = `import { ${name} } from '@/${target.slice(4, -3)}';`;
    const files = architectureFixtures({
      [from]: from.endsWith('.vue') ? `<script setup>${source}</script><template><div /></template>` : source,
      [target]: `export function ${name}() {}`,
    });
    assert.deepEqual(messages(frontendLayerBoundaryRule.check(files)), []);
    assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
  });
  test(`${capability} is rejected from a window capability consumer`, () => {
    const files = architectureFixtures({
      'src/windows/audit.window.ts': `import { ${name} } from '@/${target.slice(4, -3)}';`,
      [target]: `export function ${name}() {}`,
    });
    assert.equal([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))].length, 1);
  });
}
