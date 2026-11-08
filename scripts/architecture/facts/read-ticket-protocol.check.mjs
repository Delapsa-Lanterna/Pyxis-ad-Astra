import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures, readTicketSource } from '../testing/fixtures.mjs';
import { readTicketProtocol } from './read-ticket-protocol.mjs';

test('ticket roles follow native cancellation and guarded failure after internal names change', () => {
  const source = readTicketSource
    .replaceAll('createReadTicket', 'makeTask')
    .replaceAll('requireCurrent', 'accept')
    .replaceAll('invalidate', 'revoke')
    .replaceAll('promise', 'completion');
  const context = architectureFixtures({ 'src/shared/runtime/read-request.ts': source });
  const protocol = readTicketProtocol(context.byPath.get('src/shared/runtime/read-request.ts'));
  assert.deepEqual([...protocol.factories], ['makeTask']);
  assert.deepEqual([...protocol.checks], ['accept']);
  assert.deepEqual([...protocol.invalidations], ['revoke']);
  assert.deepEqual([...protocol.promises], ['completion']);
});
