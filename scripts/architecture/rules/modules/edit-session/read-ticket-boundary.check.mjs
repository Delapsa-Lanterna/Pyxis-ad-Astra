import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { readTicketBoundaryRule } from './read-ticket-boundary.mjs';

const ticket = 'src/shared/runtime/read-request.ts';
for (const source of [
  "import {createReadTicketOwner as owner} from '@/shared/runtime/read-request';",
  "import * as reads from '@/shared/runtime/read-request';",
  "const reads=import('@/shared/runtime/read-request');",
]) {
  test('read ticket ownership follows ' + source, () => {
    const declarations = { [ticket]: 'export function createReadTicketOwner() {}' };
    const legal = architectureFixtures({ ...declarations, 'src/app/composables/use-sample.ts': source });
    assert.deepEqual(readTicketBoundaryRule.check(legal), []);
    const context = architectureFixtures({ ...declarations, 'src/app/components/Sample.vue': '<script setup>\n' + source + '</script>' });
    const [diagnostic] = readTicketBoundaryRule.check(context);
    assert.equal(diagnostic.ruleId, 'read-ticket-boundary');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.target, ticket);
    assert.equal(diagnostic.expected, 'read runtime or composable');
  });
}
test('read ticket types and unrelated local names retain their own meaning', () => {
  const context = architectureFixtures({
    [ticket]: 'export interface ReadTicket {}',
    'src/app/components/Sample.vue':
      '<script setup lang="ts">import type {ReadTicket} from "@/shared/runtime/read-request"; const createQueryReadOwner = "sample";</script>',
  });
  assert.deepEqual(readTicketBoundaryRule.check(context), []);
});

test('direct ReadTicket consumers must accept and invalidate their ticket', () => {
  const invalid = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts':
      "import {createReadTicket} from '@/shared/runtime/read-request'; const ticket=createReadTicket(id, load); void ticket.promise;",
  });
  const diagnostics = readTicketBoundaryRule.check(invalid);
  assert.deepEqual(diagnostics.map(({ expected }) => expected).sort(), ['ticket.accept()', 'ticket.invalidate(reason)'].sort());
  const legal = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts':
      "import {createReadTicket} from '@/shared/runtime/read-request'; const ticket=createReadTicket(id, load); void ticket.promise.then(() => ticket.accept()); onScopeDispose(() => ticket.invalidate('consumer'));",
  });
  assert.deepEqual(readTicketBoundaryRule.check(legal), []);
});

test('each direct ticket keeps its own acceptance obligation', () => {
  const context = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts': `
      import {createReadTicket} from '@/shared/runtime/read-request';
      const first=createReadTicket(firstId, load);
      const second=createReadTicket(secondId, load);
      void first.promise.then(() => first.accept());
      onScopeDispose(() => { first.invalidate('consumer'); second.invalidate('consumer'); });
    `,
  });
  assert.deepEqual(
    readTicketBoundaryRule.check(context).map(({ expected }) => expected),
    ['ticket.accept()'],
  );
});

for (const unrelated of [
  'function separate(task) { task.accept(); task.invalidate(); }',
  'function separate() { const task = external(); task.accept(); task.invalidate(); }',
  'function separate(other) { other.task.accept(); other.task.invalidate(); }',
  'function separate({ task }) { task.accept(); task.invalidate(); }',
  '{ const task = external(); task.accept(); task.invalidate(); }',
  'try {} catch (task) { task.accept(); task.invalidate(); }',
]) {
  test('unrelated declarations preserve both ticket obligations: ' + unrelated, () => {
    const context = architectureFixtures({
      [ticket]: 'export function createReadTicket() {}',
      'src/app/composables/use-sample.ts': `import {createReadTicket} from '@/shared/runtime/read-request';
function read() { const task = createReadTicket(id, load); void task.promise; }
${unrelated}`,
    });
    const diagnostics = readTicketBoundaryRule.check(context);
    assert.deepEqual(
      diagnostics.map(({ expected }) => expected),
      ['ticket.accept()', 'ticket.invalidate(reason)'],
    );
    assert.ok(diagnostics.every((diagnostic) => diagnostic.ruleId === 'read-ticket-boundary' && diagnostic.line === 2));
  });
}

test('same-named tickets in separate functions retain independent obligations', () => {
  const context = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts': `import {createReadTicket} from '@/shared/runtime/read-request';
function complete() { const task = createReadTicket(id, load); task.accept(); task.invalidate(); }
function incomplete() { const task = createReadTicket(id, load); }`,
  });
  const diagnostics = readTicketBoundaryRule.check(context);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((diagnostic) => diagnostic.line === 3));
});

for (const handoff of [
  'const alias = task; queueMicrotask(() => alias.accept()); onScopeDispose(() => task.invalidate());',
  'const owner = { task }; owner.task.accept(); owner.task.invalidate();',
  'const owner = { active: task }; const alias = owner; alias.active.accept(); alias.active.invalidate();',
  'function finish(input) { input.accept(); input.invalidate(); } finish(task);',
  'const pending = new Map(); pending.set(id, { task }); const item = pending.get(id); item.task.accept(); item.task.invalidate();',
  'const pending = new Set(); pending.add({ task }); for (const item of pending) { item.task.accept(); item.task.invalidate(); }',
  'const pending = new Map(); const queued = { active: new Map() }; const item = {}; pending.set(id, item); queued.active.set(id, item); function start(job) { job.ticket = task; } start(queued.active.values().next().value); for (const [key, job] of pending) { job.ticket.accept(); job.ticket.invalidate(); }',
]) {
  test('explicit ticket handoff preserves lifecycle evidence: ' + handoff, () => {
    const context = architectureFixtures({
      [ticket]: 'export function createReadTicket() {}',
      'src/app/composables/use-sample.ts': `import {createReadTicket} from '@/shared/runtime/read-request';
const task = createReadTicket(id, load); ${handoff}`,
    });
    assert.deepEqual(readTicketBoundaryRule.check(context), []);
  });
}

test('collection wrappers follow their implementation after public methods are renamed', () => {
  for (const [read, write] of [
    ['lookup', 'retain'],
    ['findItem', 'rememberItem'],
  ]) {
    const storage = `export function createStorage() {
const items = new Map(); const separate = new Map();
return { ${read}(key) { return items.get(key); }, ${write}(key, value) { items.set(key, value); },
readSeparate(key) { return separate.get(key); } }; }`;
    const context = architectureFixtures({
      [ticket]: 'export function createReadTicket() {}',
      'src/shared/storage.ts': storage,
      'src/app/composables/use-sample.ts': `import {createReadTicket} from '@/shared/runtime/read-request';
import {createStorage} from '@/shared/storage';
const storage = createStorage(); const task = createReadTicket(id, load);
storage.${write}(id, { task }); const held = storage.${read}(id);
held.task.accept(); held.task.invalidate();`,
    });
    assert.deepEqual(readTicketBoundaryRule.check(context), []);
    const consumer = context.byPath.get('src/app/composables/use-sample.ts');
    assert.ok(consumer);
    const unrelated = architectureFixtures({
      [ticket]: 'export function createReadTicket() {}',
      'src/shared/storage.ts': storage,
      [consumer.rel]: consumer.text.replace(`storage.${read}(id)`, 'storage.readSeparate(id)'),
    });
    assert.equal(readTicketBoundaryRule.check(unrelated).length, 2);
  }
});

test('same-named object properties retain their declared owner through aliases', () => {
  const context = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts': `import {createReadTicket} from '@/shared/runtime/read-request';
const task = createReadTicket(id, load); const owner = { task }; const other = { task: external() };
other.task.accept(); other.task.invalidate();`,
  });
  assert.equal(readTicketBoundaryRule.check(context).length, 2);
});

/** @param {string} body @param {Record<string, string>} [sources] */
function collectionDiagnostics(body, sources = {}) {
  return readTicketBoundaryRule.check(
    architectureFixtures({
      [ticket]: 'export function createReadTicket() {}',
      'src/app/composables/use-sample.ts': "import {createReadTicket} from '@/shared/runtime/read-request';\n" + body,
      ...sources,
    }),
  );
}

for (const access of ["pending.get('left')", "constAlias.get('left')", 'pending.get(selected)']) {
  test('Map keys preserve each ticket obligation through ' + access, () => {
    const diagnostics = collectionDiagnostics(`const left = createReadTicket(a, load);
const right = createReadTicket(b, load);
const pending = new Map(), constAlias = pending, selected = 'left';
pending.set('left', left); pending.set('right', right);
${access}.accept(); ${access}.invalidate();`);
    assert.deepEqual(
      diagnostics.map(({ line, expected }) => ({ line, expected })),
      [
        { line: 3, expected: 'ticket.accept()' },
        { line: 3, expected: 'ticket.invalidate(reason)' },
      ],
    );
  });
}

for (const handling of [
  'for (const item of pending.values()) { item.accept(); item.invalidate(); }',
  'for (const key of pending.keys()) { pending.get(key).accept(); pending.get(key).invalidate(); }',
  "pending.get('left').accept(); pending.get('left').invalidate(); pending.get('right').accept(); pending.get('right').invalidate();",
])
  test('all Map entries retain complete lifecycle evidence: ' + handling, () => {
    assert.deepEqual(
      collectionDiagnostics(`const left = createReadTicket(a, load), right = createReadTicket(b, load);
const pending = new Map(); pending.set('left', left); pending.set('right', right); ${handling}`),
      [],
    );
  });

test('taking the first Map value preserves the remaining ticket obligations', () => {
  const diagnostics = collectionDiagnostics(`const left = createReadTicket(a, load), right = createReadTicket(b, load);
const pending = new Map(); pending.set('left', left); pending.set('right', right);
const first = pending.values().next().value; first.accept(); first.invalidate();`);
  assert.deepEqual(
    diagnostics.map(({ expected }) => expected),
    ['ticket.accept()', 'ticket.invalidate(reason)'],
  );
});

test('wrapped Map methods preserve keys and entry properties', () => {
  const diagnostics = collectionDiagnostics(
    `import {createStorage} from '@/shared/storage';
const left = createReadTicket(a, load);
const right = createReadTicket(b, load);
const storage = createStorage(); storage.retain({task:left}, 'left'); storage.retain({task:right}, 'right');
storage.lookup('left').task.accept(); storage.lookup('left').task.invalidate();`,
    {
      'src/shared/storage.ts': `export function createStorage() { const values = new Map();
return { retain(value, key) { values.set(key, value); }, lookup(key) { return values.get(key); } }; }`,
    },
  );
  assert.deepEqual(
    diagnostics.map(({ line, expected }) => ({ line, expected })),
    [
      { line: 4, expected: 'ticket.accept()' },
      { line: 4, expected: 'ticket.invalidate(reason)' },
    ],
  );
});

for (const [first, second] of [
  ["'same'", '1'],
  ['1', "'1'"],
  ['leftKey', 'rightKey'],
]) {
  test(`Map key identity separates ${first} from ${second}`, () => {
    const diagnostics = collectionDiagnostics(`const left=createReadTicket(a,load), right=createReadTicket(b,load); let leftKey, rightKey;
const pending=new Map(); pending.set(${first},left); pending.set(${second},right);
pending.get(${first}).accept(); pending.get(${first}).invalidate();`);
    assert.equal(diagnostics.length, 2);
  });
}

test('iterating a subset of keys preserves unvisited ticket obligations', () => {
  const diagnostics = collectionDiagnostics(`const left=createReadTicket(a,load), right=createReadTicket(b,load);
const pending=new Map(); pending.set('left',left); pending.set('right',right);
for (const key of ['left']) { pending.get(key).accept(); pending.get(key).invalidate(); }`);
  assert.ok(diagnostics.some(({ expected }) => expected === 'ticket.invalidate(reason)'));
});

test('class methods share their own stored tickets across constructor and read scopes', () => {
  const storage = `export function createStorage() { const values = new Map();
return { retain(key, value) { values.set(key, value); }, lookup(key) { return values.get(key); } }; }`;
  const source = `import {createReadTicket} from '@/shared/runtime/read-request';
import {createStorage} from '@/shared/storage';
class Owner {
  constructor() { this.storage = createStorage(); }
  read() { const storage = this.storage; const task = createReadTicket(id, load); storage.retain(id, task); task.accept(); }
  release() { const storage = this.storage; storage.lookup(id).invalidate(); }
}`;
  assert.deepEqual(collectionDiagnostics(source, { 'src/shared/storage.ts': storage }), []);
  const unrelated = source.replace('release() {', '} class Other { release() {');
  assert.deepEqual(
    collectionDiagnostics(unrelated, { 'src/shared/storage.ts': storage }).map(({ expected }) => expected),
    ['ticket.invalidate(reason)'],
  );
});
