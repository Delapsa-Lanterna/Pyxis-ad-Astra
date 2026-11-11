<template>
  <section class="code-overview page-content ui-content-scroll" aria-label="代码总览" tabindex="-1">
    <header class="page-header">
      <div class="page-identity">
        <h1 class="page-title">代码总览</h1>
        <p class="page-description">{{ current?.label ?? '正在读取项目' }}</p>
        <p class="page-path ui-text-path ui-text-truncate" :title="current?.modRoot">{{ current?.modRoot }}</p>
      </div>
    </header>
    <dl class="code-overview-statistics ui-layout-grid">
      <div v-for="item in statistics" :key="item.label" class="panel-card ui-content-surface ui-control-border">
        <dt class="ui-text-muted">{{ item.label }}</dt>
        <dd>{{ item.value }}</dd>
      </div>
    </dl>
    <section class="empty-state ui-layout-grid ui-text-normal">
      <h2 class="page-title">{{ files.length ? '继续编辑项目文件' : '选择文件开始编辑' }}</h2>
      <p class="empty-state-description ui-text-muted ui-text-reset">
        {{ files.length ? '点击文件标签继续编辑，草稿和阅读位置已保留。' : '从左侧项目树打开文本或 Java 文件。' }}
      </p>
      <div v-if="!treeShown" class="overview-empty-actions action-group">
        <n-button size="large" @click="emit('show-tree')">展开项目树</n-button>
      </div>
    </section>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { TextFile } from '@/app/composables/text-file-editing/use-text-file';
import type { CodeEditorSources } from '@/shared/types';

const props = defineProps<{ files: TextFile[]; sources: CodeEditorSources | null; status: string; treeShown: boolean }>();
const emit = defineEmits<{ 'show-tree': [] }>();
const current = computed(() => props.sources?.sources.find((source) => !source.readOnly));
const statistics = computed(() => [
  { label: '已打开文件', value: props.files.length },
  { label: '未保存文件', value: props.files.filter((file) => file.dirty.value).length },
  { label: '只读文件', value: props.files.filter((file) => file.readOnly).length },
  { label: '引用来源', value: props.sources?.sources.filter((source) => source.readOnly).length ?? 0 },
  { label: '分析源码根', value: props.sources?.analysisRoots.length ?? 0 },
  { label: 'Java 分析', value: props.status },
]);
</script>
