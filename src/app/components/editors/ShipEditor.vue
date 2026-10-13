<template>
  <div class="modal-backdrop">
    <div ref="editorWindowRef" class="editor-window" tabindex="-1">
      <EditorHeader
        title="舰船编辑器"
        :subtitle="str(document.hullName) || hullId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      >
        <div class="ship-mode-controls">
          <div class="segmented ship-mode-tabs">
            <button v-for="m in view.modes" :key="m.value" :class="{ active: view.mode === m.value }" @click="actions.setMode(m.value)">
              {{ m.label }} <span class="ship-mode-shortcut">{{ m.shortcut }}</span>
            </button>
          </div>
          <span class="ship-mode-hint">T 打开右侧</span>
        </div>
      </EditorHeader>
      <div class="editor-body">
        <div ref="stageRef" class="canvas-stage">
          <canvas
            ref="canvasRef"
            class="editor-canvas"
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
          <section v-if="view.weaponDiagnostics.length" class="editor-resource-diagnostics" role="status" aria-label="内置武器预览">
            <strong>内置武器预览</strong>
            <div v-for="diagnostic in view.weaponDiagnostics" :key="diagnostic">{{ diagnostic }}</div>
          </section>
          <n-collapse
            v-model:expanded-names="view.expandedSections"
            :theme-overrides="editorCollapseTheme"
            @update:expanded-names="canvas.onExpandedSectionsUpdate"
          >
            <n-collapse-item title="船体属性" name="basic">
              <div class="form-grid">
                <label>hullId</label><n-input :value="document.hullId" @update:value="actions.setField('hullId', $event)" />
                <label>hullName</label><n-input :value="document.hullName" @update:value="actions.setField('hullName', $event)" />
                <label>hullSize</label
                ><n-select
                  :value="document.hullSize"
                  :options="toOptions(['FRIGATE', 'DESTROYER', 'CRUISER', 'CAPITAL_SHIP', 'FIGHTER'])"
                  @update:value="actions.setField('hullSize', $event)"
                />
                <label>style</label
                ><n-select
                  :value="document.style"
                  filterable
                  tag
                  :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                  @update:value="actions.setField('style', $event)"
                />
                <label>width</label><NumberValueInput :value="document.width" @update:value="actions.setVisualField('width', $event)" />
                <label>height</label><NumberValueInput :value="document.height" @update:value="actions.setVisualField('height', $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="贴图" name="sprite">
              <div class="form-grid">
                <label>spriteName</label>
                <div class="sprite-field-row">
                  <n-input
                    :value="document.spriteName"
                    @update:value="actions.setField('spriteName', $event)"
                    @change="actions.loadSprite"
                  />
                  <n-button
                    class="sprite-icon-button"
                    tertiary
                    title="浏览贴图（引用 Mod 内文件）"
                    aria-label="浏览贴图"
                    @click="actions.pickShipSprite()"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 19V5h6l2 2h8v12H4z" />
                      <path d="M8 14h8M12 10v8" />
                    </svg>
                  </n-button>
                </div>
                <label>sprite width</label><NumberValueInput :value="view.spriteSize.width || null" disabled /> <label>sprite height</label
                ><NumberValueInput :value="view.spriteSize.height || null" disabled />
              </div>
              <div class="sprite-actions">
                <n-button :disabled="!view.canSyncSpriteSize" @click="actions.syncSpriteSize()">更新贴图宽高</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="中心与护盾" name="props">
              <div class="form-grid">
                <label data-inspector-field="center-x">center X</label
                ><NumberValueInput :value="view.center[0]" @update:value="actions.setArray('center', 0, $event)" />
                <label data-inspector-field="center-y">center Y</label
                ><NumberValueInput :value="view.center[1]" @update:value="actions.setArray('center', 1, $event)" />
                <label>collisionRadius</label
                ><NumberValueInput :value="document.collisionRadius" @update:value="actions.setVisualField('collisionRadius', $event)" />
                <label data-inspector-field="shield-x">shield X</label
                ><NumberValueInput :value="view.shieldCenter[0]" @update:value="actions.setArray('shieldCenter', 0, $event)" />
                <label data-inspector-field="shield-y">shield Y</label
                ><NumberValueInput :value="view.shieldCenter[1]" @update:value="actions.setArray('shieldCenter', 1, $event)" />
                <label>shieldRadius</label
                ><NumberValueInput :value="document.shieldRadius" @update:value="actions.setVisualField('shieldRadius', $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="武器槽" name="weapons">
              <div class="item-list">
                <button
                  v-for="item in view.normalWeaponSlots"
                  :key="item.index"
                  :data-inspector-target="`weapon-${item.index}`"
                  :class="{ selected: view.mode === 'weapon' && view.selected === item.index }"
                  @click="actions.selectInspectorItem('weapon', item.index, 'weapon')"
                >
                  {{ item.slot.id || `slot ${item.index}` }} <span>{{ item.slot.size }} {{ item.slot.type }}</span>
                </button>
              </div>
              <div v-if="view.mode === 'weapon' && view.selectedSlot" class="form-grid">
                <label>id</label><n-input :value="view.selectedSlot.id" @update:value="actions.setSlotField('id', $event)" />
                <label>size</label
                ><n-select
                  :value="view.selectedSlot.size"
                  :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                  @update:value="actions.setSlotField('size', $event)"
                />
                <label>type</label
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
                <label>mount</label
                ><n-select
                  :value="view.selectedSlot.mount"
                  :options="toOptions(['TURRET', 'HARDPOINT', 'HIDDEN'])"
                  @update:value="actions.setSlotField('mount', $event)"
                />
                <label>angle</label
                ><NumberValueInput :value="view.selectedSlot.angle" @update:value="actions.setSlotField('angle', $event)" />
                <label>arc</label><NumberValueInput :value="view.selectedSlot.arc" @update:value="actions.setSlotField('arc', $event)" />
                <label>renderOrderMod</label
                ><NumberValueInput
                  :value="view.selectedSlot.renderOrderMod"
                  @update:value="actions.setSlotField('renderOrderMod', $event)"
                />
                <label>loc X</label><NumberValueInput :value="view.slotLoc[0]" @update:value="actions.setSlotLoc(0, $event)" />
                <label>loc Y</label><NumberValueInput :value="view.slotLoc[1]" @update:value="actions.setSlotLoc(1, $event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="actions.addWeaponSlot()">添加</n-button
                ><n-button type="error" ghost @click="actions.deleteSelected()">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="甲板" name="launchBays">
              <div class="item-list">
                <button
                  v-for="item in view.launchBaySlots"
                  :key="item.index"
                  :data-inspector-target="`launchBay-${item.index}`"
                  :class="{ selected: view.mode === 'launchBay' && view.selected === item.index }"
                  @click="actions.selectInspectorItem('launchBay', item.index, 'weapon')"
                >
                  {{ item.slot.id || `LB ${item.index + 1}` }} <span>甲板 · {{ bayPorts(item.slot.locations).length }}</span>
                </button>
              </div>
              <div v-if="view.mode === 'launchBay' && view.selectedSlot" class="form-grid">
                <label>id</label><n-input :value="view.selectedSlot.id" @update:value="actions.setSlotField('id', $event)" />
              </div>
              <div v-if="view.mode === 'launchBay' && view.selectedSlot" class="port-rows">
                <div
                  v-for="(port, portIndex) in view.selectedBayPorts"
                  :key="portIndex"
                  class="port-row"
                  :class="{ selected: portIndex === view.selectedPort }"
                  @click="actions.selectBayPort(portIndex)"
                >
                  <span>P{{ portIndex + 1 }}</span>
                  <NumberValueInput
                    size="small"
                    :value="port[0]"
                    @update:value="actions.setBayPortCoord(portIndex, 0, $event)"
                    @click.stop
                  />
                  <NumberValueInput
                    size="small"
                    :value="port[1]"
                    @update:value="actions.setBayPortCoord(portIndex, 1, $event)"
                    @click.stop
                  />
                  <n-button size="tiny" quaternary type="error" @click.stop="actions.removeBayPortAt(portIndex)">删</n-button>
                </div>
              </div>
              <div class="action-row button-row">
                <n-button :disabled="!view.selectedSlot" @click="actions.addBayPortFromPanel()">添加港口</n-button>
                <n-button @click="actions.addLaunchBay()">添加</n-button
                ><n-button type="error" ghost @click="actions.deleteSelected()">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="引擎" name="engines">
              <div class="item-list">
                <button
                  v-for="(eng, i) in view.engineSlots"
                  :key="entryKey('engine-slot', eng, i)"
                  :data-inspector-target="`engine-${i}`"
                  :class="{ selected: view.mode === 'engine' && view.selected === i }"
                  @click="actions.selectInspectorItem('engine', i, 'engine')"
                >
                  引擎 {{ i }} <span>{{ eng.width }}x{{ eng.length }}</span>
                </button>
              </div>
              <div v-if="view.mode === 'engine' && view.selectedEngine" class="form-grid">
                <label>angle</label
                ><NumberValueInput :value="view.selectedEngine.angle" @update:value="actions.setEngineField('angle', $event)" />
                <label>width</label
                ><NumberValueInput :value="view.selectedEngine.width" @update:value="actions.setEngineField('width', $event)" />
                <label>length</label
                ><NumberValueInput :value="view.selectedEngine.length" @update:value="actions.setEngineField('length', $event)" />
                <label>contrailSize</label
                ><NumberValueInput
                  :value="view.selectedEngine.contrailSize"
                  @update:value="actions.setEngineField('contrailSize', $event)"
                />
                <label>style</label
                ><n-select
                  :value="view.selectedEngine.style"
                  filterable
                  tag
                  :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                  @update:value="actions.setEngineField('style', $event)"
                />
                <label>loc X</label><NumberValueInput :value="view.engineLoc[0]" @update:value="actions.setEngineLoc(0, $event)" />
                <label>loc Y</label><NumberValueInput :value="view.engineLoc[1]" @update:value="actions.setEngineLoc(1, $event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="actions.addEngine()">添加</n-button
                ><n-button type="error" ghost @click="actions.deleteSelected()">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="碰撞边界" name="bounds">
              <div class="bounds-list">
                <div
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
              <div class="action-row button-row">
                <n-button @click="actions.addBound()">添加点</n-button
                ><n-button type="error" ghost @click="actions.deleteSelected()">删除点</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="高级属性" name="advanced">
              <div class="form-grid">
                <label>viewOffset</label><n-input :value="document.viewOffset" @update:value="actions.setField('viewOffset', $event)" />
                <label>coversColor</label
                ><n-input
                  :value="document.coversColor"
                  placeholder="R,G,B,A (如 255,255,255,255)"
                  @update:value="actions.setField('coversColor', $event)"
                />
                <label>moduleAnchor X</label
                ><NumberValueInput :value="view.moduleAnchor[0]" @update:value="actions.setArray('moduleAnchor', 0, $event)" />
                <label>moduleAnchor Y</label
                ><NumberValueInput :value="view.moduleAnchor[1]" @update:value="actions.setArray('moduleAnchor', 1, $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="内置装备" name="builtins">
              <JsonValueInput
                :value="document.builtInWeapons"
                label="builtInWeapons"
                shape="object"
                @update="actions.builtInWeaponsUpdated"
              />
              <label>builtInMods</label><n-dynamic-tags v-model:value="view.builtInMods" /> <label>builtInWings</label
              ><n-dynamic-tags v-model:value="view.builtInWings" />
            </n-collapse-item>
          </n-collapse>
        </EditorInspector>
      </div>
      <EditorFooter :note="view.footerNote">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
          <n-button type="primary" :disabled="!canSave" :loading="saving" @click="actions.save">保存</n-button>
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
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { str } from '@/shared/lib/starsector';
import { entryKey } from '@/shared/lib/entry-keys';
import { bayPorts } from '@/domain/editors/lib/ship-slots';
import { editorCollapseTheme, toOptions } from '@/domain/editors/lib/editor-constants';
import { useShipEditorViewModel, type ShipEditorProps, type ShipEditorEvents } from '@/app/composables/editors/use-ship-editor-view-model';

const props = defineProps<ShipEditorProps>();
const emit = defineEmits<ShipEditorEvents>();
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const { document, view, actions, canvas } = useShipEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
</script>
