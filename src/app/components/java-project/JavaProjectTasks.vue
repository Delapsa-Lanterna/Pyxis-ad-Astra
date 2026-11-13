<template>
  <section
    v-if="snapshot?.taskId && snapshot.taskMode === snapshot.settings.buildMode"
    class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    aria-label="任务结果"
  >
    <h3 class="panel-section-title">任务结果</h3>
    <FieldRow readonly label="最近任务"
      ><span class="ui-code">{{ snapshot.task }}</span></FieldRow
    >
    <FieldRow readonly label="执行状态"
      ><span role="status">
        {{ snapshot.active ? '正在执行工程任务' : phases[snapshot.phase] }} · {{ snapshot.milliseconds.toFixed(0) }} ms
        <template v-if="snapshot.exitCode !== null"> · 退出码 {{ snapshot.exitCode }}</template>
      </span></FieldRow
    >
    <div class="action-group">
      <n-button size="small" @click="project.toggleOutput">{{ project.outputShown.value ? '收起输出' : '查看输出' }}</n-button>
    </div>
    <FieldHints v-if="snapshot.error" :warning="snapshot.error.message" />
    <div v-if="project.outputShown.value" class="action-group">
      <n-button
        v-for="location in project.locations.value"
        :key="location.path + ':' + location.line"
        size="small"
        @click="project.open(location.path, location.line)"
        ><span class="ui-code">{{ location.path }}:{{ location.line }}</span></n-button
      >
    </div>
    <pre v-if="project.outputShown.value" class="java-project-output ui-code">{{ snapshot.output || '当前没有操作输出' }}</pre>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import type { JavaProjectModel } from '@/app/composables/java-project/use-java-project';
const props = defineProps<{ project: Pick<JavaProjectModel, 'snapshot' | 'outputShown' | 'locations' | 'toggleOutput' | 'open'> }>();
const snapshot = computed(() => props.project.snapshot.value);
const phases = {
  idle: '等待执行',
  running: '正在执行工程任务',
  succeeded: '操作完成',
  cancelled: '已取消',
  failed: '操作失败',
  offlineFailed: '缺少本机缓存',
};
</script>
