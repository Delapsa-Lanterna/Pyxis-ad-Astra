<template>
  <section class="file-browser-page page-content">
    <header class="file-browser-header page-header">
      <div class="file-browser-header-content page-identity">
        <h1 class="page-title">文件概览</h1>
        <p
          class="file-browser-header-description page-path ui-text-truncate ui-text-description ui-text-muted ui-text-reset ui-text-small"
          :title="view.title"
        >
          <code class="page-path-code ui-code">{{ view.title }}</code>
        </p>
      </div>
    </header>
    <div class="file-browser-toolbar ui-layout-row ui-layout-center">
      <n-input
        :value="view.searchText"
        clearable
        placeholder="搜索文件名"
        :input-props="{ 'aria-label': '搜索文件名' }"
        @update:value="actions.setSearch"
        @keydown.enter.prevent="actions.submitSearch()"
      />
      <div class="file-browser-tools ui-layout-row">
        <n-button :disabled="!view.searchText" @click="actions.clearSearch">清空搜索</n-button
        ><n-button :disabled="!view.expanded.length" @click="actions.collapseAll">全部收起</n-button
        ><n-button :loading="view.refreshing" @click="actions.refresh">刷新</n-button>
      </div>
    </div>
    <p v-if="view.loading" class="file-browser-status ui-text-muted ui-text-small ui-text-reset" role="status">
      {{ view.searching ? '正在搜索…' : '正在读取目录…' }}
    </p>
    <div v-if="view.error" class="file-browser-error ui-control-between ui-text-small">
      <span class="file-browser-error-label ui-layout-shrink ui-text-wrap">{{ view.error }}</span
      ><n-button size="small" @click="actions.refresh">重试</n-button>
    </div>
    <div class="file-browser-table ui-content-fill ui-control-border ui-content-surface">
      <div class="file-browser-table-content ui-layout-row ui-layout-stack">
        <div class="file-browser-columns ui-layout-grid ui-content-surface-muted" role="row">
          <div
            v-for="column in columns"
            :key="column.key"
            role="columnheader"
            :aria-sort="view.sort.key === column.key ? (view.sort.ascending ? 'ascending' : 'descending') : 'none'"
            :class="{ 'file-browser-number': column.key === 'size' }"
          >
            <button
              class="ui-button file-browser-columns-button file-browser-number-button ui-control-button ui-text-soft ui-text-small ui-layout-row ui-layout-center ui-layout-stretch"
              type="button"
              @click="actions.setSort(column.key)"
            >
              {{ column.label }}
              <svg class="file-browser-sort ui-control-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path v-if="view.sort.key === column.key" :d="view.sort.ascending ? 'M8 13V3M4 7l4-4 4 4' : 'M8 3v10M4 9l4 4 4-4'" />
              </svg>
            </button>
          </div>
        </div>
        <div ref="stage" class="file-browser-tree ui-content-contained" tabindex="0" aria-label="文件树" @scroll.capture="onScroll">
          <n-tree
            v-if="view.ready && view.nodes.length"
            ref="tree"
            :data="view.nodes"
            :expanded-keys="view.expanded"
            :selected-keys="view.selected"
            :expand-on-click="false"
            :keyboard="false"
            block-line
            virtual-scroll
            :node-props="nodeProps"
            :render-prefix="fileTreePrefix"
            :render-label="renderLabel"
            :render-suffix="renderSuffix"
            @update:expanded-keys="actions.setExpanded"
            @update:selected-keys="actions.select"
          />
          <p v-else-if="view.ready && !view.loading" class="file-browser-empty ui-text-muted ui-text-small ui-text-reset">
            {{ view.searching ? '未找到匹配项' : '空文件夹' }}
          </p>
        </div>
      </div>
    </div>
    <footer class="file-browser-footer ui-footer ui-text-description ui-text-muted ui-text-small ui-text-reset">
      双击文件夹展开或收起，双击文本文件打开编辑器。
    </footer>
  </section>
</template>
<script setup lang="ts">
import { h, nextTick, onMounted, onScopeDispose, useTemplateRef, watch } from 'vue';
import type { TreeInst, TreeProps } from 'naive-ui/es/tree';
import type { FileSortKey } from '@/shared/types';
import { useFileBrowserViewModel, type FileBrowserTarget } from '@/app/composables/file-browser/use-file-browser-view-model';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { fileTreePrefix, fileTreeLabel } from './file-tree-renderers';
const props = defineProps<{ target: FileBrowserTarget | null }>();
const { view, actions } = useFileBrowserViewModel(() => props.target);
const columns: Array<{ key: FileSortKey; label: string }> = [
  { key: 'name', label: '文件名' },
  { key: 'type', label: '类型' },
  { key: 'size', label: '大小' },
  { key: 'modified', label: '修改时间' },
];
const stage = useTemplateRef<HTMLElement>('stage'),
  tree = useTemplateRef<TreeInst>('tree');
const nodeProps: NonNullable<TreeProps['nodeProps']> = ({ option }) => ({
  title: String(option.key),
  onDblclick: (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('[data-switcher]')) return;
    void actions.activate(String(option.key));
  },
});
const renderLabel: NonNullable<TreeProps['renderLabel']> = ({ option }) => {
  const status = view.searching ? undefined : view.directories.get(String(option.key));
  return fileTreeLabel(option, status, () => void actions.load(String(option.key)));
};
const renderSuffix: NonNullable<TreeProps['renderSuffix']> = ({ option }) =>
  h('span', { class: 'file-browser-metadata' }, [
    h('span', { title: String(option.typeText ?? '') }, String(option.typeText ?? '')),
    h('span', { class: 'file-browser-number' }, String(option.sizeText ?? '')),
    h('span', {}, String(option.modifiedText ?? '')),
  ]);
let scrollRestore: { top: number } | null = null;
let scrollFrame: number | null = null;
function onScroll(event: Event) {
  if (!scrollRestore && event.target instanceof HTMLElement) actions.setScroll(event.target.scrollTop);
}
async function restoreScroll() {
  const captured = { top: view.scrollTop };
  scrollRestore = captured;
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  await nextTick();
  if (scrollRestore !== captured) return;
  scrollFrame = requestAnimationFrame(() => {
    if (scrollRestore !== captured) return;
    if (view.ready && !view.refreshing) tree.value?.scrollTo({ top: captured.top });
    scrollFrame = requestAnimationFrame(() => {
      scrollRestore = null;
      scrollFrame = null;
    });
  });
}
watch(() => [view.title, view.searching, view.ready], restoreScroll, { flush: 'sync' });
watch(() => [view.nodes, tree.value], restoreScroll, { flush: 'post' });
watch(
  () => view.refreshing,
  (refreshing) => {
    if (!refreshing) void restoreScroll();
  },
);
watch(
  () => view.selected[0],
  (key) => {
    if (key && !view.refreshing && !scrollRestore) tree.value?.scrollTo({ key });
  },
);
onScopeDispose(() => {
  scrollRestore = null;
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
});
useWindowShortcuts({
  keyScope: (event) =>
    event.target instanceof HTMLElement && Boolean(stage.value?.contains(event.target)) && !event.target.closest('button'),
  keys: Object.fromEntries(
    ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].map((key) => [key.toLowerCase(), () => actions.navigate(key)]),
  ),
});
onMounted(restoreScroll);
</script>
