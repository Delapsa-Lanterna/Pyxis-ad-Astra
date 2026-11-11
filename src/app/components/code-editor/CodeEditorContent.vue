<template>
  <main class="code-editor ui-content-contained ui-layout-grid ui-text-normal" :inert="Boolean(closing)">
    <nav class="code-editor-tabs ui-content-surface-muted" aria-label="已打开文件">
      <div class="mod-tabs-list ui-layout-row" role="tablist">
        <div
          v-for="document in documents"
          :key="document.path.value"
          class="mod-tab ui-layout-row ui-layout-center"
          :class="{ active: active === document }"
          :title="document.path.value"
          @dragover.prevent="dragOver($event)"
          @drop.prevent="drop(document)"
        >
          <button
            class="mod-tab-activate ui-button ui-control-row ui-control-button ui-control-pointer ui-layout-row ui-layout-center"
            role="tab"
            :aria-selected="active === document"
            draggable="true"
            @dragstart="dragged = document"
            @dragend="dragged = null"
            @click="activate(document)"
          >
            <span class="mod-tab-name ui-text-truncate">{{ label(document) }}{{ document.readOnly ? '（引用，只读）' : '' }}</span
            ><span v-if="document.dirty.value" class="mod-tab-dirty" title="未保存" />
          </button>
          <button
            class="mod-tab-close ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-control-pointer"
            :aria-label="`关闭 ${label(document)}`"
            @click="run(() => close(document))"
          >
            <svg class="mod-tab-close-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
          </button>
        </div>
      </div>
    </nav>
    <div class="code-editor-tools ui-control-row">
      <span class="ui-text-path ui-text-truncate" :title="active?.path.value">{{ active?.path.value ?? '请选择要打开的文件' }}</span>
      <div class="action-group ui-layout-row">
        <n-button size="small" :disabled="!active" @click="surface?.search()">查找与替换</n-button>
        <n-button size="small" :disabled="!active" @click="run(() => analysis.navigate('declaration'))">跳转声明</n-button>
        <n-button size="small" :disabled="!active" @click="run(() => analysis.navigate('references'))">查找引用</n-button>
        <n-button size="small" @click="panel = !panel">诊断与引用</n-button>
        <n-button size="small" :disabled="!active || active.readOnly" @click="run(() => actions.parameters())">参数提示</n-button>
        <n-button size="small" :disabled="!active || active.readOnly" @click="run(() => actions.prepare('imports'))">整理导入</n-button>
        <n-input v-model:value="actions.name.value" size="small" placeholder="新名称" :input-props="{ 'aria-label': '重命名的新名称' }" />
        <n-button size="small" :disabled="!active || active.readOnly || !actions.name.value" @click="run(() => actions.prepare('rename'))"
          >预览重命名</n-button
        >
        <n-button size="small" :disabled="!active?.dirty.value" @click="run(() => save())">保存</n-button
        ><n-button size="small" :disabled="!dirty" @click="run(saveAll)">保存全部</n-button>
      </div>
    </div>
    <div v-if="active && (active.session.hasPendingExternalValue.value || active.problem.value)">
      <div v-if="active.session.hasPendingExternalValue.value" class="ui-notice" role="status">
        外部文本已更新，当前草稿已保留。<n-button size="small" @click="loadExternal(active)">载入外部文本</n-button>
      </div>
      <div v-if="active.problem.value" class="ui-notice" role="status">{{ active.problem.value.message }}</div>
    </div>
    <section v-if="active" class="code-analysis-body">
      <aside aria-label="类与方法大纲" class="code-outline">
        <n-button
          v-for="entry in analysis.current.value?.outline"
          :key="entry.range.start"
          text
          @click="run(() => analysis.locate({ file: active!.path.value, version: analysis.current.value!.version, range: entry.range }))"
          >{{ entry.name }}</n-button
        >
      </aside>
      <TextEditorSurface
        ref="surface"
        :document="active.document"
        :disabled="active.readOnly"
        :extensions="extensions"
        line-numbers
        @position="position = $event"
      />
      <section v-if="panel" class="code-analysis-results" aria-label="诊断与引用">
        <p v-if="analysis.detail.value" class="ui-text-path">{{ analysis.detail.value }}</p>
        <template v-for="[file, entries] in groupedResults" :key="file">
          <h3 class="ui-text-path">{{ file }}</h3>
          <n-button v-for="entry in entries" :key="entry.range.start + entry.label" text @click="run(() => analysis.locate(entry))">{{
            entry.label
          }}</n-button>
        </template>
      </section>
      <section v-if="actions.plan.value" class="code-analysis-results" aria-label="修改预览">
        <p v-for="conflict in actions.conflicts.value" :key="conflict">{{ conflict }}</p>
        <label v-for="choice in actions.plan.value.choices" :key="choice.name"
          >{{ choice.name
          }}<n-select
            v-model:value="actions.choices.value[choice.name]"
            :options="choice.candidates.map((value) => ({ label: value, value }))"
        /></label>
        <n-button v-if="actions.plan.value.choices.length" @click="run(() => actions.prepare('imports'))">接纳导入选择</n-button>
        <div v-for="file in actions.plan.value.files" :key="file.file">
          <p class="ui-text-path">{{ file.file }}{{ file.target ? ' → ' + file.target : '' }}</p>
          <pre v-for="edit in file.edits" :key="edit.from"
            >{{ edit.from }}–{{ edit.to }}：{{ file.source.slice(edit.from, edit.to) }} → {{ edit.text }}</pre>
        </div>
        <n-button
          :disabled="!actions.plan.value.files.length || !!actions.plan.value.conflicts.length || !!actions.plan.value.choices.length"
          @click="run(actions.apply)"
          >接纳整批修改</n-button
        >
        <n-button @click="actions.plan.value = null">取消</n-button>
      </section>
    </section>
    <section v-else class="empty-state ui-content-grid">
      <h1 class="page-title">代码编辑器</h1>
      <p class="ui-text-muted">文件将在独立标签中打开。</p>
    </section>
    <footer class="code-editor-status ui-text-muted ui-text-small">
      <span role="status"
        >{{ analysis.status.value
        }}{{ analysis.problem.value ? '：' + analysis.problem.value + '。请在设置的 Java 分析卡片检查组件和 Java 17。' : '' }}</span
      >
      <n-button v-if="analysis.problem.value" size="tiny" @click="run(analysis.start)">重试分析</n-button>
      {{ documents.length }} 个文件<template v-if="active">
        · {{ active.session.saving.value ? '保存中' : active.dirty.value ? '未保存' : '已保存' }} · 行 {{ position.line }}，列
        {{ position.column }}</template
      >
    </footer>
  </main>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useCodeEditorWindow } from '@/app/composables/code-editor/use-code-editor-window';
import type { CodeDocument } from '@/app/composables/code-editor/use-code-document';
import TextEditorSurface from '@/shared/ui/TextEditorSurface.vue';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { closeCurrentWindow } from '@/windows/current.window';

const host = useCodeEditorWindow();
const { documents, active, location, dirty, label, close, save, saveAll, loadExternal, closing, analysis, actions } = host;
const panel = ref(false);
const extensions = computed(() => [analysis.extensions.value, actions.extensions.value]);
watch([analysis.locations, analysis.detail], ([locations, detail]) => {
  if (locations.length || detail) panel.value = true;
});
const groupedResults = computed(() => {
  const entries = [
    ...analysis.diagnostics.value.map((entry) => ({
      file: entry.file,
      version: entry.version,
      range: { start: entry.start, end: entry.end },
      label: `${entry.severity} · ${entry.line} · ${entry.message}`,
    })),
    ...analysis.locations.value.map((entry) => ({ ...entry, label: `${entry.range.start}–${entry.range.end}` })),
  ];
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = groups.get(entry.file) ?? [];
    group.push(entry);
    groups.set(entry.file, group);
  }
  return groups;
});
const feedback = useAppFeedback();
const surface = useTemplateRef<InstanceType<typeof TextEditorSurface>>('surface');
const dragged = shallowRef<CodeDocument | null>(null);
let dropAfter = false;
const position = ref({ line: 1, column: 1 });
function activate(document: CodeDocument) {
  active.value = document;
  void nextTick(() => surface.value?.focus());
}
function run(action: () => Promise<unknown>) {
  void action().catch((error) => feedback.error(error, '代码编辑器操作失败'));
}
function dragOver(event: DragEvent) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropAfter = event.clientX > bounds.x + bounds.width / 2;
}
function drop(document: CodeDocument) {
  if (dragged.value) host.move(dragged.value, document, dropAfter);
  dragged.value = null;
}
watch([active, location], () => void nextTick(() => surface.value?.focus()), { flush: 'post' });
useWindowShortcuts({
  undoRedoInEditable: true,
  commands: {
    save: () => run(() => save()),
    close: () => run(closeCurrentWindow),
    undo: () => {
      run(async () => active.value?.undo());
      void nextTick(() => surface.value?.focus());
    },
    redo: () => {
      run(async () => active.value?.redo());
      void nextTick(() => surface.value?.focus());
    },
  },
});
</script>
