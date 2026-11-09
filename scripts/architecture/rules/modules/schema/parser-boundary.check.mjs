import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';
import { parserBoundaryRule } from './parser-boundary.mjs';

test('independent workspace crates can read their own strict JSON protocols', () => {
  const context = architectureFixtures({
    'src-tauri/tool/src/protocol.rs': 'fn read(){serde_json::from_str(&message);}',
    'src-tauri/src/services/project/query/sample.rs': 'fn read(){serde_json::from_str(&message);}',
  });
  const failures = parserBoundaryRule.check(context);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.file, 'src-tauri/src/services/project/query/sample.rs');
});

test('the spec construction owner parses its embedded strict JSON template', () => {
  const files = architectureFixtures({
    'src-tauri/src/domain/entity_construction.rs':
      'let defaults = serde_json::from_str(include_str!("../../../schemas/spec-defaults.json"));',
  });
  assert.deepEqual(messages(parserBoundaryRule.check(files)), []);
});

test('a project query consumes the formal Mod JSON parser boundary', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/project/query/spec.rs': 'let content = serde_json::from_str(&text);',
  });
  assert.equal(messages(parserBoundaryRule.check(files)).length, 1);
});
