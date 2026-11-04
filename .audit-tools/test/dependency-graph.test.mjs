import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  selectDependencies,
  projectDependencies,
  cycles,
  dependencyCycles,
  layeredDependencies,
  dependencyPositions,
} from '../src/dependency-graph.mjs';

const files = /** @type {const} */ ([
  { path: 'src/a.rs', role: 'production', ownership: { owner: 'a' } },
  { path: 'src/b.rs', role: 'production', ownership: { owner: 'b' } },
  { path: 'src/shared.rs', role: 'production', ownership: { owner: null, status: 'shared' } },
  { path: 'src/b.spec.rs', role: 'test', ownership: { owner: 'b' } },
]).map(
  /** @returns {import('../src/model.mjs').File} */ (file) => ({
    ...file,
    hash: 'fixture',
    text: '',
    lines: 0,
    bytes: 0,
    ownership: { status: 'declared', candidates: [], ...file.ownership },
  }),
);
const edges = /** @type {const} */ ([
  { source: 'src/a.rs', target: 'src/b.rs', kind: 'rust-call', dependencyClass: 'usage' },
  { source: 'src/b.rs', target: 'src/a.rs', kind: 'rust-import', dependencyClass: 'structure' },
  { source: 'src/b.rs', target: 'src/shared.rs', kind: 'rust-type', dependencyClass: 'usage' },
  { source: 'src/shared.rs', target: 'src/b.rs', kind: 'rust-call', dependencyClass: 'usage' },
  { source: 'src/b.spec.rs', target: 'src/a.rs', kind: 'rust-call', dependencyClass: 'usage', testOnly: true },
  { source: 'src/b.rs', target: 'src/a.rs', kind: 'rust-value', dependencyClass: 'usage', testOnly: true },
  { source: 'src/a.rs', target: 'src/a.rs', kind: 'rust-type', dependencyClass: 'usage' },
]).map((edge) => ({ line: 1, symbols: 'fixture', parser: 'fixture', ...edge }));

test('communication round trips stay separate from source dependencies and keep shared ownership', () => {
  const first = edges[0];
  assert.ok(first);
  const protocol = [first, { ...first, source: 'src/b.rs', target: 'src/a.rs', kind: 'window-event' }];
  assert.deepEqual(dependencyCycles(files, protocol), []);
  const [closed] = dependencyCycles(files, protocol, { relationScope: 'combined' });
  assert.equal(closed?.category, 'communication');
  assert.equal(closed?.relationScope, 'combined');
  assert.deepEqual(closed?.members, ['src/a.rs', 'src/b.rs']);
  assert.equal(selectDependencies(files, protocol, { relationScope: 'communication' }).length, 1);
  assert.deepEqual(dependencyCycles(files, protocol, { relationScope: 'communication' }), []);
  assert.equal(
    dependencyCycles(files, [...protocol, { ...first, source: 'src/b.rs', target: 'src/a.rs' }], {
      relationScope: 'combined',
    })[0]?.category,
    'source',
  );
  assert.equal(selectDependencies(files, protocol, { kind: 'rust-call', relationScope: 'communication' }).length, 0);
});

test('actual capability graph separates structure, scope and shared files', () => {
  const usage = selectDependencies(files, edges);
  assert.equal(usage.length, 4);
  assert.deepEqual(cycles(projectDependencies(files, usage, 'module'), 'module'), []);
  assert.deepEqual(cycles(usage, 'rust')[0]?.members, ['src/b.rs', 'src/shared.rs']);
  const complete = projectDependencies(files, selectDependencies(files, edges, { basis: 'complete' }), 'module');
  assert.deepEqual(cycles(complete, 'module')[0]?.chain, ['a', 'b', 'a']);
  assert.ok(complete.every((edge) => edge.reference));
});

test('test scope, relationship kind and actual type cycles are computed from selected edges', () => {
  const all = projectDependencies(files, selectDependencies(files, edges, { scope: 'all' }), 'module');
  assert.deepEqual(cycles(all, 'module')[0]?.members, ['a', 'b']);
  assert.deepEqual(cycles(selectDependencies(files, edges, { kind: 'rust-type' }), 'file'), []);
  const [first, second] = edges;
  assert.ok(first && second);
  const typeCycle = /** @type {const} */ ([
    { ...first, kind: 'rust-type' },
    { ...second, kind: 'rust-type', dependencyClass: 'usage' },
  ]);
  assert.deepEqual(cycles(selectDependencies(files, [...typeCycle]), 'rust')[0]?.chain, ['src/a.rs', 'src/b.rs', 'src/a.rs']);
});

test('every reported closed chain consists of actual selected relationships', () => {
  const graph = [
    { source: 'c', target: 'a' },
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'b', target: 'b' },
  ];
  const [cycle] = cycles(graph, 'file');
  assert.ok(cycle);
  assert.deepEqual(cycle.members, ['a', 'b', 'c']);
  for (let index = 0; index < cycle.chain.length - 1; index++)
    assert.ok(graph.some((edge) => edge.source === cycle.chain[index] && edge.target === cycle.chain[index + 1]));
  assert.deepEqual(cycles([{ source: 'a', target: 'a' }], 'file'), []);
});

test('dependency layers place foundations below consumers and retain cycles as single groups', () => {
  const view = {
    nodes: ['base', 'middle', 'top', 'cycle-a', 'cycle-b', 'independent'].map((id) => ({ id, label: id })),
    edges: [
      { source: 'top', target: 'middle', count: 2 },
      { source: 'middle', target: 'base', count: 3 },
      { source: 'cycle-a', target: 'cycle-b', count: 4 },
      { source: 'cycle-b', target: 'cycle-a', count: 5 },
      { source: 'cycle-a', target: 'base', count: 6 },
      { source: 'cycle-b', target: 'base', count: 7 },
    ],
  };
  const layout = layeredDependencies({ ...view, edges: view.edges.map((edge) => ({ ...edge, kinds: { fixture: edge.count } })) });
  const group = (/** @type {string} */ id) => {
    const found = layout.groups.find((entry) => entry.members.includes(id));
    assert.ok(found);
    return found;
  };
  assert.equal(group('base').level, 0);
  assert.equal(group('independent').level, 0);
  assert.equal(group('middle').level, 1);
  assert.equal(group('top').level, 2);
  assert.deepEqual(group('cycle-a').members, ['cycle-a', 'cycle-b']);
  assert.equal(group('cycle-a').level, 1);
  assert.equal(layout.groups.flatMap((entry) => entry.members).length, 6);
  assert.equal(layout.edges.find((edge) => edge.source === group('cycle-a').id && edge.target === group('base').id).count, 13);
  for (const edge of layout.edges) {
    const source = layout.groups[Number(edge.source)],
      target = layout.groups[Number(edge.target)];
    assert.ok(source && target);
    assert.ok(source.level > target.level);
  }
});

test('directed layout computes individual node coordinates from dependencies and keeps cyclic nodes distinct', () => {
  const view = {
    nodes: ['top', 'middle', 'base'].map((id) => ({ id, label: id })),
    edges: [
      { source: 'top', target: 'middle', count: 1 },
      { source: 'middle', target: 'base', count: 1 },
    ],
  };
  const graph = { ...view, edges: view.edges.map((edge) => ({ ...edge, kinds: { fixture: edge.count } })) };
  const positions = dependencyPositions(graph);
  const top = positions.get('top'),
    middle = positions.get('middle'),
    base = positions.get('base');
  assert.ok(top && middle && base);
  assert.ok(top.y < middle.y);
  assert.ok(middle.y < base.y);
  const cycle = dependencyPositions({
    ...graph,
    edges: [...graph.edges, { source: 'base', target: 'top', count: 1, kinds: { fixture: 1 } }],
  });
  assert.equal(cycle.size, 3);
  assert.equal(new Set([...cycle.values()].map(({ x, y }) => `${x},${y}`)).size, 3);
  assert.ok([...cycle.values()].every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
});
