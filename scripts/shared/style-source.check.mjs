import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkStyles } from './style-source.mjs';

/** @param {string} text @param {Array<{rel: string, text: string}>} extra */
function fixture(text, extra = []) {
  return [{ rel: 'ui/style.css', text: '@import "./control.css";' }, { rel: 'ui/control.css', text }, ...extra];
}

test('fixed component geometry, local inheritance and feedback values remain ordinary CSS', () => {
  assert.deepEqual(checkStyles(fixture('.control{--dot:green;width:72px;gap:8px;border-radius:50%;box-shadow:0 0 4px var(--dot)}')), []);
});

test('CSS syntax, property values and exact duplicate declarations report source positions', () => {
  for (const [text, code] of [
    ['.control{color:red;color:red}', 'css.duplicate'],
    ['.control{display:nonsense}', 'css.value'],
    ['.control{colorr:red}', 'css.value'],
    ['.control{color:}', 'css.value'],
    ['.control{color:red;broken}', 'css.syntax'],
  ]) {
    const failures = checkStyles(fixture(text));
    assert.ok(
      failures.some((failure) => failure.includes(code)),
      failures.join('\n'),
    );
    assert.ok(failures.every((failure) => /^ui\/control\.css:\d+:\d+:/.test(failure)));
  }
  assert.deepEqual(
    checkStyles(fixture('.control{color:red;color:var(--accent)}', [{ rel: 'ui/theme.ts', text: 'const map={"--accent":"accent"}' }])),
    [],
  );
});

test('imports resolve as a graph and diagnose missing dependencies and cycles', () => {
  assert.ok(checkStyles([{ rel: 'ui/style.css', text: '@import "./missing.css";' }])[0].includes('css.import'));
  assert.ok(checkStyles([{ rel: 'ui/style.css', text: '@import "./style.css";' }])[0].includes('css.cycle'));
  assert.ok(checkStyles(fixture('@import "./more.css";')).some((failure) => failure.includes('css.entry')));
});

test('stylesheet entries accept transitive shared imports', () => {
  const files = [
    { rel: 'a/style.css', text: '@import "./base.css";' },
    { rel: 'a/base.css', text: '.control{color:red}' },
    { rel: 'b/style.css', text: '@import "../a/style.css";' },
  ];
  assert.deepEqual(checkStyles(files), []);
});

test('variables resolve in their entry graph with local fallback and literal runtime assignments', () => {
  assert.ok(checkStyles(fixture('.control{color:var(--missing)}'))[0].includes('css.variable'));
  assert.deepEqual(checkStyles(fixture('.control{color:var(--missing,red)}')), []);
  const files = fixture('.control{color:var(--accent);background:var(--preview)}', [
    { rel: 'ui/theme.ts', text: 'root.style.setProperty("--accent", color)' },
    { rel: 'ui/Control.vue', text: '<template><div :style="{\'--preview\': color}" /></template>' },
  ]);
  assert.deepEqual(checkStyles(files), []);
  assert.ok(
    checkStyles(fixture('.control{color:var(--other)}', [{ rel: 'ui/other.ts', text: 'const text="--other";' }]))[0].includes(
      'css.variable',
    ),
  );
  assert.ok(
    checkStyles([...fixture('.control{color:var(--isolated)}'), { rel: 'other.css', text: ':root{--isolated:red}' }])[0].includes(
      'css.variable',
    ),
  );
});

test('Vue and HTML use the stylesheet entry while script literals remain content', () => {
  for (const file of [
    { rel: 'ui/Control.vue', text: '<template><div /></template><style scoped>.control{color:red}</style>' },
    { rel: 'ui/main.ts', text: 'import "./control.css"' },
    { rel: 'ui/main.ts', text: 'import "./style.css?inline"' },
    { rel: 'ui/main.ts', text: 'import("./control.css")' },
    { rel: 'ui/main.ts', text: 'export * from "./control.css"' },
    { rel: 'ui/index.html', text: '<style>.control{color:red}</style>' },
    { rel: 'ui/index.html', text: '<script type="module">import "./control.css"</script>' },
  ])
    assert.ok(checkStyles([file]).some((failure) => failure.includes('css.entry')));
  assert.deepEqual(
    checkStyles([...fixture('.control{color:red}'), { rel: 'ui/main.ts', text: 'import "./style.css"; const text="<style scoped>";' }]),
    [],
  );
});

test('shared imports produce a single diagnostic for one missing definition', () => {
  const files = [
    { rel: 'a/style.css', text: '@import "../control.css";' },
    { rel: 'b/style.css', text: '@import "../control.css";' },
    { rel: 'control.css', text: '.control{color:var(--missing)}' },
  ];
  assert.equal(checkStyles(files).length, 1);
});
