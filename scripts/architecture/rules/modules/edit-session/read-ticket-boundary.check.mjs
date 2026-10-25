import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { readTicketBoundaryRule } from './read-ticket-boundary.mjs';

const ticket = 'src/shared/runtime/read-request.ts';
for (const source of [
  "import {createReadTicketOwner as owner} from '@/shared/runtime/read-request';",
  "import * as reads from '@/shared/runtime/read-request';",
  "const reads=import('@/shared/runtime/read-request');",
]) {
  test('read ticket ownership follows ' + source, () => {
    const declarations = { [ticket]: 'export function createReadTicketOwner() {}' };
    const legal = architectureFixtures({ ...declarations, 'src/app/composables/use-sample.ts': source });
    assert.deepEqual(readTicketBoundaryRule.check(legal), []);
    const context = architectureFixtures({ ...declarations, 'src/app/components/Sample.vue': '<script setup>\n' + source + '</script>' });
    const [diagnostic] = readTicketBoundaryRule.check(context);
    assert.equal(diagnostic.ruleId, 'read-ticket-boundary');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.target, ticket);
    assert.equal(diagnostic.expected, 'read runtime or composable');
  });
}
test('read ticket types and unrelated local names retain their own meaning', () => {
  const context = architectureFixtures({
    [ticket]: 'export interface ReadTicket {}',
    'src/app/components/Sample.vue':
      '<script setup lang="ts">import type {ReadTicket} from "@/shared/runtime/read-request"; const createQueryReadOwner = "sample";</script>',
  });
  assert.deepEqual(readTicketBoundaryRule.check(context), []);
});

test('direct ReadTicket consumers must accept and invalidate their ticket', () => {
  const invalid = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts':
      "import {createReadTicket} from '@/shared/runtime/read-request'; const ticket=createReadTicket(id, load); void ticket.promise;",
  });
  const diagnostics = readTicketBoundaryRule.check(invalid);
  assert.deepEqual(diagnostics.map(({ expected }) => expected).sort(), ['ticket.accept()', 'ticket.invalidate(reason)'].sort());
  const legal = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts':
      "import {createReadTicket} from '@/shared/runtime/read-request'; const ticket=createReadTicket(id, load); void ticket.promise.then(() => ticket.accept()); onScopeDispose(() => ticket.invalidate('consumer'));",
  });
  assert.deepEqual(readTicketBoundaryRule.check(legal), []);
});

test('each direct ticket keeps its own acceptance obligation', () => {
  const context = architectureFixtures({
    [ticket]: 'export function createReadTicket() {}',
    'src/app/composables/use-sample.ts': `
      import {createReadTicket} from '@/shared/runtime/read-request';
      const first=createReadTicket(firstId, load);
      const second=createReadTicket(secondId, load);
      void first.promise.then(() => first.accept());
      onScopeDispose(() => { first.invalidate('consumer'); second.invalidate('consumer'); });
    `,
  });
  assert.deepEqual(
    readTicketBoundaryRule.check(context).map(({ expected }) => expected),
    ['ticket.accept()'],
  );
});
