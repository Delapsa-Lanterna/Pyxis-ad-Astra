import { test } from 'node:test';
import { architectureFixtures } from './testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { defineRule, sortedDiagnostics, formatDiagnostic } from './diagnostics.mjs';

test('rule diagnostics retain their source positions, deterministic order and public format', () => {
  const context = architectureFixtures({
    'src/domain/zeta.ts': "\nimport {run} from '@/services/sample.service';",
    'src/domain/alpha.ts': "\nimport {run} from '@/services/sample.service';",
    'src/services/sample.service.ts': 'export function run() {}',
  });
  const rule = defineRule('frontend-layer-boundary', '.zcode/overview.md#前端', import.meta.url, (context, report) => {
    for (const file of context.frontend.filter((file) => file.rel.startsWith('src/domain/')))
      report(file, { line: 2, column: 9 }, 'domain must consume domain or shared', { target: 'src/services/sample.service.ts' });
  });
  const diagnostics = sortedDiagnostics(rule.check(context));
  assert.deepEqual(
    diagnostics.map(({ file, line, ruleId }) => ({ file, line, ruleId })),
    [
      { file: 'src/domain/alpha.ts', line: 2, ruleId: 'frontend-layer-boundary' },
      { file: 'src/domain/zeta.ts', line: 2, ruleId: 'frontend-layer-boundary' },
    ],
  );
  assert.deepEqual(sortedDiagnostics([...diagnostics].reverse()), diagnostics);
  assert.ok(diagnostics[0]);
  assert.match(
    formatDiagnostic(diagnostics[0]),
    /^src\/domain\/alpha\.ts:2:\d+: \[frontend-layer-boundary\] src\/services\/sample.service.ts:/,
  );
});
