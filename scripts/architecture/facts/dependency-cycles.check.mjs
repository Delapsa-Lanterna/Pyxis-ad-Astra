import { test } from 'node:test';
import { dependencyCycles } from './dependency-cycles.mjs';
import assert from 'node:assert/strict';

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
