<template>
  <div class="preview-window ui-content-grid ui-content-surface">
    <EditorHeader :title="view.previewSubtitle" readonly
      ><template #actions><n-button @click="$emit('close')">关闭</n-button></template>
      <div class="ship-mode-controls ui-control-row">
        <div class="segmented ship-mode-tabs ui-layout-row ui-control-border">
          <button
            class="ui-button segmented-button ship-mode-tabs-button ui-text-normal ui-control-pointer ui-content-surface"
            :class="{ active: view.viewMode === 'turret' }"
            :disabled="!view.hasWeaponSpec"
            @click="actions.setView('turret')"
          >
            炮塔视图 <span class="ship-mode-shortcut ui-text-meta ui-text-muted">U</span>
          </button>
          <button
            class="ui-button segmented-button ship-mode-tabs-button ui-text-normal ui-control-pointer ui-content-surface"
            :class="{ active: view.viewMode === 'hardpoint' }"
            :disabled="!view.hasWeaponSpec"
            @click="actions.setView('hardpoint')"
          >
            固定视图 <span class="ship-mode-shortcut ui-text-meta ui-text-muted">H</span>
          </button>
        </div>
        <n-button :type="view.fitted ? 'primary' : 'default'" :aria-pressed="view.fitted" @click="actions.fitView">适应视图</n-button>
      </div>
    </EditorHeader>
    <div class="editor-body ui-content-contained ui-layout-grid ui-layout-clip">
      <div
        ref="previewStageRef"
        class="canvas-stage preview-canvas-stage ui-content-contained ui-content-surface-muted ui-layout-contained"
      >
        <canvas
          ref="canvasRef"
          class="editor-canvas preview-canvas ui-canvas-image"
          @mousedown="actions.onDown"
          @mousemove="actions.onMove"
          @mouseup="actions.onUp"
          @mouseleave="actions.onLeave"
          @wheel.prevent="actions.onWheel"
          @contextmenu.prevent
        />
      </div>
      <EditorInspector title="预览控制">
        <div class="preview-control-panel ui-layout-grid">
          <section class="preview-control-section ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid">
            <h3 class="preview-control-section-title ui-text-soft ui-text-reset ui-text-small">武器状态</h3>
            <div class="preview-fire-status ui-text-small ui-layout-grid ui-layout-center">
              <span class="preview-fire-status-label ui-text-muted">开火状态</span>
              <n-switch
                class="tool-switch"
                aria-label="开火状态"
                :value="view.firing"
                @update:value="$event ? actions.startFiring() : actions.stopFiring()"
              >
                <template #checked>开火</template>
                <template #unchecked>停火</template>
              </n-switch>
            </div>
          </section>
          <div class="preview-control-section ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid">
            <h3 class="preview-control-section-title ui-text-soft ui-text-reset ui-text-small">预览控制</h3>
            <div class="preview-control-actions ui-layout-grid">
              <n-button @click="actions.toggle">{{ view.running ? '暂停' : '播放' }}</n-button>
              <n-button tertiary @click="actions.reset">重置</n-button>
            </div>
            <div class="preview-control-actions ui-layout-grid">
              <n-button :disabled="!view.canStepBack" @click="actions.step(-1)">上一帧</n-button>
              <n-button @click="actions.step(1)">下一帧</n-button>
            </div>
            <div class="preview-speed-control ui-layout-grid">
              <div class="preview-speed-header ui-text-small ui-layout-grid ui-layout-center">
                <span class="preview-speed-header-label ui-text-muted">播放速度</span>
                <strong class="preview-speed-header-value ui-emphasis ui-text-normal">{{ view.speedLabel }}</strong>
              </div>
              <n-slider :value="view.speed" :min="0.5" :max="5" :step="0.1" @update:value="actions.setSpeed" />
            </div>
          </div>
        </div>
      </EditorInspector>
    </div>
    <EditorFooter note="右键 拖动画布 | 滚轮 缩放 | 右侧调整播放速度"> </EditorFooter>
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue';

import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import {
  useWeaponFirePreviewViewModel,
  type WeaponFirePreviewProps,
  type WeaponFirePreviewEvents,
} from '@/app/composables/weapon-fire-preview/use-weapon-fire-preview-view-model';

const props = defineProps<WeaponFirePreviewProps>();
defineEmits<WeaponFirePreviewEvents>();
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const previewStageRef = useTemplateRef<HTMLElement>('previewStageRef');
const { view, actions } = useWeaponFirePreviewViewModel(props, { canvasRef, previewStageRef });
</script>
