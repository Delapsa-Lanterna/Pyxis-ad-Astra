import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from './fixtures.mjs';
import { capabilityBoundaryRule } from '../rules/capabilities/capability-boundary.mjs';
import { frontendLayerBoundaryRule } from '../rules/dependencies/frontend-layer-boundary.mjs';

/** @param {[string, string, string, string][]} cases */
export function testCapabilities(cases) {
  for (const [capability, from, target, name] of cases) {
    const statement = `import { ${name} } from '@/${target.slice(4, -3)}';`;
    const provider = { [target]: `export function ${name}() {}` };
    test(`${capability} is accepted at its formal owner`, () => {
      const context = architectureFixtures({
        [from]: from.endsWith('.vue') ? `<script setup>${statement}</script>` : statement,
        ...provider,
      });
      assert.deepEqual(frontendLayerBoundaryRule.check(context), []);
      assert.deepEqual(capabilityBoundaryRule.check(context), []);
    });
    test(`${capability} is rejected from a window capability consumer`, () => {
      const context = architectureFixtures({ ...provider, 'src/windows/audit.window.ts': statement });
      const failures = capabilityBoundaryRule.check(context).filter((diagnostic) => diagnostic.file === 'src/windows/audit.window.ts');
      assert.equal(failures.length, 1);
      assert.ok(failures[0]);
      assert.equal(failures[0].ruleId, 'capability-boundary');
      assert.ok(failures[0].symbol?.includes(name));
      assert.ok(failures[0].target && failures[0].expected);
    });
  }
}
