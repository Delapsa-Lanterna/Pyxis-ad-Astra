import assert from 'node:assert/strict';
import test from 'node:test';
import { rustTestOnly, rustConditionsOverlap, rustConditionEnabled } from '../src/rust-conditions.mjs';

test('compiler facts decide platform exclusions and retain unknown conditions', () => {
  for (const [condition, cfg, expected] of /** @type {[string,string[],boolean|null][]} */ ([
    ['#[cfg(windows)]', ['windows'], true],
    ['#[cfg(unix)]', ['windows'], false],
    ['#[cfg(not(windows))]', ['windows'], false],
    ['#[cfg(not(any(windows,unix)))]', ['windows'], false],
    ['#[cfg_attr(windows,cfg(unix))]', ['windows'], false],
    ['#[cfg_attr(unix,cfg(test))]', ['windows'], true],
    ['#[cfg(all(test,windows))]', ['windows'], null],
    ['#[cfg(feature="optional")]', ['windows'], null],
    ['#[cfg(windows)]', [], null],
    ['#[cfg(not(target_os = "windows"))]', ['target_os="windows"'], false],
  ]))
    assert.equal(rustConditionEnabled(condition, cfg), expected, condition);
});
test('production exclusion follows compound test conditions', () => {
  for (const condition of [
    '#[cfg(test)]',
    '#![cfg(test)]',
    '#[cfg(all(test,windows))]',
    '#[cfg(not(not(test)))]',
    '#[cfg(any(test,all(test,feature="sample")))]',
    '#[cfg_attr(not(test),cfg(test))]',
  ])
    assert.equal(rustTestOnly(condition), true, condition);
  for (const condition of ['', '#[cfg(windows)]', '#[cfg(any(test,windows))]', '#[cfg(not(test))]', '#[cfg_attr(test,cfg(windows))]'])
    assert.equal(rustTestOnly(condition), false, condition);
});

test('condition alternatives distinguish complementary and overlapping configurations', () => {
  for (const [left, right, expected] of /** @type {[string,string,boolean][]} */ ([
    ['#[cfg(windows)]', '#[cfg(not(windows))]', false],
    ['#[cfg(all(windows,feature="draw"))]', '#[cfg(not(feature="draw"))]', false],
    ['#[cfg(any(windows,unix))]', '#[cfg(windows)]', true],
    ['#[cfg(feature="one")]', '#[cfg(feature="two")]', true],
    ['#[test]', '#[cfg(not(test))]', false],
    ['#[cfg_attr(windows,cfg(feature="draw"))] #[cfg(windows)]', '#[cfg(not(feature="draw"))]', false],
    ['', '#[cfg(windows)]', true],
    ['#[cfg(windows)]', '#[cfg(unix)]', false],
    ['#[cfg(unix)]', '#[cfg(not(any(windows,unix)))]', false],
  ]))
    assert.equal(rustConditionsOverlap(left, right), expected, left + '; ' + right);
});
