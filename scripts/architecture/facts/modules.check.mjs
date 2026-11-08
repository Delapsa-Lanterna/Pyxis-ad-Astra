import { test } from 'node:test';
import { moduleDocumentFixtures, moduleDocumentPath } from '../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { collectArchitectureContext } from './context.mjs';

test('module ownership facts resolve owned descendants and exclude public paths', () => {
  const context = moduleDocumentFixtures();
  assert.equal(context.moduleMap.owners.get('src/domain/sample.ts'), moduleDocumentPath);
  assert.equal(context.moduleMap.owners.get('assets/icon.png'), moduleDocumentPath);
  assert.equal(context.moduleMap.owners.has('src/shared/value.ts'), false);
  assert.ok(context.moduleMap.ownershipReferences.some(({ rel, file }) => rel === 'src/domain/sample.ts' && file === moduleDocumentPath));
});

test('browser facilities have one test owner while formal sources and shared helpers retain their boundaries', async () => {
  const context = await collectArchitectureContext(process.cwd());
  const document = context.byPath.get('.zcode/modules/browser-testing.md');
  assert.ok(document);
  const owned = document.document.references.filter(({ group }) => group === '拥有').map(({ path }) => path);
  assert.deepEqual(owned, ['scripts/browser/', 'src/test/browser/']);
  for (const path of [...context.paths].filter((path) => !path.endsWith('/') && owned.some((root) => path.startsWith(root)))) {
    assert.equal(context.moduleMap.shared.has(path), false);
    const owners = context.documents.filter((file) =>
      file.document.references.some(
        (reference) => reference.group === '拥有' && context.moduleMap.descendants.get(reference.path.replace(/\/$/, ''))?.includes(path),
      ),
    );
    assert.deepEqual(
      owners.map(({ rel }) => rel),
      [document.rel],
    );
  }
  for (const path of [
    'src/test/fixtures/settings.ts',
    'src/test/unit/mount-setup.ts',
    'src/test/test-foundations.spec.ts',
    'scripts/shared/sample-statistics.mjs',
  ])
    assert.equal(context.moduleMap.shared.has(path), true);
  assert.equal(
    context.frontend.some(({ rel }) => rel === 'src/test/desktop/csv-audit.ts'),
    false,
  );
  assert.ok(context.frontend.some(({ rel }) => rel === 'src/app/App.vue'));
  assert.equal(context.paths.has('src/app/components/csv-editor/csv-rendering.browser.ts'), false);
  assert.equal(context.paths.has('scripts/performance/csv-rendering.mjs'), false);
  const monitor = context.byPath.get('.zcode/modules/performance-monitor.md');
  assert.ok(monitor);
  assert.equal(
    monitor.document.references.some(({ path }) => path.includes('browser/') || path.endsWith('performance_retained_tests.rs')),
    false,
  );
});

test('desktop facilities own their native drivers, probes, build configuration and type environment', async () => {
  const context = await collectArchitectureContext(process.cwd());
  const document = context.byPath.get('.zcode/modules/desktop-testing.md');
  assert.ok(document);
  const owned = document.document.references.filter(({ group }) => group === '拥有').map(({ path }) => path);
  assert.deepEqual(owned, [
    'scripts/desktop/',
    'src-tauri/tauri.desktop-testing.conf.json',
    'src/test/desktop/',
    'tsconfig.desktop-scripts.json',
  ]);
  for (const path of ['scripts/desktop/run.mjs', 'scripts/desktop/runtime.mjs', 'src/test/desktop/csv-audit.ts']) {
    assert.equal(context.moduleMap.shared.has(path), false);
    assert.equal(context.moduleMap.owners.get(path), '.zcode/modules/desktop-testing.md');
  }
  assert.equal(context.paths.has('scripts/browser/source-watch-desktop.mjs'), false);
  assert.equal(context.paths.has('scripts/browser/csv-desktop.mjs'), false);
});
