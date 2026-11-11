import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { mountSetup } from '@/test/unit/mount-setup';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { useTextFiles } from '@/app/composables/text-file-editing/use-text-files';
import { useTextFileBatch } from '@/app/composables/text-file-editing/use-text-file-batch';
import { writeTextContent } from '@/shared/runtime/text-document';
import type { JavaAssistance, TextBatchSave, WriteResult, AppFeedback } from '@/shared/types';

const owner = { sessionId: 'sample', modRoot: 'M:/sample' };
const sources = new Map([
  ['M:/sample/A.java', 'class A {}\r\n'],
  ['M:/sample/B.java', 'class B {A a;}\r\n'],
]);
const mocks = vi.hoisted(() => ({
  write: vi.fn<(input: TextBatchSave) => Promise<WriteResult>>(),
  choose: vi.fn<AppFeedback['choose']>(async () => 'discard'),
  wait: vi.fn(async () => {}),
}));
vi.mock('@/services/text-file-editing.service', () => ({
  loadTextFile: async (_session: string, _root: string, path: string) => ({
    path,
    text: sources.get(path)!,
    baseVersions: [{ path, fingerprint: 'fixture' }],
    entity: null,
  }),
  saveTextBatch: mocks.write,
}));
vi.mock('@/services/code-editor.service', () => ({ subscribeCodeEditor: async () => {}, finishCodeEditorOpen: async () => {} }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: mocks.choose, error: vi.fn() }) }));
vi.mock('@/orchestrators/window-identity.orchestrator', () => ({
  withFileTargets: async (_targets: unknown, action: () => Promise<unknown>) => action(),
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  settleSavedContent: mocks.wait,
}));
enableAutoUnmount(afterEach);
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.clearAllMocks();
  mocks.write.mockImplementation(async (input) => {
    const result = savedWriteFixture();
    result.baseVersions = input.files.map((file) => ({ path: file.target ?? file.path, fingerprint: 'saved' }));
    result.changes = input.files.map((file) => ({
      kind: 'file',
      beforePath: file.path,
      afterPath: file.target ?? file.path,
      beforeExists: true,
      afterExists: true,
      beforeText: sources.get(file.path)!,
      afterText: file.text,
      beforeDataBase64: null,
      afterDataBase64: null,
      beforeFiles: [],
      afterFiles: [],
    }));
    return result;
  });
});
async function setup() {
  const mounted = mountSetup(() => {
    const host = useTextFiles(owner);
    return { host, batch: useTextFileBatch(host, owner) };
  });
  await mounted.value.host.ready;
  await mounted.value.host.openFiles([...sources.keys()].map((path) => ({ path })));
  return mounted.value;
}
function plan(): JavaAssistance {
  return {
    assistance: true,
    purpose: 'rename',
    project: 'sample',
    revision: 1,
    file: 'M:/sample/A.java',
    version: 1,
    argument: 0,
    candidates: [],
    choices: [],
    conflicts: [],
    files: [
      {
        file: 'M:/sample/A.java',
        version: 1,
        source: sources.get('M:/sample/A.java')!,
        target: 'M:/sample/Beacon.java',
        edits: [{ from: 6, to: 7, text: 'Beacon' }],
      },
      {
        file: 'M:/sample/B.java',
        version: 1,
        source: sources.get('M:/sample/B.java')!,
        target: null,
        edits: [{ from: 9, to: 10, text: 'Beacon' }],
      },
    ],
  };
}
it('accepts and undoes the entire multi-file edit, saves once and follows the file identity', async () => {
  const { host, batch } = await setup();
  await batch.apply(plan(), async () => {});
  const [a, b] = host.documents;
  expect(writeTextContent(a!.document.content.value)).toBe('class Beacon {}\r\n');
  expect(writeTextContent(b!.document.content.value)).toBe('class B {Beacon a;}\r\n');
  a!.undo();
  expect(writeTextContent(a!.document.content.value)).toBe(sources.get('M:/sample/A.java'));
  expect(writeTextContent(b!.document.content.value)).toBe(sources.get('M:/sample/B.java'));
  a!.redo();
  await Promise.all([a!.save(), b!.save()]);
  await flushPromises();
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(a!.path.value).toBe('M:/sample/Beacon.java');
  expect(host.dirty.value).toBe(false);
  a!.undo();
  expect(host.dirty.value).toBe(true);
  await a!.save();
  await flushPromises();
  expect(mocks.write.mock.calls[1]![0].files[0]).toMatchObject({ path: 'M:/sample/Beacon.java', target: 'M:/sample/A.java' });
});
it('rejects changed sources and stale previews before mutating any document', async () => {
  const { host, batch } = await setup();
  host.documents[1]!.setText('later');
  await expect(batch.apply(plan(), async () => {})).rejects.toThrow('草稿已变化');
  expect(writeTextContent(host.documents[0]!.document.content.value)).toBe(sources.get('M:/sample/A.java'));
  host.documents[1]!.setText(sources.get('M:/sample/B.java')!);
  await expect(
    batch.apply(plan(), async () => {
      throw Error('stale');
    }),
  ).rejects.toThrow('stale');
  expect(host.dirty.value).toBe(false);
});
it('keeps the batch saving until the project queue finishes its delivery', async () => {
  const { host, batch } = await setup();
  await batch.apply(plan(), async () => {});
  let release!: () => void;
  mocks.wait.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  const saving = host.documents[0]!.save();
  await flushPromises();
  expect(host.documents.every((document) => document.session.saving.value)).toBe(true);
  release();
  await saving;
  expect(host.documents.every((document) => !document.session.saving.value)).toBe(true);
});
it('preserves input during one shared save and releases the group after discard', async () => {
  const { host, batch } = await setup();
  await batch.apply(plan(), async () => {});
  let done!: (result: WriteResult) => void;
  const original = mocks.write.getMockImplementation()!;
  mocks.write.mockImplementationOnce(
    (input) =>
      new Promise((resolve) => {
        done = resolve;
        void original(input).then((result) => {
          saved = result;
        });
      }),
  );
  let saved!: WriteResult;
  const saving = host.documents[0]!.save();
  await flushPromises();
  host.documents[1]!.setText('later');
  done(saved);
  await saving;
  await flushPromises();
  expect(writeTextContent(host.documents[1]!.document.content.value)).toBe('later');
  expect(host.dirty.value).toBe(true);
  await host.close(host.documents[1]!);
  expect(host.documents[0]!.group.value).toBeNull();
});

it('keeps independent saves separate and restores a saved operation as a new pending group', async () => {
  sources.set('M:/sample/Cedar.java', 'class Cedar {}');
  sources.set('M:/sample/Dune.java', 'class Dune {}');
  try {
    const { host, batch } = await setup();
    await batch.apply(plan(), async () => {});
    await host.documents[0]!.save();
    await batch.apply(
      {
        files: ['Cedar', 'Dune'].map((name) => ({
          file: `M:/sample/${name}.java`,
          source: sources.get(`M:/sample/${name}.java`)!,
          target: null,
          edits: [{ from: 0, to: 0, text: '// changed\n' }],
        })),
      },
      async () => {},
    );
    await host.documents[2]!.save();
    expect(mocks.write.mock.calls[1]![0].files.map((file) => file.path)).toEqual(['M:/sample/Cedar.java', 'M:/sample/Dune.java']);
    host.documents[0]!.undo();
    await host.documents[0]!.save();
    expect(mocks.write.mock.calls[2]![0].files.map((file) => file.path)).toEqual(['M:/sample/Beacon.java', 'M:/sample/B.java']);
  } finally {
    sources.delete('M:/sample/Cedar.java');
    sources.delete('M:/sample/Dune.java');
  }
});

it('saves the full closure of overlapping pending operations in one write', async () => {
  sources.set('M:/sample/Cedar.java', 'class Cedar {}');
  try {
    const { host, batch } = await setup();
    await batch.apply(plan(), async () => {});
    await batch.apply(
      {
        files: host.documents.slice(1).map((file) => ({
          file: file.path.value,
          source: writeTextContent(file.document.content.value),
          target: null,
          edits: [{ from: 0, to: 0, text: '// next\n' }],
        })),
      },
      async () => {},
    );
    await host.documents[2]!.save();
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.write.mock.calls[0]![0].files.map((file) => file.path)).toEqual([
      'M:/sample/Cedar.java',
      'M:/sample/B.java',
      'M:/sample/A.java',
    ]);
    expect(host.dirty.value).toBe(false);
  } finally {
    sources.delete('M:/sample/Cedar.java');
  }
});

it('lists every discarded file and rechecks all associated drafts after confirmation', async () => {
  const { host, batch } = await setup();
  await batch.apply(plan(), async () => {});
  const [first, second] = host.documents;
  mocks.choose.mockImplementationOnce(async () => {
    first!.setText('continued input');
    return 'discard';
  });
  await host.close(second!);
  expect(host.documents).toHaveLength(2);
  expect(writeTextContent(first!.document.content.value)).toBe('continued input');
  await host.close(second!);
  const prompt = mocks.choose.mock.calls.at(-1)![0];
  expect(prompt.content).toContain(first!.path.value);
  expect(prompt.content).toContain(second!.path.value);
  expect(writeTextContent(first!.document.content.value)).toBe(sources.get('M:/sample/A.java'));
  expect(first!.group.value).toBeNull();
});

it('retains all drafts after a failed batch save and releases only the closed history boundary', async () => {
  const { host, batch } = await setup();
  await batch.apply(plan(), async () => {});
  mocks.write.mockRejectedValueOnce(new Error('sample write failure'));
  await expect(host.documents[0]!.save()).rejects.toThrow('sample write failure');
  expect(host.documents.every((file) => file.dirty.value && !file.session.saving.value)).toBe(true);
  await host.documents[0]!.save();
  await host.close(host.documents[0]!);
  const remaining = host.documents[0]!;
  remaining.setText('independent edit');
  remaining.undo();
  expect(() => remaining.undo()).toThrow('关联文件已关闭');
});

it('opens a missing member once and refuses a read-only member before changing other files', async () => {
  const mounted = mountSetup(() => {
    const host = useTextFiles(owner);
    return { host, batch: useTextFileBatch(host, owner) };
  });
  const { host, batch } = mounted.value;
  await host.ready;
  await batch.apply(plan(), async () => {});
  expect(host.documents).toHaveLength(2);
  await host.openSnapshot('M:/sample/Readonly.java', 'class Readonly {}');
  const before = host.documents[0]!.document.content.value;
  await expect(
    batch.apply(
      {
        files: [
          { file: 'M:/sample/Readonly.java', source: 'class Readonly {}', target: null, edits: [{ from: 6, to: 14, text: 'Changed' }] },
        ],
      },
      async () => {},
    ),
  ).rejects.toThrow('草稿已变化');
  expect(host.documents[0]!.document.content.value).toBe(before);
});

it('preserves a closed group boundary even when an older independent operation remains', async () => {
  const { host, batch } = await setup();
  const [first, second] = host.documents;
  await batch.apply(
    {
      files: [
        {
          file: first!.path.value,
          source: sources.get(first!.path.value)!,
          target: null,
          edits: [{ from: 0, to: 0, text: '// earlier\n' }],
        },
      ],
    },
    async () => {},
  );
  const change = plan();
  change.files[0]!.source = writeTextContent(first!.document.content.value);
  change.files[0]!.edits = [{ from: 17, to: 18, text: 'Beacon' }];
  await batch.apply(change, async () => {});
  await first!.save();
  await host.close(second!);
  const captured = first!.document.content.value;
  expect(() => first!.undo()).toThrow('关联文件已关闭');
  expect(first!.path.value).toBe('M:/sample/Beacon.java');
  expect(first!.document.content.value).toBe(captured);
});

it.each(['identity', 'version'])('rechecks the captured file %s before accepting a batch', async (kind) => {
  const { host, batch } = await setup();
  const first = host.documents[0]!,
    original = first.document.content.value;
  await expect(
    batch.apply(plan(), async () => {
      const snapshot = first.session.baselineSnapshot.value!;
      first.session.adoptIdentity(
        snapshot.target,
        {
          ...snapshot,
          target: kind === 'identity' ? { ...snapshot.target, path: 'M:/sample/Moved.java' } : snapshot.target,
          baseVersions: kind === 'version' ? [{ path: first.path.value, fingerprint: 'changed-version' }] : snapshot.baseVersions,
        },
        (draft) => draft,
        'identity',
      );
    }),
  ).rejects.toThrow('草稿已变化');
  expect(first.document.content.value).toBe(original);
  expect(host.documents[1]!.dirty.value).toBe(false);
});

it('keeps repeated history restoration in the same pending save association', async () => {
  const { host, batch } = await setup();
  await batch.apply(plan(), async () => {});
  const first = host.documents[0]!;
  for (let cycle = 0; cycle < 6000; cycle++) {
    first.undo();
    first.redo();
  }
  expect(first.group.value!.paths()).toHaveLength(2);
  await Promise.all(host.documents.map((file) => file.save()));
  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.write.mock.calls[0]![0].files).toHaveLength(2);
});

it('confirms associated dirty files when the selected member is clean', async () => {
  const { host, batch } = await setup();
  await batch.apply(plan(), async () => {});
  const first = host.documents[0]!;
  first.session.resetDraft();
  first.pendingPath.value = null;
  expect(first.dirty.value).toBe(false);
  mocks.choose.mockResolvedValueOnce(null);
  await host.close(first);
  expect(host.documents).toHaveLength(2);
  expect(mocks.choose.mock.calls[0]![0].content).toContain('M:/sample/B.java');
});
