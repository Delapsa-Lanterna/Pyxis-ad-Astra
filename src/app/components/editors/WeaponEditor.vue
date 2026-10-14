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
            <button :class="{ active: view.viewMode === 'turret' }" @click="actions.setView('turret')">
              炮塔视图 <span class="ship-mode-shortcut">U</span>
            </button>
            <button :class="{ active: view.viewMode === 'hardpoint' }" @click="actions.setView('hardpoint')">
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
          <n-collapse
            v-model:expanded-names="view.expandedSections"
            :theme-overrides="editorCollapseTheme"
            @update:expanded-names="canvas.onExpandedSectionsUpdate"
          >
            <n-collapse-item title="基础属性" name="basic">
              <div class="form-grid">
                <label>id</label><n-input :value="weaponId" disabled /> <label>specClass</label
                ><n-select
                  :value="document.specClass"
                  :options="toOptions([...WEAPON_SPEC_CLASSES])"
                  @update:value="actions.onSpecClassChange"
                />
                <label>type</label
                ><n-select
                  :value="document.type"
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
                  @update:value="actions.setField('type', $event)"
                />
                <label>size</label
                ><n-select
                  :value="document.size"
                  :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                  @update:value="actions.setField('size', $event)"
                />
              </div>
              <p>{{ WEAPON_SPEC_CLASS_NOTE }}</p>
            </n-collapse-item>
            <n-collapse-item title="炮塔贴图" name="turretSprites">
              <div class="form-grid">
                <template v-for="field in view.turretSpriteFields" :key="field">
                  <label>{{ field }}</label>
                  <div class="sprite-field-row">
                    <n-input :value="document[field]" @update:value="actions.setField(field, $event)" @change="actions.reloadSprites()" />
                    <n-button
                      class="sprite-icon-button"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="actions.pickWeaponSprite(field)"
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
                <template v-for="field in view.hardpointSpriteFields" :key="field">
                  <label>{{ field }}</label>
                  <div class="sprite-field-row">
                    <n-input :value="document[field]" @update:value="actions.setField(field, $event)" @change="actions.reloadSprites()" />
                    <n-button
                      class="sprite-icon-button"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="actions.pickWeaponSprite(field)"
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
            <n-collapse-item title="光效" name="glow">
              <ColorPicker label="glowColor" v-model="view.glowColor" />
              <div class="action-row button-row">
                <n-button
                  :type="view.glowPreviewEnabled ? 'primary' : 'default'"
                  :aria-pressed="view.glowPreviewEnabled"
                  @click="actions.toggleGlowPreview"
                >
                  预览光效
                </n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="炮塔发射点" name="turretBarrels">
              <div class="item-list">
                <button
                  v-for="(_, i) in actions.barrelCountFor('turret')"
                  :key="`barrel-turret-${i}`"
                  :data-inspector-target="`turret-barrel-${i}`"
                  :class="{ selected: view.viewMode === 'turret' && view.selected === i }"
                  @click="actions.selectBarrel('turret', i)"
                >
                  发射点 {{ i + 1 }}
                  <span
                    >[{{ actions.offsetsFor('turret')[i * 2] }}, {{ actions.offsetsFor('turret')[i * 2 + 1] }}]
                    {{ actions.anglesFor('turret')[i] || 0 }}°</span
                  >
                </button>
              </div>
              <div v-if="view.viewMode === 'turret' && view.selected !== null" class="form-grid">
                <label>X</label><NumberValueInput :value="view.offsets[view.selected * 2]" @update:value="actions.setOffset(0, $event)" />
                <label>Y</label
                ><NumberValueInput :value="view.offsets[view.selected * 2 + 1]" @update:value="actions.setOffset(1, $event)" />
                <label>角度偏移</label
                ><NumberValueInput :value="view.angles[view.selected] || 0" @update:value="actions.setAngle($event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="actions.addBarrelFor('turret')">添加</n-button
                ><n-button type="error" ghost @click="actions.deleteBarrelFor('turret')">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="固定发射点" name="hardpointBarrels">
              <div class="item-list">
                <button
                  v-for="(_, i) in actions.barrelCountFor('hardpoint')"
                  :key="`barrel-hardpoint-${i}`"
                  :data-inspector-target="`hardpoint-barrel-${i}`"
                  :class="{ selected: view.viewMode === 'hardpoint' && view.selected === i }"
                  @click="actions.selectBarrel('hardpoint', i)"
                >
                  发射点 {{ i + 1 }}
                  <span
                    >[{{ actions.offsetsFor('hardpoint')[i * 2] }}, {{ actions.offsetsFor('hardpoint')[i * 2 + 1] }}]
                    {{ actions.anglesFor('hardpoint')[i] || 0 }}°</span
                  >
                </button>
              </div>
              <div v-if="view.viewMode === 'hardpoint' && view.selected !== null" class="form-grid">
                <label>X</label><NumberValueInput :value="view.offsets[view.selected * 2]" @update:value="actions.setOffset(0, $event)" />
                <label>Y</label
                ><NumberValueInput :value="view.offsets[view.selected * 2 + 1]" @update:value="actions.setOffset(1, $event)" />
                <label>角度偏移</label
                ><NumberValueInput :value="view.angles[view.selected] || 0" @update:value="actions.setAngle($event)" />
              </div>
              <div class="action-row button-row">
                <n-button @click="actions.addBarrelFor('hardpoint')">添加</n-button
                ><n-button type="error" ghost @click="actions.deleteBarrelFor('hardpoint')">删除</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item title="发射模式" name="barrelMode">
              <div class="form-grid">
                <label>barrelMode</label
                ><n-select
                  :value="document.barrelMode"
                  :options="toOptions(['ALTERNATING', 'LINKED'])"
                  @update:value="actions.setField('barrelMode', $event)"
                />
              </div>
            </n-collapse-item>
            <n-collapse-item v-if="view.showProjectileSections" title="动画" name="anim">
              <div class="form-grid">
                <label>animationType</label
                ><n-select
                  :value="document.animationType"
                  :options="toOptions(['NONE', 'MUZZLE_FLASH', 'SMOKE', 'GLOW_AND_FLASH', 'GLOW'])"
                  @update:value="actions.setField('animationType', $event)"
                />
                <label>visualRecoil</label
                ><NumberValueInput :value="document.visualRecoil" @update:value="actions.setField('visualRecoil', $event)" />
              </div>
              <JsonValueInput
                :value="view.muzzleFlashSpec"
                label="muzzleFlashSpec"
                show-label
                shape="object"
                @update="view.muzzleFlashSpec = $event"
              />
              <JsonValueInput :value="view.smokeSpec" label="smokeSpec" show-label shape="object" @update="view.smokeSpec = $event" />
            </n-collapse-item>
            <n-collapse-item v-if="view.showProjectileSections" title="弹体" name="proj">
              <div class="form-grid">
                <label>projectileSpecId</label>
                <n-auto-complete v-model:value="view.projectileSpecId" :options="view.projectileOptions" />
              </div>
              <div class="action-row button-row">
                <n-button @click="actions.editProjectile">编辑弹体</n-button>
                <n-button tertiary @click="actions.preview">发射预览</n-button>
              </div>
            </n-collapse-item>
            <n-collapse-item v-if="view.showBeamSection" title="光束" name="beam">
              <ColorPicker label="fringeColor" v-model="view.fringeColor" />
              <ColorPicker label="coreColor" v-model="view.coreColor" />
              <div class="form-grid">
                <label>width</label><NumberValueInput :value="document.width" @update:value="actions.setField('width', $event)" />
                <label>textureType</label
                ><n-select
                  :options="toOptions(['ROUGH', 'SMOOTH', 'NONE'])"
                  :value="document.textureType"
                  @update:value="actions.setField('textureType', $event)"
                />
                <label>textureScrollSpeed</label
                ><NumberValueInput :value="document.textureScrollSpeed" @update:value="actions.setField('textureScrollSpeed', $event)" />
                <label>pixelsPerTexel</label
                ><NumberValueInput :value="document.pixelsPerTexel" @update:value="actions.setField('pixelsPerTexel', $event)" />
                <label>convergeOnPoint</label
                ><n-checkbox :checked="document.convergeOnPoint" @update:checked="actions.setField('convergeOnPoint', $event)" />
                <label>darkCore</label><n-checkbox :checked="document.darkCore" @update:checked="actions.setField('darkCore', $event)" />
              </div>
              <n-button tertiary @click="actions.preview">预览光束</n-button>
            </n-collapse-item>
            <n-collapse-item title="音效" name="sound">
              <div class="form-grid">
                <label>fireSoundOne</label
                ><n-input :value="document.fireSoundOne" @update:value="actions.setField('fireSoundOne', $event)" />
                <label>fireSoundTwo</label
                ><n-input :value="document.fireSoundTwo" @update:value="actions.setField('fireSoundTwo', $event)" />
              </div>
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

import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { WEAPON_SPEC_CLASSES, WEAPON_SPEC_CLASS_NOTE } from '@/domain/editors/weapon-spec';

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
const { document, view, actions, canvas } = useWeaponEditorViewModel(props, emit, { editorWindowRef, stageRef, canvasRef });
</script>
