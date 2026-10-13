<template>
  <div class="modal-backdrop">
    <div class="preview-window">
      <EditorHeader title="发射预览" :subtitle="view.previewSubtitle">
        <div class="ship-mode-controls">
          <div class="segmented ship-mode-tabs">
            <button :class="{ active: view.viewMode === 'turret' }" :disabled="!view.hasWeaponSpec" @click="actions.setView('turret')">
              炮塔视图 <span class="ship-mode-shortcut">U</span>
            </button>
            <button
              :class="{ active: view.viewMode === 'hardpoint' }"
              :disabled="!view.hasWeaponSpec"
              @click="actions.setView('hardpoint')"
            >
              固定视图 <span class="ship-mode-shortcut">H</span>
            </button>
          </div>
        </div>
      </EditorHeader>
      <div class="editor-body">
        <div ref="previewStageRef" class="canvas-stage preview-canvas-stage">
          <canvas ref="canvasRef" class="editor-canvas preview-canvas" />
        </div>
        <EditorInspector title="预览控制">
          <div class="preview-control-panel">
            <section class="preview-control-section">
              <h3>武器状态</h3>
              <div class="preview-control-actions">
                <n-button type="primary" :disabled="view.firing" @click="actions.startFiring">开火</n-button>
                <n-button :disabled="!view.firing" @click="actions.stopFiring">停火</n-button>
              </div>
              <div class="preview-fire-status">
                <span>开火状态</span>
                <strong>{{ view.firing ? '开火中' : '停火' }}</strong>
              </div>
            </section>
            <div class="preview-control-section">
              <h3>预览控制</h3>
              <div class="preview-control-actions">
                <n-button @click="actions.toggle">{{ view.running ? '暂停' : '播放' }}</n-button>
                <n-button tertiary @click="actions.reset">重置</n-button>
              </div>
              <div class="preview-speed-control">
                <div class="preview-speed-header">
                  <span>播放速度</span>
                  <strong>{{ view.speedLabel }}</strong>
                </div>
                <n-slider :value="view.speed" :min="0.5" :max="5" :step="0.1" @update:value="actions.setSpeed" />
              </div>
            </div>
          </div>
        </EditorInspector>
      </div>
      <EditorFooter note="播放预览用于观察武器弹道和光束表现；右侧可调整播放速度。">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
        </template>
      </EditorFooter>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue';

import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import {
  useWeaponPreviewViewModel,
  type WeaponFirePreviewProps,
  type WeaponFirePreviewEvents,
} from '@/app/composables/editors/use-weapon-preview-view-model';

const props = defineProps<WeaponFirePreviewProps>();
defineEmits<WeaponFirePreviewEvents>();
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const previewStageRef = useTemplateRef<HTMLElement>('previewStageRef');
const { view, actions } = useWeaponPreviewViewModel(props, { canvasRef, previewStageRef });
</script>
