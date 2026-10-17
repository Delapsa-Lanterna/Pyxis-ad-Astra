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
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="系统 ID" /></label
            ><n-input :value="systemId" disabled />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="系统类型" /></label
            ><n-select :value="view.systemType" :options="toOptions([...SYSTEM_TYPES])" @update:value="actions.onTypeChange" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="AI 行为类型" :path="'aiType'" /></label
            ><n-select
              :value="document.aiType"
              :options="toOptions([...view.AI_TYPES])"
              filterable
              tag
              @update:value="actions.setField('aiType', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="效果脚本" :path="'statsScript'" /></label
            ><n-input :value="document.statsScript" @update:value="actions.setField('statsScript', $event)" />
            <template v-if="view.showCustomAi">
              <label class="form-grid-label field-label-multi ui-text-muted ui-text-small"
                ><SpecFieldLabel raw="AI 脚本" :path="'aiScript'" /></label
              ><n-input :value="document.aiScript" @update:value="actions.setField('aiScript', $event)" />
            </template>
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="行为标志" name="behavior">
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="暂停时运行脚本" :path="'runScriptWhilePaused'" /></label
            ><n-switch :value="document.runScriptWhilePaused" @update:value="actions.setField('runScriptWhilePaused', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="闲置时运行脚本" :path="'runScriptWhileIdle'" /></label
            ><n-switch :value="document.runScriptWhileIdle" @update:value="actions.setField('runScriptWhileIdle', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="充能降低时阻止动作" :path="'blockActionsWhileChargingDown'" /></label
            ><n-switch
              :value="document.blockActionsWhileChargingDown"
              @update:value="actions.setField('blockActionsWhileChargingDown', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="不会导致过载" :path="'canNotCauseOverload'" /></label
            ><n-switch :value="document.canNotCauseOverload" @update:value="actions.setField('canNotCauseOverload', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="右键系统开启时可用" :path="'canUseWhileRightClickSystemOn'" /></label
            ><n-switch
              :value="document.canUseWhileRightClickSystemOn"
              @update:value="actions.setField('canUseWhileRightClickSystemOn', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="效果后限制转向" :path="'clampTurnRateAfter'" /></label
            ><n-switch :value="document.clampTurnRateAfter" @update:value="actions.setField('clampTurnRateAfter', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="效果后限制速度" :path="'clampMaxSpeedAfter'" /></label
            ><n-switch :value="document.clampMaxSpeedAfter" @update:value="actions.setField('clampMaxSpeedAfter', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="持续加速" :path="'alwaysAccelerate'" /></label
            ><n-switch :value="document.alwaysAccelerate" @update:value="actions.setField('alwaysAccelerate', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="撞击失控概率" :path="'flameoutOnImpactChance'" /></label
            ><NumberValueInput
              :value="document.flameoutOnImpactChance"
              :step="0.1"
              @update:value="actions.setField('flameoutOnImpactChance', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="充能降低时淡出音效" :path="'fadeActivationSoundOnChargedown'" /></label
            ><n-switch
              :value="document.fadeActivationSoundOnChargedown"
              @update:value="actions.setField('fadeActivationSoundOnChargedown', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="开盾时取消系统" :path="'activatingShieldsCancels'" /></label
            ><n-switch :value="document.activatingShieldsCancels" @update:value="actions.setField('activatingShieldsCancels', $event)" />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="音效" name="sound">
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="激活音效" :path="'useSound'" /></label
            ><n-input :value="document.useSound" @update:value="actions.setField('useSound', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="循环音效" :path="'loopSound'" /></label
            ><n-input :value="document.loopSound" @update:value="actions.setField('loopSound', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="关闭音效" :path="'deactivateSound'" /></label
            ><n-input :value="document.deactivateSound" @update:value="actions.setField('deactivateSound', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="用尽音效" :path="'outOfUsesSound'" /></label
            ><n-input :value="document.outOfUsesSound" @update:value="actions.setField('outOfUsesSound', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="滤波类型" :path="'soundFilterType'" /></label
            ><n-select
              :value="document.soundFilterType"
              :options="toOptions(['LOWPASS'])"
              clearable
              @update:value="actions.setField('soundFilterType', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="滤波增益" :path="'soundFilterGain'" /></label
            ><NumberValueInput :value="document.soundFilterGain" :step="0.05" @update:value="actions.setField('soundFilterGain', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="高频滤波增益" :path="'soundFilterGainHF'" /></label
            ><NumberValueInput
              :value="document.soundFilterGainHF"
              :step="0.05"
              @update:value="actions.setField('soundFilterGainHF', $event)"
            />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="引擎视觉" name="engine">
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="光柱长度倍率" :path="'engineGlowLengthMult'" /></label
            ><NumberValueInput
              :value="document.engineGlowLengthMult"
              :step="0.1"
              @update:value="actions.setField('engineGlowLengthMult', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="光柱宽度倍率" :path="'engineGlowWidthMult'" /></label
            ><NumberValueInput
              :value="document.engineGlowWidthMult"
              :step="0.1"
              @update:value="actions.setField('engineGlowWidthMult', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="辉光强度倍率" :path="'engineGlowGlowMult'" /></label
            ><NumberValueInput
              :value="document.engineGlowGlowMult"
              :step="0.1"
              @update:value="actions.setField('engineGlowGlowMult', $event)"
            />
          </div>
          <ColorPicker label="引擎发光颜色" v-model="view.engineGlowColor" />
          <ColorPicker label="引擎尾迹颜色" v-model="view.engineGlowContrailColor" />
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="武器发光" name="weaponGlow">
          <ColorPicker label="武器发光颜色" v-model="view.weaponGlowColor" />
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="受影响武器类型" :path="'weaponTypes'" /></label
            ><n-select
              :value="document.weaponTypes"
              :options="toOptions(['ENERGY', 'BALLISTIC', 'MISSILE', 'SYSTEM'])"
              multiple
              @update:value="actions.setField('weaponTypes', $event)"
            />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="抖动效果" name="jitter">
          <ColorPicker label="抖动颜色" v-model="view.jitterColor" />
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="抖动副本数" :path="'jitterCopies'" /></label
            ><NumberValueInput :value="document.jitterCopies" @update:value="actions.setField('jitterCopies', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="最小范围" :path="'jitterMinRange'" /></label
            ><NumberValueInput :value="document.jitterMinRange" @update:value="actions.setField('jitterMinRange', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="抖动范围" :path="'jitterRange'" /></label
            ><NumberValueInput :value="document.jitterRange" @update:value="actions.setField('jitterRange', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="范围半径比例" :path="'jitterRangeRadiusFraction'" /></label
            ><NumberValueInput
              :value="document.jitterRangeRadiusFraction"
              :step="0.1"
              @update:value="actions.setField('jitterRangeRadiusFraction', $event)"
            />
          </div>
          <ColorPicker label="底层抖动颜色" v-model="view.jitterUnderColor" />
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="底层副本数" :path="'jitterUnderCopies'" /></label
            ><NumberValueInput :value="document.jitterUnderCopies" @update:value="actions.setField('jitterUnderCopies', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="底层最小范围" :path="'jitterUnderMinRange'" /></label
            ><NumberValueInput :value="document.jitterUnderMinRange" @update:value="actions.setField('jitterUnderMinRange', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="底层抖动范围" :path="'jitterUnderRange'" /></label
            ><NumberValueInput :value="document.jitterUnderRange" @update:value="actions.setField('jitterUnderRange', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="底层范围半径比例" :path="'jitterUnderRangeRadiusFraction'" /></label
            ><NumberValueInput
              :value="document.jitterUnderRangeRadiusFraction"
              :step="0.1"
              @update:value="actions.setField('jitterUnderRangeRadiusFraction', $event)"
            />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="效果与相位视觉" name="phase">
          <ColorPicker label="效果颜色 1" v-model="view.effectColor1" />
          <ColorPicker label="效果颜色 2" v-model="view.effectColor2" />
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="高光贴图后缀" :path="'phaseHighlight'" /></label
            ><n-input :value="document.phaseHighlight" @update:value="actions.setField('phaseHighlight', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="漫射贴图后缀" :path="'phaseDiffuse'" /></label
            ><n-input :value="document.phaseDiffuse" @update:value="actions.setField('phaseDiffuse', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="舰船透明度" :path="'shipAlpha'" /></label
            ><NumberValueInput :value="document.shipAlpha" :step="0.05" @update:value="actions.setField('shipAlpha', $event)" />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="护盾视觉" name="shield">
          <ColorPicker label="护盾环颜色" v-model="view.shieldRingColor" />
          <ColorPicker label="护盾内部颜色" v-model="view.shieldInnerColor" />
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="护盾厚度倍率" :path="'shieldThicknessMult'" /></label
            ><NumberValueInput
              :value="document.shieldThicknessMult"
              :step="0.1"
              @update:value="actions.setField('shieldThicknessMult', $event)"
            />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="护盾波动倍率" :path="'shieldFluctuationMult'" /></label
            ><NumberValueInput
              :value="document.shieldFluctuationMult"
              :step="0.1"
              @update:value="actions.setField('shieldFluctuationMult', $event)"
            />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" v-if="view.showDisplacerSection" title="位移器参数" name="displacer">
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="位移距离" :path="'range'" /></label
            ><NumberValueInput :value="document.range" @update:value="actions.setField('range', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="随机偏移" :path="'randomRange'" /></label
            ><NumberValueInput :value="document.randomRange" @update:value="actions.setField('randomRange', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="传送时渲染副本" :path="'renderCopyDuringTeleport'" /></label
            ><n-switch :value="document.renderCopyDuringTeleport" @update:value="actions.setField('renderCopyDuringTeleport', $event)" />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" v-if="view.showWeaponSection" title="武器系统" name="weaponSystem">
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="关联武器 ID" :path="'weaponDataId'" /></label
            ><n-input :value="document.weaponDataId" @update:value="actions.setField('weaponDataId', $event)" />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" v-if="view.showDroneSection" title="无人机参数" name="drone">
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="无人机装配 ID" :path="'droneVariant'" /></label
            ><n-input :value="document.droneVariant" @update:value="actions.setField('droneVariant', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="允许自由漫游" :path="'allowFreeRoam'" /></label
            ><n-switch :value="document.allowFreeRoam" @update:value="actions.setField('allowFreeRoam', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="发射速度" :path="'launchSpeed'" /></label
            ><NumberValueInput :value="document.launchSpeed" @update:value="actions.setField('launchSpeed', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="发射延迟" :path="'launchDelay'" /></label
            ><NumberValueInput :value="document.launchDelay" :step="0.1" @update:value="actions.setField('launchDelay', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="最大无人机数" :path="'maxDrones'" /></label
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

        <n-collapse-item class="schema-section" title="伤害（AI 理解用）" name="damage">
          <div class="form-grid ui-layout-grid ui-layout-shrink ui-layout-center">
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="EMP 伤害" :path="'empDamage'" /></label
            ><NumberValueInput :value="document.empDamage" @update:value="actions.setField('empDamage', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="伤害值" :path="'damage'" /></label
            ><NumberValueInput :value="document.damage" @update:value="actions.setField('damage', $event)" />
            <label
              class="form-grid-label field-label-multi ui-text-muted ui-text-small ui-text-normal ui-layout-row ui-layout-shrink ui-layout-stack ui-text-wrap"
              ><SpecFieldLabel raw="伤害类型" :path="'damageType'" /></label
            ><n-select
              :value="document.damageType"
              :options="toOptions(['ENERGY', 'KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION'])"
              clearable
              @update:value="actions.setField('damageType', $event)"
            />
          </div>
        </n-collapse-item>

        <n-collapse-item class="schema-section" title="AI 提示" name="aiHints">
          <JsonValueInput :value="view.aiHintsJson" label="aiHints" shape="object" @update="view.aiHintsJson = $event" />
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
import SpecFieldLabel from '@/app/components/editors/common/SpecFieldLabel.vue';
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
