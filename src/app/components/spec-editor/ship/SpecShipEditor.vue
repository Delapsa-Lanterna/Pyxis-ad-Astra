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
        <n-button :aria-pressed="view.mirror" @click="actions.toggleMirror">镜像编辑</n-button>
        <n-button @click="actions.fitView">适应视图</n-button>
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
        <section
          v-if="view.weaponDiagnostics.length"
          class="editor-resource-diagnostics ui-layout-grid ui-text-wrap ui-text-small"
          role="status"
          aria-label="内置武器预览"
        >
          <strong class="ui-emphasis">内置武器预览</strong>
          <div v-for="diagnostic in view.weaponDiagnostics" :key="diagnostic">{{ diagnostic }}</div>
        </section>
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
              :image-fields="['spriteName']"
              @update="actions.setProperty"
              @browse="actions.pickShipSprite"
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
                  :fields="section.name === 'weapons' ? SHIP_SLOT_FIELDS : SHIP_SLOT_FIELDS.slice(0, 1)"
                  :prefix="'weaponSlots[' + view.selected + '].'"
                  @update="actions.setProperty"
                />
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
                <FieldRow label="槽位扩展字段" field-key="weaponSlots" :path="'weaponSlots[' + view.selected + ']'" layout="group">
                  <JsonValueInput
                    :value="view.slotExtras"
                    :label="'slot-extra-' + view.selected"
                    shape="object"
                    @update="actions.slotExtrasUpdated"
                  />
                </FieldRow>
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
                  @update="actions.setProperty"
                />
                <SpecFieldList
                  v-if="view.selectedEngine.style === 'CUSTOM'"
                  :content="document"
                  :fields="[
                    ['styleId', '命名样式 ID', '', view.engineStyles],
                    ['styleSpec', '内联样式', {}],
                  ]"
                  :prefix="'engineSlots[' + view.selected + '].'"
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
                ><JsonValueInput
                  :value="document.builtInWeapons"
                  label="builtInWeapons"
                  shape="object"
                  @update="actions.builtInWeaponsUpdated"
              /></FieldRow>
              <FieldRow label="内置插件" field-key="builtInMods"><n-dynamic-tags v-model:value="view.builtInMods" /></FieldRow>
              <FieldRow label="内置战机联队" field-key="builtInWings"><n-dynamic-tags v-model:value="view.builtInWings" /></FieldRow>
            </template>
            <JsonFieldEditor
              v-if="section.name === 'extra'"
              :model-value="document"
              :known-keys="SHIP_KNOWN_KEYS"
              @update:model-value="actions.extrasUpdated"
            />
          </n-collapse-item>
        </n-collapse>
      </EditorInspector>
    </div>
    <EditorFooter :note="view.footerNote" />
  </div>
</template>
<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import type { SpecField } from '@/domain/editors/spec-construction';
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import JsonFieldEditor from '@/shared/ui/JsonFieldEditor.vue';
import SpecFieldList from '../SpecFieldList.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import { str } from '@/shared/lib/starsector';
import { entryKey } from '@/shared/lib/entry-keys';
import { SHIP_SECTIONS, SHIP_SLOT_FIELDS, SHIP_ENGINE_FIELDS, SHIP_KNOWN_KEYS } from '@/domain/spec-editor/ship/spec-ship-fields';
import {
  useSpecShipEditorViewModel,
  type SpecShipEditorProps,
  type SpecShipEditorEvents,
} from '@/app/composables/spec-editor/ship/use-spec-ship-editor-view-model';
const props = defineProps<SpecShipEditorProps>();
const emit = defineEmits<SpecShipEditorEvents>();
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const { document, view, actions, canvas } = useSpecShipEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
const engineFields = computed(() =>
  SHIP_ENGINE_FIELDS.map((field) =>
    field[0] === 'style' ? ([field[0], field[1], '', [...new Set([...view.engineStyles, 'CUSTOM'])], true] as SpecField) : field,
  ),
);
</script>
