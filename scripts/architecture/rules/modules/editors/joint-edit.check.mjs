import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';
import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
import { commandBoundaryRule } from '../../capabilities/command-boundary.mjs';
import { frontendLayerBoundaryRule } from '../../dependencies/frontend-layer-boundary.mjs';

test('joint edit submission is owned by its orchestrator and registration by its lifecycle', () => {
  const files = architectureFixtures({
    'src/orchestrators/joint-edit.orchestrator.ts': "import {saveJointEdit} from '@/services/joint-edit.service'; saveJointEdit(payload);",
    'src/app/composables/use-edit-target-handoff.ts':
      "import {updateEditTargetRegistration} from '@/services/window.service'; updateEditTargetRegistration(targets);",
    'src/services/joint-edit.service.ts': 'export function saveJointEdit(payload) {return payload;}',
    'src/services/window.service.ts': 'export function updateEditTargetRegistration(targets) {return targets;}',
  });
  assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
});

test('immersive projections and window identity capabilities retain their declared owners', () => {
  const files = architectureFixtures({
    'src/app/composables/immersive-editor/use-immersive-editor-runtime.ts':
      "import {queryJointEditProjection} from '@/services/joint-edit.service'; queryJointEditProjection(draft);",
    'src/orchestrators/immersive-editor.orchestrator.ts':
      "import {focusNativeManagedWindow,retargetNativeWindow} from '@/services/window.service'; focusNativeManagedWindow(identity); retargetNativeWindow(identity,title);",
    'src/services/joint-edit.service.ts': 'export const queryJointEditProjection=(draft)=>draft;',
    'src/services/window.service.ts':
      'export const focusNativeManagedWindow=(identity)=>identity; export const retargetNativeWindow=(identity,title)=>({identity,title});',
  });
  assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
});

test('immersive presentation consumes window and query capabilities through its owners', () => {
  const files = architectureFixtures({
    'src/app/components/immersive/ImmersiveStatRow.vue':
      "<script setup>import {retargetNativeWindow} from '@/services/window.service'; retargetNativeWindow(identity,title);</script>",
    'src/services/window.service.ts': 'export const retargetNativeWindow=(identity,title)=>({identity,title});',
  });
  assert.ok(messages(frontendLayerBoundaryRule.check(files)).some((failure) => failure.includes('components must consume')));
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
  assert.ok(messages(capabilityBoundaryRule.check(files)).length > 0);
  assert.ok(messages(frontendLayerBoundaryRule.check(files)).some((failure) => failure.includes('components must consume')));
});

test('joint commands have a single capability owner and reject a second payload surface', () => {
  const files = architectureFixtures({
    'src/services/joint-edit.service.ts':
      "import {invokeCommand} from '@/shared/runtime/command.runtime'; export const read=(payload)=>invokeCommand('query_joint_edit',{payload});",
    'src/services/spec-editor.service.ts':
      "import {invokeCommand} from '@/shared/runtime/command.runtime'; export const read=(payload)=>invokeCommand('query_joint_edit',{payload});",
    'src/shared/runtime/command.runtime.ts': 'export const invokeCommand=(command,args)=>({command,args});',
  });
  const failures = messages(commandBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.ok(failures[0].includes('src/services/spec-editor.service.ts'));
});
