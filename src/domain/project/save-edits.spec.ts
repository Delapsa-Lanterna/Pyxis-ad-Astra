import { describe, expect, it } from 'vitest';
import { captureSaveEdits, retainLaterDraft } from './save-edits';

describe('save edits', () => {
  it('captures actual object assignments, removals and atomic array replacements', () => {
    expect(captureSaveEdits({ a: 1, remove: null, list: [1] }, { a: 2, added: null, list: [1, 2] })).toEqual([
      { kind: 'set', path: ['a'], value: 2 },
      { kind: 'remove', path: ['remove'] },
      { kind: 'set', path: ['list'], value: [1, 2] },
      { kind: 'set', path: ['added'], value: null },
    ]);
  });
  it('retains a later undo while accepting the other fields from the actual saved result', () => {
    expect(retainLaterDraft({ speed: 80, name: 'before' }, { speed: 100, name: 'before' }, { speed: 100, name: 'after' })).toEqual({
      speed: 80,
      name: 'after',
    });
  });
  it('preserves later removal, addition, arrays and prototype-named business fields', () => {
    const current = JSON.parse('{"__proto__":{"v":2},"list":[2],"added":3}');
    const submitted = JSON.parse('{"__proto__":{"v":1},"list":[1],"removed":2}');
    const saved = JSON.parse('{"__proto__":{"v":1,"other":4},"list":[1],"removed":2}');
    const result = retainLaterDraft(current, submitted, saved);
    expect(result).toEqual(JSON.parse('{"__proto__":{"v":2,"other":4},"list":[2],"added":3}'));
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
  });
});
