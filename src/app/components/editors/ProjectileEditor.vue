<template>
  <div class="modal-backdrop">
    <div class="projectile-window">
      <EditorHeader
        title="弹体编辑器"
        :subtitle="projectileId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      />
      <div class="projectile-body">
        <n-collapse v-model:expanded-names="expandedSections" :theme-overrides="editorCollapseTheme">
          <n-collapse-item title="基础属性" name="basic">
            <div class="form-grid">
              <label>id</label><n-input :value="projectileId" disabled /> <label>specClass</label
              ><n-select
                :value="localProjectile.specClass"
                :options="toOptions(['projectile', 'missile'])"
                @update:value="onSpecClassChange"
              />
            </div>
          </n-collapse-item>
          <template v-if="showProjectileSections">
            <n-collapse-item title="弹体外观" name="visual">
              <div class="form-grid">
                <label>spawnType</label
                ><n-select
                  :options="toOptions([...PROJECTILE_SPAWN_TYPES])"
                  :value="localProjectile.spawnType"
                  @update:value="setField('spawnType', $event)"
                />
                <label>bulletSprite</label
                ><n-input :value="localProjectile.bulletSprite" @update:value="setField('bulletSprite', $event)" /> <label>length</label
                ><NumberValueInput :value="localProjectile.length" @update:value="setField('length', $event)" /> <label>width</label
                ><NumberValueInput :value="localProjectile.width" @update:value="setField('width', $event)" />
                <label>textureScrollSpeed</label
                ><NumberValueInput :value="localProjectile.textureScrollSpeed" @update:value="setField('textureScrollSpeed', $event)" />
                <label>pixelsPerTexel</label
                ><NumberValueInput :value="localProjectile.pixelsPerTexel" @update:value="setField('pixelsPerTexel', $event)" />
              </div>
              <ColorPicker label="fringeColor" v-model="fringeColor" />
              <ColorPicker label="coreColor" v-model="coreColor" />
              <n-button size="small" tertiary @click="pickProjectileSprite('bulletSprite')">浏览贴图（引用 Mod 内文件）</n-button>
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
                  :value="localProjectile.collisionClass"
                  @update:value="setField('collisionClass', $event)"
                />
                <label>collisionClassByFighter</label
                ><n-input :value="localProjectile.collisionClassByFighter" @update:value="setField('collisionClassByFighter', $event)" />
                <label>fadeTime</label><NumberValueInput :value="localProjectile.fadeTime" @update:value="setField('fadeTime', $event)" />
                <label>hitGlowRadius</label
                ><NumberValueInput :value="localProjectile.hitGlowRadius" @update:value="setField('hitGlowRadius', $event)" />
              </div>
            </n-collapse-item>
          </template>
          <template v-else-if="showMissileSections">
            <n-collapse-item title="导弹外观" name="missileVisual">
              <div class="form-grid">
                <label>missileType</label
                ><n-select
                  :value="localProjectile.missileType"
                  :options="toOptions([...MISSILE_TYPES])"
                  @update:value="setField('missileType', $event)"
                />
                <label>sprite</label><n-input :value="localProjectile.sprite" @update:value="setField('sprite', $event)" />
                <label>size W</label><NumberValueInput :value="size[0]" @update:value="setArray('size', 0, $event)" /> <label>size H</label
                ><NumberValueInput :value="size[1]" @update:value="setArray('size', 1, $event)" /> <label>center X</label
                ><NumberValueInput :value="center[0]" @update:value="setArray('center', 0, $event)" /> <label>center Y</label
                ><NumberValueInput :value="center[1]" @update:value="setArray('center', 1, $event)" /> <label>collisionRadius</label
                ><NumberValueInput :value="localProjectile.collisionRadius" @update:value="setField('collisionRadius', $event)" />
              </div>
              <ColorPicker label="explosionColor" v-model="explosionColor" />
              <n-button size="small" tertiary @click="pickProjectileSprite('sprite')">浏览贴图（引用 Mod 内文件）</n-button>
            </n-collapse-item>
            <n-collapse-item title="引擎参数" name="engine">
              <JsonValueInput :value="engineSpec" label="engineSpec" shape="object" @update="engineSpec = $event" />
            </n-collapse-item>
            <n-collapse-item title="引擎槽位" name="slots">
              <div class="bounds-list">
                <div v-for="(slot, i) in engineSlots" :key="entryKey('engine-slot', slot, i)">
                  <span>{{ i }}</span>
                  <NumberValueInput :value="slotLoc(slot)[0]" @update:value="setSlotLoc(i, 0, $event)" />
                  <NumberValueInput :value="slotLoc(slot)[1]" @update:value="setSlotLoc(i, 1, $event)" />
                  <n-button size="tiny" type="error" ghost @click="removeEngineSlot(i)">删除</n-button>
                </div>
              </div>
              <n-button @click="addEngineSlot">添加引擎槽</n-button>
            </n-collapse-item>
            <n-collapse-item title="爆炸与时间" name="explosion">
              <div class="form-grid">
                <label>explosionRadius</label
                ><NumberValueInput :value="localProjectile.explosionRadius" @update:value="setField('explosionRadius', $event)" />
                <label>flameoutTime</label
                ><NumberValueInput :value="localProjectile.flameoutTime" @update:value="setField('flameoutTime', $event)" />
                <label>armingTime</label
                ><NumberValueInput :value="localProjectile.armingTime" @update:value="setField('armingTime', $event)" />
                <label>fadeTime</label><NumberValueInput :value="localProjectile.fadeTime" @update:value="setField('fadeTime', $event)" />
              </div>
              <JsonValueInput :value="explosionSpec" label="explosionSpec" shape="object" @update="explosionSpec = $event" />
            </n-collapse-item>
          </template>
          <n-collapse-item v-else title="通用属性" name="generic">
            <JsonValueInput
              :value="localProjectile"
              label="弹体规格"
              shape="object"
              :normalize="normalizeProjectile"
              @update="projectileUpdated"
            />
          </n-collapse-item>
        </n-collapse>
      </div>
      <EditorFooter note="结构化 JSON 写回，完整保留业务字段。">
        <template #actions>
          <n-button @click="$emit('close')">关闭</n-button>
          <n-button type="primary" :disabled="!canSave" :loading="saving" @click="emit('save-requested')">保存</n-button>
        </template>
      </EditorFooter>
    </div>
  </div>
</template>

<script setup lang="ts">
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { entryKey } from '@/shared/lib/entry-keys';
import { MISSILE_TYPES, PROJECTILE_SPAWN_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { editorCollapseTheme, toOptions } from '@/domain/editors/lib/editor-constants';
import {
  useProjectileEditorViewModel,
  type ProjectileEditorProps,
  type ProjectileEditorEvents,
} from '@/app/composables/editors/use-projectile-editor-view-model';

const props = defineProps<ProjectileEditorProps>();
const emit = defineEmits<ProjectileEditorEvents>();

const {
  showProjectileSections,
  showMissileSections,
  normalizeProjectile,
  localProjectile,
  expandedSections,
  size,
  center,
  engineSlots,
  fringeColor,
  coreColor,
  explosionColor,
  engineSpec,
  explosionSpec,
  setField,
  onSpecClassChange,
  setArray,
  slotLoc,
  setSlotLoc,
  addEngineSlot,
  removeEngineSlot,
  projectileUpdated,
  pickProjectileSprite,
} = useProjectileEditorViewModel(props, emit);
</script>
