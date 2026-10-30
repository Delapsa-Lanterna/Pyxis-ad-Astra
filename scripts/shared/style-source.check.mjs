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

test('test directories own styles and imports outside the production style checks', () => {
  assert.deepEqual(
    checkStyles([
      { rel: 'src/test/browser/browser.css', text: '@import "./missing.css"; .sample{display:invalid;color:var(--missing)}' },
      { rel: 'src/test/browser/entry.ts', text: 'import "./browser.css"' },
      { rel: 'src/test/browser/Scene.vue', text: '<template><div style="display:block" /></template><style>.sample{color:red}</style>' },
      { rel: 'test/index.html', text: '<link rel="stylesheet" href="./fixture.css">' },
      { rel: 'tools/test/fixture.css', text: 'broken {' },
    ]),
    [],
  );
  assert.ok(
    checkStyles([{ rel: 'src/testing/fixture.css', text: '.sample{display:invalid}' }]).some((failure) => failure.includes('css.value')),
  );
  assert.ok(
    checkStyles([
      { rel: 'ui/style.css', text: '.sample{color:var(--test-only)}' },
      { rel: 'src/test/browser/theme.ts', text: 'root.style.setProperty("--test-only", "red")' },
    ]).some((failure) => failure.includes('css.variable')),
  );
});

test('fixed styles in production templates and scripts belong in the stylesheet entry', () => {
  for (const [rel, text, position] of /** @type {const} */ ([
    ['ui/Control.vue', '<template>\n<div style="display:block" /></template>', '2:6'],
    ['ui/Control.vue', '<template>\n<div :style="{ display: \'block\' }" /></template>', '2:6'],
    ['ui/Control.vue', '<template>\n<div :style="({ opacity: 0, zIndex: -1, display: null })" /></template>', '2:6'],
    ['ui/index.html', '<main>\n<div style="display:block"></div></main>', '2:6'],
    ['ui/runtime.ts', "const element=document.body;\nelement.style.cursor='col-resize';", '2:1'],
    ['ui/Control.vue', '<script setup>\nconst element=document.body;\nelement.style.cursor=`move`;</script>', '3:1'],
  ])) {
    const failures = checkStyles([{ rel, text }]);
    assert.equal(failures.length, 1);
    assert.ok(failures[0]);
    assert.ok(failures[0].startsWith(`${rel}:${position}: css.entry:`), failures[0]);
  }
});

test('dynamic styles and CSS variable delivery remain allowed', () => {
  assert.deepEqual(
    checkStyles([
      { rel: 'ui/style.css', text: '.control{top:var(--top);color:var(--preview)}' },
      { rel: 'ui/Control.vue', text: "<template><div :style=\"{ top: top + 'px', '--preview': color }\" /></template>" },
      { rel: 'ui/Preview.vue', text: '<template><div :style="{\'--preview\': \'red\'}" /><div :style="{}" /></template>' },
      { rel: 'ui/Computed.vue', text: '<template><div :style="{ [property]: \'red\' }" /></template>' },
      {
        rel: 'ui/runtime.ts',
        text: "element.style.top=top+'px'; element.style.color=color; element.style.setProperty('--top', top); element.style.setProperty('--preview', 'red'); slot.style='CUSTOM';",
      },
      { rel: 'ui/runtime.spec.ts', text: "element.style.cursor='move';" },
      { rel: 'src/test/browser/entry.ts', text: "element.style.cursor='move';" },
    ]),
    [],
  );
});

test('CSS syntax, property values and exact duplicate declarations report source positions', () => {
  for (const [text, code] of /** @type {const} */ ([
    ['.control{color:red;color:red}', 'css.duplicate'],
    ['.control{display:nonsense}', 'css.value'],
    ['.control{colorr:red}', 'css.value'],
    ['.control{color:}', 'css.value'],
    ['.control{color:red;broken}', 'css.syntax'],
  ])) {
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
  const missingImport = checkStyles([{ rel: 'ui/style.css', text: '@import "./missing.css";' }])[0];
  assert.ok(missingImport);
  assert.ok(missingImport.includes('css.import'));
  const cycle = checkStyles([{ rel: 'ui/style.css', text: '@import "./style.css";' }])[0];
  assert.ok(cycle);
  assert.ok(cycle.includes('css.cycle'));
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
  const missingVariable = checkStyles(fixture('.control{color:var(--missing)}'))[0];
  assert.ok(missingVariable);
  assert.ok(missingVariable.includes('css.variable'));
  assert.deepEqual(checkStyles(fixture('.control{color:var(--missing,red)}')), []);
  const files = fixture('.control{color:var(--accent);background:var(--preview)}', [
    { rel: 'ui/theme.ts', text: 'root.style.setProperty("--accent", color)' },
    { rel: 'ui/Control.vue', text: '<template><div :style="{\'--preview\': color}" /></template>' },
  ]);
  assert.deepEqual(checkStyles(files), []);
  const missingRuntimeVariable = checkStyles(
    fixture('.control{color:var(--other)}', [{ rel: 'ui/other.ts', text: 'const text="--other";' }]),
  )[0];
  assert.ok(missingRuntimeVariable);
  assert.ok(missingRuntimeVariable.includes('css.variable'));
  const isolatedVariable = checkStyles([
    ...fixture('.control{color:var(--isolated)}'),
    { rel: 'other.css', text: ':root{--isolated:red}' },
  ])[0];
  assert.ok(isolatedVariable);
  assert.ok(isolatedVariable.includes('css.variable'));
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
