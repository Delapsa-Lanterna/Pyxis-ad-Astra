import { test } from 'node:test';
import { moduleDependencyFixtures } from '../../testing/fixtures.mjs';
import { moduleImportCycleRule } from './module-import-cycle.mjs';
import assert from 'node:assert/strict';
import { moduleDependencies } from '../../facts/module-dependencies.mjs';

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

test('three business modules form one closed source-evidenced chain', () => {
  const context = moduleDependencyFixtures(
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

test('public files, same-module imports and test-only sources keep their own scope', () => {
  const context = moduleDependencyFixtures(
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

test('embedded assets and frontend imports share the same module graph', () => {
  const context = moduleDependencyFixtures(
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

test('IPC names and event acknowledgements retain communication scope', () => {
  const context = moduleDependencyFixtures(
    {
      'src/domain/alpha.ts': 'import {invoke,emit} from "external-bridge"; invoke("read_beta"); emit("alpha_state");',
      'src/domain/beta.ts': 'import {listen,emit} from "external-bridge"; listen("alpha_state",()=>emit("beta_received"));',
    },
    { alpha: ['src/domain/alpha.ts'], beta: ['src/domain/beta.ts'] },
  );
  assert.deepEqual(moduleDependencies(context), []);
  assert.deepEqual(moduleImportCycleRule.check(context), []);
});
