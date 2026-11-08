import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestWorkspace } from './shared/test-workspace.mjs';
import { rules } from './architecture/registry.mjs';
import { moduleDocumentFixtures, moduleDocumentText } from './architecture/testing/fixtures.mjs';

const command = fileURLToPath(new URL('./check-architecture.mjs', import.meta.url));

test('the architecture command completes with the public success result', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-architecture-check');
  try {
    const sources = Object.fromEntries(moduleDocumentFixtures().files.map(({ rel, text }) => [rel, text]));
    for (const reference of new Set(rules.map((rule) => rule.reference.replace(/#.*/, '')))) {
      if (reference in sources) continue;
      if (reference.startsWith('.zcode/modules/')) {
        const id = basename(reference, '.md');
        sources[reference] = moduleDocumentText.replace('# 样例模块', '# ' + id).replace('### 拥有', '### 关联');
        sources['.zcode/module-map.md'] += '- [' + id + '](modules/' + id + '.md)：Fixture.\n';
      } else sources[reference] = '';
    }
    for (const rule of rules) {
      const [reference, anchor] = /** @type {[string, string?]} */ (rule.reference.split('#'));
      const text = /** @type {string} */ (sources[reference]);
      if (!anchor || text.split('\n').some((line) => line.replace(/^#+ /, '').toLowerCase() === anchor.toLowerCase())) continue;
      const heading = decodeURIComponent(anchor);
      if (reference.startsWith('.zcode/modules/'))
        sources[reference] = text.replace('## 规范', '### ' + heading + '\n\n1. 交付所属结果。\n\n## 规范');
      else if (reference === '.zcode/module-map.md') sources[reference] = '## ' + heading + '\n\n' + sources[reference];
      else sources[reference] += '\n## ' + heading + '\n';
    }
    for (const [rel, text] of Object.entries(sources)) {
      if (rel.endsWith('/')) await mkdir(root.path(rel), { recursive: true });
      else {
        await mkdir(dirname(root.path(rel)), { recursive: true });
        await writeFile(root.path(rel), text, 'utf8');
      }
    }
    const result = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'Architecture check passed.');
    assert.equal(result.stderr, '');
  } finally {
    await root.close();
  }
});

test('the architecture command reports a missing repository contract and exits with status one', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-architecture-missing-contract');
  try {
    const result = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\.zcode\/module-map\.md:1:1: \[module-structure\] module map index file is missing/);
  } finally {
    await root.close();
  }
});
