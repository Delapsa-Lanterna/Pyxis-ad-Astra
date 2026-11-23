import { test } from 'node:test';
import assert from 'node:assert/strict';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { repeatedKeyProjectionRule } from './repeated-key-projection.mjs';

test('only invariant project key projections produce an advisory', () => {
  const context = architectureFixtures({
    'src/domain/keys.ts': 'export function keys(rows:{key:string}[]) {return rows.map(row=>row.key)}',
    'src/domain/sample.ts': `import {keys as select} from './keys';
function use(rows:{key:string}[], text:string) {
  rows.filter(row => select(rows).includes(row.key));
  rows.filter(row => select([row]).includes('sample'));
  rows.filter(row => row.key.toLowerCase().includes(text));
  const keys=new Set(select(rows)); rows.filter(row=>keys.has(row.key));
}
`,
  });
  assert.deepEqual(
    repeatedKeyProjectionRule.check(context).map((d) => [d.ruleId, d.severity, d.file, d.line, d.target]),
    [['repeated-key-projection', 'warning', 'src/domain/sample.ts', 3, 'select']],
  );
});

test('an array projection can call another checked domain helper', () => {
  const context = architectureFixtures({
    'src/domain/keys.ts':
      'function alternate(rows:{key:string}[]) {return rows.map(row=>row.key)}\n' +
      'export function keys(rows:{key:string}[]) { return rows.length < 3 ? alternate(rows) : rows.filter(row=>Boolean(row.key)).map(row=>row.key); }',
    'src/app/sample.ts':
      "import {keys} from '../domain/keys';\n" +
      'function select(rows:{key:string}[]) { return rows.filter(row=>keys(rows).includes(row.key)); }',
  });
  assert.deepEqual(
    repeatedKeyProjectionRule.check(context).map((diagnostic) => [diagnostic.line, diagnostic.target]),
    [[2, 'keys']],
  );
});
