import { test } from 'node:test';
import { moduleDependencyFixtures } from '../testing/fixtures.mjs';
import { moduleDependencies } from './module-dependencies.mjs';
import assert from 'node:assert/strict';
import { moduleImportCycleRule } from '../rules/dependencies/module-import-cycle.mjs';

for (const declaration of [
  'export type {Beta as Renamed} from "../beta/item";',
  'import type {Beta} from "../beta/item"; export type {Beta as Renamed};',
  'export type * from "../beta/item";',
])
  test(`type export origins retain the defining module: ${declaration}`, () => {
    const name = declaration.includes('Renamed') ? 'Renamed' : 'Beta';
    const context = moduleDependencyFixtures(
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
    const context = moduleDependencyFixtures(
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
  const context = moduleDependencyFixtures(
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

test('Rust production imports retain their structure beside conditional fields', () => {
  const context = moduleDependencyFixtures(
    {
      'src-tauri/src/domain/alpha.rs': 'use crate::domain::beta::Beta; pub struct Record { #[cfg(test)] value: (), }',
      'src-tauri/src/domain/beta.rs': 'pub struct Beta;',
    },
    { alpha: ['src-tauri/src/domain/alpha.rs'], beta: ['src-tauri/src/domain/beta.rs'] },
  );
  assert.equal(moduleDependencies(context).length, 1);
});
