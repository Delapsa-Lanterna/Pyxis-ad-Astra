import { test } from 'node:test';
import {
  architectureFixtures,
  messages,
  moduleDependencyFixtures,
  moduleIndexText,
  moduleDocumentFixtures,
  moduleDocumentText,
} from './testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { checkArchitecture } from './check.mjs';
import { collectArchitectureContext, architectureContext } from './facts/context.mjs';
import { rules } from './registry.mjs';

test('timing callback reports every registered rule and preserves diagnostics', () => {
  const context = architectureFixtures({ 'src/domain/sample.ts': 'export function sample() {}' });
  /** @type {{ruleId:string,durationMs:number}[]} */
  const samples = [];
  const timed = checkArchitecture(context, { onRuleTiming: (sample) => samples.push(sample) });
  assert.deepEqual(timed, checkArchitecture(context));
  assert.deepEqual(
    samples.map((sample) => sample.ruleId),
    rules.map((rule) => rule.name),
  );
  assert.ok(samples.every((sample) => Number.isFinite(sample.durationMs) && sample.durationMs >= 0));
});

test('context stage timing reports measured collection phases without changing facts', () => {
  const sources = [{ rel: 'src/domain/sample.ts', path: 'src/domain/sample.ts', text: 'export const sample = 1;' }];
  const expected = architectureContext(sources);
  /** @type {{stage:string,durationMs:number,units?:number}[]} */
  const timings = [];
  const actual = architectureContext(sources, undefined, { onStageTiming: (timing) => timings.push(timing) });
  assert.deepEqual(
    actual.files.map(({ rel, imports, exports, dependencies, rust, document }) => ({
      rel,
      imports,
      exports,
      dependencies,
      rust,
      document,
    })),
    expected.files.map(({ rel, imports, exports, dependencies, rust, document }) => ({
      rel,
      imports,
      exports,
      dependencies,
      rust,
      document,
    })),
  );
  assert.deepEqual(actual.failures, expected.failures);
  assert.deepEqual(
    timings.map(({ stage }) => stage),
    [
      'importConfigAndPathIndexMs',
      'frontendParsingMs',
      'typescriptAstParseMs',
      'typeCheckerSetupMs',
      'frontendFactExtractionMs',
      'importResolutionMs',
      'rustMaskingAndExportsMs',
      'rustFactsMs',
      'moduleDocumentFactsMs',
      'moduleMapFactsMs',
      'contextIndexesAndFailuresMs',
    ],
  );
  assert.ok(timings.every(({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0));
  assert.equal(timings.find(({ stage }) => stage === 'typeCheckerSetupMs')?.units, 1);
});

/** @param {string} ruleId @param {import('./facts/context.mjs').ArchitectureContext} context */
function checkedRule(ruleId, context) {
  return checkArchitecture(context).filter((diagnostic) => diagnostic.ruleId === ruleId);
}

/** @param {import('./facts/context.mjs').ArchitectureContext} context */
function checkedModuleRules(context) {
  return checkArchitecture(context).filter((diagnostic) => ['module-structure', 'module-ownership'].includes(diagnostic.ruleId));
}

const serviceAssembly =
  'pub(crate) use project::query::entities::query_entity; pub(crate) use project::write::entity_write::content::save_entity_spec;';

const frontend = {
  'src/domain/alpha/use.ts': '\nimport {beta} from "../beta/item";',
  'src/domain/beta/item.ts': 'export const beta=1;',
  'src/domain/beta/use.ts': 'import type {Alpha} from "../alpha/item";',
  'src/domain/alpha/item.ts': 'export interface Alpha {}',
};

const backend = {
  'src-tauri/src/domain/alpha/use.rs': '\nuse crate::domain::beta::item::Beta;',
  'src-tauri/src/domain/beta/item.rs': 'pub struct Beta;',
  'src-tauri/src/domain/beta/use.rs': 'use crate::domain::alpha::item::Alpha;',
  'src-tauri/src/domain/alpha/item.rs': 'pub struct Alpha;',
};

const mixed = {
  'src/domain/alpha/use.ts': frontend['src/domain/alpha/use.ts'],
  'src/domain/beta/item.ts': frontend['src/domain/beta/item.ts'],
  'src-tauri/src/domain/beta/use.rs': backend['src-tauri/src/domain/beta/use.rs'],
  'src-tauri/src/domain/alpha/item.rs': backend['src-tauri/src/domain/alpha/item.rs'],
};

for (const source of [
  'crate::services::query_entity();',
  'use crate::services::{query_entity as read}; read();',
  'use crate::services as backend; backend::query_entity();',
]) {
  test('formal business exports retain command and service permissions: ' + source, () => {
    const valid = architectureFixtures({
      'src-tauri/src/services/mod.rs': serviceAssembly,
      'src-tauri/src/commands/example.rs': 'pub fn query() { ' + source + ' }',
      'src-tauri/src/services/file_editor.rs': 'fn load() { ' + source + ' }',
    });
    assert.deepEqual(messages(checkedRule('rust-project-layer-boundary', valid)), []);
    assert.deepEqual(messages(checkedRule('rust-service-edge-boundary', valid)), []);
    const invalid = architectureFixtures({
      'src-tauri/src/services/mod.rs': serviceAssembly,
      'src-tauri/src/services/app_settings.rs': 'fn load() { ' + source + ' }',
    });
    assert.equal(messages(checkedRule('rust-service-edge-boundary', invalid)).length, 1);
  });
}

for (const module of ['config_entity', 'json_file', 'spec_editor']) {
  test(module + ' consumes the formal parser and leaves resources at their owner', () => {
    const valid = architectureFixtures({
      ['src-tauri/src/services/' + module + '.rs']: 'use crate::parsers::render_csv_text; fn run() { render_csv_text(); }',
    });
    assert.deepEqual(messages(checkedRule('parser-boundary', valid)), []);
    const invalid = architectureFixtures({
      ['src-tauri/src/services/' + module + '.rs']: 'use crate::models::ResourceRef; fn run() {}',
    });
    assert.equal(messages(checkedRule('project-resources-boundary', invalid)).length, 1);
  });
}

for (const [scope, sources] of Object.entries({ frontend, backend, mixed }))
  test(`${scope} detects reciprocal module imports across separate files`, () => {
    const context = moduleDependencyFixtures(sources, {
      alpha: Object.keys(sources).filter((path) => path.includes('/alpha/')),
      beta: Object.keys(sources).filter((path) => path.includes('/beta/')),
    });
    const diagnostics = checkedRule('module-import-cycle', context);
    assert.equal(diagnostics.length, 1);
    const [diagnostic] = diagnostics;
    assert.ok(diagnostic);
    assert.equal(diagnostic.ruleId, 'module-import-cycle');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.column, scope === 'backend' ? 1 : 9);
    assert.equal(diagnostic.symbol, 'alpha -> beta -> alpha');
    assert.equal(diagnostic.expected, 'acyclic business module imports');
    assert.ok(diagnostic.message.includes('/beta/use.'));
    assert.ok(diagnostic.message.includes('/alpha/item.'));
    assert.equal(checkedRule('frontend-layer-boundary', context).filter((item) => item.message.includes('dependency cycle')).length, 0);
    assert.equal(checkArchitecture(context).filter((item) => item.ruleId === 'module-import-cycle').length, 1);
  });

for (const [source, target] of /** @type {const} */ ([
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/resources.types.ts'],
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/joint-edit.types.ts'],
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/tables.types.ts'],
  ['src/shared/types/cache-limits.types.ts', 'src/shared/types/query-cache.types.ts'],
  ['src/shared/types/cache-limits.types.ts', 'src/shared/types/app-settings.types.ts'],
  ['src/services/query-cache.service.ts', 'src/services/entity-query.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/source-catalog.service.ts'],
  ['src/services/query-cache.service.ts', 'src/shared/types/source-catalog.types.ts'],
  ['src/services/query-cache.service.ts', 'src/domain/schema/schema-source-definitions.ts'],
  ['src/services/query-cache.service.ts', 'src/services/hull-reference.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/resource-reference.service.ts'],
])) {
  for (const typeOnly of [true, false])
    test(source + ' retains its foundation boundary to ' + target + ' type=' + typeOnly, () => {
      const files = architectureFixtures({
        [source]: 'import ' + (typeOnly ? 'type ' : '') + "{ Value } from '@/" + target.slice(4, -3) + "';",
        [target]: 'export interface Value {}',
      });
      assert.equal(
        [...messages(checkedRule('frontend-layer-boundary', files)), ...messages(checkedRule('capability-boundary', files))].length,
        1,
      );
    });
}

for (const [source, target, name] of /** @type {const} */ ([
  ['src/app/composables/use-example.ts', 'src/services/entity-query.service.ts', 'hasEntityInvalidation'],
  ['src/app/composables/use-example.ts', 'src/services/csv-table.service.ts', 'hasTableInvalidation'],
  ['src/app/composables/use-example.ts', 'src/services/source-catalog.service.ts', 'hasSourceInvalidation'],
  ['src/services/resource-reference.service.ts', 'src/services/query-cache.service.ts', 'readLiveSessionQuery'],
]))
  test(name + ' has a formal consumer', () => {
    const files = architectureFixtures({
      [source]: 'import { ' + name + " } from '@/" + target.slice(4, -3) + "';",
      [target]: 'export function ' + name + '() {}',
    });
    assert.deepEqual(
      [...messages(checkedRule('frontend-layer-boundary', files)), ...messages(checkedRule('capability-boundary', files))],
      [],
    );
  });

test('Rust module and layer restrictions report each dependency fact once', () => {
  const horizontal = architectureFixtures({
    'src-tauri/src/services/example.rs': 'use crate::services::app_log::{first, second}; fn run() { crate::services::app_log::first(); }',
  });
  assert.equal(messages(checkedRule('rust-service-edge-boundary', horizontal)).length, 1);
  const layers = architectureFixtures({
    'src-tauri/src/models/example.rs': 'use crate::services::app_log::{first, second}; fn run() { crate::services::app_log::first(); }',
  });
  assert.equal(messages(checkedRule('rust-project-layer-boundary', layers)).length, 1);
});

test('Rust public query names retain their facade ownership and internal query modules retain their layer', () => {
  const facade = architectureFixtures({
    'src-tauri/src/services/file_editor.rs': 'fn run() { crate::services::project::query_entity_identity_intent(); }',
  });
  assert.deepEqual(messages(checkedRule('rust-project-layer-boundary', facade)), []);
  assert.deepEqual(messages(checkedRule('rust-service-edge-boundary', facade)), []);
  const internal = architectureFixtures({
    'src-tauri/src/services/file_editor.rs': 'fn run() { crate::services::project::query::identity(); }',
  });
  assert.equal(messages(checkedRule('rust-project-layer-boundary', internal)).length, 1);
});

test('history scope authorization belongs to its facade while records remain independent', () => {
  const target = 'crate::services::project::ensure_project_session_mod_root';
  const facade = architectureFixtures({ 'src-tauri/src/services/file_history.rs': 'fn read() { ' + target + '(session, root); }' });
  assert.deepEqual(checkedRule('rust-project-layer-boundary', facade), []);
  assert.deepEqual(checkedRule('rust-service-edge-boundary', facade), []);
  const records = architectureFixtures({
    'src-tauri/src/services/file_history/records.rs': 'fn read() { ' + target + '(session, root); }',
  });
  assert.equal(checkedRule('rust-project-layer-boundary', records).length, 1);
  assert.equal(checkedRule('rust-service-edge-boundary', records).length, 1);
  for (const target of ['unregister_project_session', 'resources::media_cache::clear_session_media']) {
    const allowed = architectureFixtures({
      'src-tauri/src/services/project_sync.rs': 'fn release() { crate::services::project::' + target + '(id); }',
    });
    assert.deepEqual(checkedRule('rust-project-layer-boundary', allowed), []);
    const denied = architectureFixtures({
      'src-tauri/src/services/file_editor.rs': 'fn release() { crate::services::project::' + target + '(id); }',
    });
    assert.equal(checkedRule('rust-project-layer-boundary', denied).length, 1);
  }
  const session = architectureFixtures({
    'src-tauri/src/services/project/session.rs': 'fn release() { crate::services::file_history::release_root_history(root); }',
  });
  assert.equal(checkedRule('rust-project-layer-boundary', session).length, 1);
});

test('public declarations and shared directories remain outside module ownership, including paired tests', () => {
  const map = moduleIndexText.replace('## 模块索引', '## 公共文件\n\n- `src/domain/sample.ts`：共享规则。\n\n## 模块索引');
  const failures = messages(checkedModuleRules(moduleDocumentFixtures(moduleDocumentText, map)));
  assert.ok(failures.some((failure) => failure.includes('public file src/domain/sample.ts')));
  const consumed = moduleDocumentText
    .replace('- `src/domain/sample.ts`：领域规则。\n', '')
    .replace('## 边界', '### 消费\n\n- `src/domain/sample.ts`：共享规则。\n\n## 边界');
  assert.deepEqual(messages(checkedModuleRules(moduleDocumentFixtures(consumed, map))), []);
  for (const path of ['src/shared/value.ts', 'scripts/shared/value.mjs', 'src/domain/sample.spec.ts']) {
    const doc = moduleDocumentText.replace('- `src/domain/sample.ts`：领域规则。', '- `' + path + '`：公共能力。');
    assert.ok(
      messages(checkedModuleRules(moduleDocumentFixtures(doc, map, { [path]: '' }))).some((failure) =>
        failure.includes('cannot have module ownership'),
      ),
    );
  }
  for (const declaration of [
    '- `missing.ts`：缺失。',
    '- `../sample.ts`：越界。',
    '- `src/domain/sample.ts`：A。\n- `src/domain/sample.ts`：B。',
  ]) {
    const invalid = map.replace('- `src/domain/sample.ts`：共享规则。', declaration);
    assert.ok(messages(checkedModuleRules(moduleDocumentFixtures(consumed, invalid))).length);
  }
});

test('module map and physical documents form a one-to-one correspondence', () => {
  /** @type {Array<[string, string, Record<string, string>]>} */
  const variants = [
    [moduleDocumentText, moduleIndexText + '- [重复](modules/sample.md)：重复。\n', {}],
    [moduleDocumentText, moduleIndexText.replace('sample.md', 'missing.md'), {}],
    [moduleDocumentText, moduleIndexText, { '.zcode/modules/extra.md': moduleDocumentText }],
    [moduleDocumentText, moduleIndexText, { '.zcode/modules/notes.txt': '正文' }],
    [moduleDocumentText, moduleIndexText, { '.zcode/modules/nested/': '' }],
    [moduleDocumentText, moduleIndexText, { '.zcode/modules/nested/sample.md': moduleDocumentText }],
    [moduleDocumentText, moduleIndexText.replace('sample.md', 'Bad_Name.md'), {}],
    [moduleDocumentText, moduleIndexText.replace('### 正式模块', '### 其它'), {}],
    [moduleDocumentText, moduleIndexText.replace('### 正式模块\n\n', '### 正式模块\n\n\n'), {}],
    [moduleDocumentText, moduleIndexText.replace('### 正式模块', '### 正式模块\n\n### 正式模块'), {}],
    [moduleDocumentText, moduleIndexText.replace('- [样例模块]', '正文\n- [样例模块]'), {}],
    [
      moduleDocumentText,
      moduleIndexText + '\n- [额外](modules/extra.md)：职责。\n',
      { '.zcode/modules/extra.md': moduleDocumentText.replace('# 样例模块', '# 额外') },
    ],
    [moduleDocumentText, moduleIndexText + '### 其它\n\n- [重复](modules/sample.md)：职责。\n', {}],
    [moduleDocumentText, moduleIndexText + '- [样例模块](modules/extra.md)：职责。\n', { '.zcode/modules/extra.md': moduleDocumentText }],
  ];
  for (const [doc, map, extras] of variants) assert.ok(messages(checkedModuleRules(moduleDocumentFixtures(doc, map, extras))).length > 0);
  assert.ok(messages(checkedModuleRules(architectureFixtures({}))).length > 0);
});

test('the shared collector supplies real module, source, binary and directory identities to the rule', async () => {
  const files = await collectArchitectureContext(process.cwd());
  const inventory = files.paths;
  assert.ok(inventory.has('src-tauri/icons/'));
  assert.ok(inventory.has('src-tauri/icons/icon.ico'));
  assert.deepEqual(messages(checkedModuleRules(files)), []);
});

test('reference existence consumes the complete repository inventory rather than only parsed source files', () => {
  const sourceFiles = moduleDocumentFixtures().files.filter((file) => file.rel !== 'assets/icon.png' && file.rel !== 'src/empty/');
  const inventory = [...sourceFiles.map((file) => file.rel), 'assets/icon.png', 'src/empty/'];
  assert.deepEqual(messages(checkedModuleRules(architectureContext(sourceFiles, inventory))), []);
  assert.ok(
    messages(
      checkedModuleRules(
        architectureContext(
          sourceFiles,
          inventory.filter((path) => path !== 'src/empty/'),
        ),
      ),
    ).length > 0,
  );
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
  assert.ok(messages(checkedRule('capability-boundary', files)).length > 0);
  assert.ok(messages(checkedRule('frontend-layer-boundary', files)).some((failure) => failure.includes('components must consume')));
});

for (const source of [
  'src/services/project-session.service.ts',
  'src/services/project-readiness.service.ts',
  'src/services/query-cache.service.ts',
  'src/services/resource-media.service.ts',
  'src/services/resource-reference.service.ts',
  'src/stores/project.store.ts',
]) {
  for (const dependency of [
    "import type { State } from '@/stores/project-sync.store';",
    "const sync = import('@/stores/project-sync.store');",
    "export { type State } from '@/stores/project-sync.store';",
  ]) {
    test(source + ' retains its foundation boundary for ' + dependency.split(' ')[0], () => {
      const files = architectureFixtures({
        [source]: dependency,
        'src/stores/project-sync.store.ts': 'export interface State {}',
      });
      const failures = [...messages(checkedRule('frontend-layer-boundary', files)), ...messages(checkedRule('capability-boundary', files))];
      assert.equal(failures.length, 1);
    });
  }
}

test('project synchronization consumes formal cache and projection capabilities', () => {
  const files = architectureFixtures({
    'src/orchestrators/project-sync.orchestrator.ts':
      "import { invalidateResourceMediaByProject } from '@/services/resource-media.service'; import { invalidateQueryCacheByProject } from '@/services/query-cache.service'; import { markSessionReady } from '@/services/project-readiness.service';",
    'src/services/resource-media.service.ts': 'export function invalidateResourceMediaByProject() {}',
    'src/services/query-cache.service.ts': 'export function invalidateQueryCacheByProject() {}',
    'src/services/project-readiness.service.ts': 'export function markSessionReady() {}',
  });
  assert.deepEqual(messages(checkedRule('frontend-layer-boundary', files)), []);
  assert.deepEqual(messages(checkedRule('capability-boundary', files)), []);
});

test('dependency rejection follows layer, responsibility and capability ownership for frontend and Rust', () => {
  const context = architectureFixtures({
    'src/app/composables/use-edit-target-draft-session.ts': "\nimport {saveCsvPatch} from '@/services/csv-table.service';",
    'src/services/csv-table.service.ts': 'export function saveCsvPatch(){}',
    'src-tauri/src/services/file_history/records.rs': '\nuse crate::services::project::query_entity;',
  });
  const frontend = checkArchitecture(context).filter((d) => d.file === 'src/app/composables/use-edit-target-draft-session.ts');
  const rust = checkArchitecture(context).filter((d) => d.file.endsWith('file_history/records.rs'));
  assert.equal(frontend.length, 2);
  assert.equal(rust.length, 2);
  assert.deepEqual(frontend.map((diagnostic) => diagnostic.ruleId).sort(), ['capability-boundary', 'draft-session-boundary']);
  assert.deepEqual(rust.map((diagnostic) => diagnostic.ruleId).sort(), ['rust-project-layer-boundary', 'rust-service-edge-boundary']);
  for (const diagnostic of [...frontend, ...rust]) {
    assert.equal(diagnostic.line, 2);
    assert.ok(diagnostic.column > 0);
    assert.ok(diagnostic.target && diagnostic.symbol && diagnostic.expected);
    const rule = rules.find((candidate) => candidate.name === diagnostic.ruleId);
    assert.equal(diagnostic.reference, rule?.reference);
    assert.equal(diagnostic.source, rule?.source);
  }
});

test('independent layer and capability violations each produce a diagnostic', () => {
  const files = architectureFixtures({
    'src/app/components/editors/Audit.vue':
      '<script setup lang="ts">import { saveCsvPatch } from "@/services/csv-table.service";</script><template><div /></template>',
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  const failures = messages(checkArchitecture(files)).filter(
    (failure) => failure.includes('Audit.vue') && (failure.includes('components must') || failure.includes('table-write')),
  );
  assert.equal(failures.length, 2);
});

test('production fixture consumption has one diagnostic and tests may consume production', () => {
  for (const source of [
    "import { fixture } from '@/test/fixtures/entity-target';",
    "import type { Fixture } from '@/test/fixtures/entity-target';",
  ]) {
    const files = architectureFixtures({
      'src/domain/example.ts': source,
      'src/test/fixtures/entity-target.ts': 'export interface Fixture {} export function fixture() {}',
    });
    const failures = messages(checkArchitecture(files)).filter((failure) => failure.includes('src/domain/example.ts'));
    assert.equal(failures.length, 1);
    assert.ok(failures[0]);
    assert.match(failures[0], /domain must not import test/);
  }
  const files = architectureFixtures({
    'src/domain/example.spec.ts': "import { example } from './example';",
    'src/domain/example.ts': 'export function example() {}',
  });
  assert.deepEqual(
    messages(checkArchitecture(files)).filter((failure) => failure.includes('src/domain/example.spec.ts')),
    [],
  );
});

test('feedback construction has one owner for direct and forwarded runtime imports', () => {
  for (const source of [
    "import { useMessage, useDialog } from 'naive-ui'; useMessage(); useDialog();",
    "import * as feedback from '@/shared/feedback-bridge';",
    "const feedback = import('@/shared/feedback-bridge');",
  ]) {
    const files = architectureFixtures({
      'src/app/composables/use-sample.ts': source,
      'src/shared/feedback-bridge.ts': "export * from 'naive-ui';",
    });
    assert.equal(messages(checkArchitecture(files)).filter((failure) => failure.includes('src/app/composables/use-sample.ts')).length, 1);
  }
});

test('invoke aliases and namespace imports remain wire capabilities', () => {
  for (const source of ["import { invoke as send } from '@tauri-apps/api/core';", "import * as core from '@tauri-apps/api/core';"]) {
    const files = architectureFixtures({ 'src/windows/audit.window.ts': source });
    assert.equal(
      [...messages(checkedRule('frontend-layer-boundary', files)), ...messages(checkedRule('capability-boundary', files))].length,
      1,
    );
    const message = messages(checkedRule('capability-boundary', files))[0];
    assert.ok(message);
    assert.match(message, /invoke-wire/);
  }
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { send } from '@/shared/runtime/bridge';",
    'src/shared/runtime/bridge.ts': "export { invoke as send } from '@tauri-apps/api/core';",
  });
  const message = messages(checkedRule('capability-boundary', files))[0];
  assert.ok(message);
  assert.match(message, /invoke-wire/);
});

test('command-domain purity retains both layer and capability obligations', () => {
  const files = architectureFixtures({
    'src/domain/workspace/commands.ts':
      "import { querySessionEntity } from '@/services/entity-query.service'; export function shortcutCommandFromKeyEvent() {}",
    'src/services/entity-query.service.ts': 'export function querySessionEntity() {}',
  });
  assert.equal(messages(checkArchitecture(files)).filter((failure) => failure.includes('src/domain/workspace/commands.ts')).length, 2);
});

test('window settings consumption is constrained through the actual settings capability module', () => {
  const files = architectureFixtures({
    'src/windows/audit.window.ts': "import { readSettings } from '@/services/app-settings.service';",
    'src/services/app-settings.service.ts': 'export function readSettings() {}',
  });
  const failures = messages(checkArchitecture(files)).filter((failure) => failure.includes('src/windows/audit.window.ts'));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /settings-read/);
});
