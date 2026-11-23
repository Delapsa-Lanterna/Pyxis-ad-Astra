import { test } from 'node:test';
import assert from 'node:assert/strict';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { unboundedArgumentsRule } from './unbounded-arguments.mjs';

test('project-sized argument lists report their actual array or numeric consumer and original source position', () => {
  const file = 'src/app/components/Rows.vue';
  const context = architectureFixtures({
    [file]: `<script setup lang="ts">
function merge(rows:number[][], values:number[], target:number[]) {
  Math.max(...rows.map(row=>row.length));
  target.push(...values);
  target.splice(0, 1, ...values);
}
</script>`,
  });
  assert.deepEqual(
    unboundedArgumentsRule.check(context).map((d) => [d.file, d.line, d.column, d.target]),
    [
      [file, 3, 12, 'Math.max'],
      [file, 4, 15, 'Array.push'],
      [file, 5, 23, 'Array.splice'],
    ],
  );
});
test('tuples, fixed literal transforms, batch slices and unrelated methods are accepted', () => {
  const context = architectureFixtures({
    'src/domain/sample.ts': `function append(values:number[], pair:readonly [number,number], start:number) {
 const target:number[]=[];
 target.push(...pair); target.push(...values.slice(start,start+8192)); target.splice(0,0,...values.slice(0,4));
 const largest=Math.max(...[1,2].map(n=>n*2)); const copy=[...values];
 const other={push(...items:number[]) { return items.length }};
 other.push(...values);
}
function local(Math:{max(...v:number[]):number},values:number[]) {return Math.max(...values);}`,
  });
  assert.deepEqual(unboundedArgumentsRule.check(context), []);
});
