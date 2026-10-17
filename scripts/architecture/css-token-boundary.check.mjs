import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCssScope, checkStyleEntry, checkVueStyles, cssTokenBoundaryRule } from './rules/css-token-boundary.mjs';

test('component scope owns its same-named file in every presentation directory', () => {
  for (const directory of ['src/styles', '.zcode/plans/editor-ui-lab/aligned']) {
    assert.deepEqual(checkCssScope({ rel: `${directory}/mod-files.css`, text: '.mod-files-header h1 {margin:0}' }), []);
    assert.equal(checkCssScope({ rel: `${directory}/settings.css`, text: '.mod-files-header h1 {margin:0}' }).length, 1);
    assert.ok(checkCssScope({ rel: `${directory}/component-content.css`, text: '.mod-files-page {display:flex}' }).length > 0);
    assert.equal(checkCssScope({ rel: `${directory}/style.css`, text: '.mod-files-page {display:flex}' }).length, 1);
  }
});

test('scope checks cover nested conditions and semantic child classes', () => {
  assert.deepEqual(
    checkCssScope({ rel: 'src/styles/font-text.css', text: '.font-text.font-default,.font-accessible-text {display:block}' }),
    [],
  );
  assert.equal(checkCssScope({ rel: 'src/styles/font-text.css', text: '@media (width<600px){.mod-files-tree {display:block}}' }).length, 1);
  assert.deepEqual(checkCssScope({ rel: 'src/styles/base.css', text: ':root {--space:4px} h1 {margin:0}' }), []);
  assert.equal(checkCssScope({ rel: 'src/styles/component-content.css', text: '' }).length, 1);
  assert.equal(checkCssScope({ rel: 'src/styles/style.css', text: '@font-face {font-family:example;src:url(example.woff)}' }).length, 1);
});

test('positive selector alternatives keep every semantic owner', () => {
  for (const pseudo of ['is', 'where']) {
    const selector = `.aligned-shell :${pseudo}(.settings-header, .mod-files-header)`;
    assert.ok(checkCssScope({ rel: 'sample/settings.css', text: `${selector} {display:flex}` }).length);
    assert.deepEqual(checkCssScope({ rel: 'sample/base.css', text: `${selector} {display:flex}` }), []);
  }
  assert.ok(
    checkCssScope({
      rel: 'sample/settings.css',
      text: '@media (width<600px){:is(.settings-header,:where(.overview-header,.mod-files-header)){display:flex}}',
    }).length,
  );
});

test('context shells and conditional selectors do not hide the presentation owner', () => {
  for (const condition of [':not(.mod-files-page)', ':has(.mod-files-header)']) {
    const text = `.app-shell .settings-header${condition} {display:flex}`;
    assert.deepEqual(checkCssScope({ rel: 'sample/settings.css', text }), []);
    assert.ok(checkCssScope({ rel: 'sample/app-shell.css', text }).length);
  }
  assert.deepEqual(checkCssScope({ rel: 'sample/app-shell.css', text: '.app-shell > :not(.settings-page) {display:block}' }), []);
  assert.ok(
    checkCssScope({ rel: 'sample/app-shell.css', text: '.aligned-shell .app-shell .about-content :is(h2,h3,h4){font-weight:600}' }).length,
  );
});

test('shared feedback selectors require the base exemption', () => {
  const text = ':root :is(.section-header,.mod-tab,.titlebar-button,.data-table td){transition:color 80ms}';
  assert.ok(checkCssScope({ rel: 'sample/schema-form.css', text }).length);
  assert.deepEqual(checkCssScope({ rel: 'sample/base.css', text }), []);
});

test('business-owned masks retain their conditional owner and cannot enter base', () => {
  const text = '.n-modal-container:has(.variant-weapon-groups) .n-modal-mask {background:black}';
  assert.deepEqual(checkCssScope({ rel: 'sample/variant.css', text }), []);
  assert.ok(checkCssScope({ rel: 'sample/base.css', text }).length);
  assert.ok(checkCssScope({ rel: 'sample/base.css', text: '.file-editor-meta {font-size:10px}' }).length);
});

test('CSS entry checks reject static, dynamic and reexport bypasses in source and Lab', () => {
  for (const rel of ['src/main.ts', '.zcode/plans/sample/main.ts']) {
    for (const text of ["import './other.css'", "import('./other.css')", "export * from './other.css'", "import './style.css?inline'"])
      assert.equal(checkStyleEntry({ rel, text }).length, 1);
    assert.deepEqual(checkStyleEntry({ rel, text: "import './style.css'; const sample = 'import other.css';" }), []);
  }
});

test('CSS aggregation is owned by style.css and HTML follows the same entry rule', () => {
  assert.deepEqual(checkStyleEntry({ rel: 'sample/style.css', text: '@import "./fields.css";' }), []);
  assert.equal(checkStyleEntry({ rel: 'sample/fields.css', text: '@import url("./other.css");' }).length, 1);
  assert.equal(checkStyleEntry({ rel: 'sample/index.html', text: '<link rel="stylesheet" href="./other.css">' }).length, 1);
  assert.equal(checkStyleEntry({ rel: 'sample/index.html', text: '<style>h1 {color:red}</style>' }).length, 1);
  assert.equal(checkStyleEntry({ rel: 'sample/index.html', text: '<script type="module">import "./other.css"</script>' }).length, 1);
  assert.deepEqual(checkStyleEntry({ rel: 'sample/index.html', text: '<link rel="stylesheet" href="./style.css">' }), []);
});

test('Vue styles reject scoped blocks across source and Lab paths', () => {
  for (const rel of ['src/app/Example.vue', '.zcode/plans/example/Example.vue']) {
    for (const attributes of ['scoped', 'lang="scss"\nscoped', 'scoped="false"', 'src="./example.css" scoped']) {
      const failures = checkVueStyles({ rel, text: `<template><div /></template>\n<style ${attributes}>.example {color:red}</style>` });
      assert.equal(failures.length, 1);
      assert.match(failures[0], /:\d+:\d+: scoped CSS is forbidden/);
    }
  }
});

test('ordinary style blocks and external styles must also use the CSS entry', () => {
  for (const text of ['<style>.sample {color:red}</style>', '<style src="./sample.css"></style>']) {
    assert.match(checkVueStyles({ rel: 'src/app/Example.vue', text })[0], /Vue style blocks are forbidden/);
  }
});

test('scoped text outside style blocks remains valid', () => {
  assert.deepEqual(
    checkVueStyles({
      rel: 'src/app/Example.vue',
      text: '<template><div>scoped</div></template><!-- <style scoped> -->',
    }),
    [],
  );
});

const base = `:root {
  --color-bg: #fff;
  --color-overlay: #fff;
  --color-panel: #fff;
  --color-panel-muted: #fff;
  --color-surface: #fff;
  --color-surface-hover: #fff;
  --color-surface-active: #fff;
  --color-border: #fff;
  --color-border-strong: #fff;
  --color-text: #fff;
  --color-text-soft: #fff;
  --color-muted: #fff;
  --color-faint: #fff;
  --color-primary: #fff;
  --color-primary-hover: #fff;
  --color-primary-pressed: #fff;
  --color-primary-soft: #fff;
  --color-primary-border: #fff;
  --color-on-primary: #fff;
  --color-warning: #fff;
  --color-warning-bg: #fff;
  --color-warning-border: #fff;
  --color-danger: #fff;
  --color-success: #fff;
  --color-success-bg: #fff;
  --color-danger-bg: #fff;
  --color-danger-text: #fff;
  --color-danger-border-soft: #fff;
  --color-danger-highlight-soft: #fff;
  --color-danger-highlight: #fff;
  --color-danger-highlight-border: #fff;
  --color-canvas-bg: #fff;
  --scrollbar-thumb: #fff;
  --scrollbar-thumb-hover: #fff;
  --scrollbar-track: transparent;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px;
  --shadow-floating: none; --shadow-subtle: none;
}
:root[data-theme='dark'] {
  --color-bg: #000; --color-panel: #000; --color-panel-muted: #000; --color-surface: #000;
  --color-overlay: #000;
  --color-surface-hover: #000; --color-surface-active: #000; --color-border: #000; --color-border-strong: #000;
  --color-text: #000; --color-text-soft: #000; --color-muted: #000; --color-faint: #000; --color-primary: #000;
  --color-primary-hover: #000; --color-primary-pressed: #000; --color-primary-soft: #000; --color-primary-border: #000;
  --color-on-primary: #000; --color-warning: #000; --color-warning-bg: #000; --color-warning-border: #000;
  --color-danger: #000; --color-success: #000; --color-success-bg: #000; --color-danger-bg: #000; --color-danger-text: #000;
  --color-danger-border-soft: #000; --color-danger-highlight-soft: #000; --color-danger-highlight: #000;
  --color-danger-highlight-border: #000; --color-canvas-bg: #000; --scrollbar-thumb: #000; --scrollbar-thumb-hover: #000; --scrollbar-track: transparent;
  --shadow-floating: none; --shadow-subtle: none;
}
.panel { border-radius: var(--radius-md); box-shadow: var(--shadow-subtle); color: var(--missing); }
`;

test('CSS tokens and shared radius/shadow semantics pass', () => {
  const failures = cssTokenBoundaryRule.check([{ rel: 'src/styles/base.css', text: base }]);
  assert.deepEqual(failures, ['src/styles/base.css:53:77: undefined CSS variable --missing [.panel; color]']);
});

test('CSS checker reports hardcoded shared radius and shadow values', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: `${base}.bad { border-radius: 6px; box-shadow: 0 1px 2px #000; }` },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('shared radius')).length, 1);
  assert.equal(failures.filter((failure) => failure.includes('shared shadow')).length, 1);
});

test('CSS checker reports hardcoded shared spacing values', () => {
  const failures = cssTokenBoundaryRule.check([{ rel: 'src/styles/base.css', text: `${base}.bad { gap: 8px; padding: 4px 6px; }` }]);
  assert.equal(failures.filter((failure) => failure.includes('shared spacing')).length, 2);
});
test('original immersive spacing is authorized at its exact presentation consumer', () => {
  const files = [
    { rel: 'src/styles/base.css', text: base },
    {
      rel: 'src/styles/immersive.css',
      text: '.weapon-immersive-data {gap:10px;} .ship-immersive-stats {gap:9px;} .immersive-section-action {margin-right:3px;} .variant-candidate-card {margin-bottom:3px;}',
    },
  ];
  assert.equal(cssTokenBoundaryRule.check(files).filter((failure) => failure.includes('original immersive spacing')).length, 0);
  files[1].text =
    '.weapon-immersive-data {padding:10px;} .unrelated {gap:3px;} .immersive-section-action {margin-left:3px;} .variant-candidate-card {padding:9px;}';
  assert.equal(cssTokenBoundaryRule.check(files).filter((failure) => failure.includes('original immersive spacing')).length, 4);
});

test('local variables follow their selector scope across descendants', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .owner { --local: 6px; padding: var(--local); }
    .owner .child { padding: var(--local); }
    .other { padding: var(--local); }
  `,
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('outside its scope --local')).length, 1);
  assert.ok(failures.some((failure) => failure.includes('[.other; padding]')));
});

test('local variables stay on their owner through pseudo-classes and child combinators', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .owner { --local: 6px; }
    .owner:hover > .child { padding: var(--local); }
    .owner.selected { padding: var(--local); }
    .owner:hover + .other { padding: var(--local); }
    .owner:focus ~ .other { padding: var(--local); }
  `,
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('outside its scope --local')).length, 2);
});

test('shared tokens keep their declaration owner inside local selectors', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: base },
    { rel: 'src/styles/tables.css', text: '.table { --color-primary: red; }' },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('shared CSS tokens must be defined in base.css')).length, 1);
});

test('a new shared token declared only in the dark theme requires its base definition', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: `${base}:root[data-theme="dark"] { --color-new: #000; }` },
  ]);
  assert.ok(failures.includes('src/styles/base.css: missing base token --color-new'));
});

test('third-party and DOM-injected variables have explicit file, selector and property authorization', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .n-base-selection { --n-color: var(--color-panel); }
    .other { --n-color: red; color: var(--n-color); background: var(--hue-color); }
    .color-picker-sv { background: var(--hue-color); }
  `,
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('third-party')).length, 2);
  assert.equal(failures.filter((failure) => failure.includes('undefined CSS variable --hue-color')).length, 1);
});

test('mixed declarations and color-based shadows retain their shared-token checks', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .other { padding: var(--space-1) 8px; box-shadow: 0 3px 12px var(--color-border); border-radius: var(--radius-sm) 2px; }
  `,
    },
  ]);
  for (const message of ['shared spacing', 'shared shadow', 'shared radius'])
    assert.equal(failures.filter((failure) => failure.includes(message)).length, 1);
});

test('special visual semantics are authorized by exact selector and property', () => {
  const failures = cssTokenBoundaryRule.check([
    {
      rel: 'src/styles/base.css',
      text: `${base}
    .color-picker-sv-handle { border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.72); }
    .other { border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.72); }
  `,
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('shared radius')).length, 1);
  assert.equal(failures.filter((failure) => failure.includes('shared shadow')).length, 1);
});
test('refit spacing authorizes the original consumer selector only', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: base },
    { rel: 'src/styles/immersive.css', text: '.variant-wing-bays { gap: 10px; } .other { gap: 10px; }' },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('original immersive spacing')).length, 1);
  assert.ok(failures.some((failure) => failure.includes('.other')));
});

test('font consumers keep immersive spacing authorization on the business root', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: base },
    {
      rel: 'src/styles/immersive.css',
      text: '.variant-stat-cell>.immersive-text:first-child {margin-right:3px;} .variant-group-summary-row>.immersive-text:first-child {margin-left:10px;} .variant-card-text>.variant-card-origin {margin-bottom:3px;} .variant-stat-cell>.font-text:first-child {margin-right:3px;} .variant-card-text>.variant-card-origin {padding-bottom:3px;}',
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('original immersive spacing')).length, 2);
  assert.ok(failures.some((failure) => failure.includes('.font-text')));
});
test('weapon group geometry authorizes its original frame and matrix spacing only', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: base },
    {
      rel: 'src/styles/immersive.css',
      text: '.immersive-game-frame { padding: 7px; } .variant-group-autofire { column-gap: 3px; } .variant-group-actions { gap: 11px; } .other { column-gap: 3px; }',
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('original immersive spacing')).length, 1);
  assert.ok(failures.some((failure) => failure.includes('.other')));
});
test('cut button shapes accept eight vertices and reject the two-corner shape', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: base },
    {
      rel: 'src/styles/immersive.css',
      text: '.variant-cut-button { clip-path: polygon(6px 0,calc(100% - 6px) 0,100% 6px,100% calc(100% - 6px),calc(100% - 6px) 100%,6px 100%,0 calc(100% - 6px),0 6px); } .old-button { clip-path: polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px); }',
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('four cut corners')).length, 1);
  assert.ok(failures.some((failure) => failure.includes('.old-button')));
});
test('hullmod filters and row geometry keep original spacing on the exact consumer', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: base },
    {
      rel: 'src/styles/immersive.css',
      text: '.immersive-filter-group { gap: 3px; } .variant-hullmod-row>.variant-hullmod-name { gap: 10px; } .unrelated-filter { gap: 3px; }',
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('original immersive spacing')).length, 1);
  assert.ok(failures.some((failure) => failure.includes('.unrelated-filter')));
});
test('weapon picker title and card text authorize only their original compact spacing', () => {
  const failures = cssTokenBoundaryRule.check([
    { rel: 'src/styles/base.css', text: base },
    {
      rel: 'src/styles/immersive.css',
      text: '.variant-card-text { gap: 3px; } .variant-current-title { margin-top: 3px; } .other-title { margin-top: 3px; }',
    },
  ]);
  assert.equal(failures.filter((failure) => failure.includes('original immersive spacing')).length, 1);
  assert.ok(failures.some((failure) => failure.includes('.other-title')));
});
