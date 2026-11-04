import { defineComponent, type Component } from 'vue';
import { inputProps } from 'naive-ui/es/input';
import { inputNumberProps } from 'naive-ui/es/input-number';
import { switchProps } from 'naive-ui/es/switch';
import { sliderProps } from 'naive-ui/es/slider';
import { selectProps, type SelectProps } from 'naive-ui/es/select';
import { buttonProps } from 'naive-ui/es/button';
import { checkboxProps } from 'naive-ui/es/checkbox';
import { dynamicTagsProps, type DynamicTagsProps } from 'naive-ui/es/dynamic-tags';
import { popoverProps } from 'naive-ui/es/popover';
import { collapseProps, collapseItemProps, type CollapseProps } from 'naive-ui/es/collapse';

function pickProps<Props extends object, Key extends keyof Props>(props: Props, keys: readonly Key[]): Pick<Props, Key> {
  return Object.fromEntries(keys.map((key) => [key, props[key]])) as Pick<Props, Key>;
}

export type GlobalStubs = Record<string, Component>;

/// Minimal Naive UI stand-ins for component tests: elements keep the same
/// update:* events so specs can drive them through native inputs.
export const nInput = defineComponent({
  props: pickProps(inputProps, ['value', 'type', 'placeholder', 'disabled', 'size', 'status', 'autosize']),
  emits: {
    'update:value': (_value: string) => true,
    change: (_value: string) => true,
    blur: (_event: FocusEvent) => true,
  },
  methods: {
    focus(this: { $el: HTMLElement }) {
      this.$el.focus();
    },
  },
  template: `<textarea
    v-if="type === 'textarea'"
    :value="value ?? ''"
    :disabled="disabled"
    @input="$emit('update:value', $event.target.value)"
    @change="$emit('change', $event.target.value)"
    @blur="$emit('blur', $event)"
  />
  <input
    v-else
    :value="value ?? ''"
    :disabled="disabled"
    @input="$emit('update:value', $event.target.value)"
    @change="$emit('change', $event.target.value)"
    @blur="$emit('blur', $event)"
  />`,
});

export const nInputNumber = defineComponent({
  props: pickProps(inputNumberProps, [
    'value',
    'disabled',
    'min',
    'max',
    'size',
    'step',
    'showButton',
    'format',
    'parse',
    'inputProps',
    'status',
  ]),
  emits: {
    'update:value': (_value: number | null) => true,
  },
  methods: nInput.methods,
  template: `<input
    :type="format ? 'text' : 'number'"
    :value="format ? format(value) : value ?? ''"
    :disabled="disabled"
    @input="inputProps?.onInput ? inputProps.onInput($event) : $emit('update:value', $event.target.value === '' ? null : Number($event.target.value))"
  />`,
});

export const nSwitch = defineComponent({
  props: pickProps(switchProps, ['value', 'size', 'disabled']),
  emits: {
    'update:value': (_value: boolean) => true,
  },
  template: `<button type="button" class="n-switch-stub" :disabled="disabled" @click="$emit('update:value', !value)" />`,
});

export const nSlider = defineComponent({
  props: pickProps(sliderProps, ['value', 'min', 'max', 'step']),
  emits: {
    'update:value': (_value: number) => true,
  },
  template: `<input class="n-slider-stub" type="range" :value="value" :min="min" :max="max" :step="step" @input="$emit('update:value', Number($event.target.value))" />`,
});

export const nSelect = defineComponent({
  props: pickProps(selectProps, ['value', 'options', 'filterable', 'tag', 'clearable', 'disabled', 'size', 'show']),
  emits: {
    'update:value': (_value: NonNullable<SelectProps['value']> | null) => true,
    'update:show': (_show: boolean) => true,
    search: (_value: string) => true,
    blur: (_event: FocusEvent) => true,
  },
  template: `<select
    class="n-select-stub"
    :value="JSON.stringify(value ?? null)"
    :disabled="disabled"
    @change="$emit('update:value', JSON.parse($event.target.value))"
  >
    <template v-for="option in options" :key="option.key ?? JSON.stringify(option.value)">
      <optgroup v-if="option.type === 'group'" :label="option.label">
        <option v-for="child in option.children" :key="JSON.stringify(child.value)" :value="JSON.stringify(child.value)">{{ child.label }}</option>
      </optgroup>
      <option v-else :value="JSON.stringify(option.value)">{{ option.label }}</option>
    </template>
  </select>`,
});

export const nButton = defineComponent({
  props: {
    ...pickProps(buttonProps, ['type', 'size', 'disabled', 'ghost', 'tertiary', 'quaternary', 'secondary', 'loading']),
    title: { type: String, default: undefined },
  },
  emits: {
    click: (_event: MouseEvent) => true,
  },
  template: `<button type="button" :disabled="disabled || loading" @click="$emit('click', $event)"><slot /></button>`,
});

export const nCheckbox = defineComponent({
  props: pickProps(checkboxProps, ['checked']),
  emits: {
    'update:checked': (_checked: boolean) => true,
  },
  template: `<input type="checkbox" :checked="checked" @change="$emit('update:checked', $event.target.checked)" />`,
});

export const nDynamicTags = defineComponent({
  props: pickProps(dynamicTagsProps, ['value']),
  emits: {
    'update:value': (_value: NonNullable<DynamicTagsProps['value']>) => true,
  },
  template: `<span class="n-dynamic-tags-stub">
    <span v-for="tag in value || []" :key="tag" class="n-dynamic-tag" @click="$emit('update:value', (value || []).filter((item) => item !== tag))">{{ tag }}</span>
  </span>`,
});

export const nPopover = defineComponent({
  props: pickProps(popoverProps, ['show', 'placement', 'showArrow', 'raw', 'trigger']),
  emits: {
    'update:show': (_show: boolean) => true,
    clickoutside: (_event: MouseEvent) => true,
  },
  template: `<div class="n-popover-stub"><slot name="trigger" /><div v-if="show"><slot /></div></div>`,
});

export const nCollapse = defineComponent({
  props: pickProps(collapseProps, ['expandedNames', 'themeOverrides']),
  emits: {
    'update:expandedNames': (_names: NonNullable<CollapseProps['expandedNames']>) => true,
  },
  template: `<div class="n-collapse-stub"><slot /></div>`,
});

export const nCollapseItem = defineComponent({
  props: pickProps(collapseItemProps, ['title', 'name']),
  template: `<div class="n-collapse-item-stub" :data-name="name"><div class="n-collapse-item-title"><slot name="header">{{ title }}</slot><slot name="header-extra" /></div><slot /></div>`,
});

/// One bundle covering every Naive UI component used by the editor and table
/// components under test.
export const editorUiStubs = {
  ResourceThumbnail: { props: ['url', 'label'], template: '<img :src="url" :alt="label" />' },
  'n-input': nInput,
  'n-input-number': nInputNumber,
  'n-switch': nSwitch,
  'n-slider': nSlider,
  'n-select': nSelect,
  'n-button': nButton,
  'n-checkbox': nCheckbox,
  'n-dynamic-tags': nDynamicTags,
  'n-image': { props: ['src', 'alt', 'imgProps'], template: '<img :src="src" :alt="alt" v-bind="imgProps" />' },
  'n-popover': nPopover,
  'n-collapse': nCollapse,
  'n-collapse-item': nCollapseItem,
  NCollapse: nCollapse,
  NCollapseItem: nCollapseItem,
  CollapseItem: nCollapseItem,
  EditorCollapseItem: nCollapseItem,
} satisfies GlobalStubs;
