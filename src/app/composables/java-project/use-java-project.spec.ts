import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { mountSetup } from '@/test/unit/mount-setup';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { useJavaProject } from './use-java-project';
import type { JavaProjectSnapshot, JavaProjectAction } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  run: vi.fn<(action: JavaProjectAction) => Promise<JavaProjectSnapshot>>(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  preview: vi.fn(),
  choose: vi.fn(),
}));
vi.mock('@/services/java-project.service', () => ({ javaProject: mocks.run, previewJavaDeployment: mocks.preview }));
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ error: mocks.error, warning: mocks.warning, info: mocks.info, choose: mocks.choose }),
}));
enableAutoUnmount(afterEach);
const result: JavaProjectSnapshot = {
  revision: 1,
  modRoot: 'M:/sample',
  mode: 'gradle',
  settings: { buildMode: 'gradle', sources: null, libraries: [], primaryJar: null, gradle: null, project: null },
  active: false,
  phase: 'succeeded',
  operation: null,
  taskId: null,
  taskMode: 'gradle',
  task: '',
  exitCode: null,
  error: null,
  version: '1',
  sources: [],
  libraries: [],
  gameJars: [],
  artifacts: [],
  tasks: [],
  choices: [],
  selectedProject: null,
  sourceCount: 0,
  missing: [],
  javaPath: null,
  gradle: null,
  gradleError: null,
  target: '17',
  buildFiles: [],
  stale: false,
  configuration: 'configuration',
  configurationError: null,
  primaryJar: null,
  deployTargets: [],
  output: '',
  locations: [],
  logPath: null,
  milliseconds: 0,
  build: null,
};
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.clearAllMocks();
  mocks.run.mockResolvedValue(result);
});
it('serializes automatic settings saves, skips unchanged values and waits on close', async () => {
  let complete!: (snapshot: JavaProjectSnapshot) => void;
  const mounted = mountSetup(() =>
    useJavaProject({ changed: async () => {}, open: async () => {}, prepare: async () => true, deploy: async () => {} }),
  );
  await mounted.value.ready;
  const first = { ...result.settings, sources: ['first'] },
    second = { ...first, sources: ['first', 'second'] };
  mocks.run.mockImplementationOnce(() => new Promise((resolve) => (complete = resolve)));
  const saving = mounted.value.save(first);
  await flushPromises();
  const next = mounted.value.save(second);
  expect(mocks.run).toHaveBeenCalledTimes(2);
  mocks.run.mockResolvedValue({ ...result, settings: second });
  complete({ ...result, settings: first });
  await Promise.all([saving, next, mounted.value.settle()]);
  expect(mocks.run.mock.calls.map(([action]) => action.kind)).toEqual(['read', 'save', 'save']);
  const calls = mocks.run.mock.calls.length;
  await mounted.value.save(second);
  expect(mocks.run).toHaveBeenCalledTimes(calls);
});
it('prepares a sync, defaults to offline and hands off only the completed result', async () => {
  const changed = vi.fn(async () => {}),
    prepare = vi.fn(async () => true);
  const mounted = mountSetup(() => useJavaProject({ changed: changed, open: async () => {}, prepare: prepare, deploy: async () => {} }));
  await mounted.value.ready;
  await mounted.value.sync();
  expect(prepare).toHaveBeenCalledOnce();
  expect(mocks.run).toHaveBeenLastCalledWith({ kind: 'sync', online: false });
  expect(changed).toHaveBeenCalledOnce();
  mocks.run.mockResolvedValue({
    ...result,
    phase: 'offlineFailed',
    error: { code: 'java_project.offline', message: 'dependency not cached', location: null },
  });
  await mounted.value.sync();
  expect(mounted.value.outputShown.value).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
  mocks.run.mockResolvedValue(result);
  await mounted.value.sync(true);
  expect(mocks.run).toHaveBeenLastCalledWith({ kind: 'sync', online: true });
});
it('retains failed automatic settings for close and accepts their correction', async () => {
  const mounted = mountSetup(() =>
    useJavaProject({ changed: async () => {}, open: async () => {}, prepare: async () => true, deploy: async () => {} }),
  );
  await mounted.value.ready;
  mocks.run.mockRejectedValueOnce(new Error('write failed'));
  expect(await mounted.value.save({ ...result.settings, sources: ['source'] })).toBe(false);
  await expect(mounted.value.settle()).rejects.toThrow('工程设置尚未保存');
  expect(mocks.error).toHaveBeenCalledOnce();
  expect(await mounted.value.save(result.settings)).toBe(true);
  await mounted.value.settle();
});
it('merges repeated input, cancels on settle and preserves a blocked preparation', async () => {
  const changed = vi.fn(async () => {}),
    prepare = vi.fn(async () => false);
  const mounted = mountSetup(() => useJavaProject({ changed: changed, open: async () => {}, prepare: prepare, deploy: async () => {} }));
  await mounted.value.ready;
  await mounted.value.sync();
  expect(mocks.run).toHaveBeenCalledTimes(1);
  prepare.mockResolvedValue(true);
  let finish!: () => void;
  mocks.run.mockImplementation((action) =>
    action.kind === 'sync'
      ? new Promise((resolve) => {
          finish = () => resolve(result);
        })
      : Promise.resolve(result),
  );
  const first = mounted.value.sync(),
    second = mounted.value.sync();
  await flushPromises();
  expect(first).toBe(second);
  const settling = mounted.value.settle();
  await flushPromises();
  expect(mocks.run).toHaveBeenLastCalledWith({ kind: 'cancel' });
  finish();
  await settling;
  expect(mounted.value.busy.value).toBe(false);
});
it('prepares builds and retries the captured task online after an offline failure', async () => {
  const prepare = vi.fn(async () => true),
    changed = vi.fn(async () => {});
  const mounted = mountSetup(() => useJavaProject({ changed: changed, open: async () => {}, prepare: prepare, deploy: async () => {} }));
  await mounted.value.ready;
  mocks.run.mockResolvedValue({
    ...result,
    phase: 'offlineFailed',
    operation: { kind: 'build', tasks: [':library:jar'], arguments: [], online: false },
    error: { code: 'java_project.offline', message: 'No cached version', location: null },
  });
  await mounted.value.build([':library:jar']);
  expect(prepare).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'build' }));
  expect(changed).not.toHaveBeenCalled();
  mocks.run.mockResolvedValue(result);
  await mounted.value.retry();
  expect(mocks.run).toHaveBeenLastCalledWith({
    kind: 'build',
    tasks: [':library:jar'],
    arguments: [],
    online: true,
    configuration: 'configuration',
  });
  expect(changed).toHaveBeenCalledOnce();
});
it('cancellation during save preparation prevents the subsequent build', async () => {
  let finish!: (value: boolean) => void;
  const prepare = () =>
    new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  const mounted = mountSetup(() =>
    useJavaProject({ changed: async () => {}, open: async () => {}, prepare: prepare, deploy: async () => {} }),
  );
  await mounted.value.ready;
  const building = mounted.value.build();
  await mounted.value.cancel();
  finish(true);
  await building;
  expect(mocks.run.mock.calls.map(([action]) => action.kind)).toEqual(['read', 'cancel']);
});
it('waits for confirmed deployment before releasing the window and exposes compiler locations', async () => {
  let finish!: () => void;
  const deploy = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mocks.preview.mockResolvedValue({
    source: { path: 'M:/output.jar', bytes: 20 },
    request: { baseVersions: [{ path: 'M:/sample/jars/main.jar' }] },
    exists: true,
    targetBytes: 10,
  });
  mocks.choose.mockResolvedValue('deploy');
  const mounted = mountSetup(() =>
    useJavaProject({ changed: async () => {}, open: async () => {}, prepare: async () => true, deploy: deploy }),
  );
  await mounted.value.ready;
  const task = mounted.value.deploy('artifact', 'jars/main.jar');
  await flushPromises();
  let settled = false;
  const closing = mounted.value.settle().then(() => {
    settled = true;
  });
  await flushPromises();
  expect(settled).toBe(false);
  finish();
  await Promise.all([task, closing]);
  expect(deploy).toHaveBeenCalledOnce();
  mocks.run.mockResolvedValue({
    ...result,
    locations: [
      { path: 'M:/sample/src/Sample.java', line: 3, column: null },
      { path: 'M:/sample/build.gradle.kts', line: 7, column: null },
    ],
  });
  await mounted.value.read();
  expect(mounted.value.locations.value).toEqual([
    { path: 'M:/sample/src/Sample.java', line: 3 },
    { path: 'M:/sample/build.gradle.kts', line: 7 },
  ]);
});

it('cancels an outstanding output confirmation and releases its waiter', async () => {
  mocks.run.mockResolvedValue({ ...result, artifacts: ['M:/sample/jars/sample.jar'], deployTargets: ['jars/sample.jar'] });
  let decide!: (choice: string | null) => void;
  mocks.choose.mockImplementation(
    () =>
      new Promise((resolve) => {
        decide = resolve;
      }),
  );
  const mounted = mountSetup(() =>
    useJavaProject({ changed: async () => {}, open: async () => {}, prepare: async () => true, deploy: async () => {} }),
  );
  await mounted.value.ready;
  const building = mounted.value.build();
  await flushPromises();
  expect(mocks.choose).toHaveBeenCalledOnce();
  await mounted.value.settle();
  await building;
  decide('build');
  await flushPromises();
  expect(mocks.run.mock.calls.some(([action]) => action.kind === 'build')).toBe(false);
  expect(mounted.value.busy.value).toBe(false);
});
it('shares one pending read and prevents it from overwriting a completed operation', async () => {
  const mounted = mountSetup(() =>
    useJavaProject({ changed: async () => {}, open: async () => {}, prepare: async () => true, deploy: async () => {} }),
  );
  await mounted.value.ready;
  let deliver!: (snapshot: JavaProjectSnapshot) => void;
  mocks.run.mockImplementation((action) =>
    action.kind === 'read'
      ? new Promise((resolve) => {
          deliver = resolve;
        })
      : Promise.resolve({ ...result, revision: 2, output: 'operation output' }),
  );
  const first = mounted.value.read(),
    second = mounted.value.read();
  expect(first).toBe(second);
  await mounted.value.detect();
  deliver({ ...result, output: 'earlier read' });
  await Promise.all([first, second]);
  expect(mounted.value.snapshot.value?.output).toBe('operation output');
  expect(mocks.run.mock.calls.filter(([action]) => action.kind === 'read')).toHaveLength(2);
});
it('restores a failed build action and synchronizes before confirming its new outputs', async () => {
  const restored: JavaProjectSnapshot = {
    ...result,
    phase: 'offlineFailed',
    operation: { kind: 'build', tasks: [':library:jar'], arguments: [], online: false },
    stale: true,
    error: { code: 'java_project.offline', message: 'cache unavailable', location: null },
  };
  const order: string[] = [];
  mocks.run.mockImplementation(async (action) => {
    order.push(action.kind);
    return action.kind === 'read'
      ? restored
      : {
          ...restored,
          phase: 'succeeded',
          stale: action.kind === 'refresh',
          error: null,
          artifacts: ['M:/sample/jars/sample.jar'],
          deployTargets: ['jars/sample.jar'],
          configuration: 'fresh',
        };
  });
  mocks.choose.mockImplementation(async () => {
    order.push('confirm');
    return 'build';
  });
  const mounted = mountSetup(() =>
    useJavaProject({ changed: async () => {}, open: async () => {}, prepare: async () => true, deploy: async () => {} }),
  );
  await mounted.value.ready;
  await mounted.value.retry();
  expect(order).toEqual(['read', 'refresh', 'sync', 'confirm', 'build']);
  expect(mocks.run).toHaveBeenLastCalledWith({
    kind: 'build',
    tasks: [':library:jar'],
    arguments: [],
    online: true,
    configuration: 'fresh',
  });
});
it('keeps project selection diagnostics separate from successful task results', async () => {
  const changed = vi.fn(async () => {});
  mocks.run.mockResolvedValue({
    ...result,
    configurationError: { code: 'java_project.selection', message: 'choose a project', location: null },
  });
  const mounted = mountSetup(() => useJavaProject({ changed, open: async () => {}, prepare: async () => true, deploy: async () => {} }));
  await mounted.value.ready;
  await mounted.value.sync();
  expect(mounted.value.snapshot.value?.phase).toBe('succeeded');
  expect(mounted.value.snapshot.value?.error).toBeNull();
  expect(mocks.warning).toHaveBeenCalledOnce();
  expect(changed).not.toHaveBeenCalled();
});
