import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { moduleDependencies } from '../../facts/module-dependencies.mjs';
import { dependencyCycles } from '../../facts/dependency-cycles.mjs';
import { frontendLayerBoundaryRule } from './frontend-layer-boundary.mjs';
import { moduleImportCycleRule } from './module-import-cycle.mjs';
import { checkArchitecture } from '../../check.mjs';

/** @param {Record<string,string>} sources @param {Record<string,string[]>} owners @param {string[]} [shared] */
function fixture(sources, owners, shared = []) {
  const modules = Object.entries(owners);
  return architectureFixtures({
    ...sources,
    '.zcode/module-map.md':
      '# Module Map\n\n## 公共文件\n\n' +
      shared.map((path) => `- \`${path}\`：Public fixture.`).join('\n') +
      '\n\n## 模块索引\n\n### 正式模块\n\n' +
      modules.map(([id]) => `- [${id}](modules/${id}.md)：Fixture.`).join('\n') +
      '\n',
    ...Object.fromEntries(
      modules.map(([id, paths]) => [
        `.zcode/modules/${id}.md`,
        `# ${id}\n\n## 参考\n\n### 拥有\n\n` + paths.map((path) => `- \`${path}\`：Fixture.`).join('\n') + '\n',
      ]),
    ),
  });
}

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

for (const [scope, sources] of Object.entries({ frontend, backend, mixed }))
  test(`${scope} detects reciprocal module imports across separate files`, () => {
    const context = fixture(sources, {
      alpha: Object.keys(sources).filter((path) => path.includes('/alpha/')),
      beta: Object.keys(sources).filter((path) => path.includes('/beta/')),
    });
    const diagnostics = moduleImportCycleRule.check(context);
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
    assert.equal(frontendLayerBoundaryRule.check(context).filter((item) => item.message.includes('dependency cycle')).length, 0);
    assert.equal(checkArchitecture(context).filter((item) => item.ruleId === 'module-import-cycle').length, 1);
  });

test('three business modules form one closed source-evidenced chain', () => {
  const context = fixture(
    {
      'src/domain/a/use.ts': 'import {b} from "../b/item";',
      'src/domain/b/item.ts': 'export const b=1;',
      'src/domain/b/use.ts': 'import {c} from "../c/item";',
      'src/domain/c/item.ts': 'export const c=1;',
      'src/domain/c/use.ts': 'import {a} from "../a/item";',
      'src/domain/a/item.ts': 'export const a=1;',
    },
    { alpha: ['src/domain/a'], beta: ['src/domain/b'], gamma: ['src/domain/c'] },
  );
  const diagnostics = moduleImportCycleRule.check(context);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.symbol, 'alpha -> beta -> gamma -> alpha');
  for (const path of ['a/use.ts', 'b/use.ts', 'c/use.ts']) assert.ok(diagnostics[0]?.message.includes(path));
});

for (const declaration of [
  'export type {Beta as Renamed} from "../beta/item";',
  'import type {Beta} from "../beta/item"; export type {Beta as Renamed};',
  'export type * from "../beta/item";',
])
  test(`type export origins retain the defining module: ${declaration}`, () => {
    const name = declaration.includes('Renamed') ? 'Renamed' : 'Beta';
    const context = fixture(
      {
        'src/domain/alpha/use.ts': `import type {${name}} from "../facade/index";`,
        'src/domain/facade/index.ts': declaration,
        'src/domain/beta/item.ts': 'export interface Beta {}',
      },
      { alpha: ['src/domain/alpha'], beta: ['src/domain/beta'], assembly: ['src/domain/facade'] },
    );
    const dependencies = moduleDependencies(context);
    assert.ok(dependencies.some((edge) => edge.source.endsWith('/alpha.md') && edge.target.endsWith('/beta.md')));
    assert.ok(dependencies.every((edge) => !edge.target.endsWith('/assembly.md')));
    assert.deepEqual(moduleImportCycleRule.check(context), []);
  });

for (const statement of ['use crate::services::read as inspect;', 'use crate::services as api; fn run(){ api::read(); }'])
  test(`Rust imports follow actual declarations through an assembly: ${statement}`, () => {
    const context = fixture(
      {
        'src-tauri/src/domain/alpha.rs': statement,
        'src-tauri/src/services/mod.rs': 'pub use implementation::read;',
        'src-tauri/src/services/implementation.rs': 'pub fn read() {}',
      },
      {
        alpha: ['src-tauri/src/domain/alpha.rs'],
        beta: ['src-tauri/src/services/implementation.rs'],
        assembly: ['src-tauri/src/services/mod.rs'],
      },
    );
    const dependencies = moduleDependencies(context);
    assert.equal(dependencies.length, 1);
    assert.equal(dependencies[0]?.resolved, 'src-tauri/src/services/implementation.rs');
    assert.equal(dependencies[0]?.target, '.zcode/modules/beta.md');
  });

test('runtime export aliases and side-effect imports retain their actual target files', () => {
  const context = fixture(
    {
      'src/domain/alpha/use.ts': 'import {renamed} from "../facade/index"; import "../beta/side";',
      'src/domain/facade/index.ts': 'export {read as renamed} from "../beta/item";',
      'src/domain/beta/item.ts': 'export function read() {}',
      'src/domain/beta/side.ts': 'export const side=1;',
    },
    { alpha: ['src/domain/alpha'], beta: ['src/domain/beta'], assembly: ['src/domain/facade'] },
  );
  const dependencies = moduleDependencies(context);
  assert.equal(dependencies.length, 1);
  assert.equal(dependencies[0]?.resolved, 'src/domain/beta/item.ts');
  assert.deepEqual(moduleImportCycleRule.check(context), []);
});

test('public files, same-module imports and test-only sources keep their own scope', () => {
  const context = fixture(
    {
      ...frontend,
      ...backend,
      'src/domain/alpha/use.ts': frontend['src/domain/alpha/use.ts'] + ' import type {Alpha} from "./item";',
      'src/domain/beta/use.ts': 'import {value} from "../../shared/public";',
      'src/shared/public.ts': 'import {Alpha} from "../domain/alpha/item"; export const value=1;',
      'src/domain/beta/case.spec.ts': 'import {Alpha} from "../alpha/item";',
      'src-tauri/src/domain/beta/use.rs': '#[cfg(test)] use crate::domain::alpha::item::Alpha;',
      'src-tauri/src/domain/beta/cases.rs': '#![cfg(test)] use crate::domain::alpha::item::Alpha;',
    },
    { alpha: ['src/domain/alpha', 'src-tauri/src/domain/alpha'], beta: ['src/domain/beta', 'src-tauri/src/domain/beta'] },
  );
  assert.deepEqual(moduleImportCycleRule.check(context), []);
  assert.ok(moduleDependencies(context).every((edge) => edge.source !== edge.target));
});

test('Rust production imports retain their structure beside conditional fields', () => {
  const context = fixture(
    {
      'src-tauri/src/domain/alpha.rs': 'use crate::domain::beta::Beta; pub struct Record { #[cfg(test)] value: (), }',
      'src-tauri/src/domain/beta.rs': 'pub struct Beta;',
    },
    { alpha: ['src-tauri/src/domain/alpha.rs'], beta: ['src-tauri/src/domain/beta.rs'] },
  );
  assert.equal(moduleDependencies(context).length, 1);
});

test('embedded assets and frontend imports share the same module graph', () => {
  const context = fixture(
    {
      'src-tauri/src/domain/alpha.rs': 'const VALUE:&str=include_str!("../../../schemas/value.json");',
      'schemas/value.json': '{}',
      'src/domain/beta.ts': 'import {value} from "./alpha";',
      'src/domain/alpha.ts': 'export const value=1;',
    },
    { alpha: ['src-tauri/src/domain/alpha.rs', 'src/domain/alpha.ts'], beta: ['src/domain/beta.ts', 'schemas/value.json'] },
  );
  assert.equal(moduleImportCycleRule.check(context).length, 1);
});

test('cycle traversal retains closed evidence for disconnected and overlapping groups', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
    { source: 'a', target: 'c' },
    { source: 'c', target: 'a' },
    { source: 'x', target: 'y' },
    { source: 'y', target: 'x' },
  ];
  const cycles = dependencyCycles(edges);
  assert.equal(cycles.length, 3);
  for (const cycle of cycles)
    for (const [index, edge] of cycle.entries()) assert.equal(edge.target, cycle[(index + 1) % cycle.length]?.source);
  assert.deepEqual(
    dependencyCycles([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]),
    [],
  );
});

test('IPC names and event acknowledgements retain communication scope', () => {
  const context = fixture(
    {
      'src/domain/alpha.ts': 'import {invoke,emit} from "external-bridge"; invoke("read_beta"); emit("alpha_state");',
      'src/domain/beta.ts': 'import {listen,emit} from "external-bridge"; listen("alpha_state",()=>emit("beta_received"));',
    },
    { alpha: ['src/domain/alpha.ts'], beta: ['src/domain/beta.ts'] },
  );
  assert.deepEqual(moduleDependencies(context), []);
  assert.deepEqual(moduleImportCycleRule.check(context), []);
});
