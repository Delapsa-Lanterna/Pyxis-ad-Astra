import { computed, onScopeDispose, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { pickDirectoryDialog, pickFileDialog } from '@/shared/runtime/dialog.runtime';
import { AppError } from '@/shared/lib/errors';
import {
  subscribeJavaAnalysis,
  unsubscribeJavaAnalysis,
  manageJavaAnalysis,
  cancelJavaAnalysis,
  javaAnalysisContext,
  openJavaAnalysisDirectory,
} from '@/services/java-analysis.service';
import type { JavaManagementAction, JavaManagementSnapshot } from '@/shared/types';

const PHASES: Record<string, string> = {
  idle: '尚未执行操作',
  checking: '正在校验',
  testing: '正在自检',
  stopping: '正在停止分析',
  removing: '正在移除',
  downloading: '正在下载',
  cancelling: '正在取消',
  succeeded: '操作完成',
  failed: '操作失败',
  cancelled: '已取消',
};
const INSTALLATIONS = { unchecked: '尚未检查', missing: '尚未安装', installed: '已安装', damaged: '需要修复' };

export function useJavaComponentManagement(context: () => readonly [string | null, string | null]) {
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  const snapshot = ref<JavaManagementSnapshot | null>(null);
  const automaticPath = ref<string | null>(null);
  const javaPath = computed(() => settings.javaExecutable ?? automaticPath.value);
  let active = true;
  let subscription: string | undefined;
  const submitting = ref(false);
  function finish(value: JavaManagementSnapshot) {
    if (value.phase === 'failed') {
      feedback.error(
        new AppError(value.error ?? 'Java component operation failed', { code: 'java_analysis.operation_failed' }),
        'Java 分析操作失败',
      );
      return;
    }
    if (value.phase === 'cancelled') {
      feedback.info('已取消，完成的文件已保留');
      return;
    }
    if (value.action?.kind === 'probe' && value.environment) {
      settings.setJavaExecutable(value.environment.path);
      feedback.success('已设置 Java 路径');
    } else if (value.action?.kind !== 'refresh')
      feedback.success(value.action?.kind === 'test' ? 'Java 分析环境自检通过' : 'Java 分析组件操作完成');
  }
  function accept(value: JavaManagementSnapshot) {
    if (!active) return;
    if (!snapshot.value || value.revision >= snapshot.value.revision) snapshot.value = value;
  }
  async function run(action: JavaManagementAction) {
    if (submitting.value) return;
    const operationKey = crypto.randomUUID();
    submitting.value = true;
    try {
      const receipt = await manageJavaAnalysis(action, operationKey);
      if (!active) return;
      accept(receipt);
      finish(receipt);
    } catch (error) {
      if (active) feedback.error(error, 'Java 分析操作失败');
    } finally {
      submitting.value = false;
    }
  }
  const ready = subscribeJavaAnalysis(accept)
    .then(async (id) => {
      if (!active) {
        await unsubscribeJavaAnalysis(id);
        return;
      }
      subscription = id;
      if (snapshot.value?.installation === 'unchecked' && !snapshot.value.active) await run({ kind: 'refresh' });
    })
    .catch((error) => {
      if (active) feedback.error(error, '读取 Java 分析状态失败');
    });
  onScopeDispose(() => {
    active = false;
    if (subscription !== undefined)
      void unsubscribeJavaAnalysis(subscription).catch((error) => feedback.error(error, '解除 Java 状态订阅失败'));
  });
  watch(
    context,
    ([sessionId, gameRoot]) => {
      void reads.consume('java-context', { sessionId, gameRoot }, () => javaAnalysisContext(sessionId, gameRoot ?? null), {
        ready: (value) => {
          automaticPath.value = value;
        },
        error: (error) => feedback.error(error, '读取游戏 Java 路径失败'),
      });
    },
    { immediate: true },
  );
  async function pickInstallationDirectory() {
    try {
      const directory = await pickDirectoryDialog('选择 Java 分析组件安装目录');
      if (directory) await run({ kind: 'directory', directory });
    } catch (error) {
      feedback.error(error, '选择 Java 分析组件安装目录失败');
    }
  }
  async function pickJava() {
    try {
      const path = await pickFileDialog({ title: '选择 JRE 或 JDK 的 Java 可执行文件 (至少 17)' });
      if (path) await run({ kind: 'probe', javaPath: path });
    } catch (error) {
      feedback.error(error, '选择 Java 路径失败');
    }
  }
  async function cancel() {
    try {
      const operationKey = snapshot.value?.operationKey;
      if (operationKey) accept(await cancelJavaAnalysis(operationKey));
    } catch (error) {
      feedback.error(error, '取消 Java 操作失败');
    }
  }
  async function openDirectory(logs: boolean) {
    try {
      await openJavaAnalysisDirectory(logs);
    } catch (error) {
      feedback.error(error, '打开 Java 目录失败');
    }
  }
  function dangerous(kind: 'stop' | 'remove') {
    feedback.confirmDanger({
      title: kind === 'stop' ? '停止全部 Java 分析？' : '移除 Java 分析组件？',
      content:
        kind === 'stop'
          ? `当前 ${snapshot.value?.projects ?? 0} 个分析项目将停止，内存分析状态将释放。`
          : '移除下载依赖与暂存文件，保留 Java 路径设置和诊断日志。',
      actionText: kind === 'stop' ? '停止全部分析' : '移除组件',
      cancelText: '取消',
      onConfirm: () => run({ kind }),
    });
  }
  return {
    ready,
    snapshot,
    javaPath,
    customPath: computed(() => settings.javaExecutable),
    phase: computed(() => (snapshot.value ? (PHASES[snapshot.value.phase] ?? snapshot.value.phase) : '读取中')),
    installation: computed(() => (snapshot.value ? INSTALLATIONS[snapshot.value.installation] : '读取中')),
    busy: computed(() => submitting.value || !snapshot.value || snapshot.value.active || snapshot.value.queued > 0),
    inUse: computed(() => (snapshot.value?.instances ?? 0) > 0),
    pickInstallationDirectory,
    pickJava,
    restoreAutomatic: () => settings.setJavaExecutable(null),
    cancel,
    openDirectory,
    dangerous,
    refresh: () => run({ kind: 'refresh' }),
    download: () => run({ kind: 'download' }),
    test: () => {
      if (javaPath.value) return run({ kind: 'test', javaPath: javaPath.value });
      return undefined;
    },
  };
}
