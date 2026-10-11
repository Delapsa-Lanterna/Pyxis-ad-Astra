import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { writeBoundaryRule } from './rules/write-boundary.mjs';
import { commandBoundaryRule } from './rules/command-boundary.mjs';
import { frontendLayerBoundaryRule } from './rules/frontend-layer-boundary.mjs';

test('joint edit submission is owned by its orchestrator and registration by its lifecycle', () => {
  const files = architectureFixtures({
    'src/orchestrators/joint-edit.orchestrator.ts': "import {saveJointEdit} from '@/services/joint-edit.service'; saveJointEdit(payload);",
    'src/app/composables/use-edit-target-handoff.ts':
      "import {updateEditTargetRegistration} from '@/services/window.service'; updateEditTargetRegistration(targets);",
    'src/services/joint-edit.service.ts': 'export function saveJointEdit(payload) {return payload;}',
    'src/services/window.service.ts': 'export function updateEditTargetRegistration(targets) {return targets;}',
  });
  assert.deepEqual(writeBoundaryRule.check(files), []);
});

test('component submission and unrelated native target registration are rejected', () => {
  const files = architectureFixtures({
    'src/app/components/Sample.vue':
      "<script setup>import {saveJointEdit} from '@/services/joint-edit.service'; saveJointEdit(payload);</script>",
    'src/app/composables/use-sample.ts':
      "import {updateEditTargetRegistration} from '@/services/window.service'; updateEditTargetRegistration(targets);",
    'src/services/joint-edit.service.ts': 'export function saveJointEdit(payload) {return payload;}',
    'src/services/window.service.ts': 'export function updateEditTargetRegistration(targets) {return targets;}',
  });
  assert.ok(writeBoundaryRule.check(files).length > 0);
  assert.ok(frontendLayerBoundaryRule.check(files).some((failure) => failure.includes('components must consume')));
});

test('joint commands have a single capability owner and reject a second payload surface', () => {
  const files = architectureFixtures({
    'src/services/joint-edit.service.ts':
      "import {invokeCommand} from '@/shared/runtime/command.runtime'; export const read=(payload)=>invokeCommand('query_joint_edit',{payload});",
    'src/services/editor.service.ts':
      "import {invokeCommand} from '@/shared/runtime/command.runtime'; export const read=(payload)=>invokeCommand('query_joint_edit',{payload});",
    'src/shared/runtime/command.runtime.ts': 'export const invokeCommand=(command,args)=>({command,args});',
  });
  const failures = commandBoundaryRule.check(files);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].includes('src/services/editor.service.ts'));
});
