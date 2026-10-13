<template>
  <div class="modal-backdrop">
    <div ref="editorWindowRef" class="editor-window" tabindex="-1">
      <EditorHeader
        title="武器编辑器"
        :subtitle="weaponId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      >
        <div class="ship-mode-controls">
          <div class="segmented ship-mode-tabs">
            <button :class="{ active: viewMode === 'turret' }" @click="runAction(() => setView('turret'))">
              炮塔视图 <span class="ship-mode-shortcut">U</span>
            </button>
            <button :class="{ active: viewMode === 'hardpoint' }" @click="runAction(() => setView('hardpoint'))">
              固定视图 <span class="ship-mode-shortcut">H</span>
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
        <EditorInspector title="武器检查器" @focusin.capture="beginField" @focusout.capture="fieldBlur" @keyup.capture="fieldKey">
          <n-collapse
            v-model:expanded-names="expandedSections"
            :theme-overrides="editorCollapseTheme"
            @update:expanded-names="onExpandedSectionsUpdate"
          >
            <n-collapse-item title="基础属性" name="basic">
              <div class="form-grid">
                <label>id</label><n-input :value="weaponId" disabled /> <label>specClass</label
                ><n-select
                  :value="localWeapon.specClass"
                  :options="toOptions([...WEAPON_SPEC_CLASSES])"
                  @update:value="onSpecClassChange"
                />
                <label>type</label
                ><n-select
                  :value="localWeapon.type"
                  :options="
                    toOptions([
                      'BALLISTIC',
                      'ENERGY',
                      'MISSILE',
                      'HYBRID',
                      'UNIVERSAL',
                      'SYNERGY',
                      'COMPOSITE',
                      'DECORATIVE',
                      'SYSTEM',
                      'BUILT_IN',
                    ])
                  "
                  @update:value="setField('type', $event)"
                />
                <label>size</label
                ><n-select
                  :value="localWeapon.size"
                  :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                  @update:value="setField('size', $event)"
                />
              </div>
              <p>{{ WEAPON_SPEC_CLASS_NOTE }}</p>
            </n-collapse-item>
            <n-collapse-item title="炮塔贴图" name="turretSprites">
              <div class="form-grid">
                <template v-for="field in turretSpriteFields" :key="field">
                  <label>{{ field }}</label>
                  <div class="sprite-field-row">
                    <n-input :value="localWeapon[field]" @update:value="setField(field, $event)" @change="reloadSprites()" />
                    <n-button
                      class="sprite-icon-button"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="runAction(() => pickWeaponSprite(field))"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19V5h6l2 2h8v12H4z" />
                        <path d="M8 14h8M12 10v8" />
                      </svg>
                    </n-button>
                  </div>
                </template>
              </div>
            </n-collapse-item>
            <n-collapse-item title="固定贴图" name="hardpointSprites">
              <div class="form-grid">
                <template v-for="field in hardpointSpriteFields" :key="field">
                  <label>{{ field }}</label>
                  <div class="sprite-field-row">
                    <n-input :value="localWeapon[field]" @update:value="setField(field, $event)" @change="reloadSprites()" />
                    <n-button
                      class="sprite-icon-button"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="runAction(() => pickWeaponSprite(field))"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19V5h6l2 2h8v12H4z" />
                        <path d="M8 14h8M12 10v8" />
                      </svg>
                    </n-button>
                  </div>
                </template>
              </div>
            </n-collapse-item>
            <n-collapse-item title="炮塔发射点" name="turretBarrels">
              <div class="item-list">
                <button
                  v-for="(_, i) in barrelCountFor('turret')"
                  :key="`barrel-turret-${i}`"
                  :data-inspector-target="`turret-barrel-${i}`"
                  :class="{ selected: viewMode === 'turret' && selected === i }"
                  @click="runAction(() => selectBarrel('turret', i))"
                >
                  发射点 {{ i + 1 }}
                  <span>[{{ offsetsFor('turret')[i * 2] }}, {{ offsetsFor('turret')[i * 2 + 1] }}] {{ anglesFor('turret')[i] || 0 }}°</span>
                </button>
              </div>
              <div v-if="viewMode === 'turret' && selected !== null" class="form-grid">
                <label>X</label><NumberValueInput :value="offsets[selected * 2]" @update:value="setOffset(0, $event)" /> <label>Y</label
                ><NumberValueInput :value="offsets[selected * 2 + 1]" @update:value="setOffset(1, $event)" /> <label>角度偏移</label
                ><NumberValueInput :value="angles[selected] || 0" @update:value="setAngle($event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="runAction(() => addBarrelFor('turret'))">添加</n-button
                ><n-button type="error" ghost @click="runAction(() => deleteBarrelFor('turret'))">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="固定发射点" name="hardpointBarrels">
              <div class="item-list">
                <button
                  v-for="(_, i) in barrelCountFor('hardpoint')"
                  :key="`barrel-hardpoint-${i}`"
                  :data-inspector-target="`hardpoint-barrel-${i}`"
                  :class="{ selected: viewMode === 'hardpoint' && selected === i }"
                  @click="runAction(() => selectBarrel('hardpoint', i))"
                >
                  发射点 {{ i + 1 }}
                  <span
                    >[{{ offsetsFor('hardpoint')[i * 2] }}, {{ offsetsFor('hardpoint')[i * 2 + 1] }}]
                    {{ anglesFor('hardpoint')[i] || 0 }}°</span
                  >
                </button>
              </div>
              <div v-if="viewMode === 'hardpoint' && selected !== null" class="form-grid">
                <label>X</label><NumberValueInput :value="offsets[selected * 2]" @update:value="setOffset(0, $event)" /> <label>Y</label
                ><NumberValueInput :value="offsets[selected * 2 + 1]" @update:value="setOffset(1, $event)" /> <label>角度偏移</label
                ><NumberValueInput :value="angles[selected] || 0" @update:value="setAngle($event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="runAction(() => addBarrelFor('hardpoint'))">添加</n-button
                ><n-button type="error" ghost @click="runAction(() => deleteBarrelFor('hardpoint'))">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="发射模式" name="barrelMode">
              <div class="form-grid">
                <label>barrelMode</label
                ><n-select
                  :value="localWeapon.barrelMode"
                  :options="toOptions(['ALTERNATING', 'LINKED'])"
                  @update:value="setField('barrelMode', $event)"
                />
              </div>
            </n-collapse-item>
            <n-collapse-item v-if="showProjectileSections" title="动画" name="anim">
              <div class="form-grid">
                <label>animationType</label
                ><n-select
                  :value="localWeapon.animationType"
                  :options="toOptions(['NONE', 'MUZZLE_FLASH', 'SMOKE', 'GLOW_AND_FLASH', 'GLOW'])"
                  @update:value="setField('animationType', $event)"
                />
                <label>visualRecoil</label
                ><NumberValueInput :value="localWeapon.visualRecoil" @update:value="setField('visualRecoil', $event)" />
              </div>
              <JsonValueInput
                :value="muzzleFlashSpec"
                label="muzzleFlashSpec"
                show-label
                shape="object"
                @update="muzzleFlashSpec = $event"
              />
              <JsonValueInput :value="smokeSpec" label="smokeSpec" show-label shape="object" @update="smokeSpec = $event" />
            </n-collapse-item>
            <n-collapse-item v-if="showProjectileSections" title="弹体" name="proj">
              <div class="form-grid">
                <label>projectileSpecId</label>
                <n-auto-complete v-model:value="projectileSpecId" :options="projectileOptions" />
              </div>
              <div class="action-row button-row">
                <n-button @click="$emit('edit-projectile', projectileSpecId)">编辑弹体</n-button>
                <n-button tertiary @click="$emit('preview', weaponId)">发射预览</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item v-if="showBeamSection" title="光束" name="beam">
              <ColorPicker label="fringeColor" v-model="fringeColor" />
              <ColorPicker label="coreColor" v-model="coreColor" />
              <ColorPicker label="glowColor" v-model="glowColor" />
              <div class="form-grid">
                <label>width</label><NumberValueInput :value="localWeapon.width" @update:value="setField('width', $event)" />
                <label>textureType</label
                ><n-select
                  :options="toOptions(['ROUGH', 'SMOOTH', 'NONE'])"
                  :value="localWeapon.textureType"
                  @update:value="setField('textureType', $event)"
                />
                <label>textureScrollSpeed</label
                ><NumberValueInput :value="localWeapon.textureScrollSpeed" @update:value="setField('textureScrollSpeed', $event)" />
                <label>pixelsPerTexel</label
                ><NumberValueInput :value="localWeapon.pixelsPerTexel" @update:value="setField('pixelsPerTexel', $event)" />
                <label>convergeOnPoint</label
                ><n-checkbox :checked="localWeapon.convergeOnPoint" @update:checked="setField('convergeOnPoint', $event)" />
                <label>darkCore</label><n-checkbox :checked="localWeapon.darkCore" @update:checked="setField('darkCore', $event)" />
              </div>
              <n-button tertiary @click="$emit('preview', weaponId)">预览光束</n-button>
            </n-collapse-item>
            <n-collapse-item title="音效" name="sound">
              <div class="form-grid">
                <label>fireSoundOne</label><n-input :value="localWeapon.fireSoundOne" @update:value="setField('fireSoundOne', $event)" />
                <label>fireSoundTwo</label><n-input :value="localWeapon.fireSoundTwo" @update:value="setField('fireSoundTwo', $event)" />
              </div>
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

import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { WEAPON_SPEC_CLASSES, WEAPON_SPEC_CLASS_NOTE } from '@/domain/editors/spec-construction';
import { editorCollapseTheme, toOptions } from '@/domain/editors/lib/editor-constants';
import {
  useWeaponEditorViewModel,
  type WeaponEditorProps,
  type WeaponEditorEvents,
} from '@/app/composables/editors/use-weapon-editor-view-model';

const props = defineProps<WeaponEditorProps>();
const emit = defineEmits<WeaponEditorEvents>();
const editorWindowRef = useTemplateRef<HTMLElement>('editorWindowRef');
const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const {
  showProjectileSections,
  showBeamSection,
  localWeapon,
  viewMode,
  expandedSections,
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
  turretSpriteFields,
  hardpointSpriteFields,
  footerNote,
  offsets,
  angles,
  projectileSpecId,
  projectileOptions,
  fringeColor,
  coreColor,
  glowColor,
  muzzleFlashSpec,
  smokeSpec,
  setView,
  setField,
  onSpecClassChange,
  selectBarrel,
  offsetsFor,
  anglesFor,
  barrelCountFor,
  setOffset,
  setAngle,
  addBarrelFor,
  deleteBarrelFor,
  pickWeaponSprite,
  save,
  reloadSprites,
} = useWeaponEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
</script>
