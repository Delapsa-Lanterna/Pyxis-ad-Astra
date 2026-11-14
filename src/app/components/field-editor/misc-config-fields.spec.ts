import SchemaCollectionInput from '@/app/components/field-editor/SchemaCollectionInput.vue';
import SchemaReferenceInput from '@/app/components/field-editor/SchemaReferenceInput.vue';
import type { AppFeedback } from '@/shared/types';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, h, ref, nextTick, toRaw } from 'vue';
import SchemaFormRenderer from './SchemaFormRenderer.vue';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { miscConfigDefinition, MISC_CONFIG_DEFINITIONS } from '@/domain/misc-config';
import { convertSchemaScalarInput, schemaFieldVariant } from '@/domain/schema/schema-values';
import { parseFileSchema } from '@/domain/schema/schema-asset-parser';
import { provideFieldInputs, createFieldInputs } from '@/shared/runtime/field-inputs';
import { createJsonDocument } from '@/domain/json-document';
import { prepareValue } from '@/domain/schema/game-number';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { editorUiStubs } from '@/test/unit/ui-stubs';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';
import { miscConfigFixture } from '@/test/fixtures/misc-config';
import type { MiscConfigKind, RowData } from '@/shared/types';
import type { FieldSchema } from '@/domain/schema/schema.types';

vi.mock('@/services/core-assets.service', () => ({ queryCoreFields: vi.fn(async () => ({})), queryCoreGraphics: vi.fn(async () => []) }));
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreGraphics: () => ({ graphicsPaths: ref([]), loadGraphics: vi.fn() }) }));
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ error: vi.fn(), choose: vi.fn<AppFeedback['choose']>(), warning: vi.fn() }),
}));
let wrapper: VueWrapper | undefined;
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});
function mountConfig(kind: MiscConfigKind, realCollapse = false) {
  const field = getSchema(miscConfigDefinition(kind).schema)!.root!;
  const snapshot = { target: kind, baseVersions: [], meta: null, value: { file: miscConfigFixture(kind) } };
  const owner = createJsonDocument(null, { value: prepareValue(snapshot.value).value }),
    revision = ref(0),
    inputs = createFieldInputs();
  const value = computed({
    get: () => {
      void revision.value;
      return (owner.projection as RowData).file as RowData;
    },
    set: (file) => {
      owner.update({ file }, (value) => prepareValue(value));
      revision.value++;
    },
  });
  wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () =>
          h(SchemaFormRenderer, {
            schema: getSchema(miscConfigDefinition(kind).schema)!,
            runtimeContext: {
              sessionId: 'fixture',
              modRoot: 'M:/fixture',
              document: owner,
              applyDocumentEdit: (edit) => {
                owner.apply(edit);
                revision.value++;
              },
            },
            modelValue: { file: value.value },
            'onUpdate:modelValue': (update: RowData) => {
              value.value = update.file as RowData;
            },
          });
      },
    },
    {
      global: {
        components: { NCollapse, NCollapseItem },
        stubs: realCollapse
          ? Object.fromEntries(Object.entries(editorUiStubs).filter(([name]) => !name.toLowerCase().includes('collapse')))
          : editorUiStubs,
      },
      attachTo: document.body,
    },
  );
  return { value, inputs, field };
}

describe('misc config fields', () => {
  it('defers completeness of partial style overrides to the merged save boundary', async () => {
    const { value, inputs } = mountConfig('engineStyles');
    value.value = { SAMPLE_STYLE: { contrailMaxSpeedMult: '0.5f' } };
    await flushPromises();
    await inputs.commit();
    expect(value.value).toEqual({ SAMPLE_STYLE: { contrailMaxSpeedMult: '0.5f' } });
    const input = wrapper!.findAll('input').find((input) => input.element.value === '0.5f')!;
    await input.setValue('');
    await inputs.commit();
    expect(value.value).toEqual({ SAMPLE_STYLE: {} });
  });
  it('edits plugin classes as plain strings and graphics as declared image values', async () => {
    const { value, inputs } = mountConfig('settings');
    value.value = { ...value.value, plugins: { sample: 'example.runtime.Sample' } };
    await flushPromises();
    const input = wrapper!.findAll('input').find((input) => input.element.value === 'example.runtime.Sample')!;
    expect(input.element.tagName).toBe('INPUT');
    await input.setValue('example.runtime.Other');
    await inputs.commit();
    expect(value.value.plugins).toEqual({ sample: 'example.runtime.Other' });
    const images = wrapper!.findAllComponents(SchemaReferenceInput).filter((input) => input.props('field').type === 'path-image');
    expect(images.map((image) => image.props('value'))).toEqual(['graphics/sample_a.png', 'graphics/sample_b.png']);
    images[1]!.vm.$emit('update', { kind: 'set', value: 'graphics/changed.png' });
    await nextTick();
    expect(value.value.graphics).toEqual({ sample: { icons: ['graphics/sample_a.png', 'graphics/changed.png'] } });
  });
  it('round-trips every registered file and its field definitions', () => {
    for (const file of MISC_CONFIG_DEFINITIONS) {
      const schema = getSchema(file.schema)!;
      expect(parseFileSchema(schema.id, schema)).toEqual(schema);
      expect(schema.sources![0]!.path).toBe(file.path);
      expect(file.initial).toEqual({});
    }
    expect(getSchema('engine-styles')!.root!.valueSchema!.nested).toHaveLength(23);
    expect(getSchema('hull-styles')!.root!.valueSchema!.nested).toHaveLength(38);
  });
  it.each([
    ['0.5f', 0.5],
    ['-1f', -1],
    ['1D', 1],
    ['2.5e-2F', 0.025],
  ] as const)('interprets game numeric input %s when committed', (raw, value) => {
    expect(convertSchemaScalarInput(raw, { key: 'n', label: 'Number', type: 'float' })).toEqual({
      kind: 'set',
      value,
    });
  });
  it('rejects incomplete numeric text and validates ranges after reading the suffix', () => {
    const field: FieldSchema = { key: 'n', label: 'Number', type: 'float', min: 0, max: 1 };
    for (const raw of ['1ff', '1e', 'NaNf', '2f']) expect(convertSchemaScalarInput(raw, field).kind).toBe('error');
  });
  it('keeps game number text and focused controls across cloned style drafts', async () => {
    const { value, inputs } = mountConfig('engineStyles');
    await flushPromises();
    const input = wrapper!.findAll('input').find((input) => input.element.value === '0.5f')!;
    input.element.focus();
    await input.setValue('-1f');
    await inputs.commit();
    expect(value.value.SAMPLE_STYLE).toMatchObject({ contrailMaxSpeedMult: -1, sampleExtra: { keep: true } });
    value.value = JSON.parse(JSON.stringify(value.value)) as RowData;
    await nextTick();
    expect(wrapper!.findAll('input').find((field) => field.element.value === '-1')!.element).toBe(input.element);
    expect(document.activeElement).toBe(input.element);
  });
  it.each(MISC_CONFIG_DEFINITIONS)('retains grouped inputs in every registered $kind file', async ({ kind }) => {
    mountConfig(kind);
    const collapse = wrapper!.findAllComponents(EditorCollapse)[0]!;
    const expanded = collapse.props('expandedNames')!;
    expect(expanded.length).toBeGreaterThan(0);
    const input = wrapper!.get('input').element;
    collapse.vm.$emit('update:expandedNames', []);
    await nextTick();
    expect(collapse.props('expandedNames')).toEqual([]);
    collapse.vm.$emit('update:expandedNames', expanded);
    await nextTick();
    expect(wrapper!.get('input').element).toBe(input);
  });
  it('edits settings groups and scalar fallback, retains names and rejects conflicting renames', async () => {
    const { value, inputs } = mountConfig('settings', true);
    const colors = structuredClone(toRaw(value.value.designTypeColors));
    const plugins = wrapper!.findAll('.schema-section').find((group) => group.find('.n-collapse-item__header-main').text() === '插件')!;
    expect(value.value.plugins).toBeUndefined();
    await plugins.findAll('button').at(-1)!.trigger('click');
    await flushPromises();
    expect(value.value.plugins).toEqual({ newField: '' });
    expect(wrapper!.getComponent(SchemaFormRenderer).props('modelValue').file).toHaveProperty('plugins.newField', '');
    expect(wrapper!.findAllComponents(SchemaCollectionInput)[0]!.props('value')).toHaveProperty('plugins.newField', '');
    expect(
      wrapper!
        .findAllComponents(SchemaCollectionInput)
        .find((input) => input.props('field').key === 'plugins')!
        .props('value'),
    ).toEqual({ newField: '' });
    expect(plugins.get('input').element.value).toBe('newField');
    await plugins.findAll('button').at(-1)!.trigger('click');
    await flushPromises();
    expect(value.value.plugins).toEqual({ newField: '', newField1: '' });
    await plugins.findAll('button.compact-icon-button')[0]!.trigger('click');
    expect(value.value.plugins).toEqual({ newField1: '' });
    expect(plugins.find('button').exists()).toBe(true);
    value.value = { ...value.value, sampleOptions: { flag: false } };
    await nextTick();
    const name = wrapper!.findAll<HTMLInputElement>('input.field-map-key-editor').find((input) => input.element.value === 'sampleOptions')!;
    name.element.focus();
    await name.setValue('designTypeColors');
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(document.activeElement).toBe(name.element);
    expect(value.value.designTypeColors).toEqual(colors);
    inputs.cancel();
    await nextTick();
    expect(name.element.value).toBe('sampleOptions');
    await name.setValue('sample.config');
    expect(value.value['sample.config']).toHaveProperty('flag', false);
    expect(
      wrapper!.findAll<HTMLInputElement>('input.field-map-key-editor').find((input) => input.element.value === 'sample.config')!.element,
    ).toBe(name.element);
    expect(wrapper!.findAll('.n-switch-stub')).toHaveLength(0);
    const number = wrapper!.findAll('textarea').find((input) => input.element.value === '42')!;
    await number.setValue('-');
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(value.value.maxShipsInFleet).toBe(42);
    inputs.cancel();
    await number.setValue('12');
    await inputs.commit();
    expect(value.value.maxShipsInFleet).toBe(12);
  });
  it('creates separate sound formats and preserves partial groups and music', async () => {
    const { value, field } = mountConfig('sounds');
    const originalMusic = structuredClone(toRaw(value.value.music));
    const effects = field.valueSchema!;
    expect(schemaFieldVariant(effects, [])).toMatchObject({ type: 'array' });
    expect(schemaFieldVariant(effects, {})).toMatchObject({ type: 'object' });
    const add = (label: string) => wrapper!.findAll('button').find((button) => button.text() === '+ ' + label)!;
    await add(effects.variants![0]!.label).trigger('click');
    expect(value.value.newField).toEqual([]);
    await add(effects.variants![1]!.label).trigger('click');
    expect(value.value.newField1).toEqual({ sounds: [] });
    expect(value.value.engine_loop).toEqual({ SAMPLE_STYLE: { pitch: 1, volume: 0.8 } });
    expect(value.value.music).toEqual(originalMusic);
    const name = wrapper!.findAll<HTMLInputElement>('input.field-map-key-editor').find((input) => input.element.value === 'sample_effect')!;
    await name.setValue('music');
    expect(value.value.music).toEqual(originalMusic);
    expect(value.value.sample_effect).toBeDefined();
  });
});
