import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures, readTicketSource } from '../testing/fixtures.mjs';
import { readTicketLifecycles } from './read-tickets.mjs';
import { callsFrom } from './imports.mjs';
import { readTicketProtocol } from './read-ticket-protocol.mjs';

/** @param {string} body @param {boolean} [renamed] */
function failures(body, renamed = false) {
  const rename = (/** @type {string} */ value) =>
    renamed
      ? value
          .replaceAll('createReadTicket', 'makeTask')
          .replaceAll('requireCurrent', 'accept')
          .replaceAll('invalidate', 'revoke')
          .replaceAll('promise', 'completion')
      : value;
  const context = architectureFixtures({
    'src/shared/runtime/read-request.ts': rename(readTicketSource),
    'src/app/composables/use-sample.ts': rename(
      "import {createReadTicket} from '@/shared/runtime/read-request'; import {onScopeDispose} from 'vue'; const task=createReadTicket(id,load); " +
        body,
    ),
  });
  const file = context.byPath.get('src/app/composables/use-sample.ts');
  assert.ok(file);
  const protocol = readTicketProtocol(context.byPath.get('src/shared/runtime/read-request.ts'));
  const creations = callsFrom(file, context.byPath, new Set(['src/shared/runtime/read-request.ts'])).filter((call) =>
    protocol.factories.has(call.name),
  );
  return readTicketLifecycles(file, creations, context.byPath).flatMap((lifecycle) => lifecycle.flowFailures);
}

for (const renamed of [false, true])
  test('publication ordering follows ticket roles after renaming=' + renamed, () => {
    assert.equal(failures('void task.promise.then(value=>{ publish(value); task.requireCurrent(); });', renamed).length, 1);
    assert.deepEqual(failures('void task.promise.then(value=>{ task.requireCurrent(); publish(value); });', renamed), []);
  });

test('every live branch must establish the result current check', () => {
  assert.equal(failures('void task.promise.then(value=>{ if(flag)task.requireCurrent(); publish(value); });').length, 1);
  assert.deepEqual(
    failures('void task.promise.then(value=>{ if(flag)task.requireCurrent(); else task.requireCurrent(); publish(value); });'),
    [],
  );
  assert.deepEqual(failures('void task.promise.then(value=>{ if(flag)return; task.requireCurrent(); publish(value); });'), []);
});

test('awaiting after acceptance creates a fresh publication obligation', () => {
  assert.equal(
    failures('async function read(){ const value=await task.promise; task.requireCurrent(); await pause(); publish(value); }').length,
    1,
  );
  assert.deepEqual(
    failures('async function read(){ const value=await task.promise; await pause(); task.requireCurrent(); publish(value); }'),
    [],
  );
});

test('release callbacks revoke tickets on every exit path', () => {
  assert.equal(failures('onScopeDispose(()=>{ if(flag)task.invalidate(); });').length, 1);
  assert.deepEqual(failures('onScopeDispose(()=>{ if(flag)task.invalidate(); else task.invalidate(); });'), []);
});

test('promise failure handlers preserve their independent error values', () => {
  assert.deepEqual(
    failures('void task.promise.then(value=>{task.requireCurrent(); publish(value);}).catch(error=>{ report(error); });'),
    [],
  );
});

test('conditional checks and final release retain each path obligation', () => {
  assert.equal(failures('void task.promise.then(value=>{ flag && task.requireCurrent(); publish(value); });').length, 1);
  assert.deepEqual(failures('onScopeDispose(()=>{try{if(flag)return;}finally{task.invalidate();}});'), []);
  assert.equal(failures('void task.promise.then(value=>{switch(flag){case 1:task.requireCurrent();break;} publish(value);});').length, 1);
  assert.deepEqual(
    failures(
      'void task.promise.then(value=>{switch(flag){case 1:task.requireCurrent();break;default:task.requireCurrent();} publish(value);});',
    ),
    [],
  );
});

test('tainted results through local helpers preserve the calling ticket identity', () => {
  assert.equal(
    failures(
      'function project(input){return input;} void task.promise.then(value=>{const selected=project(value); publish(selected); task.requireCurrent();});',
    ).length,
    1,
  );
  assert.deepEqual(
    failures(
      'function project(input){return input;} void task.promise.then(value=>{const selected=project(value); task.requireCurrent(); publish(selected);});',
    ),
    [],
  );
});
