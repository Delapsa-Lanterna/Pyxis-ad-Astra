import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';

import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
import { frontendLayerBoundaryRule } from '../../dependencies/frontend-layer-boundary.mjs';

const cases = [
  [
    'settings-close-flush',
    'src/app/composables/use-app-lifecycle-assembly.ts',
    'src/orchestrators/settings-persistence.orchestrator.ts',
    'flushSettings',
  ],
  [
    'system-fonts-read',
    'src/app/composables/settings/use-settings-view-model.ts',
    'src/services/app-settings.service.ts',
    'querySystemFonts',
  ],
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
