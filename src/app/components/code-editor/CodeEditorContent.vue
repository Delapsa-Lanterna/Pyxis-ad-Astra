<template>
  <main ref="editor" class="code-editor ui-content-contained ui-layout-grid ui-text-normal" :inert="Boolean(closing)">
    <TextFileTabs
      :files="documents"
      :active="showOverview ? null : active"
      :label="label"
      @activate="activate"
      @close="(file) => run(() => close(file))"
      @move="host.move"
    >
      <template #leading>
        <button
          class="mod-tabs-overview ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset"
          :class="{ active: showOverview }"
          :aria-pressed="showOverview"
          title="打开代码总览"
          aria-label="打开代码总览"
          @click="run(openOverview)"
        >
          <svg class="mod-tabs-overview-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </template>
    </TextFileTabs>
    <header class="code-editor-header ui-control-row">
      <span class="code-editor-path ui-text-path ui-text-truncate" :title="showOverview ? undefined : active?.path.value">{{
        showOverview ? '代码总览' : active ? label(active) : '请选择要打开的文件'
      }}</span>
      <span v-if="!showOverview && active?.readOnly" class="code-readonly">引用，只读</span>
      <div class="code-editor-regions ui-control-row ui-content-fill">
        <CodeToolButton
          :label="treeShown ? '收起项目树' : '展开项目树'"
          :pressed="treeShown"
          :path="treeShown ? 'm10 4-4 4 4 4' : 'm6 4 4 4-4 4'"
          @click="treeShown = !treeShown"
        />
        <CodeToolButton
          v-if="!showOverview"
          :label="outlineShown ? '收起大纲' : '展开大纲'"
          :pressed="outlineShown"
          :path="outlineShown ? 'm6 4 4 4-4 4' : 'm10 4-4 4 4 4'"
          @click="outlineShown = !outlineShown"
        />
        <CodeToolButton
          v-if="!showOverview"
          :title="`${panel ? '收起' : '展开'}诊断与引用 (${analysis.diagnostics.value.length})`"
          label="诊断与引用"
          :pressed="panel"
          :path="panel ? 'm4 6 4 4 4-4' : 'm4 10 4-4 4 4'"
          @click="panel = !panel"
        />
      </div>
      <div class="ui-control-row">
        <CodeToolButton
          v-if="!showOverview"
          label="查找与替换"
          path="M10.5 6.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm-.5 3.5 4 4"
          :disabled="!active"
          @click="surface?.search()"
        />
        <CodeToolButton
          v-if="!showOverview"
          label="保存"
          path="M3 2h8l3 3v9H2V2zm2 0v4h5V2M5 14V9h6v5"
          :disabled="!active?.dirty.value"
          @click="run(() => save())"
        />
        <CodeToolButton label="保存全部" path="M5 2h7l2 2v8H4V2zm2 0v3h3V2M7 12V8h4v4M2 5v9h9" :disabled="!dirty" @click="run(saveAll)" />
        <n-popover v-if="!showOverview && active && analysis.supports(active)" trigger="click" placement="bottom-end" :show-arrow="false">
          <template #trigger><CodeToolButton label="Java 操作" path="m5 4-4 4 4 4m6-8 4 4-4 4M9 2 7 14" :disabled="!javaReady" /></template>
          <div class="code-java-tools action-group">
            <n-button size="small" :disabled="!javaReady" @click="run(() => analysis.navigate('declaration'))">跳转声明</n-button>
            <n-button size="small" :disabled="!javaReady" @click="run(() => analysis.navigate('references'))">查找引用</n-button>
            <n-button size="small" :disabled="!javaReady || active.readOnly" @click="run(() => actions.parameters())">参数提示</n-button>
            <n-button size="small" :disabled="!javaReady || active.readOnly" @click="run(() => actions.prepare('imports'))"
              >整理导入</n-button
            >
            <n-input
              v-model:value="actions.name.value"
              size="small"
              placeholder="新名称"
              :disabled="!javaReady || active.readOnly"
              :input-props="{ 'aria-label': '重命名的新名称' }"
            />
            <n-button
              size="small"
              :disabled="!javaReady || active.readOnly || !actions.name.value"
              @click="run(() => actions.prepare('rename'))"
              >预览重命名</n-button
            >
          </div>
        </n-popover>
      </div>
    </header>
    <div v-if="!showOverview && active && (active.session.hasPendingExternalValue.value || active.problem.value)">
      <div v-if="active.session.hasPendingExternalValue.value" class="ui-notice" role="status">
        外部文本已更新，当前草稿已保留。<n-button size="small" @click="loadExternal(active)">载入外部文本</n-button>
      </div>
      <div v-if="active.problem.value" class="ui-notice" role="status">{{ active.problem.value.message }}</div>
    </div>
    <CodeWorkspaceLayout
      v-model:tree="treeShown"
      v-model:outline="outlineShown"
      :active="Boolean(active)"
      :results="panel"
      :overview="showOverview"
    >
      <template #tree><CodeProjectTree v-if="project" :project="project" /></template>
      <template #outline>
        <JavaOutline
          :entries="analysis.current.value?.outline ?? []"
          :status="analysis.status.value"
          :offset="activeOffset"
          :file="active?.path.value ?? ''"
          :refresh="analysis.refresh"
          @locate="(range) => run(() => analysis.locate({ file: active!.path.value, version: analysis.current.value!.version, range }))"
        />
      </template>
      <template #text>
        <div v-if="active" class="code-text-area ui-layout-row ui-layout-stack ui-layout-contained">
          <p v-if="!active.readOnly && active.path.value.endsWith('.java') && !analysis.supports(active)" class="ui-notice" role="status">
            当前文件位于分析源码根之外：{{ project?.analysisRoots.value.join('，') || '当前项目没有 src 源码目录' }}
          </p>
          <TextEditorSurface
            class="ui-content-fill"
            ref="surface"
            :document="active.document"
            :disabled="active.readOnly"
            :extensions="extensions"
            line-numbers
            @position="position = $event"
          /></div
      ></template>
      <template #results
        ><JavaEditorPanels
          v-show="panel"
          :panel="panel"
          :analysis="analysis"
          :actions="actions"
          @close="panel = false"
          @open="panel = true"
      /></template>
      <template #overview
        ><CodeOverview
          :files="documents"
          :sources="project?.sources.value ?? null"
          :status="analysis.status.value"
          :engineering="host.engineering"
          :diagnostics="analysis.diagnostics.value"
      /></template>
    </CodeWorkspaceLayout>
    <footer class="code-editor-status ui-control-row ui-text-muted ui-text-small">
      <span role="status" class="ui-text-truncate" :title="analysis.problem.value ?? analysis.status.value">{{
        analysis.status.value
      }}</span>
      <n-button v-if="analysis.problem.value" size="tiny" @click="run(analysis.start)">重试分析</n-button>
      <span
        >{{ documents.length }} 个文件<template v-if="active && !showOverview">
          · {{ active.session.saving.value ? '保存中' : active.dirty.value ? '未保存' : '已保存' }} · 行 {{ position.line }}，列
          {{ position.column }}</template
        ></span
      >
    </footer>
    <div v-if="analysis.problem.value" class="ui-notice" role="alert">
      {{ analysis.problem.value }}。请在设置的 Java 分析卡片检查组件和 Java 17。
    </div>
  </main>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import { sourceOffset } from '@/shared/runtime/text-document';
import { useCodeEditorWindow } from '@/app/composables/code-editor/use-code-editor-window';
import type { TextFile } from '@/app/composables/text-file-editing/use-text-file';
import TextEditorSurface from '@/shared/ui/TextEditorSurface.vue';
import CodeProjectTree from './CodeProjectTree.vue';
import CodeWorkspaceLayout from './CodeWorkspaceLayout.vue';
import CodeOverview from './CodeOverview.vue';
import CodeToolButton from './CodeToolButton.vue';
import TextFileTabs from '@/app/components/text-file-editing/TextFileTabs.vue';
import JavaOutline from '@/app/components/java-analysis/JavaOutline.vue';
import JavaEditorPanels from '@/app/components/java-analysis/JavaEditorPanels.vue';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { closeCurrentWindow } from '@/windows/current.window';
import { useContextMenuScope } from '@/app/composables/use-context-menu';

const host = useCodeEditorWindow();
const { documents, active, location, dirty, label, close, save, saveAll, loadExternal, closing, analysis, actions, project } = host;
const panel = ref(false);
const overview = ref(false);
const showOverview = computed(() => overview.value || !active.value);
const treeShown = ref(true),
  outlineShown = ref(false);
const javaReady = computed(() => Boolean(analysis.current.value) && !analysis.problem.value);
const activeOffset = computed(() =>
  active.value ? sourceOffset(active.value.document.content.value, active.value.document.state.value.selection.main.head) : 0,
);
const extensions = computed(() => [analysis.extensions.value, actions.extensions.value]);

const feedback = useAppFeedback();
const editor = useTemplateRef<HTMLElement>('editor');
const surface = useTemplateRef<InstanceType<typeof TextEditorSurface>>('surface');
useContextMenuScope({
  identity: () => active.value?.path.value ?? '',
  canRefresh: (target) => Boolean(!showOverview.value && active.value && !active.value.readOnly && target.closest('.code-text-area')),
  refresh: host.refresh,
});
const position = ref({ line: 1, column: 1 });
function activate(document: TextFile) {
  overview.value = false;
  active.value = document;
  void nextTick(() => surface.value?.focus());
}
async function openOverview() {
  await active.value?.document.waitForInput();
  overview.value = true;
  await nextTick();
  editor.value!.querySelector<HTMLElement>('.code-overview')!.focus({ preventScroll: true });
}
function run(action: () => Promise<unknown>) {
  void action().catch((error) => feedback.error(error, '代码编辑器操作失败'));
}
watch(
  [active, location],
  ([, request], [, previousRequest]) => {
    if (request !== previousRequest) overview.value = false;
    if (!showOverview.value) void nextTick(() => surface.value?.focus());
  },
  { flush: 'post' },
);
useWindowShortcuts({
  undoRedoInEditable: true,
  commands: {
    save: () => run(() => save()),
    close: () => run(closeCurrentWindow),
    undo: () => {
      if (showOverview.value) return;
      run(async () => active.value?.undo());
      void nextTick(() => surface.value?.focus());
    },
    redo: () => {
      if (showOverview.value) return;
      run(async () => active.value?.redo());
      void nextTick(() => surface.value?.focus());
    },
  },
});
</script>
