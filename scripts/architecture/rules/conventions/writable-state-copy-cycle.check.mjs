import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { writableStateCopyCycleRule } from './writable-state-copy-cycle.mjs';

const source = 'src/app/composables/use-sample.ts';

/** @param {string} body */
function check(body) {
  return writableStateCopyCycleRule.check(
    architectureFixtures({ [source]: "import {ref,reactive,computed,shallowReactive} from 'vue';\n" + body }),
  );
}

for (const [factory, create] of [
  ['ref', 'ref'],
  ['shallowRef as hold', 'hold'],
  ['reactive as hold', 'hold'],
]) {
  test('direct copies follow the Vue factory binding: ' + factory, () => {
    const diagnostics = writableStateCopyCycleRule.check(
      architectureFixtures({
        [source]: `import {${factory}} from 'vue'; const first=${create}(0),second=${create}(0); first.value=second.value; second.value=first.value;`,
      }),
    );
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0]);
    assert.equal(diagnostics[0].ruleId, 'writable-state-copy-cycle');
    assert.ok(diagnostics[0].column > 0 && diagnostics[0].reference && diagnostics[0].source);
    assert.equal(diagnostics[0].expected, 'one writable owner with derived consumers');
  });
}

for (const body of [
  'const a=ref(0),b=ref(0);a.value=b.value;b.value=a.value;',
  'const a=ref(0),b=ref(0);if(a.value!==b.value)a.value=b.value;b.value=a.value;',
  'const a=ref(0),b=ref(0),c=ref(0);a.value=b.value;b.value=c.value;c.value=a.value;',
  'const a=reactive({left:0,right:0}),b=ref(0);b.value=a.left;a.left=b.value;',
  "const a=reactive({left:0,right:0}),b=ref(0);b.value=a['left'];a['left']=b.value;",
  'const a=ref(0),b=ref(0);const alias=a;alias.value=b.value;b.value=a.value;',
  'const a=ref({x:0}),b=ref({x:0});a.value={x:b.value.x};b.value.x=a.value.x;',
  'const a=ref({x:0}),b=ref({x:0});a.value={...b.value};b.value.x=a.value.x;',
])
  test('resolved direct copy cycle: ' + body, () => {
    const diagnostics = check(body);
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0]);
    assert.match(diagnostics[0].message, / -> /);
  });

for (const body of [
  'const a=reactive({left:0,right:0}),b=ref(0);b.value=a.left;a.right=b.value;',
  "const a=reactive({left:0,right:0}),b=ref(0);b.value=a['left'];a['right']=b.value;",
  'const a=reactive({left:0,right:0});const alias=a;alias.left=a.left;',
  'const a=ref(0);const alias=ref(a);alias.value=a.value;',
  'const a=shallowReactive({items:[]});a.items=shallowReactive(a.items);',
  'const a=ref({x:0}),b=ref({x:0});a.value={...b.value,x:0};b.value.x=a.value.x;',
  'const a=ref(0),b=ref(0);function update(a){a.value=b.value;}b.value=a.value;',
])
  test('separate members, aliases and shadowed bindings preserve storage identity: ' + body, () => {
    assert.deepEqual(check(body), []);
  });

for (const body of [
  'const a=ref(0),b=ref(0);b.value=unavailable(a.value);',
  'const a=ref(0),b=ref(0);unavailable(a,b);',
  'const a=reactive({x:0}),b=ref(0);b.value=a[unavailable()];',
  'function create(){return ref(0);}const a=create(),b=create();a.value=b.value;b.value=a.value;',
  'const a=ref(0),b=ref(0);function relay(value,put){put(value);}relay(a.value,value=>b.value=value);relay(b.value,value=>a.value=value);',
  'const a=ref({x:0}),b=ref({x:0});a.value=structuredClone(b.value);b.value.x=a.value.x;',
])
  test('bounded analysis skips an opaque transfer without producing a diagnostic: ' + body, () => {
    assert.deepEqual(check(body), []);
  });

test('cross-file business calls stay outside direct assignment analysis', () => {
  const diagnostics = writableStateCopyCycleRule.check(
    architectureFixtures({
      [source]: "import {ref} from 'vue';import {read,write} from '@/domain/sample';const a=ref(read());write(a.value);",
      'src/domain/sample.ts':
        "import {ref} from 'vue';const state=ref(0);export function read(){return state.value;}export function write(value){state.value=value;}",
    }),
  );
  assert.deepEqual(diagnostics, []);
});

test('namespace factories retain the same direct copy evidence', () => {
  assert.equal(
    writableStateCopyCycleRule.check(
      architectureFixtures({
        [source]: "import * as vue from 'vue';const a=vue.ref(0),b=vue.ref(0);a.value=b.value;b.value=a.value;",
      }),
    ).length,
    1,
  );
});

test('every assignment between the same storage locations retains its evidence', () => {
  const diagnostics = check('const a=ref(0),b=ref(0);\na.value=b.value;\na.value=b.value;\nb.value=a.value;');
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0]);
  for (const line of [3, 4, 5]) assert.ok(diagnostics[0].message.includes(`${source}:${line}:`));
});

for (const extra of ['', 'function outside(){base.value=draft.value;}'])
  test('formal input lifecycle validates direct handoffs: ' + extra, () => {
    const diagnostics = writableStateCopyCycleRule.check(
      architectureFixtures({
        'src/shared/runtime/field-inputs.ts': 'export function registerFieldInput(input) {}',
        [source]: `import {ref,computed} from 'vue';import {registerFieldInput as register} from '@/shared/runtime/field-inputs';
const draft=ref(''),base=ref(draft.value);const dirty=computed(()=>draft.value!==base.value);
function commit(){if(!dirty.value)return;base.value=draft.value;}function cancel(){draft.value=base.value;}
register({dirty,commit,cancel});${extra}`,
      }),
    );
    assert.equal(diagnostics.length, extra ? 1 : 0);
  });

test('a comparison alone retains its direct copy cycle', () => {
  assert.equal(
    check(
      "const draft=ref(''),base=ref(draft.value);const dirty=computed(()=>draft.value!==base.value);function commit(){if(!dirty.value)return;base.value=draft.value;}function cancel(){draft.value=base.value;}",
    ).length,
    1,
  );
});

test('Vue diagnostics retain the original script position', () => {
  const diagnostics = writableStateCopyCycleRule.check(
    architectureFixtures({
      'src/app/components/Sample.vue':
        '<template><div /></template>\n<script setup>\nimport {ref} from "vue";\nconst a=ref(0),b=ref(a.value);\na.value=b.value;\n</script>',
    }),
  );
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0]);
  assert.equal(diagnostics[0].line, 4);
});
