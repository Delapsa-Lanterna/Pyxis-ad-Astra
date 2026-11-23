import { describe, expect, it } from 'vitest';
import type { CommittedFileChange } from '@/shared/types';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import { committedFileText } from './committed-text';

describe('saved text results', () => {
  it('projects directory replay text using the actual after paths and contents', async () => {
    const receipt = savedWriteFixture();
    receipt.sessionUpdates = [sessionUpdateFixture('s1', 'M:/mod')];
    const directory: CommittedFileChange = {
      kind: 'directory',
      beforePath: 'M:/mod/old',
      afterPath: 'M:/mod/next',
      beforeExists: true,
      beforeBinary: false,
      beforeFiles: ['gone.txt'],
      afterExists: true,
      afterText: null,
      afterBinary: false,
      afterFiles: [
        { relPath: 'new.txt', text: 'after', binary: false },
        { relPath: 'image.png', text: null, binary: true },
      ],
    };
    receipt.changes = [directory];
    expect(committedFileText(receipt, 'M:/mod/next/gone.txt')).toBe('');
    expect(committedFileText(receipt, 'M:/mod/next/new.txt')).toBe('after');
    expect(committedFileText(receipt, 'M:/mod/next/image.png')).toBeUndefined();
  });
  it('projects recovery writes to their actual registered text-session scope', async () => {
    const receipt = savedWriteFixture({ text: 'recovered' });
    receipt.sessionUpdates = [sessionUpdateFixture('s1', 'M:/mod')];
    receipt.changes = [
      {
        kind: 'file',
        beforePath: 'M:/mod/notes.txt',
        afterPath: 'M:/mod/notes.txt',
        beforeExists: true,
        afterExists: true,
        afterText: 'recovered',
        beforeBinary: false,
        afterBinary: false,
        beforeFiles: [],
        afterFiles: [],
      },
    ];
    expect(committedFileText(receipt, 'M:/mod/notes.txt')).toBe('recovered');
  });
});
