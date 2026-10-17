<template>
  <div class="modal-backdrop ui-layout-grid">
    <div class="projectile-window ui-content-grid ui-content-surface">
      <EditorHeader
        title="战术系统编辑器"
        :subtitle="systemId"
        :dirty="dirty"
        :external-update-notice="externalUpdateNotice"
        @load-external="$emit('load-external')"
      />
      <div class="projectile-body ui-content-scroll">
        <n-collapse v-model:expanded-names="view.expandedSections" :theme-overrides="editorCollapseTheme">
          <n-collapse-item title="基础信息" name="basic">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">系统 ID</label><n-input :value="systemId" disabled />
              <label class="form-grid-label ui-text-muted ui-text-small">系统类型</label
              ><n-select :value="view.systemType" :options="toOptions([...SYSTEM_TYPES])" @update:value="actions.onTypeChange" />
              <label class="form-grid-label ui-text-muted ui-text-small">AI 行为类型</label
              ><n-select
                :value="document.aiType"
                :options="toOptions([...view.AI_TYPES])"
                filterable
                tag
                @update:value="actions.setField('aiType', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">效果脚本</label
              ><n-input :value="document.statsScript" @update:value="actions.setField('statsScript', $event)" />
              <template v-if="view.showCustomAi">
                <label class="form-grid-label ui-text-muted ui-text-small">AI 脚本</label
                ><n-input :value="document.aiScript" @update:value="actions.setField('aiScript', $event)" />
              </template>
            </div>
          </n-collapse-item>

          <n-collapse-item title="行为标志" name="behavior">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">暂停时运行脚本</label
              ><n-switch :value="document.runScriptWhilePaused" @update:value="actions.setField('runScriptWhilePaused', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">闲置时运行脚本</label
              ><n-switch :value="document.runScriptWhileIdle" @update:value="actions.setField('runScriptWhileIdle', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">充能降低时阻止动作</label
              ><n-switch
                :value="document.blockActionsWhileChargingDown"
                @update:value="actions.setField('blockActionsWhileChargingDown', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">不会导致过载</label
              ><n-switch :value="document.canNotCauseOverload" @update:value="actions.setField('canNotCauseOverload', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">右键系统开启时可用</label
              ><n-switch
                :value="document.canUseWhileRightClickSystemOn"
                @update:value="actions.setField('canUseWhileRightClickSystemOn', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">效果后限制转向</label
              ><n-switch :value="document.clampTurnRateAfter" @update:value="actions.setField('clampTurnRateAfter', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">效果后限制速度</label
              ><n-switch :value="document.clampMaxSpeedAfter" @update:value="actions.setField('clampMaxSpeedAfter', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">持续加速</label
              ><n-switch :value="document.alwaysAccelerate" @update:value="actions.setField('alwaysAccelerate', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">撞击失控概率</label
              ><NumberValueInput
                :value="document.flameoutOnImpactChance"
                :step="0.1"
                @update:value="actions.setField('flameoutOnImpactChance', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">充能降低时淡出音效</label
              ><n-switch
                :value="document.fadeActivationSoundOnChargedown"
                @update:value="actions.setField('fadeActivationSoundOnChargedown', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">开盾时取消系统</label
              ><n-switch :value="document.activatingShieldsCancels" @update:value="actions.setField('activatingShieldsCancels', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item title="音效" name="sound">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">激活音效</label
              ><n-input :value="document.useSound" @update:value="actions.setField('useSound', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">循环音效</label
              ><n-input :value="document.loopSound" @update:value="actions.setField('loopSound', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">关闭音效</label
              ><n-input :value="document.deactivateSound" @update:value="actions.setField('deactivateSound', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">用尽音效</label
              ><n-input :value="document.outOfUsesSound" @update:value="actions.setField('outOfUsesSound', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">滤波类型</label
              ><n-select
                :value="document.soundFilterType"
                :options="toOptions(['LOWPASS'])"
                clearable
                @update:value="actions.setField('soundFilterType', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">滤波增益</label
              ><NumberValueInput
                :value="document.soundFilterGain"
                :step="0.05"
                @update:value="actions.setField('soundFilterGain', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">高频滤波增益</label
              ><NumberValueInput
                :value="document.soundFilterGainHF"
                :step="0.05"
                @update:value="actions.setField('soundFilterGainHF', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="引擎视觉" name="engine">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">光柱长度倍率</label
              ><NumberValueInput
                :value="document.engineGlowLengthMult"
                :step="0.1"
                @update:value="actions.setField('engineGlowLengthMult', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">光柱宽度倍率</label
              ><NumberValueInput
                :value="document.engineGlowWidthMult"
                :step="0.1"
                @update:value="actions.setField('engineGlowWidthMult', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">辉光强度倍率</label
              ><NumberValueInput
                :value="document.engineGlowGlowMult"
                :step="0.1"
                @update:value="actions.setField('engineGlowGlowMult', $event)"
              />
            </div>
            <ColorPicker label="引擎发光颜色" v-model="view.engineGlowColor" />
            <ColorPicker label="引擎尾迹颜色" v-model="view.engineGlowContrailColor" />
          </n-collapse-item>

          <n-collapse-item title="武器发光" name="weaponGlow">
            <ColorPicker label="武器发光颜色" v-model="view.weaponGlowColor" />
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">受影响武器类型</label
              ><n-select
                :value="document.weaponTypes"
                :options="toOptions(['ENERGY', 'BALLISTIC', 'MISSILE', 'SYSTEM'])"
                multiple
                @update:value="actions.setField('weaponTypes', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="抖动效果" name="jitter">
            <ColorPicker label="抖动颜色" v-model="view.jitterColor" />
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">抖动副本数</label
              ><NumberValueInput :value="document.jitterCopies" @update:value="actions.setField('jitterCopies', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">最小范围</label
              ><NumberValueInput :value="document.jitterMinRange" @update:value="actions.setField('jitterMinRange', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">抖动范围</label
              ><NumberValueInput :value="document.jitterRange" @update:value="actions.setField('jitterRange', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">范围半径比例</label
              ><NumberValueInput
                :value="document.jitterRangeRadiusFraction"
                :step="0.1"
                @update:value="actions.setField('jitterRangeRadiusFraction', $event)"
              />
            </div>
            <ColorPicker label="底层抖动颜色" v-model="view.jitterUnderColor" />
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">底层副本数</label
              ><NumberValueInput :value="document.jitterUnderCopies" @update:value="actions.setField('jitterUnderCopies', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">底层最小范围</label
              ><NumberValueInput :value="document.jitterUnderMinRange" @update:value="actions.setField('jitterUnderMinRange', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">底层抖动范围</label
              ><NumberValueInput :value="document.jitterUnderRange" @update:value="actions.setField('jitterUnderRange', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">底层范围半径比例</label
              ><NumberValueInput
                :value="document.jitterUnderRangeRadiusFraction"
                :step="0.1"
                @update:value="actions.setField('jitterUnderRangeRadiusFraction', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="效果与相位视觉" name="phase">
            <ColorPicker label="效果颜色 1" v-model="view.effectColor1" />
            <ColorPicker label="效果颜色 2" v-model="view.effectColor2" />
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">高光贴图后缀</label
              ><n-input :value="document.phaseHighlight" @update:value="actions.setField('phaseHighlight', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">漫射贴图后缀</label
              ><n-input :value="document.phaseDiffuse" @update:value="actions.setField('phaseDiffuse', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">舰船透明度</label
              ><NumberValueInput :value="document.shipAlpha" :step="0.05" @update:value="actions.setField('shipAlpha', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item title="护盾视觉" name="shield">
            <ColorPicker label="护盾环颜色" v-model="view.shieldRingColor" />
            <ColorPicker label="护盾内部颜色" v-model="view.shieldInnerColor" />
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">护盾厚度倍率</label
              ><NumberValueInput
                :value="document.shieldThicknessMult"
                :step="0.1"
                @update:value="actions.setField('shieldThicknessMult', $event)"
              />
              <label class="form-grid-label ui-text-muted ui-text-small">护盾波动倍率</label
              ><NumberValueInput
                :value="document.shieldFluctuationMult"
                :step="0.1"
                @update:value="actions.setField('shieldFluctuationMult', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="view.showDisplacerSection" title="位移器参数" name="displacer">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">位移距离</label
              ><NumberValueInput :value="document.range" @update:value="actions.setField('range', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">随机偏移</label
              ><NumberValueInput :value="document.randomRange" @update:value="actions.setField('randomRange', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">传送时渲染副本</label
              ><n-switch :value="document.renderCopyDuringTeleport" @update:value="actions.setField('renderCopyDuringTeleport', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="view.showWeaponSection" title="武器系统" name="weaponSystem">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">关联武器 ID</label
              ><n-input :value="document.weaponDataId" @update:value="actions.setField('weaponDataId', $event)" />
            </div>
          </n-collapse-item>

          <n-collapse-item v-if="view.showDroneSection" title="无人机参数" name="drone">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">无人机装配 ID</label
              ><n-input :value="document.droneVariant" @update:value="actions.setField('droneVariant', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">允许自由漫游</label
              ><n-switch :value="document.allowFreeRoam" @update:value="actions.setField('allowFreeRoam', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">发射速度</label
              ><NumberValueInput :value="document.launchSpeed" @update:value="actions.setField('launchSpeed', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">发射延迟</label
              ><NumberValueInput :value="document.launchDelay" :step="0.1" @update:value="actions.setField('launchDelay', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">最大无人机数</label
              ><NumberValueInput :value="document.maxDrones" @update:value="actions.setField('maxDrones', $event)" />
            </div>
            <h4 class="system-editor-heading projectile-body-subtitle">无人机行为定义</h4>
            <JsonValueInput
              :value="document.droneBehavior ?? []"
              label="droneBehavior"
              shape="array"
              @update="actions.droneBehaviorUpdated"
            />
          </n-collapse-item>

          <n-collapse-item title="伤害（AI 理解用）" name="damage">
            <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
              <label class="form-grid-label ui-text-muted ui-text-small">EMP 伤害</label
              ><NumberValueInput :value="document.empDamage" @update:value="actions.setField('empDamage', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">伤害值</label
              ><NumberValueInput :value="document.damage" @update:value="actions.setField('damage', $event)" />
              <label class="form-grid-label ui-text-muted ui-text-small">伤害类型</label
              ><n-select
                :value="document.damageType"
                :options="toOptions(['ENERGY', 'KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION'])"
                clearable
                @update:value="actions.setField('damageType', $event)"
              />
            </div>
          </n-collapse-item>

          <n-collapse-item title="AI 提示" name="aiHints">
            <JsonValueInput :value="view.aiHintsJson" label="aiHints" shape="object" @update="view.aiHintsJson = $event" />
          </n-collapse-item>

          <n-collapse-item title="额外字段" name="extra">
            <JsonFieldEditor
              :model-value="view.extraFields"
              :known-keys="view.structuredKnownKeys"
              @update:model-value="actions.onExtraUpdate"
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
import JsonFieldEditor from '@/shared/ui/JsonFieldEditor.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { SYSTEM_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { editorCollapseTheme, toOptions } from '@/domain/editors/lib/editor-constants';
import {
  useSpecSystemEditorViewModel,
  type SpecSystemEditorProps,
  type SpecSystemEditorEvents,
} from '@/app/composables/spec-editor/system/use-spec-system-editor-view-model';

const props = defineProps<SpecSystemEditorProps>();
const emit = defineEmits<SpecSystemEditorEvents>();

const { document, view, actions } = useSpecSystemEditorViewModel(props, emit);
</script>
