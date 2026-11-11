import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { mountSetup } from '@/test/unit/mount-setup';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { projectChangeFixture } from '@/test/unit/project-changes';
import { useCodeEditor } from './use-code-editor';
import { useCodeProject } from './use-code-project';
import type { CodeEditorSources, FileDirectory } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  sources: vi.fn<() => Promise<CodeEditorSources>>(),
  directory: vi.fn<(session: string, path: string | null) => Promise<FileDirectory>>(),
  snapshot: vi.fn<(path: string) => Promise<void>>(async () => {}),
  feedback: vi.fn(),
}));
vi.mock('@/services/code-editor.service', () => ({
  queryCodeEditorSources: mocks.sources,
  subscribeCodeEditor: async () => {},
  finishCodeEditorOpen: async () => {},
}));
vi.mock('@/services/file-browser.service', () => ({
  queryFileDirectory: mocks.directory,
  queryFileTextTarget: async (session: string, path: string) =>
    path.endsWith('.jar')
      ? null
      : {
          sessionId: session,
          modRoot: session === 'sample' ? 'M:/sample' : 'M:/reference',
          path: (session === 'sample' ? 'M:/sample/' : 'M:/reference/') + path,
        },
  queryFileSearch: async () => ({
    query: 'Entry',
    entries: [
      { name: 'src', relPath: 'src', kind: 'directory', sizeBytes: null, modifiedAt: null },
      { name: 'Entry.java', relPath: 'src/Entry.java', kind: 'file', sizeBytes: 4, modifiedAt: null },
    ],
    matchedPaths: ['src/Entry.java'],
  }),
}));
vi.mock('@/services/text-editor.service', () => ({
  loadTextFile: async (_s: string, _r: string, path: string) => ({ path, text: 'sample', entity: null, baseVersions: [] }),
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => await import('@/test/unit/project-changes'));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.feedback }) }));
enableAutoUnmount(afterEach);
const owner = { sessionId: 'sample', modRoot: 'M:/sample' };
const source = { ...owner, label: 'Sample', directory: null, readOnly: false };
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  mocks.sources.mockResolvedValue({
    revision: 1,
    analysisRoots: ['M:/sample/src', 'M:/reference/src'],
    sources: [source, { sessionId: 'reference', modRoot: 'M:/reference', label: 'Library', directory: 'src', readOnly: true }],
  });
  mocks.directory.mockImplementation(async (_session, directory) => ({
    directory,
    entries:
      directory === null
        ? [{ name: 'src', relPath: 'src', kind: 'directory', sizeBytes: null, modifiedAt: null }]
        : [{ name: 'Entry.java', relPath: 'src/Entry.java', kind: 'file', sizeBytes: 4, modifiedAt: null }],
  }));
});
async function setup() {
  const mounted = mountSetup(() => {
    const host = useCodeEditor(owner);
    return { host, project: useCodeProject(host, mocks.snapshot) };
  });
  await mounted.value.host.ready;
  await mounted.value.project.ready;
  return { ...mounted, ...mounted.value };
}
it('loads only the current root and merges repeated expansions while preserving loaded nodes', async () => {
  const { project } = await setup();
  expect(mocks.directory.mock.calls).toEqual([['sample', null]]);
  const branch = project.branches[0]!;
  project.expand(branch, ['src']);
  project.expand(branch, ['src']);
  await flushPromises();
  expect(mocks.directory.mock.calls).toEqual([
    ['sample', null],
    ['sample', 'src'],
  ]);
  const nodes = project.nodes(branch);
  project.expand(branch, []);
  project.expand(branch, ['src']);
  expect(project.nodes(branch)).toBe(nodes);
  expect(mocks.directory).toHaveBeenCalledTimes(2);
});
it('opens owned text through the file queue and references through the snapshot reader', async () => {
  const { project, host } = await setup();
  await project.open(project.branches[0]!, 'src/Entry.java');
  host.active.value!.setText('draft');
  await project.open(project.branches[0]!, 'src/Entry.java');
  expect(host.documents).toHaveLength(1);
  expect(host.active.value!.document.state.value.doc.toString()).toBe('draft');
  await project.open(project.branches[1]!, 'src/Library.java');
  expect(mocks.snapshot).toHaveBeenCalledExactlyOnceWith('M:/reference/src/Library.java');
  await project.open(project.branches[0]!, 'archive.jar');
  expect(host.documents).toHaveLength(1);
});
it('refreshes affected directories, searches files and releases removed references', async () => {
  const { project } = await setup();
  await project.toggle(project.branches[1]!);
  await projectChangeFixture(
    'sample',
    { paths: ['New.java'], entities: [], resources: [], tables: [], queryScopes: [], session: false },
    owner.modRoot,
  );
  expect(mocks.directory.mock.calls.filter(([id, path]) => id === 'sample' && path === null)).toHaveLength(2);
  project.setSearch('Entry');
  await project.search();
  expect(
    project
      .nodes(project.branches[0]!)
      .flatMap((file) => file.children ?? [])
      .some((file) => file.label === 'Entry.java'),
  ).toBe(true);
  mocks.sources.mockResolvedValue({ revision: 2, sources: [source], analysisRoots: ['M:/sample/src'] });
  await project.refresh();
  expect(project.branches).toHaveLength(1);
});
it('retains an actionable directory failure and prevents late reads after disposal', async () => {
  const { project, wrapper } = await setup();
  mocks.directory.mockRejectedValueOnce(new Error('sample read failure'));
  const branch = project.branches[0]!;
  await project.load(branch, 'src');
  expect(branch.directories.get('src')!.error).toBe('sample read failure');
  await project.load(branch, 'src', true);
  expect(branch.directories.get('src')!.error).toBe('');
  let release!: (value: FileDirectory) => void;
  mocks.directory.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const pending = project.load(branch, 'other');
  wrapper.unmount();
  await pending;
  release({ directory: 'other', entries: [] });
  await flushPromises();
  expect(project.branches).toHaveLength(0);
});
