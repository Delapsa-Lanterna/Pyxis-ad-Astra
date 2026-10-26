<template>
  <div ref="editorWindowRef" tabindex="-1" class="editor-window ui-content-grid ui-content-surface">
    <EditorHeader
      :title="projectileId"
      :path="path"
      :saving="saving"
      :dirty="dirty"
      :external-update-notice="externalUpdateNotice"
      @load-external="$emit('load-external')"
    >
      <template #actions
        ><n-button @click="$emit('close')">关闭</n-button
        ><n-button :disabled="!dirty || saving" @click="$emit('reset-requested')">重置</n-button
        ><n-button type="primary" :disabled="!canSave" :loading="saving" @click="$emit('save-requested')">保存</n-button></template
      >
      <n-button size="small" :type="view.fitted ? 'primary' : 'default'" :aria-pressed="view.fitted" @click="actions.resetView"
        >适应视图</n-button
      >
    </EditorHeader>
    <div class="editor-body ui-content-contained">
      <div ref="stageRef" class="canvas-stage ui-content-contained ui-content-surface-muted">
        <canvas
          ref="canvasRef"
          class="editor-canvas ui-canvas-image"
          aria-label="弹体静态画布"
          @mousedown="canvas.onDown"
          @mousemove="canvas.onMove"
          @mouseup="canvas.onUp"
          @mouseleave="canvas.onLeave"
          @wheel.prevent="canvas.onWheel"
          @contextmenu.prevent
        />
        <div
          v-if="view.spriteNotice"
          class="projectile-canvas-notice ui-text-muted ui-text-small ui-text-wrap ui-control-border ui-content-surface"
          role="status"
        >
          {{ view.spriteNotice }}
        </div>
      </div>
      <EditorInspector
        title="弹体检查器"
        @focusin.capture="canvas.beginField"
        @focusout.capture="canvas.fieldBlur"
        @keyup.capture="canvas.fieldKey"
      >
        <template #problems><SpecProblems /></template>
        <n-collapse v-model:expanded-names="view.expandedSections">
          <n-collapse-item
            v-for="section in view.sections"
            :key="section.name"
            class="schema-section"
            :title="section.title"
            :name="section.name"
          >
            <SpecFieldList
              :content="document"
              :fields="section.fields"
              :readonly-fields="['id']"
              @remove="actions.removeField"
              @update="actions.setProperty"
            />
            <template v-if="section.name === 'missileVisual'">
              <FieldRow label="实际图片尺寸"
                ><span>{{ view.spriteSize[0] }} × {{ view.spriteSize[1] }}</span></FieldRow
              >
              <div class="action-group">
                <n-button :disabled="!view.canSyncSprite" @click="actions.syncSize">按图片更新尺寸</n-button>
                <n-button :disabled="!view.canSyncSprite" @click="actions.syncCenter">中心设为图片中心</n-button>
              </div>
            </template>
            <FieldHints v-if="section.name === 'flight'" description="此处为 .proj 参数；装备后的速度与飞行时间由武器 CSV 对应值覆盖。" />
            <template v-if="section.name === 'slots'">
              <div v-for="(slot, index) in view.engineSlots" :key="entryKey('engine-slot', slot, index)" class="ui-field-stack">
                <SpecFieldList
                  :content="document"
                  :fields="engineFields"
                  :prefix="'engineSlots[' + index + '].'"
                  @remove="actions.removeField"
                  @update="actions.setProperty"
                />
                <SpecFieldList
                  v-if="slot.style === 'CUSTOM'"
                  :content="document"
                  :fields="PROJECTILE_CUSTOM_ENGINE_FIELDS"
                  :prefix="'engineSlots[' + index + '].'"
                  @remove="actions.removeField"
                  @update="actions.setProperty"
                />
                <FieldHints v-if="slot.style === 'CUSTOM'" description="styleId 优先；内联样式支持 PARTICLES 与 QUAD_STRIP。" />
                <div class="action-group">
                  <n-button @click="actions.removeEngineSlot(index)">删除</n-button>
                  <n-button @click="actions.createInlineStyle(index)">创建内联样式</n-button>
                </div>
              </div>
              <div class="action-group"><n-button @click="actions.addEngineSlot">添加</n-button></div>
            </template>
            <template v-if="section.name === 'explosion'">
              <FieldRow label="爆炸配置" field-key="explosionSpec">
                <n-button v-if="!document.explosionSpec" @click="actions.addExplosion">添加</n-button>
                <n-button v-else @click="actions.removeProperty('explosionSpec')">删除</n-button>
              </FieldRow>
              <SpecFieldList
                v-if="document.explosionSpec"
                :content="document"
                :fields="EXPLOSION_FIELDS"
                prefix="explosionSpec."
                @remove="actions.removeField"
                @update="actions.setProperty"
              />
            </template>
            <template v-if="section.name === 'scripts'">
              <FieldHints description="behavior 支持 PROXIMITY_FUSE、MIRV、CUSTOM；对象参数交给对应 AI 或脚本消费。" />
              <div v-if="document.behaviorSpec" class="action-group">
                <n-button @click="actions.removeProperty('behaviorSpec')">删除</n-button>
              </div>
            </template>
          </n-collapse-item>
        </n-collapse>
      </EditorInspector>
    </div>
    <EditorFooter note="右键 拖动画布 | 滚轮 缩放 | Ctrl+Z 撤销 | Ctrl+Shift+Z 重做" />
  </div>
</template>
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import SpecFieldList from '../SpecFieldList.vue';
import SpecProblems from '../SpecProblems.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import { entryKey } from '@/shared/lib/entry-keys';
import {
  EXPLOSION_FIELDS,
  MISSILE_ENGINE_FIELDS,
  PROJECTILE_CUSTOM_ENGINE_FIELDS,
} from '@/domain/spec-editor/projectile/spec-projectile-fields';
import {
  useSpecProjectileEditorViewModel,
  type SpecProjectileEditorProps,
  type SpecProjectileEditorEvents,
} from '@/app/composables/spec-editor/projectile/use-spec-projectile-editor-view-model';
const props = defineProps<SpecProjectileEditorProps>();
const emit = defineEmits<SpecProjectileEditorEvents>();
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const { document, view, actions, canvas } = useSpecProjectileEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
const engineFields = computed(() =>
  MISSILE_ENGINE_FIELDS.map((field) =>
    field.key === 'style' ? { ...field, options: [...new Set([...view.engineStyles, 'CUSTOM'])] } : field,
  ),
);
</script>
