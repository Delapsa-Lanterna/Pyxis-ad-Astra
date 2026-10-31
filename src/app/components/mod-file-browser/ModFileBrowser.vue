<template>
  <section class="mod-files-page page-content">
    <header class="mod-files-header page-header">
      <div class="mod-files-header-content page-identity">
        <h1 class="page-title">Mod 文件</h1>
        <p
          class="mod-files-header-description page-path ui-text-truncate ui-text-description ui-text-muted ui-text-reset ui-text-small"
          :title="view.title"
        >
          <code class="page-path-code ui-code">{{ view.title }}</code>
        </p>
      </div>
    </header>
    <div class="mod-files-toolbar ui-layout-row ui-layout-center">
      <n-input
        :value="view.searchText"
        clearable
        placeholder="搜索整个 Mod 的文件名"
        :input-props="{ 'aria-label': '搜索整个 Mod 的文件名' }"
        @update:value="actions.setSearch"
        @keydown.enter.prevent="actions.submitSearch()"
      />
      <div class="mod-files-tools ui-layout-row">
        <n-button :disabled="!view.searchText" @click="actions.clearSearch">清空搜索</n-button
        ><n-button :disabled="!view.expanded.length" @click="actions.collapseAll">全部收起</n-button
        ><n-button :loading="view.refreshing" @click="actions.refresh">刷新</n-button>
      </div>
    </div>
    <p v-if="view.loading" class="mod-files-status ui-text-muted ui-text-small ui-text-reset" role="status">
      {{ view.searching ? '正在搜索…' : '正在读取目录…' }}
    </p>
    <div v-if="view.error" class="mod-files-error ui-control-between ui-text-small">
      <span class="mod-files-error-label ui-layout-shrink ui-text-wrap">{{ view.error }}</span
      ><n-button size="small" @click="actions.refresh">重试</n-button>
    </div>
    <div class="mod-files-table ui-content-fill ui-control-border ui-content-surface">
      <div class="mod-files-table-content ui-layout-row ui-layout-stack">
        <div class="mod-files-columns ui-layout-grid ui-content-surface-muted" role="row">
          <div
            v-for="column in columns"
            :key="column.key"
            role="columnheader"
            :aria-sort="view.sort.key === column.key ? (view.sort.ascending ? 'ascending' : 'descending') : 'none'"
            :class="{ 'mod-files-number': column.key === 'size' }"
          >
            <button
              class="ui-button mod-files-columns-button mod-files-number-button ui-control-button ui-text-soft ui-text-small ui-layout-row ui-layout-center ui-layout-stretch"
              type="button"
              @click="actions.setSort(column.key)"
            >
              {{ column.label }}
              <svg class="mod-files-sort ui-control-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path v-if="view.sort.key === column.key" :d="view.sort.ascending ? 'M8 13V3M4 7l4-4 4 4' : 'M8 3v10M4 9l4 4 4-4'" />
              </svg>
            </button>
          </div>
        </div>
        <div ref="stage" class="mod-files-tree ui-content-contained" tabindex="0" aria-label="Mod 文件树" @scroll.capture="onScroll">
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
            :render-prefix="renderPrefix"
            :render-label="renderLabel"
            :render-suffix="renderSuffix"
            @update:expanded-keys="actions.setExpanded"
            @update:selected-keys="actions.select"
          />
          <p v-else-if="view.ready && !view.loading" class="mod-files-empty ui-text-muted ui-text-small ui-text-reset">
            {{ view.searching ? '未找到匹配项' : '空文件夹' }}
          </p>
        </div>
      </div>
    </div>
    <footer class="mod-files-footer ui-footer ui-text-description ui-text-muted ui-text-small ui-text-reset">
      双击文件夹展开或收起，双击文本文件打开编辑器。
    </footer>
  </section>
</template>
<script setup lang="ts">
import { h, nextTick, onMounted, onScopeDispose, useTemplateRef, watch } from 'vue';
import type { TreeInst, TreeProps } from 'naive-ui/es/tree';
import type { ModFileSortKey } from '@/shared/types';
import { useModFileBrowserViewModel } from '@/app/composables/mod-file-browser/use-mod-file-browser-view-model';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
const { view, actions } = useModFileBrowserViewModel();
const columns: Array<{ key: ModFileSortKey; label: string }> = [
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
const renderPrefix: NonNullable<TreeProps['renderPrefix']> = ({ option }) =>
  option.kind === 'status'
    ? null
    : h('svg', { class: 'mod-files-node-icon ui-control-icon', viewBox: '0 0 16 16', 'aria-hidden': true }, [
        h('path', {
          d:
            option.kind === 'directory'
              ? 'M2 4h4l2 2h6v6H2z'
              : option.kind === 'restricted'
                ? 'M5 7V5a3 3 0 0 1 6 0v2M4 7h8v7H4zM8 10v1.5'
                : 'M9 2H4v12h8V5zM9 2v3h3',
        }),
      ]);
const renderLabel: NonNullable<TreeProps['renderLabel']> = ({ option }) => {
  const status = view.searching ? undefined : view.directories.get(String(option.key));
  return h('span', { class: 'mod-files-name' }, [
    h(
      'span',
      { class: { 'mod-files-name-text': true, 'mod-files-match': option.matched }, title: String(option.label) },
      String(option.label),
    ),
    status?.loading ? h('span', { class: 'mod-files-node-status' }, '读取中…') : null,
    status?.error
      ? h(
          'button',
          {
            type: 'button',
            class: 'mod-files-retry',
            title: status.error,
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              void actions.load(String(option.key));
            },
            onDblclick: (event: MouseEvent) => event.stopPropagation(),
          },
          '读取失败，重试',
        )
      : null,
  ]);
};
const renderSuffix: NonNullable<TreeProps['renderSuffix']> = ({ option }) =>
  h('span', { class: 'mod-files-metadata' }, [
    h('span', { title: String(option.typeText ?? '') }, String(option.typeText ?? '')),
    h('span', { class: 'mod-files-number' }, String(option.sizeText ?? '')),
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
