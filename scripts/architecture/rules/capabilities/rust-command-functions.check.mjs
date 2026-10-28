import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { rustCommandFunctionsRule } from './rust-command-functions.mjs';

const path = 'src-tauri/src/commands/example.rs';
/** @param {string} source */
const check = (source) => rustCommandFunctionsRule.check(architectureFixtures({ [path]: source }));

test('commands retain explicit command declarations and test-only helpers', () => {
  assert.deepEqual(
    check(`
    #[command_macros::command(async)]
    #[allow(dead_code)]
    pub async fn save() {}
    #[cfg(test)] mod tests { fn helper() {} #[test] fn verifies() {} }
    // fn comment() {}
    const TEXT: &str = "fn quoted() {}";
  `),
    [],
  );
});

test('ordinary command functions retain their own diagnostics after renaming', () => {
  for (const name of ['prepare', 'renamed']) {
    for (const prefix of ['', 'pub ', 'pub(crate) async ', 'const ', 'unsafe ']) {
      const diagnostics = check(`\n${prefix}fn ${name}() {}`);
      assert.equal(diagnostics.length, 1);
      assert.deepEqual(diagnostics[0], {
        ruleId: 'rust-command-functions',
        file: path,
        line: 2,
        column: 1,
        message: 'commands functions must declare the unified command macro',
        reference: '.zcode/modules/backend-capabilities.md#规范',
        source: 'scripts/architecture/rules/capabilities/rust-command-functions.mjs',
        symbol: name,
        expected: '#[command_macros::command]',
      });
    }
  }
});

test('a command attribute belongs to its function and never authorizes nested helpers', () => {
  const diagnostics = check('#[command_macros::command]\nfn save() { fn helper() {} }\nfn after() {}');
  assert.deepEqual(
    diagnostics.map(({ symbol }) => symbol),
    ['helper', 'after'],
  );
  assert.equal(check('#[command_macros::command]\nfn save() {}\n#[test] fn test() {}\nfn after() {}')[0].symbol, 'after');
  assert.equal(check('trait Hidden { fn helper(); }').length, 1);
  assert.equal(check('#[command_macros::save]\nfn save() {}').length, 1);
});

test('raw names, generic bounds and const generic defaults retain command obligations', () => {
  for (const source of [
    'pub fn r#type() {}',
    'fn helper<T: Fn() -> Result<(), E>, E>() {}',
    'fn helper<const N: usize = { 3 }>() {}',
    'unsafe extern "C" fn helper() {}',
  ]) {
    const diagnostics = check(source);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].ruleId, 'rust-command-functions');
    assert.equal(diagnostics[0].line, 1);
    assert.equal(diagnostics[0].expected, '#[command_macros::command]');
  }
});
