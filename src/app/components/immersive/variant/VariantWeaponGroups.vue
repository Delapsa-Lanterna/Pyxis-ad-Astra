<template>
  <ImmersiveGameFrame class="variant-weapon-groups" :images="images" :style="{ height: groupDialogHeight(equipped.length) + 'px' }">
    <div
      ref="surface"
      class="variant-group-content ui-text-normal ui-layout-row ui-layout-stack"
      role="dialog"
      aria-modal="true"
      aria-label="管理武器组"
      tabindex="-1"
      @keydown.esc.stop.prevent="cancel"
      @keydown.enter.self.stop.prevent="confirm"
      @keydown="shiftHeld = $event.shiftKey"
      @keyup="shiftHeld = $event.shiftKey"
    >
      <header class="variant-group-content-heading ui-control-center ui-content-surface-muted">
        <ImmersiveText text="管理武器组" font="heading" ink-aligned outlined />
      </header>
      <div class="variant-group-autofire ui-layout-grid ui-layout-center">
        <ImmersiveText text="开战时自动开火" ink-aligned outlined />
        <ImmersiveSquareToggle
          v-for="(group, index) in groups"
          :key="index"
          role="checkbox"
          :checked="Boolean(group.autofire)"
          :label="'第' + (index + 1) + '组自动开火'"
          :title="autofireHint"
          :on-image="images.toggle20_on || ''"
          :off-image="images.toggle20_off || ''"
          @change="setGroup(index, 'autofire', !group.autofire)"
        />
      </div>
      <div class="variant-group-tables ui-layout-row">
        <section class="variant-group-matrix ui-layout-row ui-layout-stack" :style="{ height: groupTableHeight(equipped.length) + 'px' }">
          <div class="variant-group-table-header ui-layout-grid ui-layout-center">
            <span class="variant-group-table-header-label ui-control-center ui-control-border"
              ><ImmersiveText text="武器" font="heading" ink-aligned outlined
            /></span>
            <span
              class="variant-group-table-header-label ui-control-center ui-control-border"
              v-for="index in WEAPON_GROUP_COUNT"
              :key="index"
              ><ImmersiveText :text="String(index)" font="heading" ink-aligned outlined
            /></span>
          </div>
          <div class="variant-group-weapon-list">
            <div
              v-for="weapon in equipped"
              :key="String(weapon.slot.id)"
              class="variant-group-weapon-row ui-layout-grid ui-layout-center"
              :class="{ highlighted: highlighted(weapon) }"
              :style="{ backgroundColor: groupWeaponColor(weapon) + '40' }"
              @mouseenter="hoverWeapon(weapon, $event)"
              @mousemove="hoverWeapon(weapon, $event)"
              @mouseleave="hoveredWeapon = null"
            >
              <span
                class="variant-group-weapon-name ui-layout-row ui-layout-center ui-layout-clip"
                :title="weapon.name + ' · ' + weapon.slot.id + (weapon.diagnostic ? '\n' + weapon.diagnostic : '')"
              >
                <ImmersiveText
                  :runs="[{ text: weapon.name + ' (' }, { text: mountLabel(weapon), color: '#ffd200' }, { text: ')' }]"
                  ink-aligned
                  outlined
                />
                <svg
                  class="variant-group-weapon-name-icon"
                  width="16"
                  height="16"
                  :aria-label="'射界 ' + weapon.slot.arc + '°'"
                  viewBox="-8 -8 16 16"
                >
                  <circle
                    v-for="radius in [7.5, 7.25, 7.75]"
                    :key="radius"
                    :r="radius"
                    :fill="groupWeaponColor(weapon)"
                    fill-opacity="0.1176470588"
                  />
                  <path
                    :d="immersiveArcPath(Number(weapon.slot.angle), Number(weapon.slot.arc))"
                    transform="translate(1 1) scale(1.0666666667)"
                    fill="#000000"
                    fill-opacity="0.61"
                  />
                  <path
                    v-for="offset in [
                      [0, 0],
                      [0.25, 0.25],
                      [0.25, -0.25],
                      [-0.25, 0.25],
                      [-0.25, -0.25],
                    ]"
                    :key="offset.join('/')"
                    :d="immersiveArcPath(Number(weapon.slot.angle), Number(weapon.slot.arc))"
                    :transform="'translate(' + offset.join(' ') + ')'"
                    :fill="groupWeaponColor(weapon)"
                    fill-opacity="0.1960784314"
                  />
                </svg>
              </span>
              <ImmersiveSquareToggle
                v-for="(group, index) in groups"
                :key="index"
                role="radio"
                :checked="Object.hasOwn(groupWeapons(group), String(weapon.slot.id))"
                :label="weapon.name + '第' + (index + 1) + '组'"
                :title="assignmentHint"
                :on-image="images.toggle20_on || ''"
                :off-image="images.toggle20_off || ''"
                @focus="hoveredWeapon = weapon"
                @blur="hoveredWeapon = null"
                @change="move(weapon, index, $event.shiftKey)"
              />
            </div>
            <ImmersiveText v-if="!equipped.length" text="未安装武器" block />
          </div>
        </section>
        <section class="variant-group-summary">
          <div class="variant-group-summary-header ui-layout-grid ui-layout-center">
            <span class="variant-group-summary-header-label ui-control-center ui-control-border"
              ><ImmersiveText text="武器组" font="heading" ink-aligned outlined /></span
            ><span class="variant-group-summary-header-label ui-control-center ui-control-border"
              ><ImmersiveText text="开火模式" font="heading" ink-aligned outlined /></span
            ><span class="variant-group-summary-header-label ui-control-center ui-control-border"
              ><ImmersiveText text="幅能" font="heading" ink-aligned outlined
            /></span>
          </div>
          <div class="variant-group-summary-list">
            <button
              v-for="(group, index) in groups"
              :key="index"
              class="variant-group-summary-row ui-button ui-layout-grid ui-layout-center ui-control-pointer ui-layout-stretch ui-control-reset"
              :class="{ empty: !members(group).length }"
              :style="{ backgroundColor: members(group).length ? groupColor(members(group)) + '40' : '#000000' }"
              :aria-label="'第' + (index + 1) + '组开火模式'"
              :title="
                modeHint +
                (Number.isFinite(groupFlux(group))
                  ? ''
                  : '\n幅能来源未确定：' +
                    members(group)
                      .map((weapon) => weapon.id)
                      .join('、'))
              "
              @mouseenter="hoveredGroup = index"
              @mouseleave="hoveredGroup = null"
              @focus="hoveredGroup = index"
              @blur="hoveredGroup = null"
              @click="toggleMode(index)"
            >
              <ImmersiveText :text="'武器组 ' + (index + 1)" ink-aligned outlined />
              <ImmersiveText
                :text="members(group).length ? (group.mode === 'ALTERNATING' ? '交替' : '齐射') : '---'"
                ink-aligned
                outlined
              />
              <ImmersiveText
                :text="members(group).length && Number.isFinite(groupFlux(group)) ? integerFlux(groupFlux(group)) : '---'"
                ink-aligned
                outlined
              />
            </button>
          </div>
          <div class="variant-group-budget">
            <div class="variant-group-budget-content ui-control-between" v-for="stat in budget" :key="stat.label">
              <ImmersiveText :text="stat.label" ink-aligned outlined /><ImmersiveText
                :text="integerFlux(stat.value)"
                ink-aligned
                outlined
              />
            </div>
          </div>
        </section>
      </div>
      <div class="variant-group-actions ui-layout-row">
        <button
          class="variant-cut-button ui-button variant-group-actions-button ui-layout-inline ui-layout-center ui-control-pointer ui-content-surface-muted"
          @click="confirm"
        >
          <ImmersiveText text="确认" font="picker-title" ink-aligned />
        </button>
        <button
          class="variant-cut-button ui-button variant-group-actions-button ui-layout-inline ui-layout-center ui-control-pointer ui-content-surface-muted"
          @click="cancel"
        >
          <ImmersiveText text="取消" font="picker-title" ink-aligned />
        </button>
      </div>
    </div>
  </ImmersiveGameFrame>
</template>
<script setup lang="ts">
import { computed, ref, onMounted, onScopeDispose, watch } from 'vue';
import type { RowData, JsonValue } from '@/shared/types';
import type { VariantProjection, VariantWeapon } from '@/domain/immersive/variant/variant-panel';
import { formatVariantNumber } from '@/domain/immersive/variant/variant-panel';
import { immersiveArcPath } from '@/domain/immersive/hull-scene';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import {
  WEAPON_GROUP_COUNT,
  sevenWeaponGroups,
  sortedGroupWeapons,
  assignGroupWeapons,
  matchingGroupWeapons,
  groupWeapons,
  groupWeaponColor,
  groupColor,
  groupDialogHeight,
  groupTableHeight,
} from '@/domain/immersive/variant/variant-weapon-groups';
import type { useImmersiveVariantEditor } from '@/app/composables/immersive-editor/variant/use-immersive-variant-editor';
import { jointObject } from '@/domain/joint-edit';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import ImmersiveText from '../ImmersiveText.vue';
import ImmersiveSquareToggle from '../ImmersiveSquareToggle.vue';
import ImmersiveGameFrame from '../ImmersiveGameFrame.vue';
const props = defineProps<{ recordKey: string; variant: VariantProjection; vm: ReturnType<typeof useImmersiveVariantEditor> }>();
const emit = defineEmits<{ close: [] }>();
const feedback = useAppFeedback(),
  inputs = useFieldInputs()!;
const surface = ref<HTMLElement | null>(null);
let baseline = sevenWeaponGroups(jointObject(props.vm.joint.draftValue.value[props.recordKey]));
const groups = ref<RowData[]>(deepClone(baseline));
const dirty = computed(() => !stableDeepEqual(groups.value, baseline));
const equipped = computed(() => sortedGroupWeapons(props.variant.weapons));
const hoveredWeapon = ref<VariantWeapon | null>(null),
  hoveredGroup = ref<number | null>(null),
  shiftHeld = ref(false);
const autofireHint = '开战时该组自动开火。自动开火时各武器独立发射，开火模式不影响自动开火。';
const assignmentHint = '点击分配武器组；Shift点击将同型号、同挂载方式的武器一起分配。';
const modeHint = '点击非空组切换齐射／交替。幅能为持续射击每秒幅能，统计采用基础配置。';
const mountLabel = (weapon: VariantWeapon) =>
  weapon.slot.type === 'BUILT_IN'
    ? '内置武器'
    : weapon.slot.mount === 'HARDPOINT'
      ? '固定'
      : weapon.slot.mount === 'HIDDEN'
        ? '隐藏'
        : '炮塔';
const members = (group: RowData) => equipped.value.filter((weapon) => Object.hasOwn(groupWeapons(group), String(weapon.slot.id)));
const groupFlux = (group: RowData) => members(group).reduce((sum, weapon) => sum + weapon.flux, 0);
const integerFlux = (value: number) => formatVariantNumber(Math.trunc(value));
const budget = computed(() => [
  { label: '幅能耗散/秒', value: props.variant.dissipation },
  { label: '护盾幅能/秒', value: props.variant.shieldFlux },
  { label: '幅能容量', value: props.variant.capacity },
]);
const sessionId = props.vm.joint.currentTarget.value!.sessionId;
const resources = computed(() => props.vm.snapshot.value?.referenceSettings.resources ?? {});
const media = useResourceMediaRegistry({
  surface: '武器组控件',
  onError: feedback.error,
  onFailures: () => undefined,
});
const resourceKeys = [
  'toggle20_on',
  'toggle20_off',
  ...['top_left', 'top', 'top_right', 'left', 'right', 'bot_left', 'bot', 'bot_right'].map((edge) => 'ui_border1_' + edge),
];
const images = computed(() => Object.fromEntries(resourceKeys.map((key) => [key, media.dataUrl(sessionId, resources.value[key]) ?? ''])));
watch(
  resources,
  (value) => {
    void media.replaceCollection(
      sessionId,
      'weapon-groups',
      resourceKeys.flatMap((key) => (value[key] ? [value[key]!] : [])),
    );
  },
  { immediate: true },
);
const prefix = 'variant-groups';
onScopeDispose(
  inputs.register({
    key: prefix,
    label: '武器组',
    dirty,
    commit: () =>
      stableDeepEqual(sevenWeaponGroups(jointObject(props.vm.joint.draftValue.value[props.recordKey])), baseline)
        ? null
        : '分组来源已变化，请取消并重新打开核对',
    cancel,
    focus: () => surface.value!.focus(),
  }),
);
onScopeDispose(
  inputs.registerFinalizer(() => {
    if (dirty.value) props.vm.applyVariantAction(props.recordKey, (data) => ({ ...data, weaponGroups: deepClone(groups.value) }));
    emit('close');
  }, prefix),
);
function setGroup(index: number, key: string, value: JsonValue) {
  groups.value[index] = { ...groups.value[index]!, [key]: value };
}
function toggleMode(index: number) {
  if (members(groups.value[index]!).length) setGroup(index, 'mode', groups.value[index]!.mode === 'LINKED' ? 'ALTERNATING' : 'LINKED');
}
function move(weapon: VariantWeapon, destination: number, batch: boolean) {
  groups.value = assignGroupWeapons(groups.value, batch ? matchingGroupWeapons(equipped.value, weapon) : [weapon], destination);
}
function hoverWeapon(weapon: VariantWeapon, event: MouseEvent) {
  hoveredWeapon.value = weapon;
  shiftHeld.value = event.shiftKey;
}
function highlighted(weapon: VariantWeapon) {
  if (hoveredGroup.value !== null) return Object.hasOwn(groupWeapons(groups.value[hoveredGroup.value]!), String(weapon.slot.id));
  return (
    hoveredWeapon.value !== null &&
    (weapon.slot.id === hoveredWeapon.value.slot.id ||
      (shiftHeld.value && weapon.id === hoveredWeapon.value.id && weapon.slot.mount === hoveredWeapon.value.slot.mount))
  );
}
function cancel() {
  groups.value = deepClone(baseline);
  emit('close');
}
async function confirm() {
  try {
    const current = sevenWeaponGroups(jointObject(props.vm.joint.draftValue.value[props.recordKey]));
    if (!stableDeepEqual(current, baseline)) {
      const choice = await feedback.choose({
        title: '武器组来源已变化',
        content: '核对当前草稿分组与本次临时调整后选择接纳内容。',
        choices: [
          { label: '使用本次调整', value: 'local', type: 'primary' },
          { label: '使用当前草稿', value: 'current' },
        ],
      });
      if (choice === 'current') {
        cancel();
        return;
      }
      if (choice !== 'local') return;
      baseline = deepClone(current);
    }
    await inputs.commit(prefix);
  } catch (error) {
    feedback.error(error);
  }
}
onMounted(() => surface.value!.focus({ preventScroll: true }));
</script>
