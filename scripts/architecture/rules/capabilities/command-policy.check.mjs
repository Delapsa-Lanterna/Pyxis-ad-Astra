import { test } from 'node:test';
import { commandOwners } from './command-policy.mjs';
import assert from 'node:assert/strict';

test('every declared command has exactly one capability owner', () => {
  const commands = Object.values(commandOwners).flat();
  assert.ok(commands.length > 0);
  assert.equal(new Set(commands).size, commands.length);
});
