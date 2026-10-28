import { describe, expect, it } from 'vitest';
import type { FileChangeRecord } from '@/shared/types';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import { committedFileText } from './file-editor-window.orchestrator';

describe('saved text results', () => {
  it('projects directory replay text using the actual after paths and contents', async () => {
    const receipt = savedWriteFixture();
    receipt.sessionUpdates = [sessionUpdateFixture('s1', 'M:/mod')];
    const directory: FileChangeRecord = {
      kind: 'directory',
      beforePath: 'M:/mod/old',
      afterPath: 'M:/mod/next',
      beforeExists: true,
      beforeText: null,
      beforeDataBase64: null,
      beforeFiles: [{ relPath: 'gone.txt', text: 'before', dataBase64: null }],
      afterExists: true,
      afterText: null,
      afterDataBase64: null,
      afterFiles: [
        { relPath: 'new.txt', text: 'after', dataBase64: null },
        { relPath: 'image.png', text: null, dataBase64: 'AA==' },
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
        beforeText: 'old',
        afterText: 'recovered',
        beforeDataBase64: null,
        afterDataBase64: null,
        beforeFiles: [],
        afterFiles: [],
      },
    ];
    expect(committedFileText(receipt, 'M:/mod/notes.txt')).toBe('recovered');
  });
});
