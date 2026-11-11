<template>
  <main class="code-editor ui-content-contained ui-layout-grid ui-text-normal" :inert="Boolean(closing)">
    <TextFileTabs
      :files="documents"
      :active="active"
      :label="label"
      @activate="activate"
      @close="(file) => run(() => close(file))"
      @move="host.move"
    />
    <header class="code-editor-header">
      <div class="code-editor-identity ui-control-row">
        <span class="code-editor-path ui-content-fill ui-text-path ui-text-truncate" :title="active?.path.value">{{
          active ? label(active) : '请选择要打开的文件'
        }}</span>
        <span v-if="active?.readOnly" class="code-readonly">引用，只读</span>
      </div>
      <div class="code-editor-tools ui-control-row">
        <div class="action-group ui-layout-row">
          <n-button size="small" :aria-pressed="treeShown" :type="treeShown ? 'primary' : 'default'" @click="treeShown = !treeShown">{{
            treeShown ? '收起项目树' : '展开项目树'
          }}</n-button>
          <n-button
            size="small"
            :aria-pressed="outlineShown"
            :type="outlineShown ? 'primary' : 'default'"
            @click="outlineShown = !outlineShown"
            >{{ outlineShown ? '收起大纲' : '展开大纲' }}</n-button
          >
          <n-button size="small" aria-label="诊断与引用" :aria-pressed="panel" :type="panel ? 'primary' : 'default'" @click="panel = !panel"
            >诊断与引用 ({{ analysis.diagnostics.value.length }})</n-button
          >
        </div>
        <div class="action-group ui-layout-row">
          <n-button size="small" :disabled="!active" @click="surface?.search()">查找与替换</n-button>
          <n-button size="small" :disabled="!active?.dirty.value" @click="run(() => save())">保存</n-button
          ><n-button size="small" :disabled="!dirty" @click="run(saveAll)">保存全部</n-button>
          <n-popover v-if="active && analysis.supports(active)" trigger="click" placement="bottom-end" :show-arrow="false">
            <template #trigger><n-button size="small" :disabled="!javaReady">Java 操作</n-button></template>
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
      </div>
    </header>
    <div v-if="active && (active.session.hasPendingExternalValue.value || active.problem.value)">
      <div v-if="active.session.hasPendingExternalValue.value" class="ui-notice" role="status">
        外部文本已更新，当前草稿已保留。<n-button size="small" @click="loadExternal(active)">载入外部文本</n-button>
      </div>
      <div v-if="active.problem.value" class="ui-notice" role="status">{{ active.problem.value.message }}</div>
    </div>
    <CodeWorkspaceLayout v-model:tree="treeShown" v-model:outline="outlineShown" :active="Boolean(active)" :results="panel">
      <template #tree><CodeProjectTree v-if="project" :project="project" /></template>
      <template #outline>
        <JavaOutline
          :entries="analysis.current.value?.outline ?? []"
          :status="analysis.status.value"
          :offset="activeOffset"
          @locate="(range) => run(() => analysis.locate({ file: active!.path.value, version: analysis.current.value!.version, range }))"
        />
      </template>
      <template #text>
        <div v-if="active" class="code-text-area ui-layout-row ui-layout-stack ui-layout-contained">
          <p v-if="!active.readOnly && /\.java$/i.test(active.path.value) && !analysis.supports(active)" class="ui-notice" role="status">
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
      <template #empty
        ><section class="empty-state ui-content-grid">
          <h1 class="page-title">代码编辑器</h1>
          <p class="ui-text-muted">选择文件开始编辑</p>
        </section></template
      >
    </CodeWorkspaceLayout>
    <footer class="code-editor-status ui-control-row ui-text-muted ui-text-small">
      <span role="status" class="ui-text-truncate" :title="analysis.problem.value ?? analysis.status.value">{{
        analysis.status.value
      }}</span>
      <n-button v-if="analysis.problem.value" size="tiny" @click="run(analysis.start)">重试分析</n-button>
      <span
        >{{ documents.length }} 个文件<template v-if="active">
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
import TextFileTabs from '@/app/components/text-file-editing/TextFileTabs.vue';
import JavaOutline from '@/app/components/java-analysis/JavaOutline.vue';
import JavaEditorPanels from '@/app/components/java-analysis/JavaEditorPanels.vue';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { closeCurrentWindow } from '@/windows/current.window';

const host = useCodeEditorWindow();
const { documents, active, location, dirty, label, close, save, saveAll, loadExternal, closing, analysis, actions, project } = host;
const panel = ref(false);
const treeShown = ref(true),
  outlineShown = ref(window.innerWidth >= 1000);
const javaReady = computed(() => Boolean(analysis.current.value) && !analysis.problem.value);
const activeOffset = computed(() =>
  active.value ? sourceOffset(active.value.document.content.value, active.value.document.state.value.selection.main.head) : 0,
);
const extensions = computed(() => [analysis.extensions.value, actions.extensions.value]);

const feedback = useAppFeedback();
const surface = useTemplateRef<InstanceType<typeof TextEditorSurface>>('surface');
const position = ref({ line: 1, column: 1 });
function activate(document: TextFile) {
  active.value = document;
  void nextTick(() => surface.value?.focus());
}
function run(action: () => Promise<unknown>) {
  void action().catch((error) => feedback.error(error, '代码编辑器操作失败'));
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
