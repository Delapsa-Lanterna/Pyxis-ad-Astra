<template>
  <section v-if="panel" class="code-analysis-results ui-layout-row ui-layout-stack ui-layout-contained" aria-label="Java 分析结果">
    <header class="code-results-header action-group ui-control-between">
      <div class="action-group" role="tablist" aria-label="分析结果分类">
        <n-button
          v-for="tab in tabs"
          :key="tab.key"
          size="small"
          role="tab"
          :aria-selected="selected === tab.key"
          :type="selected === tab.key ? 'primary' : 'default'"
          @click="selected = tab.key"
          >{{ tab.label }}</n-button
        >
      </div>
      <n-button size="small" quaternary circle aria-label="关闭结果面板" @click="emit('close')">
        <svg class="code-results-close ui-control-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
      </n-button>
    </header>
    <section v-if="selected !== 'changes'" class="code-results-content ui-content-fill ui-content-scroll" aria-label="诊断与引用">
      <p v-if="selected === 'references' && analysis.detail.value" class="code-signature">{{ analysis.detail.value }}</p>
      <p v-if="!groupedResults.size" class="ui-text-muted">{{ selected === 'diagnostics' ? '当前项目没有诊断' : '没有引用位置' }}</p>
      <template v-for="[file, entries] in groupedResults" :key="file">
        <h3 class="code-result-file ui-text-path ui-text-truncate" :title="file">{{ pathBasename(file) }}</h3>
        <p class="ui-text-path ui-text-muted ui-text-truncate" :title="file">{{ file }}</p>
        <button
          v-for="entry in entries"
          :key="entry.range.start + entry.label"
          class="code-result-entry ui-button ui-control-row ui-control-button"
          @click="run(() => analysis.locate(entry))"
        >
          {{ entry.label }}
        </button>
      </template>
    </section>
    <section v-else class="code-results-content ui-content-fill ui-content-scroll" aria-label="修改预览">
      <p v-if="!actions.plan.value" class="ui-text-muted">生成导入或重命名预览后在此查看</p>
      <template v-else>
        <p
          v-if="!actions.plan.value.files.length && !actions.plan.value.choices.length && !actions.conflicts.value.length"
          class="ui-text-muted"
        >
          没有需要修改的内容
        </p>
        <p v-for="conflict in actions.conflicts.value" :key="conflict">{{ conflict }}</p>
        <label v-for="choice in actions.plan.value.choices" :key="choice.name"
          >{{ choice.name
          }}<n-select
            :value="actions.choices.value[choice.name]"
            @update:value="(value: string) => actions.chooseImport(choice.name, value)"
            :options="choice.candidates.map((value) => ({ label: value, value }))"
        /></label>
        <n-button v-if="actions.plan.value.choices.length" @click="run(() => actions.prepare('imports'))">接纳导入选择</n-button>
        <div v-for="file in actions.plan.value.files" :key="file.file">
          <h3 class="code-result-file ui-text-path ui-text-truncate" :title="file.file">{{ pathBasename(file.file) }}</h3>
          <p class="ui-text-path ui-text-wrap">{{ file.file }}</p>
          <p v-if="file.target" class="ui-text-path ui-text-wrap">目标路径：{{ file.target }}</p>
          <div v-for="edit in file.edits" :key="edit.from" class="code-edit-preview">
            <p>字符 {{ edit.from }}–{{ edit.to }}</p>
            <div>
              <span>原文</span>
              <pre>{{ file.source.slice(edit.from, edit.to) }}</pre>
            </div>
            <div>
              <span>修改后</span>
              <pre>{{ edit.text }}</pre>
            </div>
          </div>
        </div>
      </template>
    </section>
    <footer v-if="selected === 'changes' && actions.plan.value" class="code-results-actions action-group">
      <n-button
        :disabled="!actions.plan.value.files.length || !!actions.plan.value.conflicts.length || !!actions.plan.value.choices.length"
        @click="run(actions.apply)"
        >接纳整批修改</n-button
      >
      <n-button @click="actions.cancel">取消</n-button>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { pathBasename } from '@/shared/lib/paths';
import type { useJavaEditor } from '@/app/composables/java-analysis/use-java-editor';
import type { useJavaActions } from '@/app/composables/java-analysis/use-java-actions';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
const { analysis, actions } = defineProps<{
  panel: boolean;
  analysis: ReturnType<typeof useJavaEditor>;
  actions: ReturnType<typeof useJavaActions>;
}>();
const emit = defineEmits<{ close: []; open: [] }>();
const selected = ref<'diagnostics' | 'references' | 'changes'>('diagnostics');
useContextMenuScope({
  identity: () => selected.value + ':' + (analysis.current.value?.file ?? ''),
  canRefresh: () => selected.value === 'diagnostics',
  refresh: analysis.refresh,
});
const tabs = computed(() => [
  { key: 'diagnostics' as const, label: `诊断 (${analysis.diagnostics.value.length})` },
  { key: 'references' as const, label: `引用 (${analysis.locations.value.length})` },
  { key: 'changes' as const, label: `修改预览 (${actions.plan.value?.files.length ?? 0})` },
]);
function reveal(tab: 'references' | 'changes') {
  selected.value = tab;
  emit('open');
}
watch([analysis.locations, analysis.detail], ([locations, detail]) => {
  if (locations.length || detail) reveal('references');
});
watch(actions.plan, (plan) => {
  if (plan) reveal('changes');
});
const feedback = useAppFeedback();
function run(action: () => Promise<unknown>) {
  void action().catch((error) => feedback.error(error, 'Java 操作失败'));
}
const groupedResults = computed(() => {
  const entries =
    selected.value === 'diagnostics'
      ? analysis.diagnostics.value.map((entry) => ({
          file: entry.file,
          version: entry.version,
          range: { start: entry.start, end: entry.end },
          label: `${entry.severity === 'error' ? '错误' : entry.severity === 'warning' ? '警告' : '提示'} · 行 ${entry.line} · ${entry.message}`,
        }))
      : analysis.locations.value.map((entry) => ({ ...entry, label: `字符 ${entry.range.start}–${entry.range.end}` }));
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = groups.get(entry.file) ?? [];
    group.push(entry);
    groups.set(entry.file, group);
  }
  return groups;
});
</script>
