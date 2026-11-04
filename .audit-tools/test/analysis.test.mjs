import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRust } from '../src/rust.mjs';
import { inferOwnership, declaredRustOwners, declaredDependencies, cycles, validateReport } from '../src/analyze.mjs';
import { readModules, assertUnchanged } from '../src/collect.mjs';
import { csv, embeddedJson } from '../src/report.mjs';
import { join } from 'node:path';

/** @param {string} path @param {string} text @param {string} [role] @returns {import('../src/model.mjs').File} */
function file(path, text, role = 'production') {
  return {
    path,
    text,
    hash: 'hash-' + path,
    lines: text.split('\n').length,
    bytes: Buffer.byteLength(text),
    role,
    ownership: { status: 'unmatched', owner: null, candidates: [] },
  };
}

/** @param {import('../src/model.mjs').File[]} files @param {string} [root] */
function snapshot(files, root = '/project') {
  return { files, root, head: 'head', digest: 'digest' };
}
/** @param {string} id @param {[string, boolean?, boolean?][]} references @returns {import('../src/model.mjs').Module} */
function module(id, references) {
  return {
    id,
    path: `.zcode/modules/${id}.md`,
    title: id,
    references: references.map(([path, owner = false, consumer = false]) => ({
      path,
      role: owner ? 'owner' : consumer ? 'consumer' : 'reference',
      line: 10,
      kind: owner ? 'owns' : consumer ? 'consumes' : 'related',
    })),
  };
}

test('ownership retains competing evidence, consumer references and unmatched files', () => {
  const files = [file('shared.ts', ''), file('shared.spec.ts', '', 'test'), file('unknown.bin', ''), file('only.ts', '')];
  const modules = [
    module('alpha', [
      ['shared.ts', true],
      ['only.ts', true],
    ]),
    module('beta', [
      ['shared.ts', true],
      ['only.ts', false, true],
    ]),
  ];
  inferOwnership(files, modules, []);
  assert.equal(files[0]?.ownership.status, 'conflict');
  assert.equal(files[1]?.ownership.status, 'conflict');
  assert.equal(files[2]?.ownership.status, 'unmatched');
  assert.equal(files[3]?.ownership.owner, 'alpha');
  assert.equal(files[0]?.ownership.candidates.length, 2);
});

test('Rust boundary owners use only one direct owner and exclude public files', () => {
  const files = [
    file('.zcode/module-map.md', '## 公共文件\n\n- `src/public.rs`：公共类型。'),
    file('src/owned.rs', ''),
    file('src/public.rs', ''),
    file('src/conflict.rs', ''),
  ];
  const modules = [
    module('alpha', [
      ['src/owned.rs', true],
      ['src/conflict.rs', true],
    ]),
    module('beta', [['src/conflict.rs', true]]),
  ];
  const owners = declaredRustOwners(files, modules);
  assert.equal(owners.get('src/owned.rs'), 'alpha');
  assert.equal(owners.has('src/public.rs'), false);
  assert.equal(owners.has('src/conflict.rs'), false);
});

test('only declared ownership enters the formal module graph and test pairing retains its origin', () => {
  const files = ['src/shared.ts', 'src/shared.spec.ts', 'src/host.vue', 'src/candidate.ts', 'src/conflict.ts', 'src/free.ts'].map((path) =>
    file(path, '', path.includes('.spec.') ? 'test' : 'production'),
  );
  const modules = [
    module('alpha', [
      ['src/shared.ts', true],
      ['src/conflict.ts', true],
    ]),
    module('beta', [
      ['src/host.vue', true],
      ['src/shared.ts', false, true],
      ['src/conflict.ts', true],
      ['src/candidate.ts', false, true],
    ]),
  ];
  const edges = files.slice(1).map((entry) => ({
    source: 'src/host.vue',
    target: entry.path,
    kind: 'type',
    line: 7,
    symbols: 'Shape',
    parser: 'fixture',
  }));
  edges.push({
    source: 'src/host.vue',
    target: 'src/shared.ts',
    kind: 'runtime',
    line: 8,
    symbols: 'run',
    parser: 'fixture',
  });
  inferOwnership(files, modules, edges);
  assert.equal(files[0]?.ownership.owner, 'alpha');
  assert.deepEqual(
    files[0]?.ownership.candidates.map((item) => item.relation),
    ['owns', 'consumes'],
  );
  assert.equal(files[1]?.ownership.owner, 'alpha');
  assert.ok(files[1]?.ownership.candidates[0]?.evidence.some((item) => item.path === 'src/shared.ts' && item.parser === 'file-pair'));
  assert.equal(files[3]?.ownership.status, 'candidate');
  assert.equal(files[3]?.ownership.owner, null);
  assert.ok(files[3]?.ownership.candidates.some((item) => item.relation === 'consumer-reference' && item.evidence[0]?.line === 7));
  assert.equal(files[4]?.ownership.status, 'conflict');
  assert.deepEqual(
    declaredDependencies(files, edges).map((edge) => edge.target),
    ['src/shared.spec.ts', 'src/shared.ts'],
  );
});

test('directory coverage follows path segments and multiple owners retain every declaration', () => {
  const files = ['src/area/item.ts', 'src/area/item.spec.ts', 'src/area-extra.ts'].map((path) => file(path, ''));
  const modules = [module('alpha', [['src/area', true]]), module('beta', [['src/area/item.ts', true]])];
  inferOwnership(files, modules, []);
  assert.equal(files[0]?.ownership.status, 'conflict');
  assert.equal(files[1]?.ownership.status, 'conflict');
  assert.equal(files[2]?.ownership.status, 'unmatched');
  assert.equal(files[1]?.ownership.candidates.filter((item) => item.relation === 'test-owner').length, 2);
  const rust = [file('src/rules.rs', ''), file('src/rules_tests.rs', '', 'test')];
  inferOwnership(rust, [module('alpha', [['src/rules.rs', true]])], []);
  assert.equal(rust[1]?.ownership.owner, 'alpha');
  assert.equal(rust[1]?.ownership.candidates[0]?.evidence.at(-1)?.path, 'src/rules.rs');
  inferOwnership(rust, [module('alpha', [['src/rules.rs', false, true]])], []);
  assert.equal(rust[1]?.ownership.status, 'candidate');
  assert.equal(rust[1]?.ownership.candidates[0]?.relation, 'test-consumes');
});

test('Rust tests inherit a unique production owner through nested test modules', () => {
  const files = [
    file('src/joint_edit.rs', '', 'production'),
    file('src/joint_edit_tests.rs', '', 'test'),
    file('src/joint_skin_tests.rs', '', 'test'),
    file('src/ambiguous.rs', '', 'production'),
    file('src/ambiguous_tests.rs', '', 'test'),
  ];
  const modules = [module('joint-editing', [['src/joint_edit.rs', true]])];
  const parents = [
    { parentPath: 'src/joint_edit.rs', childPath: 'src/joint_edit_tests.rs', line: 12, testOnly: true },
    { parentPath: 'src/joint_edit_tests.rs', childPath: 'src/joint_skin_tests.rs', line: 8, testOnly: true },
    { parentPath: 'src/joint_edit.rs', childPath: 'src/ambiguous_tests.rs', line: 20, testOnly: true },
  ];
  modules.push(module('entity-write', [['src/ambiguous.rs', true]]));
  inferOwnership(files, modules, [], parents);
  assert.equal(files[1]?.ownership.owner, 'joint-editing');
  assert.equal(files[2]?.ownership.owner, 'joint-editing');
  assert.deepEqual(
    files[2]?.ownership.candidates[0]?.evidence.map((item) => [item.path, item.line, item.parser]),
    [
      ['.zcode/modules/joint-editing.md', 10, 'module-document'],
      ['src/joint_edit.rs', 1, 'file-pair'],
      ['src/joint_edit_tests.rs', 8, 'rust-module'],
    ],
  );
  assert.equal(files[4]?.ownership.owner, 'entity-write');
});

test('Rust assembly preserves declared owners, records competing parents and follows file-level test conditions', async () => {
  const files = [
    file('src/lib.rs', 'mod left; mod right;'),
    file('src/left.rs', '#[cfg(test)]\n#[path = "cases.rs"]\nmod tests;\n#[path = "inner.rs"]\nmod inner;'),
    file('src/right.rs', '#[cfg(test)]\n#[path = "cases.rs"]\nmod tests;'),
    file('src/cases.rs', 'fn check() {}'),
    file('src/inner.rs', '#![cfg(test)]\n#[path = "child.rs"]\nmod child;'),
    file('src/child.rs', 'fn check() {}'),
  ];
  const modules = [module('left', [['src/left.rs', true]]), module('right', [['src/right.rs', true]])];
  const facts = await parseRust(
    snapshot(files, process.cwd()),
    [{ target: { name: 'fixture', src_path: join(process.cwd(), 'src/lib.rs') } }],
    new Map(),
    new Map(),
  );
  inferOwnership(files, modules, facts.edges, facts.moduleParents);
  assert.equal(files[3]?.role, 'test');
  assert.equal(files[3]?.ownership.status, 'conflict');
  assert.deepEqual(
    files[3]?.ownership.candidates.map((candidate) => candidate.module),
    ['left', 'right'],
  );
  assert.equal(files[4]?.ownership.owner, 'left');
  assert.equal(files[5]?.ownership.owner, 'left');
  assert.ok(files[5]?.ownership.candidates[0]?.evidence.some((item) => item.path === 'src/inner.rs' && item.line === 3));
});

test('Rust nested tests inherit public ownership through actual assembly', () => {
  const files = [
    file('.zcode/module-map.md', '## 公共文件\n\n- `src/public.rs`：公共类型。'),
    file('src/public.rs', ''),
    file('src/cases.rs', '', 'test'),
    file('src/nested.rs', '', 'test'),
  ];
  inferOwnership(
    files,
    [],
    [],
    [
      { parentPath: 'src/public.rs', childPath: 'src/cases.rs', line: 4, testOnly: true },
      { parentPath: 'src/cases.rs', childPath: 'src/nested.rs', line: 7, testOnly: true },
    ],
  );
  assert.equal(files[2]?.ownership.status, 'shared');
  assert.equal(files[3]?.ownership.status, 'shared');
  assert.ok(files[3]?.ownership.sharedEvidence?.some((item) => item.path === 'src/cases.rs' && item.line === 7));
});

test('shared directories and declared public files stay outside module ownership and dependencies', () => {
  const files = [
    file('.zcode/module-map.md', '## 公共文件\n\n- `native/common.rs`：公共类型。\n- `src/read.ts`：公共读取。\n\n## 模块索引\n'),
    ...[
      'src/shared/value.ts',
      'scripts/shared/check.mjs',
      'native/common.rs',
      'src/read.ts',
      'src/read.spec.ts',
      'src/owned.ts',
      'src/shared-other.ts',
    ].map((path) => file(path, '')),
  ];
  const modules = [
    module(
      'alpha',
      files.slice(1).map((entry) => [entry.path, true]),
    ),
  ];
  const edges = files.slice(1).map((entry) => ({
    source: 'src/owned.ts',
    target: entry.path,
    kind: 'type',
    line: 1,
    symbols: 'Value',
    parser: 'fixture',
  }));
  inferOwnership(files, modules, edges);
  for (const entry of files.slice(1, 6)) {
    assert.equal(entry.ownership.status, 'shared');
    assert.equal(entry.ownership.owner, null);
    assert.deepEqual(entry.ownership.candidates, []);
    assert.ok(entry.ownership.sharedEvidence?.length);
  }
  assert.equal(files.at(-1)?.ownership.owner, 'alpha');
  assert.deepEqual(declaredDependencies(files, edges), []);
  assert.equal(edges.length, 7);
});

test('reference headings determine relations independently of ownership words in remarks', () => {
  const doc =
    '# 甲\n\n## 参考\n\n### 拥有\n\n- `owned.ts`：实现。\n\n### 消费\n\n- `external.ts`：消费唯一实例 owner。\n\n### 装配\n\n- `host.ts`：宿主拥有状态。\n\n### 关联\n\n- `mixed.ts`：唯一 owner 待核。\n\n## 边界\n\n- `ignored.ts`：无关记录。\n';
  const files = ['owned.ts', 'external.ts', 'host.ts', 'mixed.ts', 'ignored.ts'].map((path) => file(path, ''));
  for (const source of [doc, doc.replaceAll('\n', '\r\n')]) {
    const { modules } = readModules(
      snapshot([file('.zcode/module-map.md', '- [甲](modules/alpha.md)：职责。\n'), file('.zcode/modules/alpha.md', source)]),
    );
    assert.deepEqual(
      modules[0]?.references.map((entry) => entry.kind),
      ['owns', 'consumes', 'assembles', 'related'],
    );
    assert.equal(modules[0]?.references[1]?.role, '消费唯一实例 owner。');
    assert.equal(modules[0]?.references[1]?.line, 11);
    inferOwnership(files, modules, []);
    assert.deepEqual(
      files.map((entry) => entry.ownership.status),
      ['declared', 'candidate', 'candidate', 'candidate', 'unmatched'],
    );
  }
});

test('module discovery consumes current index/documents and reports missing documents', () => {
  const data = snapshot([
    file('.zcode/module-map.md', '- [甲](modules/alpha.md)：x\n- [乙](modules/beta.md)：y\n'),
    file('.zcode/modules/alpha.md', '# 甲\n\n## 参考\n\n### 拥有\n\n- `src/main.ts`：入口。\n'),
  ]);
  const result = readModules(data);
  assert.equal(result.modules.length, 1);
  assert.equal(result.modules[0]?.references[0]?.path, 'src/main.ts');
  assert.equal(result.issues.length, 1);
  assert.throws(() => assertUnchanged(data, { ...data, digest: 'changed', files: [] }), /Source changed/);
});

test('Rust syntax metadata preserves inline modules, path attributes, commands, events and test conditions', async () => {
  const root = process.cwd();
  const files = [
    file(
      'src/lib.rs',
      `#[path = "custom.rs"] mod selected;\nmod inline { pub fn work() {} }\n#[cfg(test)] mod tests { fn sample() {} }\nfn boot() { tauri::generate_handler![selected::read_item]; app.emit("content-changed", ()); }`,
    ),
    file('src/custom.rs', `#[tauri::command]\npub fn read_item() {}\npub use crate::inline::work;\nstruct Settings { read_item: bool }`),
  ];
  const result = await parseRust(
    snapshot(files, root),
    [{ target: { name: 'sample', src_path: join(root, 'src/lib.rs') } }],
    new Map(),
    new Map(),
  );
  assert.equal(result.commands.get('read_item')?.[0]?.line, 2);
  assert.equal(result.events[0]?.value, 'content-changed');
  assert.ok(result.declarations.find((entry) => entry.name === 'sample')?.conditional?.includes('cfg(test)'));
});

test('cycles use runtime and type edges; exports remain machine readable and escaped', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ];
  assert.deepEqual(cycles(edges, 'file'), [{ kind: 'file', members: ['a', 'b'], chain: ['a', 'b', 'a'] }]);
  assert.equal(
    csv([
      ['name', 'value'],
      ['中文', 'a"b\nc'],
    ]),
    '"name","value"\n"中文","a""b\nc"\n',
  );
  assert.equal(embeddedJson({ value: '</script>' }), '{"value":"\\u003c/script>"}');
});

test('report validation rejects missing endpoints and unsupported ownership claims', () => {
  const files = [file('entry.ts', '')];
  const modules = [module('alpha', [['entry.ts', true]])];
  inferOwnership(files, modules, []);
  const data = {
    schemaVersion: 5,
    run: {},
    declarations: [],
    events: [],
    issues: [],
    cycles: [],
    rust: { symbols: [], relations: [] },
    exploration: null,
    files,
    modules,
    edges: [{ source: 'entry.ts', target: 'missing.ts', kind: 'fixture', line: 1, symbols: 'fixture', parser: 'fixture' }],
  };
  assert.throws(() => validateReport(data), /Unknown dependency endpoint/);
  data.edges = [];
  const first = files[0];
  assert.ok(first);
  first.ownership.candidates.push({ module: 'unknown', relation: 'fixture', evidence: [] });
  assert.throws(() => validateReport(data), /Unknown ownership module/);
});
