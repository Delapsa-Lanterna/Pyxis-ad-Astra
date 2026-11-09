<template>
  <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
    <h3 class="panel-section-title">Java 分析</h3>
    <FieldRow readonly label="分析组件"
      ><span
        >{{ installation }}<template v-if="snapshot"> · JDT {{ snapshot.jdtVersion }} · {{ bytes(snapshot.downloadBytes) }}</template></span
      ></FieldRow
    >
    <FieldRow readonly label="安装位置"><n-input :value="snapshot?.installationPath ?? ''" size="small" readonly /></FieldRow>
    <FieldRow readonly label="暂存文件"
      ><span
        >{{ bytes(snapshot?.stagedBytes ?? 0) }}<template v-if="snapshot?.stagedBytes"> · 已校验文件将在重试时复用</template></span
      ></FieldRow
    >
    <FieldRow label="Java 17 路径"
      ><div class="ui-field-actions ui-layout-stretch action-group">
        <n-input :value="javaPath ?? ''" placeholder="先打开游戏目录或选择 Java 17" size="small" readonly />
        <n-button size="small" :disabled="busy" @click="pickJava">选择文件</n-button>
        <n-button v-if="customPath" size="small" quaternary :disabled="busy" @click="restoreAutomatic">恢复自动</n-button>
      </div>
      <template #hint
        ><FieldHints
          :description="customPath ? '使用指定 Java；变更对下一次启动和自检生效。' : '自动使用当前实际游戏目录中的 Java 17。'" /></template
    ></FieldRow>
    <FieldRow readonly label="运行状态"
      ><span>{{ snapshot?.instances ?? 0 }} 个 JVM · {{ snapshot?.projects ?? 0 }} 个项目</span></FieldRow
    >
    <FieldRow readonly label="当前操作"
      ><span
        >{{ phase }}<template v-if="snapshot?.queued"> · 排队 {{ snapshot.queued }} 项</template
        ><template v-if="snapshot?.progress">
          · {{ snapshot.progress.filesDone }}/{{ snapshot.progress.filesTotal }} 个文件 · {{ bytes(snapshot.progress.completedBytes) }}/{{
            bytes(snapshot.progress.totalBytes)
          }}</template
        ></span
      ></FieldRow
    >
    <FieldRow v-if="snapshot?.active && snapshot.progress" readonly label="进度"
      ><n-progress
        type="line"
        :percentage="Math.min(100, (snapshot.progress.completedBytes / Math.max(1, snapshot.progress.totalBytes)) * 100)"
        :show-indicator="false"
    /></FieldRow>
    <div class="ui-field-actions action-group">
      <n-button size="small" type="primary" :disabled="busy || inUse" @click="download">{{
        snapshot?.installation === 'installed' || snapshot?.installation === 'damaged' ? '检查并修复' : '下载安装'
      }}</n-button>
      <n-button size="small" :disabled="busy || inUse" @click="importArchive">离线导入</n-button>
      <n-button size="small" :disabled="busy || !javaPath || snapshot?.installation !== 'installed'" @click="test">环境自检</n-button>
      <n-button size="small" :disabled="busy" @click="refresh">刷新状态</n-button>
      <n-button
        v-if="snapshot?.active && ['download', 'import', 'probe', 'test'].includes(snapshot.action?.kind ?? '')"
        size="small"
        :disabled="snapshot.phase === 'cancelling'"
        @click="cancel"
        >取消操作</n-button
      >
      <n-button size="small" @click="openDirectory(false)">打开安装目录</n-button>
      <n-button size="small" @click="openDirectory(true)">打开日志目录</n-button>
    </div>
    <div class="ui-field-actions action-group">
      <n-button size="small" type="error" secondary :disabled="busy || !inUse" @click="dangerous('stop')">停止全部分析</n-button>
      <n-button
        size="small"
        type="error"
        secondary
        :disabled="busy || inUse || (snapshot?.installation === 'missing' && !snapshot.stagedBytes)"
        @click="dangerous('remove')"
        >移除组件</n-button
      >
    </div>
    <FieldHints description="下载中断后保留已校验文件。使用中的组件须先停止分析，再进行修复或移除。" :warning="snapshot?.error ?? ''" />
    <FieldHints
      v-if="snapshot?.environment"
      :description="`最近检查：Java ${snapshot.environment.version} · ${snapshot.environment.milliseconds.toFixed(0)} ms · ${snapshot.environment.released ? '进程已释放' : '正在运行'}`"
    />
  </section>
</template>

<script setup lang="ts">
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import { useJavaComponentManagement } from '@/app/composables/java-analysis/use-java-component-management';
const props = defineProps<{ sessionId: string | null; gameRoot: string | null }>();
const {
  snapshot,
  javaPath,
  customPath,
  phase,
  installation,
  busy,
  inUse,
  pickJava,
  restoreAutomatic,
  importArchive,
  cancel,
  openDirectory,
  dangerous,
  refresh,
  download,
  test,
} = useJavaComponentManagement(() => [props.sessionId, props.gameRoot]);
function bytes(value: number) {
  return value < 1024 ? `${value} B` : `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}
</script>
