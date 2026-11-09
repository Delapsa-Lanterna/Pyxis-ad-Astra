import { test } from 'node:test';
import { architectureFixtures, messages } from '../../testing/fixtures.mjs';
import { frontendLayerBoundaryRule } from './frontend-layer-boundary.mjs';
import assert from 'node:assert/strict';

test('settings persistence dependencies follow actual workspace responsibilities', () => {
  for (const owner of [
    'src/orchestrators/settings-persistence.orchestrator.ts',
    'src/app/composables/settings/use-settings-view-model.ts',
    'src/app/components/SettingsPage.vue',
  ]) {
    for (const target of [
      'src/orchestrators/workspace-core-source.orchestrator.ts',
      'src/orchestrators/workspace-lifecycle.orchestrator.ts',
      'src/orchestrators/workspace-opening.orchestrator.ts',
      'src/stores/workspace.store.ts',
      'src/stores/save-command.store.ts',
      'src/services/directory.service.ts',
      'src/domain/project/load-diagnostics.ts',
      'src/app/composables/use-window-close-state.ts',
    ])
      for (const typeOnly of [false, true]) {
        const statement = `import ${typeOnly ? 'type ' : ''}{Action as Selected} from '@/${target.slice(4, -3)}';`;
        const source = owner.endsWith('.vue') ? `<script setup lang="ts">\n${statement}\n</script>` : `\n${statement}`;
        const context = architectureFixtures({ [owner]: source, [target]: 'export interface Action {}' });
        const diagnostics = frontendLayerBoundaryRule.check(context);
        assert.equal(diagnostics.length, 1);
        const diagnostic = diagnostics[0];
        assert.ok(diagnostic);
        assert.equal(diagnostic.file, owner);
        assert.equal(diagnostic.line, 2);
        assert.equal(diagnostic.target, target);
        assert.equal(
          diagnostic.expected,
          owner.startsWith('src/orchestrators/') && target.startsWith('src/app/')
            ? 'orchestrators, services, stores, domain, windows, shared'
            : 'settings dependencies and explicit source action',
        );
      }
    for (const target of owner.endsWith('.vue')
      ? ['src/app/composables/settings/use-settings-view-model.ts', 'src/domain/settings/rules.ts']
      : [
          'src/services/app-settings.service.ts',
          'src/orchestrators/settings-normalization.orchestrator.ts',
          'src/domain/workspace/projection.ts',
        ]) {
      const context = architectureFixtures({
        [owner]: owner.endsWith('.vue')
          ? `<script setup lang="ts">import {operation} from '@/${target.slice(4, -3)}';</script>`
          : `import {operation} from '@/${target.slice(4, -3)}';`,
        [target]: 'export function operation() {}',
      });
      assert.deepEqual(frontendLayerBoundaryRule.check(context), []);
    }
  }
  const sameName = architectureFixtures({
    'src/domain/settings-persistence.ts': "import {operation} from '@/domain/project/load-diagnostics';",
    'src/domain/project/load-diagnostics.ts': 'export function operation() {}',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(sameName), []);
});

test('extensionless relative and alias imports reveal an orchestrator cycle', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { beta } from '@/orchestrators/beta.orchestrator'; export function alpha() {}",
    'src/orchestrators/beta.orchestrator.ts': "import { alpha } from './alpha.orchestrator'; export function beta() {}",
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).filter((failure) => failure.includes('dependency cycle')).length, 1);
});

test('one-way runtime and type imports keep the dependency graph acyclic', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { beta, type Beta } from './beta.orchestrator'; export interface Alpha {}",
    'src/orchestrators/beta.orchestrator.ts': 'export interface Beta {} export function beta() {}',
  });
  assert.deepEqual(messages(frontendLayerBoundaryRule.check(files)), []);
});

test('type cycles are checked across shared models and domain projections', () => {
  for (const directory of ['shared/types', 'domain/schema']) {
    const files = architectureFixtures({
      [`src/${directory}/alpha.ts`]: "import type { Beta } from './beta'; export interface Alpha {}",
      [`src/${directory}/beta.ts`]: "import type { Alpha } from './alpha'; export interface Beta {}",
    });
    assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
  }
});

test('a mixed type import still participates in runtime cycle detection', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { type Beta, beta } from './beta.orchestrator'; export function alpha() {}",
    'src/orchestrators/beta.orchestrator.ts':
      "import { alpha } from './alpha.orchestrator'; export interface Beta {} export function beta() {}",
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
});

test('component dependency rejection has one owner and one source-positioned diagnostic', () => {
  const files = architectureFixtures({
    'src/app/components/config/Audit.vue':
      '<script setup lang="ts">\nimport { saveCsvPatch, saveTextFile } from "@/services/csv-table.service";\n</script><template><div /></template>',
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {} export function saveTextFile() {}',
  });
  const failures = messages(frontendLayerBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /Audit.vue:2:\d+: src\/services\/csv-table.service.ts: components must consume/);
});

test('layer directions govern type imports and production capability constraints exempt test fixtures', () => {
  const files = architectureFixtures({
    'src/domain/sample.ts': "import type { State } from '@/stores/sample.store';",
    'src/stores/sample.store.ts': 'export interface State {}',
    'src/app/components/sample.spec.ts': "import { saveCsvPatch } from '@/services/csv-table.service';",
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
});

test('browser persistence access follows global bindings and preserves source locations', () => {
  const legal = architectureFixtures({
    'src/domain/sample.ts': 'function run(localStorage) { localStorage.getItem("value"); } const text="localStorage";',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(legal), []);
  const context = architectureFixtures({
    'src/domain/sample.ts': '\nconst disk=localStorage;\ndisk.getItem("value");\nglobalThis.indexedDB.open("value");',
  });
  const diagnostics = frontendLayerBoundaryRule.check(context);
  assert.deepEqual(
    diagnostics.map(({ line, column, symbol, expected }) => ({ line, column, symbol, expected })),
    [
      { line: 3, column: 1, symbol: 'localStorage', expected: 'app config services' },
      { line: 4, column: 1, symbol: 'indexedDB', expected: 'app config services' },
    ],
  );
});

test('window persistence access is treated as a global browser store', () => {
  const context = architectureFixtures({
    'src/app/composables/use-sample.ts': 'window.localStorage.setItem("workspace", "value");',
  });
  const [diagnostic] = frontendLayerBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.symbol, 'localStorage');
  assert.equal(diagnostic.expected, 'app config services');
});

test('file browser targets and configuration registries have their own inputs', () => {
  for (const [source, target, expected] of /** @type {[string, string, string][]} */ ([
    ['src/app/composables/file-browser/use-file-browser-view-model.ts', 'src/stores/workspace.store.ts', 'explicit file browser target'],
    ['src/services/misc-config.service.ts', 'src/domain/json-editor/json-document-definitions.ts', 'misc config definitions'],
  ])) {
    const context = architectureFixtures({
      [source]: '\nimport {value} from "@/' + target.slice(4, -3) + '";',
      [target]: 'export const value = 1;',
    });
    const [diagnostic] = frontendLayerBoundaryRule.check(context);
    assert.ok(diagnostic);
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.expected, expected);
    assert.equal(diagnostic.target, target);
  }
  const allowed = architectureFixtures({
    'src/services/misc-config.service.ts': 'import {value} from "@/domain/misc-config";',
    'src/domain/misc-config.ts': 'export const value = 1;',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(allowed), []);
});

test('JSON editors consume explicit host inputs across implementation layers and import aliases', () => {
  for (const source of [
    'src/app/components/json-editor/JsonEditorPage.vue',
    'src/app/composables/json-editor/use-json-document-view.ts',
    'src/domain/json-editor/json-document-definitions.ts',
    'src/stores/json-editor.store.ts',
    'src/orchestrators/json-save.orchestrator.ts',
    'src/services/json-file.service.ts',
  ]) {
    for (const target of ['src/stores/workspace.store.ts', 'src/orchestrators/workspace-navigation.orchestrator.ts']) {
      const code = 'import { value as own } from "@/' + target.slice(4, -3) + '"; own();';
      const context = architectureFixtures({
        [source]: source.endsWith('.vue') ? '<script setup lang="ts">' + code + '</script>' : code,
        [target]: 'export function value() {}',
      });
      const diagnostics = frontendLayerBoundaryRule.check(context).filter((item) => item.target === target);
      assert.equal(diagnostics.length, 1, source + ' -> ' + target);
      assert.equal(diagnostics[0]?.target, target);
    }
  }
  const context = architectureFixtures({
    'src/app/composables/use-workspace-json-editor-host.ts': 'import type {Host} from "@/app/composables/json-editor/json-editor-context";',
    'src/app/composables/json-editor/json-editor-context.ts': 'export interface Host {}',
    'src/app/composables/json-editor/use-json-document-view.ts': 'import type {Location} from "@/shared/types/workspace.types";',
    'src/shared/types/workspace.types.ts': 'export interface Location {}',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(context), []);
});

test('CSV editors consume explicit host inputs across implementation layers and import aliases', () => {
  for (const source of [
    'src/app/components/csv-editor/CsvEditorPage.vue',
    'src/app/composables/csv-editor/use-csv-table-view-model.ts',
    'src/domain/csv-editor/csv-table-draft.ts',
    'src/stores/csv-editor.store.ts',
    'src/orchestrators/csv-save.orchestrator.ts',
    'src/services/csv-table.service.ts',
  ]) {
    for (const target of ['src/stores/workspace.store.ts', 'src/orchestrators/workspace-navigation.orchestrator.ts']) {
      const code = 'import { value as own } from "@/' + target.slice(4, -3) + '"; own();';
      const context = architectureFixtures({
        [source]: source.endsWith('.vue') ? '<script setup lang="ts">' + code + '</script>' : code,
        [target]: 'export function value() {}',
      });
      const diagnostics = frontendLayerBoundaryRule.check(context).filter((item) => item.target === target);
      assert.equal(diagnostics.length, 1, source + ' -> ' + target);
      assert.equal(diagnostics[0]?.target, target);
    }
  }
  const context = architectureFixtures({
    'src/app/composables/use-workspace-csv-editor-host.ts': 'import type {Host} from "@/app/composables/csv-editor/csv-editor-context";',
    'src/app/composables/csv-editor/csv-editor-context.ts': 'export interface Host {}',
    'src/app/composables/csv-editor/use-csv-table-view-model.ts': 'import type {Location} from "@/shared/types/workspace.types";',
    'src/shared/types/workspace.types.ts': 'export interface Location {}',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(context), []);
});

test('context menus consume runtime capabilities through their window host', () => {
  for (const owner of ['src/app/components/ContextMenu.vue', 'src/app/composables/use-context-menu.ts']) {
    for (const target of [
      'src/stores/save-command.store.ts',
      'src/stores/project-sync.store.ts',
      'src/services/window.service.ts',
      'src/orchestrators/project-sync.orchestrator.ts',
      'src/windows/current.window.ts',
      'src/app/composables/use-window-close-state.ts',
      'src/app/composables/use-window-shortcuts.ts',
      'src/app/composables/use-app-feedback.ts',
      'src/app/composables/use-app-lifecycle-assembly.ts',
    ])
      for (const typeOnly of [false, true]) {
        const statement = 'import ' + (typeOnly ? 'type ' : '') + '{Action as Selected} from "@/' + target.slice(4, -3) + '";';
        const source = owner.endsWith('.vue') ? '<script setup lang="ts">\n' + statement + '\n</script>' : '\n' + statement;
        const context = architectureFixtures({ [owner]: source, [target]: 'export interface Action {}' });
        const diagnostics = frontendLayerBoundaryRule.check(context);
        assert.equal(diagnostics.length, 1);
        const diagnostic = diagnostics[0];
        assert.ok(diagnostic);
        assert.equal(diagnostic.ruleId, 'frontend-layer-boundary');
        assert.equal(diagnostic.file, owner);
        assert.equal(diagnostic.line, 2);
        assert.equal(diagnostic.target, target);
        assert.equal(diagnostic.expected, 'explicit context menu host');
        assert.equal(diagnostic.message, 'menu runtime capabilities must be supplied by window assembly');
      }
  }
  const allowed = architectureFixtures({
    'src/app/composables/use-app-lifecycle-assembly.ts':
      "import type {ContextMenuHost} from '@/app/composables/use-context-menu'; import {wait} from '@/stores/save-command.store';",
    'src/stores/save-command.store.ts': 'export function wait() {}',
    'src/app/components/ContextMenu.vue':
      '<script setup lang="ts">import {useWindowContextMenu} from "@/app/composables/use-context-menu";</script>',
    'src/app/composables/use-context-menu.ts':
      "import {read} from '@/shared/runtime/clipboard.runtime'; export interface ContextMenuHost {} export function useWindowContextMenu() {} export function useContextMenuScope() {}",
    'src/shared/runtime/clipboard.runtime.ts': 'export function read() {}',
    'src/app/composables/settings/use-settings-view-model.ts':
      "import {useContextMenuScope as register} from '@/app/composables/use-context-menu';",
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(allowed), []);
});

test('runtime and type edges share one layer-violation diagnostic', () => {
  const files = architectureFixtures({
    'src/domain/sample.ts': "import { type Shape, run } from '@/stores/sample.store';",
    'src/stores/sample.store.ts': 'export interface Shape {} export function run() {}',
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
});

test('editing and resource projections consume their own rules and public contracts', () => {
  for (const [source, target] of [
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/stores/project-sync.store.ts'],
    ['src/domain/resources/hull-references.ts', 'src/domain/field-editor/field-options.ts'],
    ['src/services/source-catalog.service.ts', 'src/domain/field-editor/csv-source-options.ts'],
  ])
    for (const typeOnly of [false, true]) {
      assert.ok(source && target);
      const context = architectureFixtures({
        [source]: `\nimport ${typeOnly ? 'type ' : ''}{Value as Selected} from '@/${target.slice(4, -3)}';`,
        [target]: 'export interface Value {}',
      });
      const diagnostics = frontendLayerBoundaryRule.check(context);
      assert.equal(diagnostics.length, 1);
      const diagnostic = diagnostics[0];
      assert.ok(diagnostic);
      assert.equal(diagnostic.file, source);
      assert.equal(diagnostic.line, 2);
      assert.equal(diagnostic.target, target);
      assert.ok(['owned projection or shared contract', 'field definitions or public contracts'].includes(diagnostic.expected ?? ''));
    }
  for (const [source, target] of [
    ['src/domain/edit-session.ts', 'src/shared/lib/json-edits.ts'],
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/shared/lib/json-edits.ts'],
    ['src/services/source-catalog.service.ts', 'src/domain/schema/schema-source-definitions.ts'],
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/domain/edit-session.ts'],
    ['src/domain/resources/hull-references.ts', 'src/shared/types/resources.types.ts'],
    ['src/stores/project-sync.store.ts', 'src/shared/types/write-commit.types.ts'],
  ]) {
    assert.ok(source && target);
    const context = architectureFixtures({
      [source]: `import type {Value} from '@/${target.slice(4, -3)}';`,
      [target]: 'export interface Value {}',
    });
    assert.deepEqual(frontendLayerBoundaryRule.check(context), []);
  }
});

test('field definitions and JSON composition consume their own pure contracts', () => {
  for (const [source, target] of /** @type {const} */ ([
    ['src/domain/schema/schema-source-definitions.ts', 'src/domain/field-editor/field-options.ts'],
    ['src/domain/schema/schema-values.ts', 'src/domain/json-composition.ts'],
    ['src/domain/json-composition.ts', 'src/domain/schema/schema-values.ts'],
    ['src/domain/json-composition.ts', 'src/domain/project/versions.ts'],
  ]))
    for (const typeOnly of [false, true]) {
      const context = architectureFixtures({
        [source]: '\nimport ' + (typeOnly ? 'type ' : '') + '{Value as Selected} from "@/' + target.slice(4, -3) + '";',
        [target]: 'export interface Value {}',
      });
      const [diagnostic] = frontendLayerBoundaryRule.check(context);
      assert.equal(diagnostic?.ruleId, 'frontend-layer-boundary');
      assert.equal(diagnostic?.file, source);
      assert.equal(diagnostic?.line, 2);
      assert.equal(diagnostic?.target, target);
      assert.equal(diagnostic?.expected, 'owned definitions or public contracts');
    }
  const allowed = architectureFixtures({
    'src/domain/schema/schema-asset-parser.ts': 'import {source} from "./schema-source-definitions";',
    'src/domain/schema/schema-source-definitions.ts': 'export const source = "config:sounds";',
    'src/domain/json-composition.ts': 'import {captureJsonEdits} from "@/shared/lib/json-edits";',
    'src/shared/lib/json-edits.ts': 'export function captureJsonEdits() {}',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(allowed), []);
});

test('immersive presentation consumes window and query capabilities through its owners', () => {
  const files = architectureFixtures({
    'src/app/components/immersive/ImmersiveStatRow.vue':
      "<script setup>import {retargetNativeWindow} from '@/services/window.service'; retargetNativeWindow(identity,title);</script>",
    'src/services/window.service.ts': 'export const retargetNativeWindow=(identity,title)=>({identity,title});',
  });
  assert.ok(messages(frontendLayerBoundaryRule.check(files)).some((failure) => failure.includes('components must consume')));
});
