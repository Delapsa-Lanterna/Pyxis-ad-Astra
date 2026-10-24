<template>
  <div ref="editorWindowRef" class="editor-window ui-content-grid ui-content-surface" tabindex="-1">
    <EditorHeader
      :title="weaponId"
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
      <div class="ship-mode-controls ui-control-row">
        <div class="segmented ship-mode-tabs ui-layout-row ui-control-border">
          <button
            class="ui-button segmented-button ship-mode-tabs-button ui-text-normal ui-control-pointer ui-content-surface"
            :class="{ active: view.viewMode === 'turret' }"
            @click="actions.setView('turret')"
          >
            炮塔视图 <span class="ship-mode-shortcut ui-text-meta ui-text-muted">U</span>
          </button>
          <button
            class="ui-button segmented-button ship-mode-tabs-button ui-text-normal ui-control-pointer ui-content-surface"
            :class="{ active: view.viewMode === 'hardpoint' }"
            @click="actions.setView('hardpoint')"
          >
            固定视图 <span class="ship-mode-shortcut ui-text-meta ui-text-muted">H</span>
          </button>
        </div>
        <n-button :type="view.mirror ? 'primary' : 'default'" :aria-pressed="view.mirror" @click="actions.toggleMirror">镜像编辑</n-button>
        <n-button :type="view.fitted ? 'primary' : 'default'" :aria-pressed="view.fitted" @click="actions.fitView">适应视图</n-button>
        <span class="ship-mode-hint ui-text-muted">T 打开右侧</span>
      </div>
    </EditorHeader>
    <div class="editor-body ui-content-contained">
      <div ref="stageRef" class="canvas-stage ui-content-contained ui-content-surface-muted">
        <canvas
          ref="canvasRef"
          class="editor-canvas ui-canvas-image"
          @mousedown="canvas.onDown"
          @mousemove="canvas.onMove"
          @mouseup="canvas.onUp"
          @mouseleave="canvas.onLeave"
          @wheel.prevent="canvas.onWheel"
          @contextmenu.prevent
        />
      </div>
      <EditorInspector
        title="武器检查器"
        @focusin.capture="canvas.beginField"
        @focusout.capture="canvas.fieldBlur"
        @keyup.capture="canvas.fieldKey"
      >
        <template #problems><SpecProblems /></template>
        <n-collapse v-model:expanded-names="view.expandedSections" @update:expanded-names="canvas.onExpandedSectionsUpdate">
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
              :image-fields="view.spriteFields"
              :readonly-fields="['id']"
              @remove="actions.removeField"
              @update="actions.setProperty"
              @browse="actions.pickWeaponSprite"
            />
            <template v-if="section.name === 'turretBarrels' || section.name === 'hardpointBarrels'">
              <div class="item-list ui-layout-grid">
                <button
                  v-for="(_, index) in actions.barrelCountFor(section.name === 'turretBarrels' ? 'turret' : 'hardpoint')"
                  :key="index"
                  class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                  :class="{
                    selected: view.viewMode === (section.name === 'turretBarrels' ? 'turret' : 'hardpoint') && view.selected === index,
                  }"
                  @click="actions.selectBarrel(section.name === 'turretBarrels' ? 'turret' : 'hardpoint', index)"
                >
                  发射点 {{ index + 1 }}
                </button>
              </div>
              <div
                v-if="view.selected !== null && view.viewMode === (section.name === 'turretBarrels' ? 'turret' : 'hardpoint')"
                :data-inspector-target="view.viewMode + '-barrel-' + view.selected"
                :key="view.viewMode + view.selected"
                class="ui-field-stack"
              >
                <FieldRow
                  v-for="(axis, index) in ['X', 'Y']"
                  :key="axis"
                  :label="'位置 ' + axis"
                  :field-key="view.viewMode + 'Offsets'"
                  :path="view.viewMode + 'Offsets[' + (view.selected * 2 + index) + ']'"
                >
                  <NumberValueInput
                    :value="view.offsets[view.selected * 2 + index]"
                    clear-action="required"
                    @update:value="actions.setOffset(index as 0 | 1, $event)"
                  />
                </FieldRow>
                <FieldRow
                  label="角度偏移"
                  :field-key="view.viewMode + 'AngleOffsets'"
                  :path="view.viewMode + 'AngleOffsets[' + view.selected + ']'"
                >
                  <NumberValueInput :value="view.angles[view.selected] ?? 0" clear-action="required" @update:value="actions.setAngle" />
                </FieldRow>
              </div>
              <div class="action-group">
                <n-button @click="actions.addBarrelFor(section.name === 'turretBarrels' ? 'turret' : 'hardpoint')">添加</n-button>
                <n-button
                  :disabled="view.selected === null || view.viewMode !== (section.name === 'turretBarrels' ? 'turret' : 'hardpoint')"
                  @click="actions.deleteBarrelFor(section.name === 'turretBarrels' ? 'turret' : 'hardpoint')"
                  >删除</n-button
                >
              </div>
            </template>
            <div v-if="section.name === 'muzzle'" class="ui-field-stack">
              <div v-for="(fields, key) in WEAPON_OBJECT_FIELDS" :key="key" class="ui-field-stack">
                <FieldRow :label="key === 'muzzleFlashSpec' ? '闪光配置' : '烟雾配置'" :field-key="key">
                  <n-button v-if="!document[key]" @click="actions.addObject(key as 'muzzleFlashSpec' | 'smokeSpec')">添加</n-button>
                  <n-button v-else @click="actions.removeProperty(key)">删除</n-button>
                </FieldRow>
                <SpecFieldList
                  v-if="document[key]"
                  :content="document"
                  :fields="fields"
                  :prefix="key + '.'"
                  @remove="actions.removeField"
                  @update="actions.setProperty"
                />
              </div>
            </div>
            <FieldHints v-if="section.name === 'anim'" description="原版帧图片使用 _00.png、_01.png 等独立序列文件。" />
            <div v-if="section.name === 'proj'" class="action-group">
              <n-button @click="actions.editProjectile">编辑弹体</n-button><n-button @click="actions.preview">开火预览</n-button>
            </div>
            <div v-if="section.name === 'beam'" class="action-group"><n-button @click="actions.preview">开火预览</n-button></div>
            <div v-if="section.name === 'glow'" class="action-group">
              <n-button
                :type="view.glowPreviewEnabled ? 'primary' : 'default'"
                :aria-pressed="view.glowPreviewEnabled"
                @click="actions.toggleGlowPreview"
                >预览光效</n-button
              >
            </div>
          </n-collapse-item>
        </n-collapse>
      </EditorInspector>
    </div>
    <EditorFooter :note="view.footerNote" />
  </div>
</template>
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import SpecFieldList from '../SpecFieldList.vue';
import SpecProblems from '../SpecProblems.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import { WEAPON_OBJECT_FIELDS } from '@/domain/spec-editor/weapon/spec-weapon-fields';
import {
  useSpecWeaponEditorViewModel,
  type SpecWeaponEditorProps,
  type SpecWeaponEditorEvents,
} from '@/app/composables/spec-editor/weapon/use-spec-weapon-editor-view-model';
const props = defineProps<SpecWeaponEditorProps>();
const emit = defineEmits<SpecWeaponEditorEvents>();
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const { document, view, actions, canvas } = useSpecWeaponEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
</script>
