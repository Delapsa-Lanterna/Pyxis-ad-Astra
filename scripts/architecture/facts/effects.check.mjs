import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../testing/fixtures.mjs';
import { effectPaths } from './effects.mjs';

test('function effects follow imported aliases, local helpers and original exports', () => {
  const context = architectureFixtures({
    'src/domain/sample.ts': "import {read as execute} from '../shared/barrel'; export function project(){ return execute(); }",
    'src/shared/barrel.ts': "export {load as read} from './loader';",
    'src/shared/loader.ts':
      'export function load(){return actual();} function actual(){return fetch("https://example.invalid/data");} export function pure(){return 1;}',
  });
  const paths = effectPaths(context).filter((path) => path.function.file === 'src/domain/sample.ts');
  assert.equal(paths.length, 1);
  assert.deepEqual(
    paths[0]?.chain.map((fn) => fn.name),
    ['project', 'load', 'actual'],
  );
  assert.equal(paths[0]?.effect.kind, 'read');
});

test('Rust aliases retain native writes behind functions with ordinary names', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/project/query/sample.rs': 'use crate::io::sample::prepare; pub fn query(){prepare();}',
    'src-tauri/src/io/sample.rs': 'use std::fs::write as persist; pub fn prepare(){persist("sample", "value");}',
  });
  const paths = effectPaths(context).filter((path) => path.function.name === 'query');
  assert.equal(paths.length, 1);
  assert.equal(paths[0]?.effect.kind, 'write');
  assert.deepEqual(
    paths[0]?.chain.map((fn) => fn.name),
    ['query', 'prepare'],
  );
});

test('internal renames preserve effects while local shadows and unused exports retain their own behavior', () => {
  for (const name of ['prepare', 'calculate']) {
    const context = architectureFixtures({
      'src/domain/sample.ts': 'import { ' + name + ' as selected } from "../shared/work"; export function project(){ return selected(); }',
      'src/shared/work.ts': 'export function ' + name + '(){return fetch("https://example.invalid/data");}',
    });
    const paths = effectPaths(context).filter((path) => path.function.file === 'src/domain/sample.ts');
    assert.equal(paths.length, 1);
    assert.equal(paths[0]?.effect.symbol, 'fetch');
  }
  const context = architectureFixtures({
    'src/domain/sample.ts':
      'import { pure } from "../shared/work"; function fetch(){return 1;} export function project(){return pure()+fetch();}',
    'src/shared/work.ts': 'export function pure(){return 1;} export function separate(){return fetch("https://example.invalid/data");}',
  });
  assert.deepEqual(
    effectPaths(context).filter((path) => path.function.file === 'src/domain/sample.ts'),
    [],
  );
});

test('external aliases retain observable effects independently of local names', () => {
  const context = architectureFixtures({
    'src/domain/sample.ts': 'import {watch as observe} from "vue"; export function project(){observe(source,handler);}',
  });
  const [path] = effectPaths(context).filter((path) => path.function.name === 'project');
  assert.equal(path?.effect.kind, 'publish');
  assert.equal(path?.effect.symbol, 'vue.watch');
});

test('namespace aliases and computed external members retain their actual API origin', () => {
  const context = architectureFixtures({
    'src/domain/sample.ts':
      'import * as fs from "node:fs/promises"; const renamed=fs; export function project(){return renamed["writeFile"]("sample","value");}',
  });
  const [path] = effectPaths(context).filter((path) => path.function.name === 'project');
  assert.equal(path?.effect.symbol, 'node:fs/promises.writeFile');
  assert.equal(path?.effect.kind, 'write');
});

test('runtime import initialization follows module dependencies', () => {
  const context = architectureFixtures({
    'src/domain/sample.ts': 'import "../shared/initialize"; export const value=1;',
    'src/shared/initialize.ts': 'const source=fetch("https://example.invalid/data");',
  });
  const paths = effectPaths(context).filter((path) => path.function.file === 'src/domain/sample.ts');
  assert.equal(paths.length, 1);
  assert.equal(paths[0]?.function.name, '<module>');
  assert.equal(paths[0]?.effect.symbol, 'fetch');
  assert.deepEqual(effectPaths(context, new Set(['src/domain/sample.ts'])), paths);
});

test('Rust forwarding exports retain their actual implementation effect', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/project/query/sample.rs': 'use crate::io::prepare; pub fn query(){prepare();}',
    'src-tauri/src/io/mod.rs': 'pub use sample::run as prepare;',
    'src-tauri/src/io/sample.rs': 'pub fn run(){std::fs::write("sample","value");}',
  });
  const paths = effectPaths(context).filter((path) => path.function.name === 'query');
  assert.equal(paths.length, 1);
  assert.deepEqual(
    paths[0]?.chain.map((fn) => fn.name),
    ['query', 'run'],
  );
  assert.equal(paths[0]?.effect.kind, 'write');
});
