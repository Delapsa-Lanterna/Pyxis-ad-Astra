<template>
  <div class="modal-backdrop">
    <div ref="editorWindowRef" class="editor-window" tabindex="-1">
      <EditorHeader
        title="舰船编辑器"
        :subtitle="str(localShip.hullName) || hullId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      >
        <div class="ship-mode-controls">
          <div class="segmented ship-mode-tabs">
            <button v-for="m in modes" :key="m.value" :class="{ active: mode === m.value }" @click="runAction(() => setMode(m.value))">
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
            @mousedown="onDown"
            @mousemove="onMove"
            @mouseup="onUp"
            @mouseleave="onLeave"
            @wheel.prevent="onWheel"
            @contextmenu.prevent
          />
        </div>
        <EditorInspector title="舰船检查器" @focusin.capture="beginField" @focusout.capture="fieldBlur" @keyup.capture="fieldKey">
          <n-collapse
            v-model:expanded-names="expandedSections"
            :theme-overrides="editorCollapseTheme"
            @update:expanded-names="onExpandedSectionsUpdate"
          >
            <n-collapse-item title="船体属性" name="basic">
              <div class="form-grid">
                <label>hullId</label><n-input :value="localShip.hullId" @update:value="setField('hullId', $event)" /> <label>hullName</label
                ><n-input :value="localShip.hullName" @update:value="setField('hullName', $event)" /> <label>hullSize</label
                ><n-select
                  :value="localShip.hullSize"
                  :options="toOptions(['FRIGATE', 'DESTROYER', 'CRUISER', 'CAPITAL_SHIP', 'FIGHTER'])"
                  @update:value="setField('hullSize', $event)"
                />
                <label>style</label
                ><n-select
                  :value="localShip.style"
                  filterable
                  tag
                  :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                  @update:value="setField('style', $event)"
                />
                <label>width</label><NumberValueInput :value="localShip.width" @update:value="setVisualField('width', $event)" />
                <label>height</label><NumberValueInput :value="localShip.height" @update:value="setVisualField('height', $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="贴图" name="sprite">
              <div class="form-grid">
                <label>spriteName</label>
                <div class="sprite-field-row">
                  <n-input :value="localShip.spriteName" @update:value="setField('spriteName', $event)" @change="loadSprite" />
                  <n-button
                    class="sprite-icon-button"
                    tertiary
                    title="浏览贴图（引用 Mod 内文件）"
                    aria-label="浏览贴图"
                    @click="runAction(pickShipSprite)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M4 19V5h6l2 2h8v12H4z" />
                      <path d="M8 14h8M12 10v8" />
                    </svg>
                  </n-button>
                </div>
                <label>sprite width</label><NumberValueInput :value="spriteSize.width || null" disabled /> <label>sprite height</label
                ><NumberValueInput :value="spriteSize.height || null" disabled />
              </div>
              <div class="sprite-actions">
                <n-button :disabled="!canSyncSpriteSize" @click="runAction(syncSpriteSize)">更新贴图宽高</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="中心与护盾" name="props">
              <div class="form-grid">
                <label data-inspector-field="center-x">center X</label
                ><NumberValueInput :value="center[0]" @update:value="setArray('center', 0, $event)" />
                <label data-inspector-field="center-y">center Y</label
                ><NumberValueInput :value="center[1]" @update:value="setArray('center', 1, $event)" /> <label>collisionRadius</label
                ><NumberValueInput :value="localShip.collisionRadius" @update:value="setVisualField('collisionRadius', $event)" />
                <label data-inspector-field="shield-x">shield X</label
                ><NumberValueInput :value="shieldCenter[0]" @update:value="setArray('shieldCenter', 0, $event)" />
                <label data-inspector-field="shield-y">shield Y</label
                ><NumberValueInput :value="shieldCenter[1]" @update:value="setArray('shieldCenter', 1, $event)" />
                <label>shieldRadius</label
                ><NumberValueInput :value="localShip.shieldRadius" @update:value="setVisualField('shieldRadius', $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="武器槽" name="weapons">
              <div class="item-list">
                <button
                  v-for="item in normalWeaponSlots"
                  :key="item.index"
                  :data-inspector-target="`weapon-${item.index}`"
                  :class="{ selected: mode === 'weapon' && selected === item.index }"
                  @click="runAction(() => selectInspectorItem('weapon', item.index, 'weapon'))"
                >
                  {{ item.slot.id || `slot ${item.index}` }} <span>{{ item.slot.size }} {{ item.slot.type }}</span>
                </button>
              </div>
              <div v-if="mode === 'weapon' && selectedSlot" class="form-grid">
                <label>id</label><n-input :value="selectedSlot.id" @update:value="setSlotField('id', $event)" /> <label>size</label
                ><n-select
                  :value="selectedSlot.size"
                  :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                  @update:value="setSlotField('size', $event)"
                />
                <label>type</label
                ><n-select
                  :value="selectedSlot.type"
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
                  @update:value="setSlotField('type', $event)"
                />
                <label>mount</label
                ><n-select
                  :value="selectedSlot.mount"
                  :options="toOptions(['TURRET', 'HARDPOINT', 'HIDDEN'])"
                  @update:value="setSlotField('mount', $event)"
                />
                <label>angle</label><NumberValueInput :value="selectedSlot.angle" @update:value="setSlotField('angle', $event)" />
                <label>arc</label><NumberValueInput :value="selectedSlot.arc" @update:value="setSlotField('arc', $event)" />
                <label>loc X</label><NumberValueInput :value="slotLoc[0]" @update:value="setSlotLoc(0, $event)" /> <label>loc Y</label
                ><NumberValueInput :value="slotLoc[1]" @update:value="setSlotLoc(1, $event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="runAction(addWeaponSlot)">添加</n-button
                ><n-button type="error" ghost @click="runAction(deleteSelected)">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="甲板" name="launchBays">
              <div class="item-list">
                <button
                  v-for="item in launchBaySlots"
                  :key="item.index"
                  :data-inspector-target="`launchBay-${item.index}`"
                  :class="{ selected: mode === 'launchBay' && selected === item.index }"
                  @click="runAction(() => selectInspectorItem('launchBay', item.index, 'weapon'))"
                >
                  {{ item.slot.id || `LB ${item.index + 1}` }} <span>甲板 · {{ bayPorts(item.slot.locations).length }}</span>
                </button>
              </div>
              <div v-if="mode === 'launchBay' && selectedSlot" class="form-grid">
                <label>id</label><n-input :value="selectedSlot.id" @update:value="setSlotField('id', $event)" />
              </div>
              <div v-if="mode === 'launchBay' && selectedSlot" class="port-rows">
                <div
                  v-for="(port, portIndex) in selectedBayPorts"
                  :key="portIndex"
                  class="port-row"
                  :class="{ selected: portIndex === selectedPort }"
                  @click="runAction(() => selectBayPort(portIndex))"
                >
                  <span>P{{ portIndex + 1 }}</span>
                  <NumberValueInput size="small" :value="port[0]" @update:value="setBayPortCoord(portIndex, 0, $event)" @click.stop />
                  <NumberValueInput size="small" :value="port[1]" @update:value="setBayPortCoord(portIndex, 1, $event)" @click.stop />
                  <n-button size="tiny" quaternary type="error" @click.stop="runAction(() => removeBayPortAt(portIndex))">删</n-button>
                </div>
              </div>
              <div class="action-row button-row">
                <n-button :disabled="!selectedSlot" @click="runAction(addBayPortFromPanel)">添加港口</n-button>
                <n-button @click="runAction(addLaunchBay)">添加</n-button
                ><n-button type="error" ghost @click="runAction(deleteSelected)">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="引擎" name="engines">
              <div class="item-list">
                <button
                  v-for="(eng, i) in engineSlots"
                  :key="entryKey('engine-slot', eng, i)"
                  :data-inspector-target="`engine-${i}`"
                  :class="{ selected: mode === 'engine' && selected === i }"
                  @click="runAction(() => selectInspectorItem('engine', i, 'engine'))"
                >
                  引擎 {{ i }} <span>{{ eng.width }}x{{ eng.length }}</span>
                </button>
              </div>
              <div v-if="mode === 'engine' && selectedEngine" class="form-grid">
                <label>angle</label><NumberValueInput :value="selectedEngine.angle" @update:value="setEngineField('angle', $event)" />
                <label>width</label><NumberValueInput :value="selectedEngine.width" @update:value="setEngineField('width', $event)" />
                <label>length</label><NumberValueInput :value="selectedEngine.length" @update:value="setEngineField('length', $event)" />
                <label>contrailSize</label
                ><NumberValueInput :value="selectedEngine.contrailSize" @update:value="setEngineField('contrailSize', $event)" />
                <label>style</label
                ><n-select
                  :value="selectedEngine.style"
                  filterable
                  tag
                  :options="toOptions(['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'])"
                  @update:value="setEngineField('style', $event)"
                />
                <label>loc X</label><NumberValueInput :value="engineLoc[0]" @update:value="setEngineLoc(0, $event)" /> <label>loc Y</label
                ><NumberValueInput :value="engineLoc[1]" @update:value="setEngineLoc(1, $event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="runAction(addEngine)">添加</n-button
                ><n-button type="error" ghost @click="runAction(deleteSelected)">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="碰撞边界" name="bounds">
              <div class="bounds-list">
                <div
                  v-for="(_, i) in boundPairs"
                  :key="`bound-${i}`"
                  :data-inspector-target="`bound-${i}`"
                  :class="{ selected: mode === 'bounds' && selected === i }"
                  @click="runAction(() => selectInspectorItem('bounds', i, 'bound'))"
                >
                  <span>{{ i }}</span>
                  <NumberValueInput :value="bounds[i * 2]" @update:value="setBound(i * 2, $event)" />
                  <NumberValueInput :value="bounds[i * 2 + 1]" @update:value="setBound(i * 2 + 1, $event)" />
                </div>
              </div>
              <div class="action-row button-row">
                <n-button @click="runAction(addBound)">添加点</n-button
                ><n-button type="error" ghost @click="runAction(deleteSelected)">删除点</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="高级属性" name="advanced">
              <div class="form-grid">
                <label>viewOffset</label><n-input :value="localShip.viewOffset" @update:value="setField('viewOffset', $event)" />
                <label>coversColor</label
                ><n-input
                  :value="localShip.coversColor"
                  placeholder="R,G,B,A (如 255,255,255,255)"
                  @update:value="setField('coversColor', $event)"
                />
                <label>moduleAnchor X</label
                ><NumberValueInput :value="moduleAnchor[0]" @update:value="setArray('moduleAnchor', 0, $event)" />
                <label>moduleAnchor Y</label
                ><NumberValueInput :value="moduleAnchor[1]" @update:value="setArray('moduleAnchor', 1, $event)" />
              </div>
            </n-collapse-item>
            <n-collapse-item title="内置装备" name="builtins">
              <JsonValueInput :value="localShip.builtInWeapons" label="builtInWeapons" shape="object" @update="builtInWeaponsUpdated" />
              <label>builtInMods</label><n-dynamic-tags v-model:value="builtInMods" /> <label>builtInWings</label
              ><n-dynamic-tags v-model:value="builtInWings" />
            </n-collapse-item>
          </n-collapse>
        </EditorInspector>
      </div>
      <EditorFooter :note="footerNote">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
          <n-button type="primary" :disabled="!canSave" :loading="saving" @click="save">保存</n-button>
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
const {
  localShip,
  mode,
  selectedPort,
  selectBayPort,
  expandedSections,
  spriteSize,
  selected,
  onDown,
  onExpandedSectionsUpdate,
  onLeave,
  onMove,
  onUp,
  onWheel,
  runAction,
  beginField,
  fieldBlur,
  fieldKey,
  modes,
  footerNote,
  normalWeaponSlots,
  launchBaySlots,
  engineSlots,
  bounds,
  boundPairs,
  center,
  shieldCenter,
  moduleAnchor,
  selectedSlot,
  selectedEngine,
  slotLoc,
  selectedBayPorts,
  engineLoc,
  builtInMods,
  builtInWings,
  setMode,
  loadSprite,
  canSyncSpriteSize,
  syncSpriteSize,
  setField,
  setVisualField,
  setSlotField,
  setEngineField,
  setArray,
  setSlotLoc,
  setBayPortCoord,
  removeBayPortAt,
  addBayPortFromPanel,
  setEngineLoc,
  setBound,
  selectInspectorItem,
  addWeaponSlot,
  addLaunchBay,
  addEngine,
  addBound,
  deleteSelected,
  builtInWeaponsUpdated,
  pickShipSprite,
  save,
} = useShipEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
</script>
