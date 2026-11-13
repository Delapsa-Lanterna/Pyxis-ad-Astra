import { computed, onScopeDispose, ref, watch } from 'vue';
import { javaProject, previewJavaDeployment } from '@/services/java-project.service';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useSettingsStore } from '@/stores/settings.store';
import { pickFileDialog } from '@/shared/runtime/dialog.runtime';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { AppError } from '@/shared/lib/errors';
import type {
  ChooseOptions,
  JavaProjectAction,
  JavaProjectOperation,
  JavaProjectSettings,
  JavaProjectSnapshot,
  JavaDeploy,
} from '@/shared/types';

export interface JavaProjectHost {
  changed: () => Promise<void>;
  open: (path: string, line?: number) => Promise<unknown>;
  prepare: (operation: Exclude<JavaProjectOperation, { kind: 'detect' }>) => Promise<boolean>;
  deploy: (input: JavaDeploy) => Promise<void>;
}
export function useJavaProject(host: JavaProjectHost) {
  const feedback = useAppFeedback(),
    reads = useQueryReadOwner(),
    snapshot = ref<JavaProjectSnapshot | null>(null),
    busy = ref(false),
    outputShown = ref(false);
  let alive = true,
    cancelled = false,
    polling: ReturnType<typeof setInterval> | undefined,
    reading: Promise<void> | undefined;
  let pending: Promise<void> = Promise.resolve(),
    cancelWaiting = () => {};
  let settingsTail = Promise.resolve(true);
  let runningAction: JavaProjectAction['kind'] | 'deploy' | undefined;
  function save(settings: JavaProjectSettings) {
    settings = cloneQuerySnapshot(settings);
    settingsTail = settingsTail.then(async () => {
      await pending;
      if (stableDeepEqual(snapshot.value?.settings, settings)) return true;
      await run({ kind: 'save', settings });
      return stableDeepEqual(snapshot.value?.settings, settings);
    });
    return settingsTail;
  }
  let interrupted: Promise<null>;
  function accept(value: JavaProjectSnapshot) {
    reads.revoke('consumer', 'snapshot');
    reading = undefined;
    if (alive) snapshot.value = value;
  }
  function read() {
    if (reading) return reading;
    const work = reads
      .consume('snapshot', {}, () => javaProject({ kind: 'read' }), {
        ready(value) {
          if (!snapshot.value || value.revision >= snapshot.value.revision) snapshot.value = value;
        },
      })
      .then(() => {})
      .finally(() => {
        if (reading === work) reading = undefined;
      });
    reading = work;
    return work;
  }
  function choose(options: ChooseOptions) {
    return Promise.race([feedback.choose(options), interrupted]);
  }
  function begin(action: JavaProjectAction['kind'] | 'deploy') {
    runningAction = action;
    busy.value = true;
    cancelled = false;
    interrupted = new Promise((resolve) => {
      cancelWaiting = () => resolve(null);
    });
  }
  function finish() {
    runningAction = undefined;
    clearInterval(polling);
    polling = undefined;
    busy.value = false;
  }
  function show(value: JavaProjectSnapshot) {
    accept(value);
    if (value.error) {
      outputShown.value = true;
      feedback.error(value.error, 'Java 工程任务失败');
    } else if (value.configurationError) {
      feedback.warning({ userMessage: value.configurationError.message, diagnostic: value.configurationError });
    }
  }
  function run(request: Exclude<JavaProjectAction, { kind: 'build' }> | JavaProjectOperation) {
    const action = cloneQuerySnapshot(request);
    if (busy.value) return pending;
    begin(action.kind);
    pending = (async () => {
      try {
        const prepare = action.kind === 'sync' || action.kind === 'build';
        if (prepare && !(await Promise.race([host.prepare(action), interrupted.then(() => false)]))) return;
        if (cancelled) return;
        polling = setInterval(
          () =>
            void read().catch((error) => {
              if (alive) feedback.error(error, '读取工程进度失败');
            }),
          250,
        );
        let prepared = snapshot.value;
        if (prepare) {
          prepared = await javaProject({ kind: 'refresh' });
          if (cancelled) return;
          if (action.kind === 'build' && prepared.stale) {
            prepared = await javaProject({ kind: 'sync', online: action.online });
            if (cancelled) return;
            if (prepared.error) {
              show(prepared);
              return;
            }
          }
          accept(prepared);
        }
        if (action.kind === 'build' && prepared?.mode === 'gradle') {
          const targets = prepared.artifacts.filter((path) =>
            prepared.deployTargets.some((target) => normalizeFsPath(path) === normalizeFsPath(prepared.modRoot + '/' + target)),
          );
          if (
            targets.length &&
            !(await choose({
              title: '构建将更新游戏加载文件',
              content: targets.join('\n'),
              choices: [{ label: '继续构建', value: 'build', type: 'primary' }],
              cancelText: '返回',
            }))
          )
            return;
        }
        if (cancelled) return;
        const result = await javaProject(action.kind === 'build' ? { ...action, configuration: prepared!.configuration } : action);
        if (!alive) return;
        if (action.kind === 'save' || action.kind === 'locate') accept(result);
        else show(result);
        if (!result.configurationError && (action.kind === 'save' || (result.phase === 'succeeded' && prepare))) await host.changed();
      } catch (error) {
        if (alive) feedback.error(error, 'Java 工程操作失败');
      } finally {
        finish();
      }
    })();
    return pending;
  }
  const ready = read().catch((error) => feedback.error(error, '读取 Java 工程失败'));
  watch(
    () => useSettingsStore().javaExecutable,
    () => void read().catch((error) => feedback.error(error, '读取 Java 路径失败')),
  );
  async function cancel() {
    cancelled = true;
    cancelWaiting();
    accept(await javaProject({ kind: 'cancel' }));
  }
  onScopeDispose(() => {
    alive = false;
    reads.revoke();
    clearInterval(polling);
    if (busy.value) void cancel().catch((error) => feedback.error(error, '释放工程任务失败'));
  });
  return {
    snapshot,
    busy,
    outputShown,
    ready,
    read,
    run,
    cancel,
    locations: computed(() => {
      const location = snapshot.value?.error?.location;
      const entries = [
        ...(location?.path ? [{ path: location.path, line: location.line ?? 1 }] : []),
        ...(snapshot.value?.locations ?? []).flatMap((location) =>
          location.path ? [{ path: location.path, line: location.line ?? 1 }] : [],
        ),
      ];
      return entries.filter(
        (entry, index) =>
          pathBelongsToRoot(entry.path, snapshot.value!.modRoot) &&
          entries.findIndex((other) => normalizeFsPath(other.path) === normalizeFsPath(entry.path) && other.line === entry.line) === index,
      );
    }),
    toggleOutput: () => {
      outputShown.value = !outputShown.value;
    },
    save,
    sync: (online = false) => run({ kind: 'sync', online }),
    retry: () => {
      const operation = snapshot.value?.operation;
      return operation && operation.kind !== 'detect' ? run({ ...operation, online: true }) : Promise.resolve();
    },
    build: (tasks: string[] = [], args: string[] = []) => run({ kind: 'build', tasks, arguments: args, online: false }),
    locate: (artifact: string) => run({ kind: 'locate', artifact }),
    deploy(artifact: string, target: string) {
      if (busy.value) return pending;
      begin('deploy');
      pending = (async () => {
        try {
          const preview = await previewJavaDeployment(artifact, target);
          if (cancelled) return;
          const choice = await choose({
            title: '部署 Java 产物？',
            content: `${preview.source.path}\n${preview.source.bytes} 字节\n\n目标：${preview.request.baseVersions[0]!.path}\n${preview.exists ? '覆盖 ' + preview.targetBytes + ' 字节' : '新建文件'}\n替换进入文件历史。`,
            choices: [{ label: '部署', value: 'deploy', type: 'primary' }],
            cancelText: '返回',
          });
          if (choice && !cancelled) {
            await host.deploy(preview.request);
            await host.changed();
            await read();
          }
        } catch (error) {
          if (alive) feedback.error(error, '部署 Java 产物失败');
        } finally {
          finish();
        }
      })();
      return pending;
    },
    detect: () => run({ kind: 'detect' }),
    async pickGradle() {
      const path = await pickFileDialog({ title: '选择 Gradle 可执行文件' });
      if (path && snapshot.value) {
        if (await save({ ...snapshot.value.settings, gradle: path })) await run({ kind: 'detect' });
      }
    },
    open: host.open,
    async settle() {
      if (busy.value && runningAction !== 'save') await cancel();
      await pending;
      if (!(await settingsTail)) throw new AppError('工程设置尚未保存，请先修正设置', { action: 'java-project-settings' });
    },
  };
}
export type JavaProjectModel = ReturnType<typeof useJavaProject>;
