import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from './registry.mjs';

test('registered contracts have stable unique identities', () => {
  assert.equal(new Set(rules.map((rule) => rule.name)).size, rules.length);
  assert.ok(rules.every((rule) => rule.reference.startsWith('.zcode/') && rule.source.startsWith('scripts/architecture/rules/')));
});
