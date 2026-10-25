import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';

import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
import { frontendLayerBoundaryRule } from '../../dependencies/frontend-layer-boundary.mjs';

const cases = [
  ['config-write', 'src/orchestrators/json-save.orchestrator.ts', 'src/services/json-entity.service.ts', 'saveModInfo'],
  ['definition-write', 'src/orchestrators/json-save.orchestrator.ts', 'src/services/json-file.service.ts', 'saveVariantEntity'],
  ['table-write', 'src/orchestrators/csv-save.orchestrator.ts', 'src/services/csv-table.service.ts', 'saveCsvPatch'],
  ['spec-write', 'src/services/spec-editor.service.ts', 'src/services/spec-editor.service.ts', 'saveSpecEditorSpec'],
  ['text-write', 'src/app/composables/use-file-editor-view-model.ts', 'src/services/files.service.ts', 'writeEditableFileText'],
  ['text-transcode', 'src/app/app-feedback-assembly.ts', 'src/services/files.service.ts', 'transcodeFileToUtf8'],
  [
    'history-replay',
    'src/orchestrators/file-history-replay.orchestrator.ts',
    'src/services/file-history.service.ts',
    'replayFileChangeSet',
  ],
  [
    'wing-joint-query',
    'src/app/composables/immersive-editor/wing/use-immersive-wing-editor.ts',
    'src/services/joint-edit.service.ts',
    'queryJointEditRow',
  ],
  [
    'variant-catalog-query',
    'src/app/composables/immersive-editor/variant/use-variant-catalog.ts',
    'src/services/joint-edit.service.ts',
    'queryJointVariantCatalog',
  ],
  [
    'variant-candidate-query',
    'src/app/composables/immersive-editor/variant/use-variant-candidate.ts',
    'src/services/joint-edit.service.ts',
    'queryJointEdit',
  ],
  ['ship-weapon-candidate', 'src/services/spec-ship-editor.service.ts', 'src/services/joint-edit.service.ts', 'queryJointCandidate'],
  [
    'ship-weapon-sources',
    'src/app/composables/spec-editor/ship/use-spec-ship-weapons.ts',
    'src/services/spec-ship-editor.service.ts',
    'querySpecShipWeaponSources',
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
