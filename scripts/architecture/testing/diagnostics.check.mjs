import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkArchitecture } from '../check.mjs';
import { formatDiagnostic, sortedDiagnostics } from '../diagnostics.mjs';
import { rules } from '../registry.mjs';
import { architectureFixtures } from './fixtures.mjs';

test('registered contracts have stable unique identities and deterministically ordered diagnostics', () => {
  assert.equal(new Set(rules.map((rule) => rule.name)).size, rules.length);
  assert.ok(rules.every((rule) => rule.reference.startsWith('.zcode/') && rule.source.startsWith('scripts/architecture/rules/')));
  const context = architectureFixtures({
    'src/domain/zeta.ts': "\nimport {run} from '@/services/sample.service';",
    'src/domain/alpha.ts': "\nimport {run} from '@/services/sample.service';",
    'src/services/sample.service.ts': 'export function run() {}',
  });
  const diagnostics = checkArchitecture(context).filter((diagnostic) => diagnostic.ruleId === 'frontend-layer-boundary');
  assert.deepEqual(
    diagnostics.map(({ file, line, ruleId }) => ({ file, line, ruleId })),
    [
      { file: 'src/domain/alpha.ts', line: 2, ruleId: 'frontend-layer-boundary' },
      { file: 'src/domain/zeta.ts', line: 2, ruleId: 'frontend-layer-boundary' },
    ],
  );
  assert.deepEqual(sortedDiagnostics([...diagnostics].reverse()), diagnostics);
  assert.match(
    formatDiagnostic(diagnostics[0]),
    /^src\/domain\/alpha\.ts:2:\d+: \[frontend-layer-boundary\] src\/services\/sample.service.ts:/,
  );
});
test('the real architecture command completes with the public success result', () => {
  const result = spawnSync(process.execPath, ['scripts/check-architecture.mjs'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'Architecture check passed.');
});

test('dependency rejection follows layer, responsibility and capability ownership for frontend and Rust', () => {
  const context = architectureFixtures({
    'src/app/composables/use-edit-target-draft-session.ts': "\nimport {saveCsvPatch} from '@/services/csv-table.service';",
    'src/services/csv-table.service.ts': 'export function saveCsvPatch(){}',
    'src-tauri/src/services/file_history.rs': '\nuse crate::services::project::query_entity;',
  });
  const frontend = checkArchitecture(context).filter((d) => d.file === 'src/app/composables/use-edit-target-draft-session.ts');
  const rust = checkArchitecture(context).filter((d) => d.file.endsWith('file_history.rs'));
  assert.equal(frontend.length, 2);
  assert.equal(rust.length, 2);
  assert.deepEqual(frontend.map((diagnostic) => diagnostic.ruleId).sort(), ['capability-boundary', 'draft-session-boundary']);
  assert.deepEqual(rust.map((diagnostic) => diagnostic.ruleId).sort(), ['rust-project-layer-boundary', 'rust-service-edge-boundary']);
  for (const diagnostic of [...frontend, ...rust]) {
    assert.equal(diagnostic.line, 2);
    assert.ok(diagnostic.column > 0);
    assert.ok(diagnostic.target && diagnostic.symbol && diagnostic.expected);
    const rule = rules.find((candidate) => candidate.name === diagnostic.ruleId);
    assert.equal(diagnostic.reference, rule?.reference);
    assert.equal(diagnostic.source, rule?.source);
  }
});

test('the real command reports a missing repository contract and exits with status one', () => {
  const result = spawnSync(process.execPath, [resolve('scripts/check-architecture.mjs')], {
    cwd: resolve('scripts/architecture/testing'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /\.zcode\/module-map\.md:1:1: \[module-structure\] module map index file is missing/);
});
