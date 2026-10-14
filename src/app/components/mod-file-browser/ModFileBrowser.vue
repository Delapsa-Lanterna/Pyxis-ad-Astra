<template>
  <main class="mod-files-page">
    <header class="mod-files-header">
      <div>
        <h1>Mod 文件</h1>
        <p :title="view.title">{{ view.title }}</p>
      </div>
    </header>
    <div class="mod-files-toolbar">
      <n-input
        :value="view.searchText"
        clearable
        placeholder="搜索整个 Mod 的文件名"
        :input-props="{ 'aria-label': '搜索整个 Mod 的文件名' }"
        @update:value="actions.setSearch"
        @keydown.enter.prevent="actions.submitSearch"
      />
      <div class="mod-files-tools">
        <n-button :disabled="!view.searchText" @click="actions.clearSearch">清空搜索</n-button
        ><n-button :disabled="!view.expanded.length" @click="actions.collapseAll">全部收起</n-button
        ><n-button :loading="view.refreshing" @click="actions.refresh">刷新</n-button>
      </div>
    </div>
    <p v-if="view.loading" class="mod-files-status" role="status">{{ view.searching ? '正在搜索…' : '正在读取目录…' }}</p>
    <div v-if="view.error" class="mod-files-error">
      <span>{{ view.error }}</span
      ><n-button size="small" @click="actions.refresh">重试</n-button>
    </div>
    <div class="mod-files-table">
      <div class="mod-files-table-content">
        <div class="mod-files-columns" role="row">
          <div
            v-for="column in columns"
            :key="column.key"
            role="columnheader"
            :aria-sort="view.sort.key === column.key ? (view.sort.ascending ? 'ascending' : 'descending') : 'none'"
            :class="{ 'mod-files-number': column.key === 'size' }"
          >
            <button type="button" @click="actions.setSort(column.key)">
              {{ column.label
              }}<span class="mod-files-sort" aria-hidden="true">{{
                view.sort.key === column.key ? (view.sort.ascending ? '↑' : '↓') : ''
              }}</span>
            </button>
          </div>
        </div>
        <div ref="stage" class="mod-files-tree" tabindex="0" aria-label="Mod 文件树" @scroll.capture="onScroll">
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
          <p v-else-if="view.ready && !view.loading" class="mod-files-empty">{{ view.searching ? '未找到匹配项' : '空文件夹' }}</p>
        </div>
      </div>
    </div>
    <footer class="mod-files-footer">双击文件夹展开或收起，双击文本文件打开编辑器。</footer>
  </main>
</template>
<script setup lang="ts">
import { h, nextTick, onMounted, useTemplateRef, watch } from 'vue';
import type { TreeInst, TreeProps } from 'naive-ui/es/tree';
import type { ModFileSortKey } from '@/shared/types';
import { useModFileBrowserViewModel } from '@/app/composables/mod-file-browser/use-mod-file-browser-view-model';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
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
  onDblclick: () => void actions.activate(String(option.key)),
});
const renderPrefix: NonNullable<TreeProps['renderPrefix']> = ({ option }) =>
  option.kind === 'status'
    ? null
    : h('span', { 'aria-hidden': true }, option.kind === 'directory' ? '📁' : option.kind === 'restricted' ? '🔒' : '📄');
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
function onScroll(event: Event) {
  if (!view.refreshing && event.target instanceof HTMLElement) actions.setScroll(event.target.scrollTop);
}
async function restoreScroll() {
  await nextTick();
  if (view.ready && !view.refreshing) tree.value?.scrollTo({ top: view.scrollTop });
}
watch(() => [view.title, view.searching, view.ready, view.refreshing], restoreScroll);
watch(
  () => view.selected[0],
  (key) => {
    if (key && !view.refreshing) tree.value?.scrollTo({ key });
  },
);
useShortcutDispatch({
  keyScope: (event) =>
    event.target instanceof HTMLElement && Boolean(stage.value?.contains(event.target)) && !event.target.closest('button'),
  keys: Object.fromEntries(
    ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].map((key) => [key.toLowerCase(), () => actions.navigate(key)]),
  ),
});
onMounted(restoreScroll);
</script>
<style scoped>
.mod-files-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: var(--space-7) var(--space-9);
  background: var(--color-panel-muted);
}
.mod-files-header > div {
  min-width: 0;
}
.mod-files-header h1 {
  margin: 0 0 var(--space-1);
  font-size: 22px;
  font-weight: 650;
  color: var(--color-text);
}
.mod-files-header p {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--color-muted);
}
.mod-files-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.mod-files-toolbar > .n-input {
  flex: 1 1 240px;
  min-width: min(100%, 240px);
  max-width: 560px;
}
.mod-files-tools {
  display: flex;
  flex-shrink: 0;
  gap: var(--space-2);
  margin-left: auto;
}
.mod-files-table {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-panel);
  scrollbar-gutter: stable;
}
.mod-files-table-content {
  display: flex;
  flex-direction: column;
  min-width: 740px;
  height: 100%;
}
.mod-files-columns {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 128px 112px 192px;
  flex-shrink: 0;
  padding: 0 var(--space-2);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-panel-muted);
}
.mod-files-columns button {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: 0;
  background: transparent;
  color: var(--color-text-soft);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.mod-files-columns button:hover {
  background: var(--color-surface-hover);
  color: var(--color-text);
}
.mod-files-columns button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
.mod-files-columns > .mod-files-number button {
  justify-content: flex-end;
}
.mod-files-sort {
  width: 12px;
  color: var(--color-primary);
}
.mod-files-tree {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.mod-files-tree:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}
.mod-files-tree :deep(.n-tree) {
  height: 100%;
  padding: var(--space-2);
  font-size: 12px;
}
.mod-files-tree :deep(.n-tree-node-content) {
  flex: 1;
  min-width: 0;
  padding-right: 0;
}
.mod-files-tree :deep(.n-tree-node-content__text) {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.mod-files-tree :deep(.n-tree-node-content__suffix) {
  flex-shrink: 0;
  margin-left: 0;
}
.mod-files-tree :deep(.mod-files-metadata) {
  display: grid;
  grid-template-columns: 128px 112px 192px;
  width: 432px;
  color: var(--color-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.mod-files-tree :deep(.mod-files-metadata > span) {
  padding: 0 var(--space-2);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.mod-files-tree :deep(.mod-files-number) {
  text-align: right;
}
.mod-files-tree :deep(.mod-files-name) {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.mod-files-tree :deep(.mod-files-name-text) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mod-files-tree :deep(.mod-files-match) {
  color: var(--color-primary);
}
.mod-files-tree :deep(.mod-files-node-status) {
  color: var(--color-muted);
  white-space: nowrap;
}
.mod-files-status,
.mod-files-footer {
  margin: 0;
  color: var(--color-muted);
  font-size: 12px;
}
.mod-files-empty {
  margin: 0;
  padding: var(--space-4);
  color: var(--color-muted);
  font-size: 12px;
}
.mod-files-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  color: var(--color-danger);
  font-size: 12px;
}
.mod-files-error span {
  overflow-wrap: anywhere;
  min-width: 0;
}
.mod-files-tree :deep(.mod-files-retry) {
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-danger);
  font: inherit;
  cursor: pointer;
}
.mod-files-tree :deep(.mod-files-retry:focus-visible) {
  outline: 2px solid var(--color-primary);
}
@media (max-width: 640px) {
  .mod-files-page {
    padding: var(--space-4);
  }
}
</style>
