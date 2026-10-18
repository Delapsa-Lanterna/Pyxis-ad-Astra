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
        <n-collapse v-model:expanded-names="view.expandedSections" @update:expanded-names="canvas.onExpandedSectionsUpdate">
          <n-collapse-item class="schema-section" title="基础属性" name="basic">
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['id'] ?? 'id'" field-key="id"><n-input :value="weaponId" disabled /></FieldRow>
              <FieldRow :label="fieldNames['specClass'] ?? 'specClass'" field-key="specClass" :path="'specClass'"
                ><n-select
                  :value="document.specClass"
                  :options="toOptions([...WEAPON_SPEC_CLASSES])"
                  @update:value="actions.onSpecClassChange"
              /></FieldRow>
              <FieldRow :label="fieldNames['type'] ?? 'type'" field-key="type" :path="'type'"
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
              /></FieldRow>
              <FieldRow :label="fieldNames['size'] ?? 'size'" field-key="size" :path="'size'"
                ><n-select
                  :value="document.size"
                  :options="toOptions(['SMALL', 'MEDIUM', 'LARGE'])"
                  @update:value="actions.setField('size', $event)"
              /></FieldRow>
            </div>
            <p class="field-description">{{ WEAPON_SPEC_CLASS_NOTE }}</p>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="炮塔贴图" name="turretSprites">
            <div class="ui-field-stack">
              <template v-for="field in view.turretSpriteFields" :key="field">
                <FieldRow :label="fieldNames[field] ?? field" :field-key="field"
                  ><div class="sprite-field-row ui-layout-grid ui-layout-center">
                    <n-input :value="document[field]" @update:value="actions.setField(field, $event)" @change="actions.reloadSprites()" />
                    <n-button
                      class="sprite-icon-button ui-control-reset"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="actions.pickWeaponSprite(field)"
                    >
                      <svg class="sprite-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19V5h6l2 2h8v12H4z" />
                        <path d="M8 14h8M12 10v8" />
                      </svg>
                    </n-button></div
                ></FieldRow>
              </template>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="固定贴图" name="hardpointSprites">
            <div class="ui-field-stack">
              <template v-for="field in view.hardpointSpriteFields" :key="field">
                <FieldRow :label="fieldNames[field] ?? field" :field-key="field"
                  ><div class="sprite-field-row ui-layout-grid ui-layout-center">
                    <n-input :value="document[field]" @update:value="actions.setField(field, $event)" @change="actions.reloadSprites()" />
                    <n-button
                      class="sprite-icon-button ui-control-reset"
                      tertiary
                      title="浏览贴图（引用 Mod 内文件）"
                      aria-label="浏览贴图"
                      @click="actions.pickWeaponSprite(field)"
                    >
                      <svg class="sprite-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 19V5h6l2 2h8v12H4z" />
                        <path d="M8 14h8M12 10v8" />
                      </svg>
                    </n-button></div
                ></FieldRow>
              </template>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="光效" name="glow">
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['glowColor'] ?? 'glowColor'" field-key="glowColor"
                ><ColorPicker label="glowColor" v-model="view.glowColor"
              /></FieldRow>
            </div>
            <div class="action-row button-row action-group">
              <n-button
                :type="view.glowPreviewEnabled ? 'primary' : 'default'"
                :aria-pressed="view.glowPreviewEnabled"
                @click="actions.toggleGlowPreview"
              >
                预览光效
              </n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="炮塔发射点" name="turretBarrels">
            <div v-if="actions.barrelCountFor('turret')" class="item-list ui-layout-grid">
              <button
                class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                v-for="(_, i) in actions.barrelCountFor('turret')"
                :key="`barrel-turret-${i}`"
                :class="{ selected: view.viewMode === 'turret' && view.selected === i }"
                @click="actions.selectBarrel('turret', i)"
              >
                发射点 {{ i + 1 }}
                <span class="item-list-label ui-text-muted"
                  >[{{ actions.offsetsFor('turret')[i * 2] }}, {{ actions.offsetsFor('turret')[i * 2 + 1] }}]
                  {{ actions.anglesFor('turret')[i] || 0 }}°</span
                >
              </button>
            </div>
            <div
              v-if="view.viewMode === 'turret' && view.selected !== null"
              class="ui-field-stack"
              :data-inspector-target="`turret-barrel-${view.selected}`"
            >
              <FieldRow :label="fieldNames['X'] ?? 'X'" field-key="X" :path="`${view.viewMode}Offsets[${view.selected! * 2}]`"
                ><NumberValueInput :value="view.offsets[view.selected * 2]" @update:value="actions.setOffset(0, $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['Y'] ?? 'Y'" field-key="Y" :path="`${view.viewMode}Offsets[${view.selected! * 2 + 1}]`"
                ><NumberValueInput :value="view.offsets[view.selected * 2 + 1]" @update:value="actions.setOffset(1, $event)"
              /></FieldRow>
              <FieldRow label="角度偏移" field-key="角度偏移" :path="`${view.viewMode}AngleOffsets[${view.selected}]`"
                ><NumberValueInput :value="view.angles[view.selected] || 0" @update:value="actions.setAngle($event)"
              /></FieldRow>
            </div>
            <div class="action-row button-row action-group">
              <n-button @click="actions.addBarrelFor('turret')">添加</n-button
              ><n-button type="error" ghost @click="actions.deleteBarrelFor('turret')">删除</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="固定发射点" name="hardpointBarrels">
            <div v-if="actions.barrelCountFor('hardpoint')" class="item-list ui-layout-grid">
              <button
                class="ui-button item-list-button ui-text-normal ui-control-pointer ui-content-surface ui-layout-row"
                v-for="(_, i) in actions.barrelCountFor('hardpoint')"
                :key="`barrel-hardpoint-${i}`"
                :class="{ selected: view.viewMode === 'hardpoint' && view.selected === i }"
                @click="actions.selectBarrel('hardpoint', i)"
              >
                发射点 {{ i + 1 }}
                <span class="item-list-label ui-text-muted"
                  >[{{ actions.offsetsFor('hardpoint')[i * 2] }}, {{ actions.offsetsFor('hardpoint')[i * 2 + 1] }}]
                  {{ actions.anglesFor('hardpoint')[i] || 0 }}°</span
                >
              </button>
            </div>
            <div
              v-if="view.viewMode === 'hardpoint' && view.selected !== null"
              class="ui-field-stack"
              :data-inspector-target="`hardpoint-barrel-${view.selected}`"
            >
              <FieldRow :label="fieldNames['X'] ?? 'X'" field-key="X" :path="`${view.viewMode}Offsets[${view.selected! * 2}]`"
                ><NumberValueInput :value="view.offsets[view.selected * 2]" @update:value="actions.setOffset(0, $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['Y'] ?? 'Y'" field-key="Y" :path="`${view.viewMode}Offsets[${view.selected! * 2 + 1}]`"
                ><NumberValueInput :value="view.offsets[view.selected * 2 + 1]" @update:value="actions.setOffset(1, $event)"
              /></FieldRow>
              <FieldRow label="角度偏移" field-key="角度偏移" :path="`${view.viewMode}AngleOffsets[${view.selected}]`"
                ><NumberValueInput :value="view.angles[view.selected] || 0" @update:value="actions.setAngle($event)"
              /></FieldRow>
            </div>
            <div class="action-row button-row action-group">
              <n-button @click="actions.addBarrelFor('hardpoint')">添加</n-button
              ><n-button type="error" ghost @click="actions.deleteBarrelFor('hardpoint')">删除</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="发射模式" name="barrelMode">
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['barrelMode'] ?? 'barrelMode'" field-key="barrelMode" :path="'barrelMode'"
                ><n-select
                  :value="document.barrelMode"
                  :options="toOptions(['ALTERNATING', 'LINKED'])"
                  @update:value="actions.setField('barrelMode', $event)"
              /></FieldRow>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" v-if="view.showProjectileSections" title="动画" name="anim">
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['animationType'] ?? 'animationType'" field-key="animationType" :path="'animationType'"
                ><n-select
                  :value="document.animationType"
                  :options="toOptions(['NONE', 'MUZZLE_FLASH', 'SMOKE', 'GLOW_AND_FLASH', 'GLOW'])"
                  @update:value="actions.setField('animationType', $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['visualRecoil'] ?? 'visualRecoil'" field-key="visualRecoil" :path="'visualRecoil'"
                ><NumberValueInput :value="document.visualRecoil" @update:value="actions.setField('visualRecoil', $event)"
              /></FieldRow>
            </div>
            <FieldRow :label="fieldNames['muzzleFlashSpec'] ?? 'muzzleFlashSpec'" field-key="muzzleFlashSpec" layout="group"
              ><JsonValueInput :value="view.muzzleFlashSpec" label="muzzleFlashSpec" shape="object" @update="view.muzzleFlashSpec = $event"
            /></FieldRow>
            <FieldRow :label="fieldNames['smokeSpec'] ?? 'smokeSpec'" field-key="smokeSpec" layout="group"
              ><JsonValueInput :value="view.smokeSpec" label="smokeSpec" shape="object" @update="view.smokeSpec = $event"
            /></FieldRow>
          </n-collapse-item>
          <n-collapse-item class="schema-section" v-if="view.showProjectileSections" title="弹体" name="proj">
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['projectileSpecId'] ?? 'projectileSpecId'" field-key="projectileSpecId"
                ><n-auto-complete v-model:value="view.projectileSpecId" :options="view.projectileOptions"
              /></FieldRow>
            </div>
            <div class="action-row button-row action-group">
              <n-button @click="actions.editProjectile">编辑弹体</n-button>
              <n-button tertiary @click="actions.preview">发射预览</n-button>
            </div>
          </n-collapse-item>
          <n-collapse-item class="schema-section" v-if="view.showBeamSection" title="光束" name="beam">
            <FieldRow :label="fieldNames['fringeColor'] ?? 'fringeColor'" field-key="fringeColor"
              ><ColorPicker label="fringeColor" v-model="view.fringeColor"
            /></FieldRow>
            <FieldRow :label="fieldNames['coreColor'] ?? 'coreColor'" field-key="coreColor"
              ><ColorPicker label="coreColor" v-model="view.coreColor"
            /></FieldRow>
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['width'] ?? 'width'" field-key="width" :path="'width'"
                ><NumberValueInput :value="document.width" @update:value="actions.setField('width', $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['textureType'] ?? 'textureType'" field-key="textureType" :path="'textureType'"
                ><n-select
                  :options="toOptions(['ROUGH', 'SMOOTH', 'NONE'])"
                  :value="document.textureType"
                  @update:value="actions.setField('textureType', $event)"
              /></FieldRow>
              <FieldRow
                :label="fieldNames['textureScrollSpeed'] ?? 'textureScrollSpeed'"
                field-key="textureScrollSpeed"
                :path="'textureScrollSpeed'"
                ><NumberValueInput :value="document.textureScrollSpeed" @update:value="actions.setField('textureScrollSpeed', $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['pixelsPerTexel'] ?? 'pixelsPerTexel'" field-key="pixelsPerTexel" :path="'pixelsPerTexel'"
                ><NumberValueInput :value="document.pixelsPerTexel" @update:value="actions.setField('pixelsPerTexel', $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['convergeOnPoint'] ?? 'convergeOnPoint'" field-key="convergeOnPoint"
                ><n-checkbox :checked="document.convergeOnPoint" @update:checked="actions.setField('convergeOnPoint', $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['darkCore'] ?? 'darkCore'" field-key="darkCore"
                ><n-checkbox :checked="document.darkCore" @update:checked="actions.setField('darkCore', $event)"
              /></FieldRow>
            </div>
            <n-button tertiary @click="actions.preview">预览光束</n-button>
          </n-collapse-item>
          <n-collapse-item class="schema-section" title="音效" name="sound">
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['fireSoundOne'] ?? 'fireSoundOne'" field-key="fireSoundOne" :path="'fireSoundOne'"
                ><n-input :value="document.fireSoundOne" @update:value="actions.setField('fireSoundOne', $event)"
              /></FieldRow>
              <FieldRow :label="fieldNames['fireSoundTwo'] ?? 'fireSoundTwo'" field-key="fireSoundTwo" :path="'fireSoundTwo'"
                ><n-input :value="document.fireSoundTwo" @update:value="actions.setField('fireSoundTwo', $event)"
              /></FieldRow>
            </div>
          </n-collapse-item>
        </n-collapse>
      </EditorInspector>
    </div>
    <EditorFooter :note="view.footerNote"> </EditorFooter>
  </div>
</template>

<script setup lang="ts">
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import { fieldNames } from '@/domain/editors/lib/field-names';
import { useTemplateRef } from 'vue';

import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { WEAPON_SPEC_CLASSES, WEAPON_SPEC_CLASS_NOTE } from '@/domain/editors/weapon-spec';

import { toOptions } from '@/domain/editors/lib/editor-constants';
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
