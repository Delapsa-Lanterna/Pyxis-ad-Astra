import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSemanticIndex, semanticVersion } from '../src/rust-semantic.mjs';
import { parseRust } from '../src/rust.mjs';
import { setupCommands, toolRoot } from '../src/runtime.mjs';

/** @typedef {{source:string,line:number,column:number,target:string,targetLine:number,targetColumn:number,symbol:string,package?:string}} SemanticSite */
/** @param {SemanticSite[]} rows */
function index(rows) {
  /** @type {import('../src/rust-semantic.mjs').Lsif[]} */
  const output = [{ id: 0, type: 'vertex', label: 'metaData', positionEncoding: 'utf-16' }];
  let id = 1;
  for (const r of rows) {
    const doc = id++,
      source = id++,
      set = id++,
      definition = id++,
      targetDoc = id++,
      target = id++,
      moniker = id++,
      pkg = id++;
    output.push(
      { id: doc, type: 'vertex', label: 'document', uri: pathToFileURL(join(process.cwd(), r.source)).href },
      {
        id: source,
        type: 'vertex',
        label: 'range',
        start: { line: r.line - 1, character: r.column - 1 },
        end: { line: r.line - 1, character: r.column },
      },
      { id: targetDoc, type: 'vertex', label: 'document', uri: pathToFileURL(join(process.cwd(), r.target)).href },
      {
        id: target,
        type: 'vertex',
        label: 'range',
        start: { line: r.targetLine - 1, character: r.targetColumn - 1 },
        end: { line: r.targetLine - 1, character: r.targetColumn },
      },
      { id: moniker, type: 'vertex', label: 'moniker', identifier: r.symbol },
      { id: pkg, type: 'vertex', label: 'packageInformation', name: r.package ?? 'fixture' },
      { id: id++, type: 'edge', label: 'contains', outV: doc, inVs: [source] },
      { id: id++, type: 'edge', label: 'contains', outV: targetDoc, inVs: [target] },
      { id: id++, type: 'edge', label: 'next', outV: source, inV: set },
      { id: id++, type: 'edge', label: 'textDocument/definition', outV: set, inV: definition },
      { id: id++, type: 'edge', label: 'item', outV: definition, inVs: [target] },
      { id: id++, type: 'edge', label: 'moniker', outV: set, inV: moniker },
      { id: id++, type: 'edge', label: 'packageInformation', outV: moniker, inV: pkg },
    );
  }
  return output.map((row) => JSON.stringify(row)).join('\n');
}
/** @param {Record<string,string>} sources @param {SemanticSite[]} rows @param {string[]} [cfg] */
async function extract(sources, rows, cfg = []) {
  const input = snapshot(sources);
  const semantic = readSemanticIndex(input.root, [index(rows)]);
  return parseRust(input, [{ target: { name: 'fixture', src_path: join(process.cwd(), 'src/lib.rs') } }], new Map(), semantic, cfg);
}
/** @param {Record<string,string>} sources @returns {import('../src/model.mjs').AuditInputSnapshot} */
function snapshot(sources) {
  return {
    root: process.cwd(),
    head: 'fixture',
    digest: 'fixture',
    files: Object.entries(sources).map(([path, text]) => ({
      path,
      text,
      role: 'production',
      hash: 'fixture',
      bytes: Buffer.byteLength(text),
      lines: text.split('\n').length,
      ownership: { status: 'unmatched', owner: null, candidates: [] },
    })),
  };
}

test('Rust 2024 foreign declarations preserve the complete parent test scope', async () => {
  const source =
    '#[cfg(all(test,windows))] mod checks { unsafe extern "C" { fn foreign(); } fn helper() { unsafe { foreign(); } } #[test] fn run() { helper(); } } fn production() {}';
  const sites = [
    source.indexOf('fn foreign') + 4,
    source.indexOf('fn helper') + 4,
    source.lastIndexOf('foreign(); }') + 1,
    source.indexOf('helper(); }') + 1,
  ];
  const rows = sites.map((column) => ({
    source: 'src/lib.rs',
    line: 1,
    column,
    target: 'src/lib.rs',
    targetLine: 1,
    targetColumn: source.indexOf('fn foreign') + 4,
    symbol: 'fixture::checks::foreign',
  }));
  const r = await extract({ 'src/lib.rs': source }, rows, ['windows']);
  assert.equal(r.issues.filter((issue) => issue.kind === 'parse').length, 0);
  assert.equal(r.referenceResolutions.length, sites.length);
  assert.ok(r.referenceResolutions.every((row) => row.testOnly && row.conditional.includes('all(test,windows)')));
  assert.ok(r.edges.every((edge) => edge.testOnly && edge.conditional?.includes('all(test,windows)')));
  assert.equal(r.declarations.find((row) => row.name === 'helper')?.scope, 'fixture::checks');
  assert.equal(r.declarations.find((row) => row.name === 'helper')?.testOnly, true);
  assert.equal(r.declarations.find((row) => row.name === 'production')?.testOnly, false);
});

test('compiler-excluded positions remain separate from enabled semantic gaps', async () => {
  const source = '#[cfg(not(windows))] fn other() { missing_other(); } fn live() { missing_live(); }';
  const r = await extract({ 'src/lib.rs': source }, [], ['windows']);
  assert.equal(r.issues.filter((issue) => issue.kind === 'rust-inactive-source').length, 1);
  assert.ok(r.issues.find((issue) => issue.kind === 'rust-inactive-source')?.message.includes('missing_other'));
  assert.equal(r.issues.filter((issue) => issue.kind === 'rust-semantic-coverage').length, 1);
  assert.ok(r.issues.find((issue) => issue.kind === 'rust-semantic-coverage')?.message.includes('missing_live'));
});

test('lifetime attributes and tuple positions do not become missing dependency targets', async () => {
  const source = "#![allow(dead_code)] fn live<'a>(input: &'a str, pair: (u32,u32)) -> &'a str { let _ = pair.0; input }";
  const r = await extract({ 'src/lib.rs': source }, []);
  assert.equal(r.issues.filter((issue) => issue.kind === 'parse').length, 0);
  assert.ok(r.issues.every((issue) => ![' a', ' 0', ' allow', ' dead_code'].some((text) => issue.message.endsWith(text))));
});

test('semantic calls follow the engine target for an arbitrary method and preserve both token positions', async () => {
  const r = await extract(
    {
      'src/lib.rs': 'mod data; mod use_case;',
      'src/data.rs': 'pub struct Item;\nimpl Item { pub fn compute(&self) {} }',
      'src/use_case.rs': 'fn run(item: Unknown) { item.compute(); }',
    },
    [
      {
        source: 'src/use_case.rs',
        line: 1,
        column: 30,
        target: 'src/data.rs',
        targetLine: 2,
        targetColumn: 20,
        symbol: 'fixture::data::Item::compute',
      },
    ],
  );
  const call = r.edges.find((e) => e.parser === 'rust-analyzer LSIF');
  assert.equal(call?.target, 'src/data.rs');
  assert.equal(call?.targetLine, 2);
  assert.equal(call?.column, 30);
  assert.equal(call?.targetSymbol, 'fixture::data::Item::compute');
  assert.equal(r.issues.filter((i) => i.kind === 'rust-semantic-coverage' && i.path === 'src/use_case.rs' && i.column === 30).length, 0);
  assert.ok(r.referenceResolutions.some((x) => x.kind === 'rust-method' && x.route === 'semantic'));
});

test('external declarations inside an ignored cache retain package evidence and their external identity', async () => {
  const r = await extract({ 'src/lib.rs': 'fn run(item:Unknown) { item.read(); }' }, [
    {
      source: 'src/lib.rs',
      line: 1,
      column: 29,
      target: '.audit-tools/cache/library.rs',
      targetLine: 9,
      targetColumn: 5,
      symbol: 'library::Reader::read',
      package: 'library',
    },
  ]);
  assert.equal(r.edges.filter((e) => e.parser === 'rust-analyzer LSIF').length, 0);
  const record = r.referenceResolutions.find((x) => x.kind === 'rust-method');
  assert.equal(record?.reason, 'external-declaration');
  assert.equal(record?.targets[0]?.path, '.audit-tools/cache/library.rs');
  assert.equal(record?.targets[0]?.text, 'library::Reader::read');
});

test('independent engine indexes merge by position while keeping their local record identities separate', () => {
  const data = { source: 'src/a.rs', line: 1, column: 4, target: 'src/b.rs', targetLine: 3, targetColumn: 5, symbol: 'fixture::first' };
  const first = index([data]),
    second = index([{ ...data, symbol: 'fixture::second', targetLine: 7 }]);
  const result = readSemanticIndex(process.cwd(), [first, second]);
  assert.deepEqual(
    result.get('src/a.rs:1:4')?.map((r) => r.symbol),
    ['fixture::first', 'fixture::second'],
  );
  assert.equal(readSemanticIndex(process.cwd(), [first, first]).get('src/a.rs:1:4')?.length, 1);
});

test('semantic field dispatch points to its declaration contract', async () => {
  const r = await extract({ 'src/lib.rs': 'struct Actions { run:fn() }\nfn use_it(actions:Unknown) { (actions.run)(); }' }, [
    { source: 'src/lib.rs', line: 2, column: 39, target: 'src/lib.rs', targetLine: 1, targetColumn: 18, symbol: 'fixture::Actions::run' },
  ]);
  const field = r.referenceResolutions.find((x) => x.kind === 'rust-field-call');
  assert.ok(field);
  assert.equal(field.reason, 'callable-field-contract');
  const edge = r.edges.find((x) => x.parser === 'rust-analyzer LSIF');
  assert.equal(edge?.kind, 'rust-field');
  assert.equal(edge?.targetLine, 1);
});

test('missing semantic positions retain their actual cfg and test evidence', async () => {
  const r = await extract({ 'src/lib.rs': '#[cfg(test)] mod tests { fn run(item:Unknown) { item.read(); } }' }, []);
  const issue = r.issues.find((x) => x.kind === 'rust-semantic-coverage');
  assert.ok(issue?.testOnly);
  assert.ok(issue?.conditional?.includes('test'));
  assert.equal(issue?.parser, 'rust-analyzer LSIF');
  assert.equal(issue?.candidates, undefined);
});

test('generated methods retain the engine expansion origin', async () => {
  const r = await extract({ 'src/lib.rs': '#[derive(Clone)]\nstruct Item;\nfn run(item:Unknown) { item.clone(); }' }, [
    {
      source: 'src/lib.rs',
      line: 3,
      column: 29,
      target: 'src/lib.rs',
      targetLine: 1,
      targetColumn: 10,
      symbol: 'fixture::Item::Clone::clone',
    },
  ]);
  const edge = r.edges.find((x) => x.parser === 'rust-analyzer LSIF');
  assert.equal(edge?.targetLine, 1);
  assert.equal(edge?.kind, 'rust-call');
  assert.ok(edge?.evidence?.some((e) => e.text.includes('expansion origin')));
});

test('engine-defined trait declarations retain the contract without choosing an implementation', async () => {
  const r = await extract({ 'src/lib.rs': 'trait Reader { fn read(&self); }\nfn run<T:Reader>(item:&T) { item.read(); }' }, [
    { source: 'src/lib.rs', line: 2, column: 34, target: 'src/lib.rs', targetLine: 1, targetColumn: 19, symbol: 'fixture::Reader::read' },
  ]);
  const edge = r.edges.find((x) => x.parser === 'rust-analyzer LSIF');
  assert.equal(edge?.targetSymbol, 'fixture::Reader::read');
  assert.equal(edge?.kind, 'rust-call');
});

test('unsupported position encodings and corrupt semantic indexes fail explicitly', () => {
  assert.throws(
    () => readSemanticIndex(process.cwd(), ['{"id":0,"type":"vertex","label":"metaData","positionEncoding":"utf-8"}']),
    /position encoding/,
  );
  assert.throws(() => readSemanticIndex(process.cwd(), ['{broken']), SyntaxError);
});

test('setup registers the pinned engine through its own implementation', () => {
  const command = setupCommands(false).find((c) => c.name === 'rust-analyzer');
  assert.ok(command);
  assert.equal(command.command, process.execPath);
  assert.equal(command.args[0], join(toolRoot, 'src/rust-semantic.mjs'));
  assert.equal(semanticVersion, '0.3.3105');
});

test('source tokens use UTF-16 positions with non-ASCII text and supplementary characters', async () => {
  const source = 'fn run(item:Unknown) { let _ = "星🚀"; item.read(); }';
  const column = source.indexOf('read') + 1;
  const r = await extract({ 'src/lib.rs': source, 'src/接口.rs': 'pub fn read() {}' }, [
    { source: 'src/lib.rs', line: 1, column, target: 'src/接口.rs', targetLine: 1, targetColumn: 8, symbol: 'fixture::read' },
  ]);
  const method = r.referenceResolutions.find((row) => row.kind === 'rust-method');
  assert.equal(method?.reason, 'project-declaration');
  const edge = r.edges.find((row) => row.parser === 'rust-analyzer LSIF');
  assert.equal(edge?.column, column);
  assert.equal(edge?.target, 'src/接口.rs');
});

test('type and value targets use the engine even when the source spelling names a different declaration', async () => {
  const r = await extract(
    {
      'src/lib.rs': 'mod data; mod usage;',
      'src/data.rs': 'pub struct Actual;\npub fn actual() {}',
      'src/usage.rs': 'fn run(value: Alias) { expected(); }',
    },
    [
      {
        source: 'src/usage.rs',
        line: 1,
        column: 15,
        target: 'src/data.rs',
        targetLine: 1,
        targetColumn: 12,
        symbol: 'fixture::data::Actual',
      },
      {
        source: 'src/usage.rs',
        line: 1,
        column: 24,
        target: 'src/data.rs',
        targetLine: 2,
        targetColumn: 8,
        symbol: 'fixture::data::actual',
      },
    ],
  );
  assert.ok(r.edges.some((e) => e.targetSymbol === 'fixture::data::Actual'));
  assert.ok(r.edges.some((e) => e.targetSymbol === 'fixture::data::actual'));
  assert.ok(r.edges.every((e) => e.parser === 'rust-analyzer LSIF'));
});

test('same-token shorthand preserves both the local binding and destination field', async () => {
  const rows = [
    { source: 'src/lib.rs', line: 1, column: 83, target: 'src/lib.rs', targetLine: 1, targetColumn: 62, symbol: '' },
    { source: 'src/lib.rs', line: 1, column: 83, target: 'src/lib.rs', targetLine: 1, targetColumn: 19, symbol: 'fixture::Record::value' },
  ];
  const source = 'struct Record { value:u32 } fn run() { let value:u32=1; let record=Record { value }; }';
  const column = source.lastIndexOf('value') + 1;
  for (const row of rows) row.column = column;
  const r = await extract({ 'src/lib.rs': source }, rows);
  const item = r.referenceResolutions.find((item) => item.line === 1 && item.column === column);
  assert.equal(item?.targets.length, 2);
  assert.equal(r.edges.filter((e) => e.column === column).length, 2);
});

test('module name prefixes and visibility keep structural roles with engine identities', async () => {
  const source = 'pub(in crate::data) fn run() {}';
  const r = await extract({ 'src/lib.rs': source, 'src/data.rs': 'pub struct Record;' }, [
    { source: 'src/lib.rs', line: 1, column: 15, target: 'src/data.rs', targetLine: 1, targetColumn: 1, symbol: 'fixture::data' },
  ]);
  assert.ok(r.edges.every((e) => e.dependencyClass === 'structure'));
});

test('semantic rules distinguish named and qualified cross-business types', async () => {
  const sources = {
    'src/lib.rs': 'mod data; mod usage;',
    'src/data.rs': 'pub struct Record;',
    'src/usage.rs': 'use crate::data::Record; fn run(value:Record,other:crate::data::Record) {}',
  };
  const source = sources['src/usage.rs'];
  const rows = [source.indexOf('Record') + 1, source.indexOf('value:Record') + 7, source.lastIndexOf('Record') + 1].map((column) => ({
    source: 'src/usage.rs',
    line: 1,
    column,
    target: 'src/data.rs',
    targetLine: 1,
    targetColumn: 12,
    symbol: 'fixture::data::Record',
  }));
  const input = snapshot(sources);
  const semantic = readSemanticIndex(input.root, [index(rows)]);
  const r = await parseRust(
    input,
    [{ target: { name: 'fixture', src_path: join(process.cwd(), 'src/lib.rs') } }],
    new Map([
      ['src/data.rs', 'data'],
      ['src/usage.rs', 'usage'],
    ]),
    semantic,
  );
  const issues = r.issues.filter((i) => i.kind === 'rust-business-type-import');
  assert.equal(issues.length, 1);
  assert.ok(issues[0]?.message.startsWith('crate::data::Record'));
});

test('semantic export rules preserve direct, chained and wildcard boundaries', async () => {
  const sources = {
    'src/lib.rs': 'mod data; mod api; mod facade; mod wildcard;',
    'src/data.rs': 'pub struct Record;',
    'src/api.rs': 'pub use crate::data::Record;',
    'src/facade.rs': 'pub use crate::api::Record;',
    'src/wildcard.rs': 'pub use crate::data::*;',
  };
  const row = (
    /** @type {string} */ source,
    /** @type {number} */ column,
    /** @type {string} */ target,
    /** @type {number} */ targetColumn,
    /** @type {string} */ symbol,
  ) => ({ source, line: 1, column, target, targetLine: 1, targetColumn, symbol });
  const rows = [
    row('src/api.rs', 22, 'src/data.rs', 12, 'fixture::data::Record'),
    row('src/api.rs', 16, 'src/data.rs', 1, 'fixture::data'),
    row('src/facade.rs', 21, 'src/data.rs', 12, 'fixture::data::Record'),
    row('src/facade.rs', 16, 'src/api.rs', 1, 'fixture::api'),
    row('src/wildcard.rs', 16, 'src/data.rs', 1, 'fixture::data'),
  ];
  const input = snapshot(sources);
  const r = await parseRust(
    input,
    [{ target: { name: 'fixture', src_path: join(process.cwd(), 'src/lib.rs') } }],
    new Map(Object.keys(sources).map((p) => [p, p])),
    readSemanticIndex(input.root, [index(rows)]),
  );
  assert.deepEqual(
    r.issues.filter((i) => i.kind.startsWith('rust-business-export')).map((i) => [i.kind, i.path]),
    [
      ['rust-business-export-depth', 'src/facade.rs'],
      ['rust-business-export-glob', 'src/wildcard.rs'],
    ],
  );
});

test('all syntax roles preserve their engine target while tests stay scoped', async () => {
  const source = '#[cfg(test)] mod tests { use crate::data::Record; fn run() { let value=Record; } }';
  const rows = [source.indexOf('Record') + 1, source.lastIndexOf('Record') + 1].map((column) => ({
    source: 'src/lib.rs',
    line: 1,
    column,
    target: 'src/data.rs',
    targetLine: 1,
    targetColumn: 12,
    symbol: 'fixture::data::Record',
  }));
  const r = await extract({ 'src/lib.rs': source, 'src/data.rs': 'pub struct Record;' }, rows);
  assert.ok(r.edges.every((e) => e.testOnly && e.conditional?.includes('test')));
  assert.ok(r.referenceResolutions.every((e) => e.route === 'semantic'));
});

test('declaration identities use engine symbols and keep unavailable declarations explicit', async () => {
  const r = await extract({ 'src/lib.rs': 'fn shown() {}\nfn unavailable() {}' }, [
    { source: 'src/lib.rs', line: 1, column: 4, target: 'src/lib.rs', targetLine: 1, targetColumn: 4, symbol: 'engine::canonical::shown' },
  ]);
  assert.equal(r.declarations.find((d) => d.name === 'shown')?.qualified, 'engine::canonical::shown');
  assert.equal(r.declarations.find((d) => d.name === 'unavailable')?.qualified, null);
});

test('indexed module declarations select the engine file before syntax-only location', async () => {
  const r = await extract({ 'src/lib.rs': 'mod chosen;', 'src/resolved.rs': 'pub fn value() {}' }, [
    { source: 'src/lib.rs', line: 1, column: 5, target: 'src/resolved.rs', targetLine: 1, targetColumn: 1, symbol: 'engine::chosen' },
  ]);
  assert.deepEqual(
    r.moduleParents.map((p) => p.childPath),
    ['src/resolved.rs'],
  );
  assert.equal(r.issues.filter((i) => i.kind === 'rust-module-location').length, 0);
});
