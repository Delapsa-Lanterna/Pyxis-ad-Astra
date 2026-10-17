<template>
  <div class="editor-window ui-content-grid ui-content-surface">
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
      <n-button size="small" @click="actions.resetView">重置视图</n-button>
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
        <n-collapse v-model:expanded-names="view.expandedSections">
          <n-collapse-item class="schema-section" title="基础属性" name="basic">
            <div class="ui-field-stack">
              <FieldRow :label="fieldNames['id'] ?? 'id'" field-key="id"><n-input :value="projectileId" disabled /></FieldRow>
              <FieldRow :label="fieldNames['specClass'] ?? 'specClass'" field-key="specClass" :path="'specClass'"
                ><n-select
                  :value="document.specClass"
                  :options="toOptions(['projectile', 'missile'])"
                  @update:value="actions.onSpecClassChange"
              /></FieldRow>
            </div>
          </n-collapse-item>
          <template v-if="view.showProjectileSections">
            <n-collapse-item class="schema-section" title="弹体外观" name="visual">
              <div class="ui-field-stack">
                <FieldRow :label="fieldNames['spawnType'] ?? 'spawnType'" field-key="spawnType" :path="'spawnType'"
                  ><n-select
                    :options="toOptions([...PROJECTILE_SPAWN_TYPES])"
                    :value="document.spawnType"
                    @update:value="actions.setField('spawnType', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['bulletSprite'] ?? 'bulletSprite'" field-key="bulletSprite" :path="'bulletSprite'"
                  ><n-input :value="document.bulletSprite" @update:value="actions.setField('bulletSprite', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['length'] ?? 'length'" field-key="length" :path="'length'"
                  ><NumberValueInput :value="document.length" @update:value="actions.setField('length', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['width'] ?? 'width'" field-key="width" :path="'width'"
                  ><NumberValueInput :value="document.width" @update:value="actions.setField('width', $event)"
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
                <FieldRow :label="fieldNames['fringeColor'] ?? 'fringeColor'" field-key="fringeColor"
                  ><ColorPicker label="fringeColor" v-model="view.fringeColor"
                /></FieldRow>
                <FieldRow :label="fieldNames['coreColor'] ?? 'coreColor'" field-key="coreColor"
                  ><ColorPicker label="coreColor" v-model="view.coreColor"
                /></FieldRow>
              </div>
              <n-button size="small" tertiary @click="actions.pickProjectileSprite('bulletSprite')">浏览贴图（引用 Mod 内文件）</n-button>
            </n-collapse-item>
            <n-collapse-item class="schema-section" title="碰撞与消散" name="collision">
              <div class="ui-field-stack">
                <FieldRow :label="fieldNames['collisionClass'] ?? 'collisionClass'" field-key="collisionClass" :path="'collisionClass'"
                  ><n-select
                    :options="
                      toOptions([
                        'PROJECTILE_NO_FF',
                        'PROJECTILE_FF',
                        'PROJECTILE_FIGHTER',
                        'MISSILE_NO_FF',
                        'MISSILE_FF',
                        'RAY',
                        'RAY_FIGHTER',
                        'HITS_SHIPS_AND_ASTEROIDS',
                        'NONE',
                      ])
                    "
                    :value="document.collisionClass"
                    @update:value="actions.setField('collisionClass', $event)"
                /></FieldRow>
                <FieldRow
                  :label="fieldNames['collisionClassByFighter'] ?? 'collisionClassByFighter'"
                  field-key="collisionClassByFighter"
                  :path="'collisionClassByFighter'"
                  ><n-input :value="document.collisionClassByFighter" @update:value="actions.setField('collisionClassByFighter', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['fadeTime'] ?? 'fadeTime'" field-key="fadeTime" :path="'fadeTime'"
                  ><NumberValueInput :value="document.fadeTime" @update:value="actions.setField('fadeTime', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['hitGlowRadius'] ?? 'hitGlowRadius'" field-key="hitGlowRadius" :path="'hitGlowRadius'"
                  ><NumberValueInput :value="document.hitGlowRadius" @update:value="actions.setField('hitGlowRadius', $event)"
                /></FieldRow>
              </div>
            </n-collapse-item>
          </template>
          <template v-else-if="view.showMissileSections">
            <n-collapse-item class="schema-section" title="导弹外观" name="missileVisual">
              <div class="ui-field-stack">
                <FieldRow :label="fieldNames['missileType'] ?? 'missileType'" field-key="missileType" :path="'missileType'"
                  ><n-select
                    :value="document.missileType"
                    :options="toOptions([...MISSILE_TYPES])"
                    @update:value="actions.setField('missileType', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['sprite'] ?? 'sprite'" field-key="sprite" :path="'sprite'"
                  ><n-input :value="document.sprite" @update:value="actions.setField('sprite', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['size W'] ?? 'size W'" field-key="size[0]"
                  ><NumberValueInput :value="view.size[0]" @update:value="actions.setArray('size', 0, $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['size H'] ?? 'size H'" field-key="size[1]"
                  ><NumberValueInput :value="view.size[1]" @update:value="actions.setArray('size', 1, $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['center X'] ?? 'center X'" field-key="center[0]"
                  ><NumberValueInput :value="view.center[0]" @update:value="actions.setArray('center', 0, $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['center Y'] ?? 'center Y'" field-key="center[1]"
                  ><NumberValueInput :value="view.center[1]" @update:value="actions.setArray('center', 1, $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['collisionRadius'] ?? 'collisionRadius'" field-key="collisionRadius" :path="'collisionRadius'"
                  ><NumberValueInput :value="document.collisionRadius" @update:value="actions.setField('collisionRadius', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['explosionColor'] ?? 'explosionColor'" field-key="explosionColor"
                  ><ColorPicker label="explosionColor" v-model="view.explosionColor"
                /></FieldRow>
              </div>
              <n-button size="small" tertiary @click="actions.pickProjectileSprite('sprite')">浏览贴图（引用 Mod 内文件）</n-button>
            </n-collapse-item>
            <n-collapse-item class="schema-section" title="引擎参数" name="engine">
              <FieldRow :label="fieldNames['engineSpec'] ?? 'engineSpec'" field-key="engineSpec" layout="group"
                ><JsonValueInput :value="view.engineSpec" label="engineSpec" shape="object" @update="view.engineSpec = $event"
              /></FieldRow>
            </n-collapse-item>
            <n-collapse-item class="schema-section" title="引擎槽位" name="slots">
              <div v-if="view.engineSlots.length" class="bounds-list ui-layout-grid">
                <div
                  class="bounds-list-content ui-layout-grid ui-layout-center ui-control-border ui-content-surface"
                  v-for="(slot, i) in view.engineSlots"
                  :key="entryKey('engine-slot', slot, i)"
                >
                  <span>{{ i }}</span>
                  <NumberValueInput :value="view.slotLoc(slot)[0]" @update:value="actions.setSlotLoc(i, 0, $event)" />
                  <NumberValueInput :value="view.slotLoc(slot)[1]" @update:value="actions.setSlotLoc(i, 1, $event)" />
                  <n-button size="tiny" type="error" ghost @click="actions.removeEngineSlot(i)">删除</n-button>
                </div>
              </div>
              <n-button @click="actions.addEngineSlot">添加引擎槽</n-button>
            </n-collapse-item>
            <n-collapse-item class="schema-section" title="爆炸与时间" name="explosion">
              <div class="ui-field-stack">
                <FieldRow :label="fieldNames['explosionRadius'] ?? 'explosionRadius'" field-key="explosionRadius" :path="'explosionRadius'"
                  ><NumberValueInput :value="document.explosionRadius" @update:value="actions.setField('explosionRadius', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['flameoutTime'] ?? 'flameoutTime'" field-key="flameoutTime" :path="'flameoutTime'"
                  ><NumberValueInput :value="document.flameoutTime" @update:value="actions.setField('flameoutTime', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['armingTime'] ?? 'armingTime'" field-key="armingTime" :path="'armingTime'"
                  ><NumberValueInput :value="document.armingTime" @update:value="actions.setField('armingTime', $event)"
                /></FieldRow>
                <FieldRow :label="fieldNames['fadeTime'] ?? 'fadeTime'" field-key="fadeTime" :path="'fadeTime'"
                  ><NumberValueInput :value="document.fadeTime" @update:value="actions.setField('fadeTime', $event)"
                /></FieldRow>
              </div>
              <FieldRow :label="fieldNames['explosionSpec'] ?? 'explosionSpec'" field-key="explosionSpec" layout="group"
                ><JsonValueInput :value="view.explosionSpec" label="explosionSpec" shape="object" @update="view.explosionSpec = $event"
              /></FieldRow>
            </n-collapse-item>
          </template>
          <n-collapse-item class="schema-section" v-else title="通用属性" name="generic">
            <FieldRow label="弹体规格" field-key="弹体规格" layout="group"
              ><JsonValueInput
                :value="document"
                label="弹体规格"
                shape="object"
                :normalize="view.normalizeProjectile"
                @update="actions.projectileUpdated"
            /></FieldRow>
          </n-collapse-item>
        </n-collapse>
      </EditorInspector>
    </div>
    <EditorFooter note="右键 拖动画布 | 滚轮 缩放"> </EditorFooter>
  </div>
</template>

<script setup lang="ts">
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import { fieldNames } from '@/domain/editors/lib/field-names';
import { useTemplateRef } from 'vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { entryKey } from '@/shared/lib/entry-keys';
import { MISSILE_TYPES, PROJECTILE_SPAWN_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { toOptions } from '@/domain/editors/lib/editor-constants';
import {
  useSpecProjectileEditorViewModel,
  type SpecProjectileEditorProps,
  type SpecProjectileEditorEvents,
} from '@/app/composables/spec-editor/projectile/use-spec-projectile-editor-view-model';

const props = defineProps<SpecProjectileEditorProps>();
const emit = defineEmits<SpecProjectileEditorEvents>();

const stageRef = useTemplateRef<HTMLElement>('stageRef');
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const { document, view, actions, canvas } = useSpecProjectileEditorViewModel(props, emit, { stageRef, canvasRef });
</script>
