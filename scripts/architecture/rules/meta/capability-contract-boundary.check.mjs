import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { capabilityContractBoundaryRule } from './capability-contract-boundary.mjs';

test('declared capabilities resolve actual provider exports and consumer roles', () => {
  const context = architectureFixtures({
    'scripts/architecture/rules/capabilities/frontend-policy.mjs': '',
    'src/services/font.service.ts': 'export function renamed() {}',
    'src/app/composables/use-original-fonts.ts': 'export function useOriginalFonts() {}',
  });
  const missing = capabilityContractBoundaryRule.check(context).filter((item) => item.symbol === 'queryOriginalFont');
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.expected, 'existing runtime export');
  const provider = context.byPath.get('src/services/font.service.ts');
  assert.ok(provider);
  provider.exports.push({
    exportedName: 'queryOriginalFont',
    localName: 'queryOriginalFont',
    importedName: 'queryOriginalFont',
    specifier: null,
    typeOnly: false,
    line: 1,
    column: 1,
  });
  assert.deepEqual(
    capabilityContractBoundaryRule.check(context).filter((item) => item.symbol === 'queryOriginalFont'),
    [],
  );
});
