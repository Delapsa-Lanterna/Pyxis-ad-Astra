<template>
  <aside class="code-project-tree" aria-label="项目文件">
    <n-input
      :value="project.searchText.value"
      clearable
      placeholder="搜索文件名"
      :input-props="{ 'aria-label': '搜索项目文件' }"
      @update:value="project.setSearch"
      @keydown.enter.prevent="run(project.search)"
    />
    <n-button size="small" @click="run(project.refresh)">刷新项目</n-button>
    <p v-if="project.problem.value" role="status">{{ project.problem.value }}</p>
    <section v-for="entry in project.branches" :key="entry.source.sessionId">
      <button
        class="code-project-heading ui-button ui-control-button ui-text-reset ui-text-soft ui-text-path"
        :aria-expanded="entry.opened"
        :title="entry.source.modRoot"
        @click="run(() => project.toggle(entry))"
      >
        {{ entry.source.label }}{{ entry.source.readOnly ? ' (引用，只读)' : '' }}
      </button>
      <div v-show="entry.opened" @keydown.enter.prevent="activateSelected(entry)">
        <p v-if="entry.loading" role="status">正在搜索…</p>
        <p v-if="entry.directories.get(entry.source.directory)?.loading" role="status">正在读取目录…</p>
        <p v-if="entry.error" role="status">{{ entry.error }}</p>
        <template v-for="[directory, state] in entry.directories" :key="directory ?? ''">
          <n-button v-if="state.error" size="tiny" @click="run(() => project.load(entry, directory, true))"
            >{{ directory ?? '项目' }}：读取失败，重试</n-button
          >
        </template>
        <n-tree
          :data="project.nodes(entry)"
          block-line
          :expanded-keys="project.expanded(entry)"
          :selected-keys="project.selected(entry)"
          :expand-on-click="true"
          :node-props="
            ({ option }) => ({
              title: String(option.key),
              onDblclick: () => option.kind === 'file' && run(() => project.open(entry, String(option.key))),
            })
          "
          @update:expanded-keys="(keys) => project.expand(entry, keys)"
          @update:selected-keys="(keys) => project.select(entry, keys)"
        />
        <p
          v-if="!entry.loading && !entry.directories.get(entry.source.directory)?.loading && !project.nodes(entry).length"
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
const props = defineProps<{ project: ReturnType<typeof useCodeProject> }>();
const feedback = useAppFeedback();
function run(action: () => Promise<unknown>) {
  void action().catch((error) => feedback.error(error, '读取项目文件失败'));
}
function activateSelected(entry: CodeProjectBranch) {
  const key = props.project.selected(entry)[0];
  const file =
    entry.search?.entries.find((file) => file.relPath === key) ??
    [...entry.directories.values()].flatMap((value) => value.entries ?? []).find((file) => file.relPath === key);
  if (file?.kind === 'file') run(() => props.project.open(entry, file.relPath));
}
</script>
