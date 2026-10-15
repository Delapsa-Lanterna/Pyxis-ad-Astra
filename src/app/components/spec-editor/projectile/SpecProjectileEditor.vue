<template>
  <div class="modal-backdrop">
    <div class="editor-window">
      <EditorHeader
        title="弹体编辑器"
        :subtitle="projectileId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      >
        <n-button size="small" @click="actions.resetView">重置视图</n-button>
      </EditorHeader>
      <div class="editor-body">
        <div ref="stageRef" class="canvas-stage">
          <canvas
            ref="canvasRef"
            class="editor-canvas"
            aria-label="弹体静态画布"
            @mousedown="canvas.onDown"
            @mousemove="canvas.onMove"
            @mouseup="canvas.onUp"
            @mouseleave="canvas.onLeave"
            @wheel.prevent="canvas.onWheel"
            @contextmenu.prevent
          />
          <div v-if="view.spriteNotice" class="projectile-canvas-notice" role="status">{{ view.spriteNotice }}</div>
        </div>
        <EditorInspector
          title="弹体检查器"
          @focusin.capture="canvas.beginField"
          @focusout.capture="canvas.fieldBlur"
          @keyup.capture="canvas.fieldKey"
        >
          <n-collapse v-model:expanded-names="view.expandedSections" :theme-overrides="editorCollapseTheme">
            <n-collapse-item title="基础属性" name="basic">
              <div class="form-grid">
                <label>id</label><n-input :value="projectileId" disabled /> <label>specClass</label
                ><n-select
                  :value="document.specClass"
                  :options="toOptions(['projectile', 'missile'])"
                  @update:value="actions.onSpecClassChange"
                />
              </div>
            </n-collapse-item>
            <template v-if="view.showProjectileSections">
              <n-collapse-item title="弹体外观" name="visual">
                <div class="form-grid">
                  <label>spawnType</label
                  ><n-select
                    :options="toOptions([...PROJECTILE_SPAWN_TYPES])"
                    :value="document.spawnType"
                    @update:value="actions.setField('spawnType', $event)"
                  />
                  <label>bulletSprite</label
                  ><n-input :value="document.bulletSprite" @update:value="actions.setField('bulletSprite', $event)" /> <label>length</label
                  ><NumberValueInput :value="document.length" @update:value="actions.setField('length', $event)" /> <label>width</label
                  ><NumberValueInput :value="document.width" @update:value="actions.setField('width', $event)" />
                  <label>textureScrollSpeed</label
                  ><NumberValueInput :value="document.textureScrollSpeed" @update:value="actions.setField('textureScrollSpeed', $event)" />
                  <label>pixelsPerTexel</label
                  ><NumberValueInput :value="document.pixelsPerTexel" @update:value="actions.setField('pixelsPerTexel', $event)" />
                </div>
                <ColorPicker label="fringeColor" v-model="view.fringeColor" />
                <ColorPicker label="coreColor" v-model="view.coreColor" />
                <n-button size="small" tertiary @click="actions.pickProjectileSprite('bulletSprite')">浏览贴图（引用 Mod 内文件）</n-button>
              </n-collapse-item>
              <n-collapse-item title="碰撞与消散" name="collision">
                <div class="form-grid">
                  <label>collisionClass</label
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
                  />
                  <label>collisionClassByFighter</label
                  ><n-input :value="document.collisionClassByFighter" @update:value="actions.setField('collisionClassByFighter', $event)" />
                  <label>fadeTime</label
                  ><NumberValueInput :value="document.fadeTime" @update:value="actions.setField('fadeTime', $event)" />
                  <label>hitGlowRadius</label
                  ><NumberValueInput :value="document.hitGlowRadius" @update:value="actions.setField('hitGlowRadius', $event)" />
                </div>
              </n-collapse-item>
            </template>
            <template v-else-if="view.showMissileSections">
              <n-collapse-item title="导弹外观" name="missileVisual">
                <div class="form-grid">
                  <label>missileType</label
                  ><n-select
                    :value="document.missileType"
                    :options="toOptions([...MISSILE_TYPES])"
                    @update:value="actions.setField('missileType', $event)"
                  />
                  <label>sprite</label><n-input :value="document.sprite" @update:value="actions.setField('sprite', $event)" />
                  <label>size W</label><NumberValueInput :value="view.size[0]" @update:value="actions.setArray('size', 0, $event)" />
                  <label>size H</label><NumberValueInput :value="view.size[1]" @update:value="actions.setArray('size', 1, $event)" />
                  <label>center X</label><NumberValueInput :value="view.center[0]" @update:value="actions.setArray('center', 0, $event)" />
                  <label>center Y</label><NumberValueInput :value="view.center[1]" @update:value="actions.setArray('center', 1, $event)" />
                  <label>collisionRadius</label
                  ><NumberValueInput :value="document.collisionRadius" @update:value="actions.setField('collisionRadius', $event)" />
                </div>
                <ColorPicker label="explosionColor" v-model="view.explosionColor" />
                <n-button size="small" tertiary @click="actions.pickProjectileSprite('sprite')">浏览贴图（引用 Mod 内文件）</n-button>
              </n-collapse-item>
              <n-collapse-item title="引擎参数" name="engine">
                <JsonValueInput :value="view.engineSpec" label="engineSpec" shape="object" @update="view.engineSpec = $event" />
              </n-collapse-item>
              <n-collapse-item title="引擎槽位" name="slots">
                <div class="bounds-list">
                  <div v-for="(slot, i) in view.engineSlots" :key="entryKey('engine-slot', slot, i)">
                    <span>{{ i }}</span>
                    <NumberValueInput :value="view.slotLoc(slot)[0]" @update:value="actions.setSlotLoc(i, 0, $event)" />
                    <NumberValueInput :value="view.slotLoc(slot)[1]" @update:value="actions.setSlotLoc(i, 1, $event)" />
                    <n-button size="tiny" type="error" ghost @click="actions.removeEngineSlot(i)">删除</n-button>
                  </div>
                </div>
                <n-button @click="actions.addEngineSlot">添加引擎槽</n-button>
              </n-collapse-item>
              <n-collapse-item title="爆炸与时间" name="explosion">
                <div class="form-grid">
                  <label>explosionRadius</label
                  ><NumberValueInput :value="document.explosionRadius" @update:value="actions.setField('explosionRadius', $event)" />
                  <label>flameoutTime</label
                  ><NumberValueInput :value="document.flameoutTime" @update:value="actions.setField('flameoutTime', $event)" />
                  <label>armingTime</label
                  ><NumberValueInput :value="document.armingTime" @update:value="actions.setField('armingTime', $event)" />
                  <label>fadeTime</label
                  ><NumberValueInput :value="document.fadeTime" @update:value="actions.setField('fadeTime', $event)" />
                </div>
                <JsonValueInput :value="view.explosionSpec" label="explosionSpec" shape="object" @update="view.explosionSpec = $event" />
              </n-collapse-item>
            </template>
            <n-collapse-item v-else title="通用属性" name="generic">
              <JsonValueInput
                :value="document"
                label="弹体规格"
                shape="object"
                :normalize="view.normalizeProjectile"
                @update="actions.projectileUpdated"
              />
            </n-collapse-item>
          </n-collapse>
        </EditorInspector>
      </div>
      <EditorFooter note="右键 拖动画布 | 滚轮 缩放">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
          <n-button type="primary" :disabled="!canSave" :loading="saving" @click="emit('save-requested')">保存</n-button>
        </template>
      </EditorFooter>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTemplateRef } from 'vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { entryKey } from '@/shared/lib/entry-keys';
import { MISSILE_TYPES, PROJECTILE_SPAWN_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { editorCollapseTheme, toOptions } from '@/domain/editors/lib/editor-constants';
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
