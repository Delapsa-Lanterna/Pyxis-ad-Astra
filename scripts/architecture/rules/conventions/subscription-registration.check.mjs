import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { subscriptionRegistrationRule } from './subscription-registration.mjs';

const file = 'src/services/sample.service.ts';
/** @param {string} body */
function check(body) {
  const source = `function subscribe(): () => void { handlers.add(listener); return () => {handlers.delete(listener);} }
declare const handlers: Set<() => void>, listener: () => void, ready: Promise<void>;
async function listen() {
${body}
}`;
  return subscriptionRegistrationRule.check(architectureFixtures({ [file]: source }));
}

test('reports the await that can lose an acquired cleanup', () => {
  for (const [acquire, release] of [
    ['const stop = subscribe();', 'return stop;'],
    ['handlers.add(listener);', 'return () => handlers.delete(listener);'],
    ["window.addEventListener('focus', listener);", "return () => window.removeEventListener('focus', listener);"],
  ]) {
    const diagnostics = check([acquire, 'await ready;', release].join('\n'));
    assert.equal(diagnostics.length, 1);
    assert.deepEqual(
      [diagnostics[0]?.ruleId, diagnostics[0]?.file, diagnostics[0]?.line, diagnostics[0]?.column],
      ['subscription-registration', file, 5, 1],
    );
  }
});

test('checks rollback ownership and permits waiting before registration', () => {
  assert.deepEqual(check('await ready; handlers.add(listener); return () => handlers.delete(listener);'), []);
  assert.deepEqual(check('const stop=subscribe(); try {await ready;} catch (e) {stop(); throw e;} return stop;'), []);
  assert.deepEqual(
    check(
      'handlers.add(listener); try {await ready;} catch (e) {handlers.delete(listener); throw e;} return () => handlers.delete(listener);',
    ),
    [],
  );
  assert.equal(
    check(
      'handlers.add(listener); try {await ready;} catch (e) {handlers.delete(() => {}); throw e;} return () => handlers.delete(listener);',
    ).length,
    1,
  );
  assert.equal(check('const stop=subscribe(); try {await ready;} catch (e) {const stop=()=>{}; stop(); throw e;} return stop;').length, 1);
  assert.equal(check('const stop=subscribe(); try {await ready;} catch (e) {e && stop(); throw e;} return stop;').length, 1);
  assert.deepEqual(check('const act=()=>()=>{}; const task=act(); await ready; return task;'), []);
  assert.deepEqual(check('const stop=subscribe(); const later=async()=>{await ready;}; return stop;'), []);
});

test('both production subscriptions report a removed rejection cleanup', () => {
  const rel = 'src/orchestrators/project-sync.orchestrator.ts';
  const source = readFileSync(rel, 'utf8');
  const broken = source.replaceAll('    stop();\n    throw error;', '    throw error;');
  const scan = (/** @type {string} */ code) => subscriptionRegistrationRule.check(architectureFixtures({ [rel]: code }));
  assert.deepEqual(scan(source), []);
  assert.equal(scan(broken).length, 2);
});
