import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectArchitectureContext } from './context.mjs';
import { collectRepoPaths } from '../../shared/files.mjs';

test('repository collection exposes source roles and excludes controlled workspaces', async () => {
  const paths = await collectRepoPaths(process.cwd(), () => true, true);
  assert.equal(
    paths.some((file) => file.rel.startsWith('.audit-tools/')),
    false,
  );
  const files = await collectArchitectureContext(process.cwd());
  assert.equal(
    files.files.some((file) => file.rel.startsWith('.zcode/plans/')),
    false,
  );
  assert.equal(
    files.files.some((file) => file.rel.startsWith('src/')),
    true,
  );
  assert.equal(
    files.files.some((file) => file.rel.startsWith('src-tauri/src/')),
    true,
  );
  assert.equal(
    files.files.some((file) => file.rel.startsWith('.zcode/modules/')),
    true,
  );
});
