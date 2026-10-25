import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures, fixtureFile } from '../testing/fixtures.mjs';
import { importSpecifiers, importedProjectPaths, dependencyOrigins } from './imports.mjs';
import { architectureContext } from './context.mjs';
import { capabilityFor } from '../rules/capabilities/frontend-policy.mjs';
import { classifyFrontendPath } from './classify.mjs';
import { cratePaths } from './rust-crate-paths.mjs';

test('mixed named imports keep per-binding type and runtime semantics', () => {
  const files = architectureFixtures({
    'src/app/sample.ts': "import Default, { type Shape, run as execute } from '@/domain/sample';",
    'src/domain/sample.ts': 'export default 1; export interface Shape {} export function run() {}',
  });
  const facts = importSpecifiers(fixtureFile(files, (file) => file.rel === 'src/app/sample.ts'));
  assert.deepEqual(
    facts.map(({ importedName, localName, typeOnly }) => ({ importedName, localName, typeOnly })),
    [
      { importedName: 'default', localName: 'Default', typeOnly: false },
      { importedName: 'Shape', localName: 'Shape', typeOnly: true },
      { importedName: 'run', localName: 'execute', typeOnly: false },
    ],
  );
  assert.equal(importedProjectPaths(fixtureFile(files, (file) => file.rel === 'src/app/sample.ts')).length, 2);
});

test('relative, alias, explicit and index imports resolve one actual module per edge kind', () => {
  const files = architectureFixtures({
    'src/app/sample.ts':
      "import { run } from '@/domain/sample'; import { run as again } from '../domain/sample.ts'; import * as sample from '@/domain/sample';",
    'src/domain/sample/index.ts': 'export const indexed = 1;',
    'src/domain/sample.ts': 'export function run() {}',
  });
  const file = fixtureFile(files, (file) => file.rel === 'src/app/sample.ts');
  assert.equal(file.dependencies.length, 1);
  assert.equal(file.dependencies[0].resolved, 'src/domain/sample.ts');
  const indexed = architectureFixtures({
    'src/app/sample.ts': "import { run } from '@/domain/folder';",
    'src/domain/folder/index.ts': 'export function run() {}',
  });
  assert.equal(fixtureFile(indexed, (file) => file.rel === 'src/app/sample.ts').dependencies[0].resolved, 'src/domain/folder/index.ts');
});

test('the resolver consumes declared aliases and asset query suffixes', () => {
  const sources = [
    { path: '', rel: 'tsconfig.json', text: JSON.stringify({ compilerOptions: { paths: { '~/*': ['./src/*'] } } }) },
    { path: '', rel: 'src/app/sample.ts', text: "import text from '../../text.md?raw'; import { run } from '~/domain/sample';" },
    { path: '', rel: 'src/domain/sample.ts', text: 'export function run() {}' },
  ];
  const files = architectureContext(sources, [...sources.map((file) => file.rel), 'text.md']);
  assert.deepEqual(
    fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies.map((edge) => edge.resolved),
    ['text.md', 'src/domain/sample.ts'],
  );
});

test('Vue script and setup imports retain their original file positions', () => {
  const files = architectureFixtures({
    'src/app/Sample.vue':
      '<script lang="ts">\nimport { first } from "../domain/sample";\n</script>\n<script setup lang="ts">\nimport { second } from "../domain/sample";\n</script>\n<template><div /></template>',
    'src/domain/sample.ts': 'export const first = 1; export const second = 2;',
  });
  const file = fixtureFile(files, (file) => file.rel.endsWith('Sample.vue'));
  assert.deepEqual(
    file.imports.map((binding) => binding.line),
    [2, 5],
  );
  assert.equal(file.dependencies.length, 1);
  assert.equal(file.dependencies[0].bindings.length, 2);
});

test('dynamic imports and import type references have independent edge semantics', () => {
  const files = architectureFixtures({
    'src/app/sample.ts': "type Shape = import('@/domain/sample').Shape; const module = import('@/domain/sample');",
    'src/domain/sample.ts': 'export interface Shape {} export const value = 1;',
  });
  const file = fixtureFile(files, (file) => file.rel.endsWith('app/sample.ts'));
  assert.deepEqual(
    file.imports.map((binding) => [binding.kind, binding.typeOnly]),
    [
      ['type', true],
      ['dynamic', false],
    ],
  );
});

test('comments and source strings do not create imports', () => {
  const files = architectureFixtures({
    'src/app/sample.ts': "// import { x } from '@/missing';\nconst text = \"import('@/missing')\"; /* export * from '@/missing' */",
  });
  const file = fixtureFile(files, (file) => file.rel.endsWith('sample.ts'));
  assert.equal(file.imports.length, 0);
  assert.equal(file.dependencyFailures.length, 0);
});

test('missing internal modules produce a source-positioned failure', () => {
  const files = architectureFixtures({ 'src/app/sample.ts': "\nimport { run } from '@/missing';" });
  const file = fixtureFile(files, (file) => file.rel.endsWith('sample.ts'));
  assert.equal(file.dependencies.length, 0);
  assert.deepEqual(file.dependencyFailures[0], {
    line: 2,
    column: 10,
    message: 'internal dependency @/missing must resolve to an existing project file',
    target: '@/missing',
    symbol: 'run',
    expected: 'existing project module',
  });
});

test('reexports and imported aliases retain the protected capability origin', () => {
  const files = architectureFixtures({
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
    'src/shared/bridge.ts': "export { saveCsvPatch as submit } from '@/services/csv-table.service';",
    'src/shared/second.ts': "import { submit } from './bridge'; export const hidden = submit;",
    'src/app/sample.ts': "import { hidden } from '@/shared/second';",
  });
  const nodes = new Map(files.files.map((file) => [file.rel, file]));
  const edge = fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies[0];
  assert.deepEqual(
    dependencyOrigins(edge, nodes, (rel, name) => Boolean(capabilityFor(rel, name))),
    [{ rel: 'src/services/csv-table.service.ts', name: 'saveCsvPatch' }],
  );
});

test('namespace, export-star, export namespace and dynamic imports expand runtime capabilities', () => {
  for (const source of ["import * as write from '@/shared/bridge';", "const write = import('@/shared/bridge');"]) {
    const files = architectureFixtures({
      'src/services/csv-table.service.ts': 'export function saveCsvPatch() {} export interface Shape {}',
      'src/shared/bridge.ts': "export * from '@/services/csv-table.service';",
      'src/app/sample.ts': source,
    });
    const nodes = new Map(files.files.map((file) => [file.rel, file]));
    assert.deepEqual(
      dependencyOrigins(fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies[0], nodes, (rel, name) =>
        Boolean(capabilityFor(rel, name)),
      ),
      [{ rel: 'src/services/csv-table.service.ts', name: 'saveCsvPatch' }],
    );
  }
  const files = architectureFixtures({
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
    'src/shared/bridge.ts': "export * as write from '@/services/csv-table.service';",
    'src/app/sample.ts': "import { write } from '@/shared/bridge';",
  });
  const nodes = new Map(files.files.map((file) => [file.rel, file]));
  assert.equal(
    dependencyOrigins(fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies[0], nodes, (rel, name) =>
      Boolean(capabilityFor(rel, name)),
    )[0].name,
    'saveCsvPatch',
  );
});

test('type-only export-star has no runtime capability origin and cyclic barrels terminate', () => {
  const files = architectureFixtures({
    'src/shared/first.ts': "export * from './second'; export type * from '@/services/csv-table.service';",
    'src/shared/second.ts': "export * from './first'; export const plain = 1;",
    'src/services/csv-table.service.ts': 'export interface Shape {}',
    'src/app/sample.ts': "import * as first from '@/shared/first';",
  });
  const nodes = new Map(files.files.map((file) => [file.rel, file]));
  assert.deepEqual(
    dependencyOrigins(fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies[0], nodes, (rel, name) =>
      Boolean(capabilityFor(rel, name)),
    ),
    [{ rel: 'src/shared/second.ts', name: 'plain' }],
  );
});

test('classification expresses flat domain and actual responsibility suffixes consistently', () => {
  assert.equal(classifyFrontendPath('src/domain/edit-session.ts').domain, 'edit-session');
  assert.equal(classifyFrontendPath('src/services/csv-table.service.ts').domain, 'csv-table');
  assert.equal(classifyFrontendPath('src/services/files.service.ts').domain, 'files');
  assert.equal(classifyFrontendPath('src/orchestrators/csv-save.orchestrator.ts').domain, 'csv-save');
  assert.equal(classifyFrontendPath('scripts/architecture/testing/fixtures.mjs').role, 'fixture');
  assert.equal(classifyFrontendPath('scripts/shared/rust-source.check.mjs').layer, 'test');
  assert.equal(classifyFrontendPath('src/domain/sample.spec.mjs').layer, 'test');
});

test('Rust dependency extraction deduplicates identical resolved references', () => {
  const paths = cratePaths(
    'use crate::models::WriteResult; fn run() { let value: crate::models::WriteResult; }',
    'src-tauri/src/services/sample.rs',
  );
  assert.equal(paths.filter((parts) => parts.join('::') === 'models::WriteResult').length, 1);
});

test('Rust module aliases and function values retain their resolved service path', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs': 'pub(crate) use project::query::query_entity;',
    'src-tauri/src/services/example.rs':
      'use crate::services::project::query as query_layer; fn run() { let action = query_layer::query_entity; action(); }',
  });
  const file = fixtureFile(files, (item) => item.rel === 'src-tauri/src/services/example.rs');
  assert.equal(
    file.rust.references.some((edge) => edge.target.join('::').includes('project::query')),
    true,
  );
});

test('JavaScript modules, side-effect imports and direct reexports share the source model', () => {
  const files = architectureFixtures({
    'src/domain/sample.mjs': "import './effect.js'; export { run } from './helper.js'; export default function start() {}",
    'src/domain/effect.js': 'export const ready = true;',
    'src/domain/helper.js': 'export function run() {}',
  });
  const file = fixtureFile(files, (file) => file.rel.endsWith('sample.mjs'));
  assert.deepEqual(
    file.imports.map((binding) => [binding.kind, binding.importedName]),
    [
      ['import', null],
      ['export', 'run'],
    ],
  );
  assert.deepEqual(
    file.dependencies.map((edge) => edge.resolved),
    ['src/domain/effect.js', 'src/domain/helper.js'],
  );
  assert.deepEqual(file.exportedFunctions, ['default']);
});

test('explicit exports own their name when a star export offers the same name', () => {
  const files = architectureFixtures({
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
    'src/shared/bridge.ts': "export * from '@/services/csv-table.service'; export function saveCsvPatch() {}",
    'src/app/sample.ts': "import * as module from '@/shared/bridge';",
  });
  const nodes = new Map(files.files.map((file) => [file.rel, file]));
  const edge = fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies[0];
  assert.deepEqual(
    dependencyOrigins(edge, nodes, (rel, name) => Boolean(capabilityFor(rel, name))),
    [{ rel: 'src/shared/bridge.ts', name: 'saveCsvPatch' }],
  );
});

test('star exports preserve default export visibility and config comments are parsed', () => {
  const files = architectureFixtures({
    'tsconfig.json': '{ /* aliases */ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    'src/shared/source.ts': 'export default function run() {} export const visible = 1;',
    'src/shared/bridge.ts': "export * from './source';",
    'src/app/sample.ts': "import * as module from '@/shared/bridge';",
  });
  const nodes = new Map(files.files.map((file) => [file.rel, file]));
  const edge = fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies[0];
  assert.deepEqual(
    dependencyOrigins(edge, nodes, () => false),
    [{ rel: 'src/shared/source.ts', name: 'visible' }],
  );
});

test('a missing declaration with several bindings produces one resolution diagnostic', () => {
  const files = architectureFixtures({ 'src/app/sample.ts': "import { first, second } from '@/missing';" });
  assert.equal(fixtureFile(files, (file) => file.rel.endsWith('sample.ts')).dependencyFailures.length, 1);
});

test('alias targets are resolved relative to the configured base URL', () => {
  const files = architectureFixtures({
    'tsconfig.json': '{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["./*"] } } }',
    'src/app/sample.ts': "import { run } from '@/domain/sample';",
    'src/domain/sample.ts': 'export function run() {}',
  });
  assert.equal(fixtureFile(files, (file) => file.rel.endsWith('app/sample.ts')).dependencies[0].resolved, 'src/domain/sample.ts');
});

test('computed dynamic dependencies require an explicit authorization target', () => {
  const files = architectureFixtures({ 'src/app/sample.ts': 'const target = "module"; const loaded = import(target);' });
  const file = fixtureFile(files, (file) => file.rel.endsWith('sample.ts'));
  assert.equal(file.dependencies.length, 0);
  assert.match(file.dependencyFailures[0].message, /dynamic dependencies must declare a literal module specifier/);
  assert.equal(file.dependencyFailures[0].target, 'import(target)');
  assert.equal(file.dependencyFailures[0].symbol, 'import');
  assert.equal(file.dependencyFailures[0].expected, 'literal module specifier');
});

test('runtime aliases assigned after declaration retain capability origin', () => {
  const files = architectureFixtures({
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
    'src/app/sample.ts': "import { saveCsvPatch } from '@/services/csv-table.service'; let submit; submit = saveCsvPatch; submit();",
  });
  const file = fixtureFile(files, (item) => item.rel === 'src/app/sample.ts');
  assert.equal(
    file.calls.some((call) => call.localName === 'saveCsvPatch'),
    true,
  );
});

test('TypeScript generic arrows and TSX scripts use their declared syntax mode', () => {
  const files = architectureFixtures({
    'src/domain/sample.ts': "export const run = <T>(value: T) => import('@/domain/target');",
    'src/domain/target.ts': 'export const ready = true;',
    'src/app/Sample.vue':
      '<script setup lang="tsx">const view = <div />; const load = () => import("@/domain/target");</script><template><div /></template>',
  });
  assert.equal(fixtureFile(files, (file) => file.rel.endsWith('sample.ts')).imports[0].kind, 'dynamic');
  assert.equal(fixtureFile(files, (file) => file.rel.endsWith('Sample.vue')).dependencies[0].resolved, 'src/domain/target.ts');
});

test('local, namespace and default forwarding retain the defining runtime symbol', () => {
  for (const [forwarding, consumer] of [
    [
      "import {saveCsvPatch as remote} from '@/services/csv-table.service'; const local=remote; export {local as submit};",
      "import {submit} from '@/shared/bridge';",
    ],
    [
      "import * as remote from '@/services/csv-table.service'; const local=remote.saveCsvPatch; export {local as submit};",
      "import {submit} from '@/shared/bridge';",
    ],
    [
      "import {saveCsvPatch as remote} from '@/services/csv-table.service'; const local=remote; export default local;",
      "import submit from '@/shared/bridge';",
    ],
    [
      "import * as remote from '@/services/csv-table.service'; const local=remote; export {local as commands};",
      "import {commands} from '@/shared/bridge';",
    ],
  ]) {
    const files = architectureFixtures({
      'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
      'src/shared/bridge.ts': forwarding,
      'src/app/sample.ts': consumer,
    });
    const edge = fixtureFile(files, (file) => file.rel === 'src/app/sample.ts').dependencies[0];
    assert.deepEqual(
      dependencyOrigins(edge, files.byPath, (rel, name) => Boolean(capabilityFor(rel, name))),
      [{ rel: 'src/services/csv-table.service.ts', name: 'saveCsvPatch' }],
    );
  }
});
