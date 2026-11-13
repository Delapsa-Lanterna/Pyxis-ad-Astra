<template>
  <aside ref="tree" class="code-project-tree" aria-label="项目文件" @scroll="recordScroll">
    <div class="code-project-tools ui-layout-grid">
      <n-input
        :value="project.searchText.value"
        clearable
        placeholder="搜索文件名"
        :input-props="{ 'aria-label': '搜索项目文件' }"
        @update:value="project.setSearch"
        @keydown.enter.prevent="run(project.search)"
      />
      <n-button size="small" @click="run(project.refresh)">刷新项目</n-button>
    </div>
    <p v-if="project.problem.value" role="status">{{ project.problem.value }}</p>
    <section v-for="entry in project.branches" :key="entry.source.sessionId + ':' + entry.source.directory">
      <button
        class="code-project-heading ui-button ui-control-row ui-control-button ui-text-reset ui-text-soft ui-text-small"
        :aria-expanded="entry.opened"
        :aria-label="entry.source.label + (entry.source.readOnly ? ' (引用，只读)' : '')"
        :title="entry.source.modRoot"
        @click="run(() => project.toggle(entry))"
      >
        <svg class="code-project-chevron ui-control-icon" :class="{ opened: entry.opened }" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m6 4 4 4-4 4" />
        </svg>
        <span class="ui-text-truncate">{{ entry.source.label }}</span
        ><span v-if="entry.source.readOnly" class="code-readonly">引用，只读</span>
      </button>
      <div v-show="entry.opened" class="file-browser-tree" @keydown.enter.prevent="activateSelected(entry)">
        <p v-if="entry.browser.view.loading" role="status">正在搜索…</p>
        <p v-if="entry.browser.view.directories.get(entry.source.directory)?.loading" role="status">正在读取目录…</p>
        <p v-if="entry.browser.view.error" role="status">{{ entry.browser.view.error }}</p>
        <template v-for="[directory, state] in entry.browser.view.directories" :key="directory ?? ''">
          <n-button v-if="state.error" size="tiny" @click="run(() => entry.browser.actions.load(directory, true))"
            >{{ directory ?? '项目' }}：读取失败，重试</n-button
          >
        </template>
        <n-tree
          :data="entry.browser.view.nodes"
          block-line
          :expanded-keys="entry.browser.view.expanded"
          :selected-keys="entry.browser.view.selected"
          :expand-on-click="true"
          :render-prefix="fileTreePrefix"
          :render-label="
            ({ option }) =>
              fileTreeLabel(option, entry.browser.view.searching ? undefined : entry.browser.view.directories.get(String(option.key)), () =>
                run(() => entry.browser.actions.load(String(option.key))),
              )
          "
          :node-props="
            ({ option }) => ({
              title: String(option.key),
              onDblclick: () => option.kind === 'file' && run(() => entry.browser.actions.activate(String(option.key))),
            })
          "
          @update:expanded-keys="(keys) => entry.browser.actions.setExpanded(keys)"
          @update:selected-keys="(keys) => entry.browser.actions.select(keys)"
        />
        <p
          v-if="
            !entry.browser.view.loading &&
            !entry.browser.view.directories.get(entry.source.directory)?.loading &&
            !entry.browser.view.nodes.length
          "
          class="ui-text-muted"
        >
          {{ project.searchText.value ? '未找到匹配项' : '空文件夹' }}
        </p>
      </div>
    </section>
  </aside>
</template>
<script setup lang="ts">
import type { useCodeProject, CodeProjectBranch } from '@/app/composables/code-editor/use-code-project';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { nextTick, useTemplateRef, watch } from 'vue';
import { fileTreePrefix, fileTreeLabel } from '@/app/components/file-browser/file-tree-renderers';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
const props = defineProps<{ project: ReturnType<typeof useCodeProject> }>();
useContextMenuScope({
  identity: () => JSON.stringify(props.project.sources.value),
  refresh: () => props.project.refresh(),
  canRefresh: () => Boolean(props.project.sources.value),
});
const tree = useTemplateRef<HTMLElement>('tree');
watch(
  () => [Boolean(props.project.searchText.value.trim()), props.project.branches.map((entry) => entry.browser.view.nodes)],
  async () => {
    await nextTick();
    if (tree.value) tree.value.scrollTop = props.project.scrollTop.value;
  },
);
function recordScroll(event: Event) {
  props.project.setScroll((event.currentTarget as HTMLElement).scrollTop);
}
const feedback = useAppFeedback();
function run(action: () => Promise<unknown>) {
  void action().catch((error) => feedback.error(error, '读取项目文件失败'));
}
function activateSelected(entry: CodeProjectBranch) {
  const key = entry.browser.view.selected[0];
  if (key) run(() => entry.browser.actions.activate(key));
}
</script>
