<template>
  <section class="code-overview page-content ui-content-scroll" aria-label="代码总览" tabindex="-1">
    <header class="page-header">
      <div class="page-identity">
        <h1 class="page-title">代码总览</h1>
        <p class="page-description">{{ current?.label ?? '正在读取项目' }} {{ engineering?.snapshot.value?.version }}</p>
        <p class="page-path ui-text-path ui-text-truncate" :title="current?.modRoot">{{ current?.modRoot }}</p>
      </div>
    </header>
    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">项目概览</h3>
      <dl class="code-overview-statistics ui-layout-grid">
        <div v-for="item in statistics" :key="item.label">
          <dt class="ui-text-muted ui-text-small">{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </dl>
    </section>
    <JavaProjectPanel v-if="engineering" :project="engineering" />
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { TextFile } from '@/app/composables/text-file-editing/use-text-file';
import type { CodeEditorSources } from '@/shared/types';
import type { JavaInspection } from '@/shared/types';
import type { useJavaProject } from '@/app/composables/java-project/use-java-project';
import JavaProjectPanel from '@/app/components/java-project/JavaProjectPanel.vue';

const props = defineProps<{
  files: TextFile[];
  sources: CodeEditorSources | null;
  status: string;
  engineering?: ReturnType<typeof useJavaProject>;
  diagnostics: JavaInspection['diagnostics'];
}>();
const current = computed(() => props.sources?.sources.find((source) => !source.readOnly));
const statistics = computed(() => [
  { label: '已打开文件', value: props.files.length },
  { label: '未保存文件', value: props.files.filter((file) => file.dirty.value).length },
  { label: '只读文件', value: props.files.filter((file) => file.readOnly).length },
  { label: '引用来源', value: props.sources?.sources.filter((source) => source.readOnly).length ?? 0 },
  { label: '分析源码根', value: props.sources?.analysisRoots.length ?? 0 },
  { label: 'Java 分析', value: props.status },
  { label: 'Java 源码文件', value: props.engineering?.snapshot.value?.sourceCount ?? 0 },
  { label: '错误 (已分析打开文件)', value: props.diagnostics.filter((entry) => entry.severity === 'error').length },
  { label: '警告 (已分析打开文件)', value: props.diagnostics.filter((entry) => entry.severity === 'warning').length },
]);
</script>
