import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { mountSetup } from '@/test/unit/mount-setup';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { useCodeEditor } from './use-code-editor';
import { useCodeBatch } from './use-code-batch';
import { writeTextContent } from '@/shared/runtime/text-document';
import type { JavaAssistance, TextBatchSave, WriteResult } from '@/shared/types';

const owner = { sessionId: 'sample', modRoot: 'M:/sample' };
const sources = new Map([
  ['M:/sample/A.java', 'class A {}\r\n'],
  ['M:/sample/B.java', 'class B {A a;}\r\n'],
]);
const mocks = vi.hoisted(() => ({
  write: vi.fn<(input: TextBatchSave) => Promise<WriteResult>>(),
  choose: vi.fn(async () => 'discard'),
  wait: vi.fn(async () => {}),
}));
vi.mock('@/services/text-editor.service', () => ({
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
    const host = useCodeEditor(owner);
    return { host, batch: useCodeBatch(host, owner) };
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
