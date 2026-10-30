<template>
  <main class="browser-workspace-shell browser-chrome" :style="appearanceStyle">
    <BrowserHeader :title="demo ? '浏览器演示' : '测试工作区'">
      <template v-if="demo" #status>编辑仅在当前页面会话保留，刷新后恢复样本。</template>
      <details v-if="!demo" class="workbench-menu">
        <summary>打开子窗口</summary>
        <div class="workbench-menu-panel">
          <label
            >规格类型
            <select aria-label="规格窗口类型" v-model="specKind">
              <option v-for="kind in ['ship', 'weapon', 'projectile', 'system']" :key="kind" :value="kind">{{ kind }}</option>
            </select></label
          >
          <label
            >沉浸式类型
            <select aria-label="沉浸式窗口类型" v-model="immersiveKind">
              <option v-for="kind in immersiveSamples" :key="kind" :value="kind">{{ kind }}</option>
            </select></label
          >
          <button
            v-for="kind in windowKinds"
            :key="kind"
            @click="workspace.openSampleWindow(kind, kind === 'editor' ? specKind : kind === 'immersive-editor' ? immersiveKind : 'ship')"
          >
            {{ windowLabels[kind] }}
          </button>
        </div>
      </details>
      <button class="workbench-primary" @click="workspace.restoreSample()">恢复样本</button>
      <button v-if="!demo" @click="workspace.reopen()">重开窗口</button>
      <details v-if="!demo" class="workbench-menu">
        <summary>校对工具</summary>
        <div class="workbench-menu-panel">
          <button @click="workspace.externalUpdate()">注入外部更新</button>
          <button @click="workspace.faults.read = true">模拟读取失败</button>
          <button @click="workspace.faults.save = true">模拟保存失败</button>
          <label>读取延迟 <input v-model.number="workspace.faults.delay" type="number" min="0" /> ms</label>
          <button @click="workspace.closeApplication()">关闭工作区</button>
        </div>
      </details>
      <details v-if="!demo" class="workbench-menu">
        <summary>窗口尺寸</summary>
        <div class="workbench-menu-panel workbench-size-options">
          <button :aria-pressed="width === 0" @click="width = 0">适应工作区</button>
          <button :aria-pressed="width === 1000" @click="width = 1000">1000 px</button>
          <button :aria-pressed="width === 720" @click="width = 720">720 px</button>
        </div>
      </details>
      <details v-if="!demo" class="workbench-menu workbench-catalog">
        <summary>功能校对目录</summary>
        <div class="workbench-menu-panel workbench-catalog-panel">
          <a v-for="scene in scenarios" :key="scene.id" :data-scene-id="scene.id" :href="scenarioHref(scene.id)">{{ scene.label }}</a>
          <details class="browser-workspace-routes">
            <summary>正式页面与子窗口</summary>
            <a v-for="entry in workspaceEntries" :key="entry.id" :data-navigation-id="entry.id" :href="entry.href">{{ entry.label }}</a>
          </details>
        </div>
      </details>
      <BrowserAppearance :settings="workspace.appearance" @change="workspace.setAppearance" />
    </BrowserHeader>
    <section class="browser-window-grid" :class="{ 'has-child-windows': windowEntries.length > 1 }">
      <iframe
        v-for="[label, window] in windowEntries"
        :key="label + window.generation"
        :data-window="label"
        :title="window.context?.title || '主窗口'"
        :src="`${base}?window=${encodeURIComponent(label)}`"
        :style="{ width: width ? width + 'px' : '100%' }"
      />
    </section>
  </main>
</template>
<script setup lang="ts">
import { computed, onUnmounted, ref, toRef } from 'vue';
import type { BrowserWorkspace } from './workspace-runtime';
import { scenarios, workspaceEntries, scenarioHref, immersiveSamples } from './scenarios/registry';
import BrowserAppearance from './BrowserAppearance.vue';
import BrowserHeader from './BrowserHeader.vue';
import { browserThemeStyle } from './appearance';
import type { SpecEditorKind, JointEditKind } from '@/shared/types';
import './browser.css';
const windowKinds = ['editor', 'file-editor', 'immersive-editor', 'weapon-fire-preview'] as const;
const demo = import.meta.env.VITE_BROWSER_DEMO === true;
const base = import.meta.env.BASE_URL;
const windowLabels = {
  editor: '规格编辑器',
  'file-editor': '文件编辑器',
  'immersive-editor': '沉浸式编辑器',
  'weapon-fire-preview': '武器开火预览',
};
const props = defineProps<{ workspace: BrowserWorkspace }>();
const workspace = toRef(props, 'workspace');
const width = ref(0);
const specKind = ref<SpecEditorKind>('ship'),
  immersiveKind = ref<JointEditKind>('variant');
const appearanceStyle = computed(() => browserThemeStyle(workspace.value.appearance));
const windowsVersion = ref(0);
const stop = workspace.value.setWindowListener(() => windowsVersion.value++);
const windowEntries = computed(() => {
  windowsVersion.value;
  return [...workspace.value.windows.entries()];
});
onUnmounted(stop);
</script>
