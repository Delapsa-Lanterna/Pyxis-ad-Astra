<template>
  <div ref="editorWindowRef" class="editor-window ui-content-grid ui-content-surface" tabindex="-1">
    <EditorHeader
      :title="str(document.hullName) || hullId"
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
            v-for="m in view.modes"
            :key="m.value"
            :class="{ active: view.mode === m.value }"
            @click="actions.setMode(m.value)"
          >
            {{ m.label }} <span class="ship-mode-shortcut ui-text-meta ui-text-muted">{{ m.shortcut }}</span>
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
        title="舰船检查器"
        @focusin.capture="canvas.beginField"
        @focusout.capture="canvas.fieldBlur"
        @keyup.capture="canvas.fieldKey"
      >
        <template #problems><SpecProblems /></template>
        <n-collapse v-model:expanded-names="view.expandedSections" @update:expanded-names="canvas.onExpandedSectionsUpdate">
          <n-collapse-item
            v-for="section in SHIP_SECTIONS"
            :key="section.name"
            class="schema-section"
            :title="section.title"
            :name="section.name"
          >
            <SpecFieldList
              :content="document"
              :fields="section.fields"
              @remove="actions.removeField"
              @update="actions.setProperty"
              @change="$event === 'spriteName' && actions.loadSprite()"
            />
            <template v-if="section.name === 'sprite'">
              <FieldRow label="实际图片尺寸"
                ><span>{{ view.spriteSize.width }} × {{ view.spriteSize.height }}</span></FieldRow
              >
              <FieldHints description="中心赋值保持附属相对坐标；画布拖动中心会补偿武器槽、甲板、引擎、护盾和边界坐标。" />
              <div v-if="spriteError" class="editor-resource-diagnostics ui-text-wrap">{{ spriteError }}</div>
              <div class="action-group">
                <n-button :disabled="!view.canSyncSpriteSize" @click="actions.syncShipCenter">中心设为图片中心</n-button>
                <n-button :disabled="!view.canSyncSpriteSize" @click="actions.syncSpriteSize">按图片更新宽高</n-button>
              </div>
            </template>
            <template v-if="section.name === 'advanced'">
              <FieldRow label="覆盖颜色" field-key="coversColor"
                ><ColorPicker :model-value="view.coversColor" label="coversColor" @update:model-value="actions.setCoversColor"
              /></FieldRow>
            </template>
            <template v-if="section.name === 'weapons' || section.name === 'launchBays'">
              <div class="item-list ui-layout-grid">
                <button
                  v-for="item in section.name === 'weapons' ? view.normalWeaponSlots : view.launchBaySlots"
                  :key="item.index"
                  class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                  :class="{ selected: view.selected === item.index && view.mode === (section.name === 'weapons' ? 'weapon' : 'launchBay') }"
                  @click="actions.selectInspectorItem(section.name === 'weapons' ? 'weapon' : 'launchBay', item.index, 'weapon')"
                >
                  {{ item.slot.id }} <span class="item-list-label ui-text-muted">{{ item.slot.type }}</span>
                </button>
              </div>
              <div
                v-if="view.selectedSlot && view.mode === (section.name === 'weapons' ? 'weapon' : 'launchBay')"
                :key="'slot-' + view.selected"
                class="ui-field-stack"
                :data-inspector-target="(view.mode === 'weapon' ? 'weapon-' : 'launchBay-') + view.selected"
              >
                <SpecFieldList
                  :content="document"
                  :fields="section.name === 'weapons' ? weaponSlotFields : SHIP_SLOT_FIELDS.slice(0, 1)"
                  :prefix="'weaponSlots[' + view.selected + '].'"
                  @remove="actions.removeField"
                  @update="actions.setProperty"
                >
                  <template #id="{ value, path }">
                    <SchemaScalarInput
                      :field="{ ...SHIP_SLOT_FIELDS[0]!, key: path }"
                      :value="value"
                      :input-key="path"
                      :validate="view.validateSlotId"
                      @update="$event.kind === 'set' && actions.setProperty(path, $event.value as string)"
                    />
                  </template>
                </SpecFieldList>
                <div v-if="view.mode === 'launchBay'" class="port-rows ui-layout-grid">
                  <div class="port-list-header coordinate-list-header ui-layout-grid ui-text-meta ui-text-muted">
                    <span>起降口</span><span>X</span><span>Y</span><span>操作</span>
                  </div>
                  <div
                    v-for="(port, index) in view.selectedBayPorts"
                    :key="index"
                    class="port-row coordinate-row ui-layout-grid ui-layout-center ui-control-pointer"
                    :data-inspector-target="'launchBay-' + view.selected + '-port-' + index"
                    :class="{ selected: view.selectedPort === index }"
                    @click="actions.selectBayPort(index)"
                  >
                    <small class="ui-text-meta ui-text-muted">{{ index + 1 }}</small>
                    <NumberValueInput
                      :value="port[0]"
                      :label="'起降口 ' + (index + 1) + ' X'"
                      clear-action="required"
                      :show-button="false"
                      size="small"
                      @update:value="actions.setBayPortCoord(index, 0, $event)"
                      @click.stop
                    />
                    <NumberValueInput
                      :value="port[1]"
                      :label="'起降口 ' + (index + 1) + ' Y'"
                      clear-action="required"
                      :show-button="false"
                      size="small"
                      @update:value="actions.setBayPortCoord(index, 1, $event)"
                      @click.stop
                    />
                    <n-button size="small" @click.stop="actions.removeBayPortAt(index)">删除</n-button>
                  </div>
                </div>
              </div>
              <div class="action-group">
                <n-button @click="section.name === 'weapons' ? actions.addWeaponSlot() : actions.addLaunchBay()">添加</n-button>
                <n-button
                  v-if="section.name === 'launchBays'"
                  :disabled="view.mode !== 'launchBay' || !view.selectedSlot"
                  @click="actions.addBayPortFromPanel"
                  >添加起降口</n-button
                >
                <n-button
                  :disabled="!view.selectedSlot || view.mode !== (section.name === 'weapons' ? 'weapon' : 'launchBay')"
                  @click="actions.deleteSelected(section.name === 'weapons' ? 'weapon' : 'launchBay')"
                  >删除</n-button
                >
              </div>
            </template>
            <template v-if="section.name === 'engines'">
              <div class="item-list ui-layout-grid">
                <button
                  v-for="(engine, index) in view.engineSlots"
                  :key="entryKey('engine-slot', engine, index)"
                  class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                  :class="{ selected: view.mode === 'engine' && view.selected === index }"
                  @click="actions.selectInspectorItem('engine', index, 'engine')"
                >
                  引擎 {{ index }} <span class="item-list-label ui-text-muted">{{ engine.width }} × {{ engine.length }}</span>
                </button>
              </div>
              <div
                v-if="view.mode === 'engine' && view.selectedEngine"
                :key="'engine-' + view.selected"
                class="ui-field-stack"
                :data-inspector-target="'engine-' + view.selected"
              >
                <SpecFieldList
                  :content="document"
                  :fields="engineFields"
                  :prefix="'engineSlots[' + view.selected + '].'"
                  @remove="actions.removeField"
                  @update="actions.setProperty"
                />
                <SpecFieldList
                  v-if="view.selectedEngine.style === 'CUSTOM'"
                  :content="document"
                  :fields="SHIP_CUSTOM_ENGINE_FIELDS"
                  :prefix="'engineSlots[' + view.selected + '].'"
                  @remove="actions.removeField"
                  @update="actions.setProperty"
                />
                <FieldHints
                  description="CUSTOM 优先使用 styleId；内联样式支持 PARTICLES 与 QUAD_STRIP。contrailSize 的 128、256 为原版特殊标记。"
                />
              </div>
              <div class="action-group">
                <n-button @click="actions.addEngine">添加</n-button>
                <n-button :disabled="view.mode !== 'engine' || !view.selectedEngine" @click="actions.deleteSelected('engine')"
                  >删除</n-button
                >
                <n-button v-if="view.mode === 'engine' && view.selectedEngine" @click="actions.createInlineStyle">创建内联样式</n-button>
              </div>
            </template>
            <template v-if="section.name === 'bounds'">
              <div class="bounds-list ui-layout-grid">
                <div class="coordinate-list-header ui-layout-grid ui-text-meta ui-text-muted">
                  <span>顶点</span><span>X</span><span>Y</span>
                </div>
                <div
                  v-for="(_, index) in view.boundPairs"
                  :key="index"
                  class="bounds-list-content coordinate-row ui-layout-grid ui-layout-center ui-control-pointer"
                  :class="{ selected: view.mode === 'bounds' && view.selected === index }"
                  :data-inspector-target="'bound-' + index"
                  @click="actions.selectInspectorItem('bounds', index, 'bound')"
                >
                  <small class="ui-text-meta ui-text-muted">{{ index }}</small>
                  <NumberValueInput
                    :value="view.bounds[index * 2]"
                    :label="'边界顶点 ' + index + ' X'"
                    clear-action="required"
                    :show-button="false"
                    size="small"
                    @update:value="actions.setBound(index * 2, $event)"
                  />
                  <NumberValueInput
                    :value="view.bounds[index * 2 + 1]"
                    :label="'边界顶点 ' + index + ' Y'"
                    clear-action="required"
                    :show-button="false"
                    size="small"
                    @update:value="actions.setBound(index * 2 + 1, $event)"
                  />
                </div>
              </div>
              <div class="action-group">
                <n-button @click="actions.addBound">添加</n-button>
                <n-button :disabled="view.mode !== 'bounds' || view.selected === null" @click="actions.deleteSelected('bounds')"
                  >删除</n-button
                >
              </div>
            </template>
            <template v-if="section.name === 'builtins'">
              <FieldRow label="内置武器" field-key="builtInWeapons" layout="group"
                ><SchemaValueInput
                  :field="view.builtInWeaponsSchema"
                  :value="document.builtInWeapons"
                  :runtime-context="schemaRuntime"
                  @update="$event.kind === 'set' && actions.builtInWeaponsUpdated($event.value as RowData)"
                />
                <template #hint><FieldHints description="类型为 BUILT_IN 的武器槽会在此处显示对应的内置武器配置项。" /></template>
              </FieldRow>
              <SpecFieldList
                :content="document"
                :fields="SHIP_BUILTIN_FIELDS"
                @remove="actions.removeField"
                @update="actions.setProperty"
              />
            </template>
          </n-collapse-item>
        </n-collapse>
      </EditorInspector>
    </div>
    <EditorFooter :note="view.footerNote" />
  </div>
</template>
<script setup lang="ts">
import { computed, inject, useTemplateRef } from 'vue';
import type { RowData } from '@/shared/types';
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import SchemaScalarInput from '@/app/components/schema/SchemaScalarInput.vue';
import SpecFieldList from '../SpecFieldList.vue';
import SpecProblems from '../SpecProblems.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import { str } from '@/shared/lib/starsector';
import { entryKey } from '@/shared/lib/entry-keys';
import {
  SHIP_SECTIONS,
  SHIP_SLOT_FIELDS,
  SHIP_ENGINE_FIELDS,
  SHIP_CUSTOM_ENGINE_FIELDS,
  SHIP_BUILTIN_FIELDS,
} from '@/domain/spec-editor/ship/spec-ship-fields';
import { specSchemaContext } from '@/app/composables/spec-editor/spec-schema-context';
import {
  useSpecShipEditorViewModel,
  type SpecShipEditorProps,
  type SpecShipEditorEvents,
} from '@/app/composables/spec-editor/ship/use-spec-ship-editor-view-model';
const props = defineProps<SpecShipEditorProps>();
const emit = defineEmits<SpecShipEditorEvents>();
const schemaRuntime = inject(specSchemaContext, null);
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const { document, view, actions, canvas } = useSpecShipEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
const weaponSlotFields = SHIP_SLOT_FIELDS.map((field) =>
  field.key === 'type' ? { ...field, options: field.options!.filter((type) => type !== 'LAUNCH_BAY') } : field,
);
const engineFields = computed(() =>
  SHIP_ENGINE_FIELDS.map((field) =>
    field.key === 'style' ? { ...field, options: [...new Set([...view.engineStyles, 'CUSTOM'])] } : field,
  ),
);
</script>
