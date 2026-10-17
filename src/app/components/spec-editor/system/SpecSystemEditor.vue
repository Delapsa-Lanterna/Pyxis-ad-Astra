<template>
  <div class="projectile-window ui-content-grid ui-content-surface">
    <EditorHeader
      :title="systemId"
      :path="path"
      :dirty="dirty"
      :saving="saving"
      :external-update-notice="externalUpdateNotice"
      @load-external="$emit('load-external')"
      ><template #actions
        ><n-button @click="$emit('close')">关闭</n-button
        ><n-button :disabled="!dirty || saving" @click="$emit('reset-requested')">重置</n-button
        ><n-button type="primary" :disabled="!canSave" :loading="saving" @click="$emit('save-requested')">保存</n-button></template
      ></EditorHeader
    >
    <div class="projectile-body ui-content-scroll">
      <n-collapse v-model:expanded-names="view.expandedSections">
        <n-collapse-item class="schema-section" title="基础信息" name="basic">
          <div class="ui-field-stack">
            <FieldRow label="系统 ID" field-key="id"><n-input :value="systemId" disabled /></FieldRow>
            <FieldRow label="系统类型" field-key="type"
              ><n-select :value="view.systemType" :options="toOptions([...SYSTEM_TYPES])" @update:value="actions.onTypeChange"
            /></FieldRow>
            <FieldRow label="AI 行为类型" field-key="aiType" :path="'aiType'"
              ><n-select
                :value="document.aiType"
                :options="toOptions([...view.AI_TYPES])"
                filterable
                tag
                @update:value="actions.setField('aiType', $event)"
            /></FieldRow>
            <FieldRow label="效果脚本" field-key="statsScript" :path="'statsScript'"
              ><n-input :value="document.statsScript" @update:value="actions.setField('statsScript', $event)"
            /></FieldRow>
            <template v-if="view.showCustomAi">
              <FieldRow label="AI 脚本" field-key="aiScript" :path="'aiScript'"
                ><n-input :value="document.aiScript" @update:value="actions.setField('aiScript', $event)"
              /></FieldRow>
            </template>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="行为标志" name="behavior">
          <div class="ui-field-stack">
            <FieldRow label="暂停时运行脚本" field-key="runScriptWhilePaused" :path="'runScriptWhilePaused'"
              ><n-switch :value="document.runScriptWhilePaused" @update:value="actions.setField('runScriptWhilePaused', $event)"
            /></FieldRow>
            <FieldRow label="闲置时运行脚本" field-key="runScriptWhileIdle" :path="'runScriptWhileIdle'"
              ><n-switch :value="document.runScriptWhileIdle" @update:value="actions.setField('runScriptWhileIdle', $event)"
            /></FieldRow>
            <FieldRow label="充能降低时阻止动作" field-key="blockActionsWhileChargingDown" :path="'blockActionsWhileChargingDown'"
              ><n-switch
                :value="document.blockActionsWhileChargingDown"
                @update:value="actions.setField('blockActionsWhileChargingDown', $event)"
            /></FieldRow>
            <FieldRow label="不会导致过载" field-key="canNotCauseOverload" :path="'canNotCauseOverload'"
              ><n-switch :value="document.canNotCauseOverload" @update:value="actions.setField('canNotCauseOverload', $event)"
            /></FieldRow>
            <FieldRow label="右键系统开启时可用" field-key="canUseWhileRightClickSystemOn" :path="'canUseWhileRightClickSystemOn'"
              ><n-switch
                :value="document.canUseWhileRightClickSystemOn"
                @update:value="actions.setField('canUseWhileRightClickSystemOn', $event)"
            /></FieldRow>
            <FieldRow label="效果后限制转向" field-key="clampTurnRateAfter" :path="'clampTurnRateAfter'"
              ><n-switch :value="document.clampTurnRateAfter" @update:value="actions.setField('clampTurnRateAfter', $event)"
            /></FieldRow>
            <FieldRow label="效果后限制速度" field-key="clampMaxSpeedAfter" :path="'clampMaxSpeedAfter'"
              ><n-switch :value="document.clampMaxSpeedAfter" @update:value="actions.setField('clampMaxSpeedAfter', $event)"
            /></FieldRow>
            <FieldRow label="持续加速" field-key="alwaysAccelerate" :path="'alwaysAccelerate'"
              ><n-switch :value="document.alwaysAccelerate" @update:value="actions.setField('alwaysAccelerate', $event)"
            /></FieldRow>
            <FieldRow label="撞击失控概率" field-key="flameoutOnImpactChance" :path="'flameoutOnImpactChance'"
              ><NumberValueInput
                :value="document.flameoutOnImpactChance"
                :step="0.1"
                @update:value="actions.setField('flameoutOnImpactChance', $event)"
            /></FieldRow>
            <FieldRow label="充能降低时淡出音效" field-key="fadeActivationSoundOnChargedown" :path="'fadeActivationSoundOnChargedown'"
              ><n-switch
                :value="document.fadeActivationSoundOnChargedown"
                @update:value="actions.setField('fadeActivationSoundOnChargedown', $event)"
            /></FieldRow>
            <FieldRow label="开盾时取消系统" field-key="activatingShieldsCancels" :path="'activatingShieldsCancels'"
              ><n-switch :value="document.activatingShieldsCancels" @update:value="actions.setField('activatingShieldsCancels', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="音效" name="sound">
          <div class="ui-field-stack">
            <FieldRow label="激活音效" field-key="useSound" :path="'useSound'"
              ><n-input :value="document.useSound" @update:value="actions.setField('useSound', $event)"
            /></FieldRow>
            <FieldRow label="循环音效" field-key="loopSound" :path="'loopSound'"
              ><n-input :value="document.loopSound" @update:value="actions.setField('loopSound', $event)"
            /></FieldRow>
            <FieldRow label="关闭音效" field-key="deactivateSound" :path="'deactivateSound'"
              ><n-input :value="document.deactivateSound" @update:value="actions.setField('deactivateSound', $event)"
            /></FieldRow>
            <FieldRow label="用尽音效" field-key="outOfUsesSound" :path="'outOfUsesSound'"
              ><n-input :value="document.outOfUsesSound" @update:value="actions.setField('outOfUsesSound', $event)"
            /></FieldRow>
            <FieldRow label="滤波类型" field-key="soundFilterType" :path="'soundFilterType'"
              ><n-select
                :value="document.soundFilterType"
                :options="toOptions(['LOWPASS'])"
                clearable
                @update:value="actions.setField('soundFilterType', $event)"
            /></FieldRow>
            <FieldRow label="滤波增益" field-key="soundFilterGain" :path="'soundFilterGain'"
              ><NumberValueInput :value="document.soundFilterGain" :step="0.05" @update:value="actions.setField('soundFilterGain', $event)"
            /></FieldRow>
            <FieldRow label="高频滤波增益" field-key="soundFilterGainHF" :path="'soundFilterGainHF'"
              ><NumberValueInput
                :value="document.soundFilterGainHF"
                :step="0.05"
                @update:value="actions.setField('soundFilterGainHF', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="引擎视觉" name="engine">
          <div class="ui-field-stack">
            <FieldRow label="光柱长度倍率" field-key="engineGlowLengthMult" :path="'engineGlowLengthMult'"
              ><NumberValueInput
                :value="document.engineGlowLengthMult"
                :step="0.1"
                @update:value="actions.setField('engineGlowLengthMult', $event)"
            /></FieldRow>
            <FieldRow label="光柱宽度倍率" field-key="engineGlowWidthMult" :path="'engineGlowWidthMult'"
              ><NumberValueInput
                :value="document.engineGlowWidthMult"
                :step="0.1"
                @update:value="actions.setField('engineGlowWidthMult', $event)"
            /></FieldRow>
            <FieldRow label="辉光强度倍率" field-key="engineGlowGlowMult" :path="'engineGlowGlowMult'"
              ><NumberValueInput
                :value="document.engineGlowGlowMult"
                :step="0.1"
                @update:value="actions.setField('engineGlowGlowMult', $event)"
            /></FieldRow>
          </div>
          <FieldRow label="引擎发光颜色" field-key="engineGlowColor"
            ><ColorPicker label="引擎发光颜色" v-model="view.engineGlowColor"
          /></FieldRow>
          <FieldRow label="引擎尾迹颜色" field-key="engineGlowContrailColor"
            ><ColorPicker label="引擎尾迹颜色" v-model="view.engineGlowContrailColor"
          /></FieldRow>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="武器发光" name="weaponGlow">
          <FieldRow label="武器发光颜色" field-key="weaponGlowColor"
            ><ColorPicker label="武器发光颜色" v-model="view.weaponGlowColor"
          /></FieldRow>
          <div class="ui-field-stack">
            <FieldRow label="受影响武器类型" field-key="weaponTypes" :path="'weaponTypes'"
              ><n-select
                :value="document.weaponTypes"
                :options="toOptions(['ENERGY', 'BALLISTIC', 'MISSILE', 'SYSTEM'])"
                multiple
                @update:value="actions.setField('weaponTypes', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="抖动效果" name="jitter">
          <FieldRow label="抖动颜色" field-key="jitterColor"><ColorPicker label="抖动颜色" v-model="view.jitterColor" /></FieldRow>
          <div class="ui-field-stack">
            <FieldRow label="抖动副本数" field-key="jitterCopies" :path="'jitterCopies'"
              ><NumberValueInput :value="document.jitterCopies" @update:value="actions.setField('jitterCopies', $event)"
            /></FieldRow>
            <FieldRow label="最小范围" field-key="jitterMinRange" :path="'jitterMinRange'"
              ><NumberValueInput :value="document.jitterMinRange" @update:value="actions.setField('jitterMinRange', $event)"
            /></FieldRow>
            <FieldRow label="抖动范围" field-key="jitterRange" :path="'jitterRange'"
              ><NumberValueInput :value="document.jitterRange" @update:value="actions.setField('jitterRange', $event)"
            /></FieldRow>
            <FieldRow label="范围半径比例" field-key="jitterRangeRadiusFraction" :path="'jitterRangeRadiusFraction'"
              ><NumberValueInput
                :value="document.jitterRangeRadiusFraction"
                :step="0.1"
                @update:value="actions.setField('jitterRangeRadiusFraction', $event)"
            /></FieldRow>
          </div>
          <FieldRow label="底层抖动颜色" field-key="jitterUnderColor"
            ><ColorPicker label="底层抖动颜色" v-model="view.jitterUnderColor"
          /></FieldRow>
          <div class="ui-field-stack">
            <FieldRow label="底层副本数" field-key="jitterUnderCopies" :path="'jitterUnderCopies'"
              ><NumberValueInput :value="document.jitterUnderCopies" @update:value="actions.setField('jitterUnderCopies', $event)"
            /></FieldRow>
            <FieldRow label="底层最小范围" field-key="jitterUnderMinRange" :path="'jitterUnderMinRange'"
              ><NumberValueInput :value="document.jitterUnderMinRange" @update:value="actions.setField('jitterUnderMinRange', $event)"
            /></FieldRow>
            <FieldRow label="底层抖动范围" field-key="jitterUnderRange" :path="'jitterUnderRange'"
              ><NumberValueInput :value="document.jitterUnderRange" @update:value="actions.setField('jitterUnderRange', $event)"
            /></FieldRow>
            <FieldRow label="底层范围半径比例" field-key="jitterUnderRangeRadiusFraction" :path="'jitterUnderRangeRadiusFraction'"
              ><NumberValueInput
                :value="document.jitterUnderRangeRadiusFraction"
                :step="0.1"
                @update:value="actions.setField('jitterUnderRangeRadiusFraction', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="效果与相位视觉" name="phase">
          <FieldRow label="效果颜色 1" field-key="effectColor1"><ColorPicker label="效果颜色 1" v-model="view.effectColor1" /></FieldRow>
          <FieldRow label="效果颜色 2" field-key="effectColor2"><ColorPicker label="效果颜色 2" v-model="view.effectColor2" /></FieldRow>
          <div class="ui-field-stack">
            <FieldRow label="高光贴图后缀" field-key="phaseHighlight" :path="'phaseHighlight'"
              ><n-input :value="document.phaseHighlight" @update:value="actions.setField('phaseHighlight', $event)"
            /></FieldRow>
            <FieldRow label="漫射贴图后缀" field-key="phaseDiffuse" :path="'phaseDiffuse'"
              ><n-input :value="document.phaseDiffuse" @update:value="actions.setField('phaseDiffuse', $event)"
            /></FieldRow>
            <FieldRow label="舰船透明度" field-key="shipAlpha" :path="'shipAlpha'"
              ><NumberValueInput :value="document.shipAlpha" :step="0.05" @update:value="actions.setField('shipAlpha', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="护盾视觉" name="shield">
          <FieldRow label="护盾环颜色" field-key="shieldRingColor"
            ><ColorPicker label="护盾环颜色" v-model="view.shieldRingColor"
          /></FieldRow>
          <FieldRow label="护盾内部颜色" field-key="shieldInnerColor"
            ><ColorPicker label="护盾内部颜色" v-model="view.shieldInnerColor"
          /></FieldRow>
          <div class="ui-field-stack">
            <FieldRow label="护盾厚度倍率" field-key="shieldThicknessMult" :path="'shieldThicknessMult'"
              ><NumberValueInput
                :value="document.shieldThicknessMult"
                :step="0.1"
                @update:value="actions.setField('shieldThicknessMult', $event)"
            /></FieldRow>
            <FieldRow label="护盾波动倍率" field-key="shieldFluctuationMult" :path="'shieldFluctuationMult'"
              ><NumberValueInput
                :value="document.shieldFluctuationMult"
                :step="0.1"
                @update:value="actions.setField('shieldFluctuationMult', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" v-if="view.showDisplacerSection" title="位移器参数" name="displacer">
          <div class="ui-field-stack">
            <FieldRow label="位移距离" field-key="range" :path="'range'"
              ><NumberValueInput :value="document.range" @update:value="actions.setField('range', $event)"
            /></FieldRow>
            <FieldRow label="随机偏移" field-key="randomRange" :path="'randomRange'"
              ><NumberValueInput :value="document.randomRange" @update:value="actions.setField('randomRange', $event)"
            /></FieldRow>
            <FieldRow label="传送时渲染副本" field-key="renderCopyDuringTeleport" :path="'renderCopyDuringTeleport'"
              ><n-switch :value="document.renderCopyDuringTeleport" @update:value="actions.setField('renderCopyDuringTeleport', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" v-if="view.showWeaponSection" title="武器系统" name="weaponSystem">
          <div class="ui-field-stack">
            <FieldRow label="关联武器 ID" field-key="weaponDataId" :path="'weaponDataId'"
              ><n-input :value="document.weaponDataId" @update:value="actions.setField('weaponDataId', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" v-if="view.showDroneSection" title="无人机参数" name="drone">
          <div class="ui-field-stack">
            <FieldRow label="无人机装配 ID" field-key="droneVariant" :path="'droneVariant'"
              ><n-input :value="document.droneVariant" @update:value="actions.setField('droneVariant', $event)"
            /></FieldRow>
            <FieldRow label="允许自由漫游" field-key="allowFreeRoam" :path="'allowFreeRoam'"
              ><n-switch :value="document.allowFreeRoam" @update:value="actions.setField('allowFreeRoam', $event)"
            /></FieldRow>
            <FieldRow label="发射速度" field-key="launchSpeed" :path="'launchSpeed'"
              ><NumberValueInput :value="document.launchSpeed" @update:value="actions.setField('launchSpeed', $event)"
            /></FieldRow>
            <FieldRow label="发射延迟" field-key="launchDelay" :path="'launchDelay'"
              ><NumberValueInput :value="document.launchDelay" :step="0.1" @update:value="actions.setField('launchDelay', $event)"
            /></FieldRow>
            <FieldRow label="最大无人机数" field-key="maxDrones" :path="'maxDrones'"
              ><NumberValueInput :value="document.maxDrones" @update:value="actions.setField('maxDrones', $event)"
            /></FieldRow>
          </div>
          <h4 class="system-editor-heading projectile-body-subtitle">无人机行为定义</h4>
          <FieldRow :label="fieldNames['droneBehavior'] ?? 'droneBehavior'" field-key="droneBehavior" layout="group"
            ><JsonValueInput
              :value="document.droneBehavior ?? []"
              label="droneBehavior"
              shape="array"
              @update="actions.droneBehaviorUpdated"
          /></FieldRow>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="伤害（AI 理解用）" name="damage">
          <div class="ui-field-stack">
            <FieldRow label="EMP 伤害" field-key="empDamage" :path="'empDamage'"
              ><NumberValueInput :value="document.empDamage" @update:value="actions.setField('empDamage', $event)"
            /></FieldRow>
            <FieldRow label="伤害值" field-key="damage" :path="'damage'"
              ><NumberValueInput :value="document.damage" @update:value="actions.setField('damage', $event)"
            /></FieldRow>
            <FieldRow label="伤害类型" field-key="damageType" :path="'damageType'"
              ><n-select
                :value="document.damageType"
                :options="toOptions(['ENERGY', 'KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION'])"
                clearable
                @update:value="actions.setField('damageType', $event)"
            /></FieldRow>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="AI 提示" name="aiHints">
          <FieldRow :label="fieldNames['aiHints'] ?? 'aiHints'" field-key="aiHints" layout="group"
            ><JsonValueInput :value="view.aiHintsJson" label="aiHints" shape="object" @update="view.aiHintsJson = $event"
          /></FieldRow>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="额外字段" name="extra">
          <JsonFieldEditor
            :model-value="view.extraFields"
            :known-keys="view.structuredKnownKeys"
            @update:model-value="actions.onExtraUpdate"
          />
        </n-collapse-item>
      </n-collapse>
    </div>
    <EditorFooter note="结构化 JSON 写回，完整保留业务字段。"> </EditorFooter>
  </div>
</template>

<script setup lang="ts">
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import { fieldNames } from '@/domain/editors/lib/field-names';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import JsonFieldEditor from '@/shared/ui/JsonFieldEditor.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import JsonValueInput from '@/shared/ui/JsonValueInput.vue';
import NumberValueInput from '@/shared/ui/NumberValueInput.vue';
import { SYSTEM_TYPES } from '@/domain/editors/lib/game-spec-enums';
import { toOptions } from '@/domain/editors/lib/editor-constants';
import {
  useSpecSystemEditorViewModel,
  type SpecSystemEditorProps,
  type SpecSystemEditorEvents,
} from '@/app/composables/spec-editor/system/use-spec-system-editor-view-model';

const props = defineProps<SpecSystemEditorProps>();
const emit = defineEmits<SpecSystemEditorEvents>();

const { document, view, actions } = useSpecSystemEditorViewModel(props, emit);
</script>
