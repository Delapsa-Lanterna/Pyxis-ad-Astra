import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { parseRust } from '../src/rust.mjs';
import { ipcEdges } from '../src/analyze.mjs';
/** @param {Record<string,string>} sources */
async function extract(sources) {
  /** @type {import('../src/model.mjs').File[]} */
  const files = Object.entries(sources).map(([path, text]) => ({
    path,
    text,
    role: 'production',
    hash: 'fixture',
    lines: text.split('\n').length,
    bytes: Buffer.byteLength(text),
    ownership: { status: 'unmatched', owner: null, candidates: [] },
  }));
  const facts = await parseRust(
    { root: process.cwd(), files, head: 'fixture', digest: 'fixture' },
    [
      {
        target: { name: 'fixture', src_path: join(process.cwd(), 'src/lib.rs') },
      },
    ],
    new Map(),
    new Map(),
  );
  return { files, facts };
}
test('file and parent conditions identify exclusive tests and preserve mixed assembly', async () => {
  const { files, facts } = await extract({
    'src/lib.rs':
      'mod live; #[cfg(all(test,windows))] #[path="helper.rs"] mod testing; #[path="mixed.rs"] mod mixed; #[cfg(test)] #[path="mixed.rs"] mod mixed_test;',
    'src/live.rs':
      'pub fn work() {} #[cfg(all(test,windows))] mod checks { fn run() { crate::live::work(); let _ = include_str!("asset.json"); } }',
    'src/helper.rs': '#![cfg(test)] pub fn check() { crate::live::work(); }',
    'src/mixed.rs': 'pub fn check() { crate::live::work(); }',
    'src/asset.json': '{}',
  });
  assert.equal(files.find((file) => file.path === 'src/helper.rs')?.role, 'test');
  assert.equal(files.find((file) => file.path === 'src/mixed.rs')?.role, 'production');
  assert.ok(facts.edges.find((edge) => edge.kind === 'embedded-asset' && edge.testOnly));
  assert.ok(facts.edges.filter((edge) => edge.source === 'src/helper.rs').every((edge) => edge.testOnly));
});
test('project command macros resolve production handlers separately from test handlers', async () => {
  const { facts } = await extract({
    'src/lib.rs':
      '#[command_macros::command(async)] pub fn read_item() {} #[cfg(test)] #[command_macros::command] fn test_item() {} fn start() { command_macros::generate_handler![crate::read_item]; } #[cfg(test)] fn test_start() { command_macros::generate_handler![crate::test_item]; }',
  });
  const result = ipcEdges(
    [{ path: 'service.ts', line: 1, value: 'read_item', role: 'ipc', expression: 'read_item', parser: 'fixture' }],
    facts.commands,
  );
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0]?.targetLine, 1);
  const testCall = {
    path: 'service.spec.ts',
    line: 1,
    value: 'fixture_only',
    role: 'ipc',
    expression: 'fixture_only',
    parser: 'fixture',
    testOnly: true,
  };
  assert.equal(ipcEdges([testCall], facts.commands).issues[0]?.testOnly, true);
  assert.equal(
    ipcEdges([{ path: 'service.ts', line: 1, value: 'test_item', role: 'ipc', expression: 'test_item', parser: 'fixture' }], facts.commands)
      .edges.length,
    0,
  );
});
