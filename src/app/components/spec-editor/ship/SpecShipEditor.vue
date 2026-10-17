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
          <n-collapse-item class="schema-section" title="船体属性" name="basic">
            <div class="form-grid ui-layout-center">
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="hullId" :path="'hullId'" /></label
              ><n-input :value="document.hullId" @update:value="actions.setField('hullId', $event)" />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="hullName" :path="'hullName'" /></label
              ><n-input :value="document.hullName" @update:value="actions.setField('hullName', $event)" />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="hullSize" :path="'hullSize'" /></label
              ><n-select
                :value="document.hullSize"
                :options="toOptions(['FRIGATE', 'DESTROYER', 'CRUISER', 'CAPITAL_SHIP', 'FIGHTER'])"
                @update:value="actions.setField('hullSize', $event)"
              />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="style" :path="'style'" /></label
              ><n-select
                :value="document.style"
                filterable
                tag
                :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                @update:value="actions.setField('style', $event)"
              />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="width" :path="'width'" /></label
              ><NumberValueInput :value="document.width" @update:value="actions.setVisualField('width', $event)" />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="height" :path="'height'" /></label
              ><NumberValueInput :value="document.height" @update:value="actions.setVisualField('height', $event)" />
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="贴图" name="sprite">
            <div class="form-grid ui-layout-center">
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="spriteName" :path="'spriteName'" /></label>
              <div class="sprite-field-row ui-layout-grid ui-layout-center">
                <n-input :value="document.spriteName" @update:value="actions.setField('spriteName', $event)" @change="actions.loadSprite" />
                <n-button
                  class="sprite-icon-button ui-control-reset"
                  tertiary
                  title="浏览贴图（引用 Mod 内文件）"
                  aria-label="浏览贴图"
                  @click="actions.pickShipSprite()"
                >
                  <svg class="sprite-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 19V5h6l2 2h8v12H4z" />
                    <path d="M8 14h8M12 10v8" />
                  </svg>
                </n-button>
              </div>
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="sprite width" /></label
              ><NumberValueInput :value="view.spriteSize.width || null" disabled />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="sprite height" /></label
              ><NumberValueInput :value="view.spriteSize.height || null" disabled />
            </div>
            <div v-if="spriteError" class="editor-resource-diagnostics ui-layout-grid ui-text-wrap ui-text-small">{{ spriteError }}</div>
            <div class="sprite-actions ui-layout-grid">
              <n-button :disabled="!view.canSyncSpriteSize" @click="actions.syncShipCenter()">更新舰船中心</n-button>
              <n-button :disabled="!view.canSyncSpriteSize" @click="actions.syncSpriteSize()">更新贴图宽高</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="中心与护盾" name="props">
            <div class="form-grid ui-layout-center">
              <label class="form-grid-label field-label-multi" data-inspector-field="center-x"><SpecFieldLabel raw="center X" /></label
              ><NumberValueInput :value="view.center[0]" @update:value="actions.setArray('center', 0, $event)" />
              <label class="form-grid-label field-label-multi" data-inspector-field="center-y"><SpecFieldLabel raw="center Y" /></label
              ><NumberValueInput :value="view.center[1]" @update:value="actions.setArray('center', 1, $event)" />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="collisionRadius" :path="'collisionRadius'" /></label
              ><NumberValueInput :value="document.collisionRadius" @update:value="actions.setVisualField('collisionRadius', $event)" />
              <label class="form-grid-label field-label-multi" data-inspector-field="shield-x"><SpecFieldLabel raw="shield X" /></label
              ><NumberValueInput :value="view.shieldCenter[0]" @update:value="actions.setArray('shieldCenter', 0, $event)" />
              <label class="form-grid-label field-label-multi" data-inspector-field="shield-y"><SpecFieldLabel raw="shield Y" /></label
              ><NumberValueInput :value="view.shieldCenter[1]" @update:value="actions.setArray('shieldCenter', 1, $event)" />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="shieldRadius" :path="'shieldRadius'" /></label
              ><NumberValueInput :value="document.shieldRadius" @update:value="actions.setVisualField('shieldRadius', $event)" />
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="武器槽" name="weapons">
            <div v-if="view.normalWeaponSlots.length" class="item-list ui-layout-grid">
              <button
                class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                v-for="item in view.normalWeaponSlots"
                :key="item.index"
                :data-inspector-target="`weapon-${item.index}`"
                :class="{ selected: view.mode === 'weapon' && view.selected === item.index }"
                @click="actions.selectInspectorItem('weapon', item.index, 'weapon')"
              >
                {{ item.slot.id || `slot ${item.index}` }}
                <span class="item-list-label ui-text-muted">{{ item.slot.size }} {{ item.slot.type }}</span>
              </button>
            </div>
            <div v-if="view.mode === 'weapon' && view.selectedSlot" class="form-grid ui-layout-center">
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="id" :path="`weaponSlots[${view.selected}].id`" /></label
              ><n-input :value="view.selectedSlot.id" @update:value="actions.setSlotField('id', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="size" :path="`weaponSlots[${view.selected}].size`" /></label
              ><n-select
                :value="view.selectedSlot.size"
                :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                @update:value="actions.setSlotField('size', $event)"
              />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="type" :path="`weaponSlots[${view.selected}].type`" /></label
              ><n-select
                :value="view.selectedSlot.type"
                :options="
                  toOptions([
                    'BALLISTIC',
                    'ENERGY',
                    'MISSILE',
                    'HYBRID',
                    'UNIVERSAL',
                    'SYNERGY',
                    'COMPOSITE',
                    'BUILT_IN',
                    'DECORATIVE',
                    'SYSTEM',
                    'STATION_MODULE',
                  ])
                "
                @update:value="actions.setSlotField('type', $event)"
              />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="mount" :path="`weaponSlots[${view.selected}].mount`" /></label
              ><n-select
                :value="view.selectedSlot.mount"
                :options="toOptions(['TURRET', 'HARDPOINT', 'HIDDEN'])"
                @update:value="actions.setSlotField('mount', $event)"
              />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="angle" :path="`weaponSlots[${view.selected}].angle`" /></label
              ><NumberValueInput :value="view.selectedSlot.angle" @update:value="actions.setSlotField('angle', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="arc" :path="`weaponSlots[${view.selected}].arc`" /></label
              ><NumberValueInput :value="view.selectedSlot.arc" @update:value="actions.setSlotField('arc', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="renderOrderMod" :path="`weaponSlots[${view.selected}].renderOrderMod`" /></label
              ><NumberValueInput :value="view.selectedSlot.renderOrderMod" @update:value="actions.setSlotField('renderOrderMod', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="loc X" :path="`weaponSlots[${view.selected}].locations[0]`" /></label
              ><NumberValueInput :value="view.slotLoc[0]" @update:value="actions.setSlotLoc(0, $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="loc Y" :path="`weaponSlots[${view.selected}].locations[1]`" /></label
              ><NumberValueInput :value="view.slotLoc[1]" @update:value="actions.setSlotLoc(1, $event)" />
            </div>
            <div class="action-row button-row action-group">
              <n-button @click="actions.addWeaponSlot()">添加</n-button
              ><n-button type="error" ghost @click="actions.deleteSelected()">删除</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="甲板" name="launchBays">
            <div v-if="view.launchBaySlots.length" class="item-list ui-layout-grid">
              <button
                class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                v-for="item in view.launchBaySlots"
                :key="item.index"
                :data-inspector-target="`launchBay-${item.index}`"
                :class="{ selected: view.mode === 'launchBay' && view.selected === item.index }"
                @click="actions.selectInspectorItem('launchBay', item.index, 'weapon')"
              >
                {{ item.slot.id || `LB ${item.index + 1}` }}
                <span class="item-list-label ui-text-muted">甲板 · {{ bayPorts(item.slot.locations).length }}</span>
              </button>
            </div>
            <div v-if="view.mode === 'launchBay' && view.selectedSlot" class="form-grid ui-layout-center">
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="id" :path="`weaponSlots[${view.selected}].id`" /></label
              ><n-input :value="view.selectedSlot.id" @update:value="actions.setSlotField('id', $event)" />
            </div>
            <div v-if="view.mode === 'launchBay' && view.selectedSlot && view.selectedBayPorts.length" class="port-rows ui-layout-grid">
              <div
                v-for="(port, portIndex) in view.selectedBayPorts"
                :key="portIndex"
                class="port-row ui-layout-grid ui-layout-center ui-control-pointer ui-control-border ui-content-surface"
                :class="{ selected: portIndex === view.selectedPort }"
                @click="actions.selectBayPort(portIndex)"
              >
                <span class="port-row-label ui-text-muted ui-text-small">P{{ portIndex + 1 }}</span>
                <NumberValueInput size="small" :value="port[0]" @update:value="actions.setBayPortCoord(portIndex, 0, $event)" @click.stop />
                <NumberValueInput size="small" :value="port[1]" @update:value="actions.setBayPortCoord(portIndex, 1, $event)" @click.stop />
                <n-button size="tiny" quaternary type="error" @click.stop="actions.removeBayPortAt(portIndex)">删</n-button>
              </div>
            </div>
            <div class="action-row button-row action-group">
              <n-button :disabled="!view.selectedSlot" @click="actions.addBayPortFromPanel()">添加港口</n-button>
              <n-button @click="actions.addLaunchBay()">添加</n-button
              ><n-button type="error" ghost @click="actions.deleteSelected()">删除</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="引擎" name="engines">
            <div v-if="view.engineSlots.length" class="item-list ui-layout-grid">
              <button
                class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                v-for="(eng, i) in view.engineSlots"
                :key="entryKey('engine-slot', eng, i)"
                :data-inspector-target="`engine-${i}`"
                :class="{ selected: view.mode === 'engine' && view.selected === i }"
                @click="actions.selectInspectorItem('engine', i, 'engine')"
              >
                引擎 {{ i }} <span class="item-list-label ui-text-muted">{{ eng.width }}x{{ eng.length }}</span>
              </button>
            </div>
            <div v-if="view.mode === 'engine' && view.selectedEngine" class="form-grid ui-layout-center">
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="angle" :path="`engineSlots[${view.selected}].angle`" /></label
              ><NumberValueInput :value="view.selectedEngine.angle" @update:value="actions.setEngineField('angle', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="width" :path="`engineSlots[${view.selected}].width`" /></label
              ><NumberValueInput :value="view.selectedEngine.width" @update:value="actions.setEngineField('width', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="length" :path="`engineSlots[${view.selected}].length`" /></label
              ><NumberValueInput :value="view.selectedEngine.length" @update:value="actions.setEngineField('length', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="contrailSize" :path="`engineSlots[${view.selected}].contrailSize`" /></label
              ><NumberValueInput :value="view.selectedEngine.contrailSize" @update:value="actions.setEngineField('contrailSize', $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="style" :path="`engineSlots[${view.selected}].style`" /></label
              ><n-select
                :value="view.selectedEngine.style"
                filterable
                tag
                :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                @update:value="actions.setEngineField('style', $event)"
              />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="loc X" :path="`engineSlots[${view.selected}].location[0]`" /></label
              ><NumberValueInput :value="view.engineLoc[0]" @update:value="actions.setEngineLoc(0, $event)" />
              <label class="form-grid-label field-label-multi"
                ><SpecFieldLabel raw="loc Y" :path="`engineSlots[${view.selected}].location[1]`" /></label
              ><NumberValueInput :value="view.engineLoc[1]" @update:value="actions.setEngineLoc(1, $event)" />
            </div>
            <div class="action-row button-row action-group">
              <n-button @click="actions.addEngine()">添加</n-button
              ><n-button type="error" ghost @click="actions.deleteSelected()">删除</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="碰撞边界" name="bounds">
            <div v-if="view.boundPairs.length" class="bounds-list ui-layout-grid">
              <div
                class="bounds-list-content ui-content-surface ui-layout-grid ui-layout-center ui-control-border"
                v-for="(_, i) in view.boundPairs"
                :key="`bound-${i}`"
                :data-inspector-target="`bound-${i}`"
                :class="{ selected: view.mode === 'bounds' && view.selected === i }"
                @click="actions.selectInspectorItem('bounds', i, 'bound')"
              >
                <span>{{ i }}</span>
                <NumberValueInput :value="view.bounds[i * 2]" @update:value="actions.setBound(i * 2, $event)" />
                <NumberValueInput :value="view.bounds[i * 2 + 1]" @update:value="actions.setBound(i * 2 + 1, $event)" />
              </div>
            </div>
            <div class="action-row button-row action-group">
              <n-button @click="actions.addBound()">添加点</n-button
              ><n-button type="error" ghost @click="actions.deleteSelected()">删除点</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="高级属性" name="advanced">
            <div class="form-grid ui-layout-center">
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="viewOffset" :path="'viewOffset'" /></label
              ><n-input :value="document.viewOffset" @update:value="actions.setField('viewOffset', $event)" />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="coversColor" :path="'coversColor'" /></label
              ><n-input
                :value="document.coversColor"
                placeholder="R,G,B,A (如 255,255,255,255)"
                @update:value="actions.setField('coversColor', $event)"
              />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="moduleAnchor X" /></label
              ><NumberValueInput :value="view.moduleAnchor[0]" @update:value="actions.setArray('moduleAnchor', 0, $event)" />
              <label class="form-grid-label field-label-multi"><SpecFieldLabel raw="moduleAnchor Y" :path="'moduleAnchor[1]'" /></label
              ><NumberValueInput :value="view.moduleAnchor[1]" @update:value="actions.setArray('moduleAnchor', 1, $event)" />
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="内置装备" name="builtins">
            <JsonValueInput
              :value="document.builtInWeapons"
              label="builtInWeapons"
              shape="object"
              @update="actions.builtInWeaponsUpdated"
            />
            <label><SpecFieldLabel raw="builtInMods" /></label><n-dynamic-tags v-model:value="view.builtInMods" />
            <label><SpecFieldLabel raw="builtInWings" /></label><n-dynamic-tags v-model:value="view.builtInWings" />
          </n-collapse-item>
        </n-collapse>
      </EditorInspector>
    </div>
    <EditorFooter :note="view.footerNote"> </EditorFooter>
  </div>
</template>

<script setup lang="ts">
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import SpecFieldLabel from '@/app/components/editors/common/SpecFieldLabel.vue';
import { useTemplateRef } from 'vue';

import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { str } from '@/shared/lib/starsector/index';
import { entryKey } from '@/shared/lib/entry-keys';
import { bayPorts } from '@/domain/spec-editor/ship/spec-ship-editing';
import { toOptions } from '@/domain/editors/lib/editor-constants';
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
</script>
