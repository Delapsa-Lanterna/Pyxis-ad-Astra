import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';

import { draftSessionBoundaryRule } from './draft-session-boundary.mjs';

test('flat edit-session primitives retain their declared adapter ownership', () => {
  const files = architectureFixtures({
    'src/domain/edit-session.ts': 'export function createEditSessionValue() {}',
    'src/app/composables/use-draft-session.ts': "import { createEditSessionValue } from '@/domain/edit-session';",
    'src/app/composables/use-snapshot-history.ts': "import { createEditSessionValue } from '@/domain/edit-session';",
    'src/app/composables/use-sample.ts': "import { createEditSessionValue } from '@/domain/edit-session';",
  });
  assert.equal(messages(draftSessionBoundaryRule.check(files)).length, 1);
});

for (const consumer of ['src/stores/save-command.store.ts', 'src/orchestrators/edit-target-handoff.orchestrator.ts']) {
  for (const imported of ['editTargetsOverlap', 'editTargetsOverlap as overlaps'])
    test(consumer + ' consumes only target comparison through ' + imported, () => {
      const files = architectureFixtures({
        [consumer]: `import { ${imported} } from '@/domain/edit-session';`,
        'src/domain/edit-session.ts': 'export function editTargetsOverlap() {}',
      });
      assert.deepEqual(messages(draftSessionBoundaryRule.check(files)), []);
    });
  for (const imported of [
    "import { createEditSessionValue } from '@/domain/edit-session';",
    "import { editTargetsOverlap, createEditSessionValue } from '@/domain/edit-session';",
    "import * as session from '@/domain/edit-session';",
    "const session = import('@/domain/edit-session');",
    "export * from '@/domain/edit-session';",
  ])
    test(consumer + ' retains primitive adapter boundaries for ' + imported, () => {
      const files = architectureFixtures({
        [consumer]: imported,
        'src/domain/edit-session.ts': 'export function editTargetsOverlap() {} export function createEditSessionValue() {}',
      });
      assert.equal(messages(draftSessionBoundaryRule.check(files)).length, 1);
    });
}

for (const consumer of ['src/stores/save-command.store.ts', 'src/domain/edit-session.ts']) {
  for (const imported of [
    "import { jointObject as value } from '@/domain/joint-edit';",
    "import type { JointIdentitySnapshot } from '@/domain/joint-edit';",
    "type Identity = import('@/domain/joint-edit').JointIdentitySnapshot;",
    "const joint = import('@/domain/joint-edit');",
    "export { jointObject } from '@/domain/joint-edit';",
  ])
    test(consumer + ' stays independent of joint editing for ' + imported, () => {
      const files = architectureFixtures({
        [consumer]: imported,
        'src/domain/joint-edit.ts': 'export interface JointIdentitySnapshot {} export function jointObject() {}',
      });
      assert.equal(messages(draftSessionBoundaryRule.check(files)).length, 1);
    });
}

test('target comparison permits mixed type imports and retains adapter ownership for other consumers', () => {
  const legal = architectureFixtures({
    'src/stores/save-command.store.ts': "import { type EditSessionValue, editTargetsOverlap as overlaps } from '@/domain/edit-session';",
    'src/domain/edit-session.ts': 'export interface EditSessionValue {} export function editTargetsOverlap() {}',
  });
  assert.deepEqual(messages(draftSessionBoundaryRule.check(legal)), []);
  const invalid = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { editTargetsOverlap } from '@/domain/edit-session';",
    'src/domain/edit-session.ts': 'export function editTargetsOverlap() {}',
  });
  assert.equal(messages(draftSessionBoundaryRule.check(invalid)).length, 1);
});
