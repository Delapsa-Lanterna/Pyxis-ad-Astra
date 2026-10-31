import { describe, expect, it } from 'vitest';
import { captureSaveEdits } from './save-edits';

describe('save edits', () => {
  it('captures actual object assignments, removals and atomic array replacements', () => {
    expect(captureSaveEdits({ a: 1, remove: null, list: [1] }, { a: 2, added: null, list: [1, 2] })).toEqual([
      { kind: 'set', path: ['a'], value: 2 },
      { kind: 'remove', path: ['remove'] },
      { kind: 'set', path: ['list'], value: [1, 2] },
      { kind: 'set', path: ['added'], value: null },
    ]);
  });
});
