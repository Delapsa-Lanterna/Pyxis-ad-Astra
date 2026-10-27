import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommittedWriteEvent, SpecEditorKind, FileChangeRecord } from '@/shared/types';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  listeners: [] as Array<{ handler: (event: CommittedWriteEvent) => Promise<void>; phase: string | undefined }>,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', () => ({
  publishCommittedWrite: mocks.publish,
  listenProjectSessionInvalidated: vi.fn(),
  listenCommittedWrites: async (handler: (event: CommittedWriteEvent) => Promise<void>, _matches?: unknown, phase?: string) => {
    const entry = { handler, phase };
    mocks.listeners.push(entry);
    return () => {
      mocks.listeners.splice(mocks.listeners.indexOf(entry), 1);
    };
  },
}));

import { listenEditorSpecSaved } from './editor-window.orchestrator';
import { committedFileText } from './file-editor-window.orchestrator';

function event(): CommittedWriteEvent {
  return { originWindowLabel: 'peer', sessionId: 's1', modRoot: 'M:/mod', reason: 'undo', result: savedWriteFixture() };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.length = 0;
  mocks.publish.mockResolvedValue(undefined);
});
describe('committed write domain projections', () => {
  it.each(['ship', 'weapon', 'projectile', 'system'] as SpecEditorKind[])(
    'publishes %s saves and projects their formal identity from one receipt',
    async (kind) => {
      const receipt = savedWriteFixture({ id: 'next', hullId: 'next' }, { kind: 'spec', target: entityTargetFixture(kind, 'next') });
      receipt.identityChanges = [{ before: entityTargetFixture(kind, 'old'), after: entityTargetFixture(kind, 'next') }];
      const source = { sessionId: 's1', modRoot: 'M:/mod', kind, id: 'next', spec: receipt.content!.value, writeResult: receipt };
      const receive = vi.fn();
      await listenEditorSpecSaved(receive);
      await mocks.listeners[0]!.handler({ ...event(), result: receipt });
      expect(receive).toHaveBeenCalledWith(source);
    },
  );
  it('releases a spec listener after consuming a generic file receipt', async () => {
    const receive = vi.fn();
    const stop = await listenEditorSpecSaved(receive);
    await mocks.listeners[0]!.handler(event());
    expect(receive).not.toHaveBeenCalled();
    stop();
    expect(mocks.listeners).toHaveLength(0);
  });
  it('routes identified text saves through projection reads while retaining their text receipt', async () => {
    const receipt = savedWriteFixture({ text: '{hullId:"next"}' });
    receipt.identityChanges = [{ before: entityTargetFixture('ship', 'old'), after: entityTargetFixture('ship', 'next') }];
    const receive = vi.fn();
    await listenEditorSpecSaved(receive);
    await mocks.listeners[0]!.handler({ ...event(), result: receipt });
    expect(receive).not.toHaveBeenCalled();
  });
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
