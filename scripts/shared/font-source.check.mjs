import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFontSources } from './font-source.mjs';

/** @param {string} text */
const fixture = (text) => [
  { rel: 'ui/style.css', text: '@import "./base.css"; @import "./control.css";' },
  {
    rel: 'ui/base.css',
    text: ':root{--font-interface:Example;--font-field:Example;--font-text-editor:Example} body{font-family:var(--font-interface)}',
  },
  { rel: 'ui/control.css', text },
];
test('text and controls inherit a configured document font without repeated declarations', () => {
  assert.deepEqual(checkFontSources(fixture('.text{color:red;font-size:12px} button{font:inherit} .child{font-family:unset}')), []);
});
test('text roles consume their configured font and preserve inheritance in descendants', () => {
  assert.deepEqual(
    checkFontSources(
      fixture(
        '.ui-text-path,.ui-code{font-family:var(--font-field)} .text-editor-surface .cm-content{font-family:var(--font-text-editor)} .child{font-weight:600}',
      ),
    ),
    [],
  );
  for (const text of ['.ui-text-path{font-size:10px}', '.ui-code{font-family:var(--font-interface)}'])
    assert.match(checkFontSources(fixture(text)).join('\n'), /css.font-source:.*must consume --font-field/);
});
test('fixed families, system resets and variable fallbacks cannot bypass configured sources', () => {
  for (const value of ['Arial', 'monospace', 'initial', 'revert', 'var(--other)', 'var(--font-field,Arial)', 'var(--font-field),serif'])
    assert.match(checkFontSources(fixture(`.text{font-family:${value}}`)).join('\n'), /^ui\/control.css:1:7: css.font-source:/);
  assert.match(checkFontSources(fixture('.text{font:12px Arial}')).join('\n'), /css.font-source/);
  assert.match(checkFontSources(fixture('.text{font:12px Arial var(--font-field)}')).join('\n'), /css.font-source/);
  assert.match(checkFontSources(fixture('.text{all:initial}')).join('\n'), /all resets/);
  assert.match(checkFontSources(fixture('.text{--font-field:Arial}')).join('\n'), /only declare defaults/);
  assert.match(checkFontSources(fixture(':root{--font-field:Arial!important}')).join('\n'), /only declare defaults/);
});
test('inherited text requires a configured entry across transitive imports', () => {
  assert.match(checkFontSources([{ rel: 'ui/style.css', text: '.text{color:red;font:inherit}' }]).join('\n'), /configured document font/);
  assert.match(checkFontSources([{ rel: 'ui/orphan.css', text: '.text{color:red}' }]).join('\n'), /belong to an entry/);
  assert.deepEqual(
    checkFontSources([...fixture(''), { rel: 'other/style.css', text: '@import "../ui/style.css"; .text{font:inherit}' }]),
    [],
  );
});
test('font checks cover test styles with the same inheritance rules', () => {
  assert.match(checkFontSources([{ rel: 'src/test/style.css', text: 'body{font-family:Arial}' }]).join('\n'), /css.font-source/);
  assert.deepEqual(
    checkFontSources([...fixture(''), { rel: 'src/test/style.css', text: '@import "../../ui/style.css"; .sample{font:inherit}' }]),
    [],
  );
});
test('sibling stylesheet imports share the document font of their actual script entry', () => {
  assert.deepEqual(
    checkFontSources([
      ...fixture(''),
      { rel: 'src/test/browser.css', text: '.sample{font:inherit}' },
      { rel: 'src/entry.ts', text: 'import "../ui/style.css"; import "./test/browser.css";' },
    ]),
    [],
  );
});
