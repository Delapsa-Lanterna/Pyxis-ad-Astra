<template>
  <n-input-number
    ref="input"
    :key="controlGeneration"
    :value="numericValue"
    :format="format"
    :parse="parse"
    :input-props="{ onInput: captureRaw }"
    :min="min"
    :max="max"
    :step="step"
    :show-button="false"
    :disabled="disabled"
    :size="size"
    :placeholder="placeholder"
    :status="invalid ? 'error' : undefined"
    @update:value="controlUpdated"
    @blur="commit"
    @keydown.enter="commit"
  >
    <template v-if="showButton" #suffix>
      <n-button
        v-for="direction in [-1, 1]"
        :key="direction"
        class="compact-icon-button ui-control-reset"
        text
        :focusable="false"
        :disabled="
          disabled || (numericValue !== null && (direction < 0 ? numericValue <= (min ?? -Infinity) : numericValue >= (max ?? Infinity)))
        "
        :aria-label="direction < 0 ? '减少' : '增加'"
        @mousedown.prevent
        @click="adjust(direction, $event)"
      >
        <svg class="compact-icon-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12h14" />
          <path v-if="direction > 0" d="M12 5v14" />
        </svg>
      </n-button>
    </template>
  </n-input-number>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, ref } from 'vue';
import { useRawFieldInput, type InputConversion } from '@/shared/runtime/raw-field-input';
import { parseInputNumber } from '@/shared/lib/input-number';
import { focusFieldInput } from '@/shared/runtime/focus-field-input';
import { cell } from '@/shared/lib/starsector';

const props = withDefaults(
  defineProps<{
    value: unknown;
    integer?: boolean;
    inputKey?: string;
    label?: string;
    clearAction?: 'null' | 'remove' | 'required';
    min?: number;
    max?: number;
    step?: number;
    showButton?: boolean;
    disabled?: boolean;
    size?: 'small' | 'medium' | 'large';
    placeholder?: string;
  }>(),
  {
    integer: false,
    inputKey: undefined,
    label: '数值',
    clearAction: 'null',
    min: undefined,
    max: undefined,
    step: undefined,
    showButton: true,
    disabled: false,
    size: 'medium',
    placeholder: undefined,
  },
);
const emit = defineEmits<{ 'update:value': [value: number | null]; remove: [] }>();
const input = ref<{ $el: HTMLElement; focus: () => void } | null>(null);
const controlGeneration = ref(0);
const { raw, invalid, update, commit } = useRawFieldInput<number | null>({
  key: props.inputKey ?? 'number/' + getCurrentInstance()!.uid,
  path: props.inputKey,
  label: props.label,
  text: () => cell(props.value),
  convert,
  apply: (converted) => {
    if (converted.kind === 'remove') emit('remove');
    else emit('update:value', converted.value);
  },
  focus: async () => {
    await focusFieldInput(input.value?.$el.querySelector('input') ?? null);
    input.value?.focus();
  },
  canonicalize: true,
  onCancel: () => {
    controlGeneration.value++;
  },
});
const numericValue = computed(() => (typeof props.value === 'number' ? props.value : null));
function format() {
  return raw.value;
}
function convert(text: string): InputConversion<number | null> {
  if (text.trim() === '') {
    if (props.clearAction === 'required') return { kind: 'error', message: '必填字段不能为空' };
    return props.clearAction === 'remove' ? { kind: 'remove' } : { kind: 'value', value: null };
  }
  const value = parseInputNumber(text, props.integer);
  if (typeof value === 'string') return { kind: 'error', message: '请输入完整有效数字' };
  if ((props.min !== undefined && value < props.min) || (props.max !== undefined && value > props.max))
    return { kind: 'error', message: '数值超出允许范围' };
  return { kind: 'value', value };
}
function parse(text: string) {
  const converted = convert(text);
  return converted.kind === 'error' ? Number.NaN : converted.kind === 'remove' ? null : converted.value;
}
function captureRaw(event: Event) {
  const text = (event.target as HTMLInputElement).value;
  update(text);
  const converted = convert(text);
  if (converted.kind === 'value' && converted.value !== null) emit('update:value', converted.value);
}
function adjust(direction: number, event: MouseEvent) {
  const converted = convert(raw.value);
  if (converted.kind === 'error') {
    commit();
    return;
  }
  const current = converted.kind === 'value' ? converted.value : null;
  const multiplier = event.shiftKey ? (event.ctrlKey ? 10 : 5) : event.ctrlKey ? 0.5 : 1;
  const scaled = (Math.abs(props.step ?? 1) || 1) * multiplier;
  const offset = props.integer ? Math.max(1, Math.round(scaled)) : scaled;
  const next = current === null ? 0 : current + direction * offset;
  const precision = Math.max(
    ...[current ?? 0, offset].map((value) => {
      const [coefficient, exponent = '0'] = String(value).split('e');
      return Math.max(0, (coefficient!.split('.')[1]?.length ?? 0) - Number(exponent));
    }),
  );
  const value = Number(next.toFixed(Math.min(100, precision)));
  controlUpdated(Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, value)));
}
function controlUpdated(value: number | null) {
  const converted = convert(raw.value);
  if (converted.kind === 'value' && converted.value === value) return;
  update(value === null ? '' : String(value));
  commit();
}
</script>
