import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';
import { fieldEditorModuleBoundaryRule } from './field-editor-module-boundary.mjs';

test('a schema dispatcher must own plain and enhanced mode selection', () => {
  const files = architectureFixtures({
    'src/app/components/field-editor/Fields.vue':
      '<script setup lang="ts">interface FieldSchema {} defineProps<{ field: FieldSchema }>();</script><template><input v-if="field.type === \'integer\'" /></template>',
  });
  assert.equal(messages(fieldEditorModuleBoundaryRule.check(files)).length, 1);
});

test('a scalar input consumes field semantics within its declared presentation', () => {
  const files = architectureFixtures({
    'src/app/components/field-editor/Scalar.vue':
      '<script setup lang="ts">interface FieldSchema {} defineProps<{ field: FieldSchema }>();</script><template><input :disabled="field.editable === false" /></template>',
  });
  assert.deepEqual(messages(fieldEditorModuleBoundaryRule.check(files)), []);
});

test('a dispatcher accepts an inherited effective input mode', () => {
  const files = architectureFixtures({
    'src/app/components/field-editor/Fields.vue':
      '<script setup lang="ts">interface FieldSchema {} defineProps<{ field: FieldSchema }>(); const plainMode = true;</script><template><input v-if="plainMode && field.type === \'integer\'" /></template>',
  });
  assert.deepEqual(messages(fieldEditorModuleBoundaryRule.check(files)), []);
});

test('an active field dispatcher must expose plain and enhanced mode branches', () => {
  const files = architectureFixtures({
    'src/app/components/field-editor/Fields.vue':
      '<script setup lang="ts">interface FieldSchema { type: string } defineProps<{ active: FieldSchema }>();</script><template><input v-if="active.type === \'integer\'" /></template>',
  });
  assert.equal(messages(fieldEditorModuleBoundaryRule.check(files)).length, 1);
});

test('schema field renderers delegate source resolution and file selection', () => {
  const files = architectureFixtures({
    'src/app/components/field-editor/Fields.vue':
      '<script setup lang="ts">interface FieldSchema { type: string } const querySourceOptions = () => []; const resolveSource = () => null; defineProps<{ field: FieldSchema }>();</script><template><input v-if="field.type === \'string\' && plainMode" /></template>',
  });
  const diagnostics = fieldEditorModuleBoundaryRule.check(files);
  assert.deepEqual(diagnostics.map(({ symbol }) => symbol).sort(), ['querySourceOptions', 'resolveSource'].sort());
});

test('field editor contexts are owned by their runtime domain', () => {
  const context = architectureFixtures({ 'src/shared/types/field-editor.types.ts': '\nexport interface FieldEditorContext {}' });
  const [diagnostic] = fieldEditorModuleBoundaryRule.check(context);
  assert.equal(diagnostic?.ruleId, 'field-editor-module-boundary');
  assert.equal(diagnostic?.file, 'src/shared/types/field-editor.types.ts');
  assert.equal(diagnostic?.line, 2);
  assert.equal(diagnostic?.symbol, 'FieldEditorContext');
  assert.equal(diagnostic?.expected, 'field editor domain');
  const legal = architectureFixtures({ 'src/domain/field-editor/field-editor-context.ts': 'export interface FieldEditorContext {}' });
  assert.deepEqual(fieldEditorModuleBoundaryRule.check(legal), []);
});
