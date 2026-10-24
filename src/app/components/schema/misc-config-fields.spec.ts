import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, h, ref, nextTick, toRaw } from 'vue';
import SchemaFormRenderer from './SchemaFormRenderer.vue';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { miscConfigFile, MISC_CONFIG_FILES } from '@/domain/json-editor/misc-config-files';
import { convertSchemaScalarInput, schemaFieldVariant } from '@/domain/schema/schema-values';
import { parseFileSchema } from '@/domain/schema/schema-asset-parser';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { editorUiStubs, nCollapse } from '@/test/ui-stubs';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';
import { miscConfigFixture } from '@/test/misc-config';
import type { MiscConfigKind, RowData } from '@/shared/types';
import type { FieldSchema } from '@/domain/schema/schema.types';

vi.mock('@/services/core-assets.service', () => ({ queryCoreFields: vi.fn(async () => ({})), queryCoreGraphics: vi.fn(async () => []) }));
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreGraphics: () => ({ graphicsPaths: ref([]), loadGraphics: vi.fn() }) }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), choose: vi.fn(), warning: vi.fn() }) }));
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
  const field = getSchema(miscConfigFile(kind).schema)!.root!;
  const snapshot = { target: kind, baseVersions: [], meta: null, value: { file: miscConfigFixture(kind) } };
  let draft!: ReturnType<typeof useEditTargetDraftSession<RowData, MiscConfigKind, null>>;
  const value = computed({ get: () => draft.draftValue.value.file as RowData, set: (file) => draft.setDraft({ file }) });
  wrapper = mount(
    {
      setup() {
        draft = useEditTargetDraftSession({ emptyValue: {} as RowData, targetKey: (key: string) => key, load: () => snapshot });
        draft.loadBaseForTarget(snapshot);
        provideFieldInputs(draft.inputs);
        return () =>
          h(SchemaFormRenderer, {
            schema: getSchema(miscConfigFile(kind).schema)!,
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
  return { value, inputs: draft.inputs, field };
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
    const images = wrapper!
      .findAllComponents({ name: 'SchemaReferenceInput' })
      .filter((input) => input.props('field').type === 'path-image');
    expect(images.map((image) => image.props('value'))).toEqual(['graphics/sample_a.png', 'graphics/sample_b.png']);
    images[1]!.vm.$emit('update', { kind: 'set', value: 'graphics/changed.png' });
    await nextTick();
    expect(value.value.graphics).toEqual({ sample: { icons: ['graphics/sample_a.png', 'graphics/changed.png'] } });
  });
  it('registers five independently typed files and round-trips their field definitions', () => {
    expect(MISC_CONFIG_FILES.map((file) => file.kind)).toEqual(['strings', 'engineStyles', 'hullStyles', 'sounds', 'settings']);
    for (const file of MISC_CONFIG_FILES) {
      const schema = getSchema(file.schema)!;
      expect(parseFileSchema(schema.id, schema)).toEqual(schema);
      expect(schema.sources![0]!.path).toBe(file.path);
      expect(file.initial).toEqual({});
    }
    expect(getSchema('engine-styles')!.root!.valueSchema!.nested).toHaveLength(23);
    expect(getSchema('hull-styles')!.root!.valueSchema!.nested).toHaveLength(38);
  });
  it.each(['0.5f', '-1f', '1D', '2.5e-2F'])('retains the game numeric literal %s when committed', (raw) => {
    expect(convertSchemaScalarInput(raw, { key: 'n', label: 'Number', type: 'float', numberFormat: 'starsector' })).toEqual({
      kind: 'set',
      value: raw,
    });
    expect(convertSchemaScalarInput(raw, { key: 'n', label: 'Number', type: 'float' }).kind).toBe('error');
  });
  it('rejects incomplete numeric text and validates ranges after reading the suffix', () => {
    const field: FieldSchema = { key: 'n', label: 'Number', type: 'float', numberFormat: 'starsector', min: 0, max: 1 };
    for (const raw of ['1ff', '1e', 'NaNf', '2f']) expect(convertSchemaScalarInput(raw, field).kind).toBe('error');
  });
  it('keeps game number text and focused controls across cloned style drafts', async () => {
    const { value, inputs } = mountConfig('engineStyles');
    await flushPromises();
    const input = wrapper!.findAll('input').find((input) => input.element.value === '0.5f')!;
    input.element.focus();
    await input.setValue('-1f');
    await inputs.commit();
    expect(value.value.SAMPLE_STYLE).toMatchObject({ contrailMaxSpeedMult: '-1f', sampleExtra: { keep: true } });
    value.value = JSON.parse(JSON.stringify(value.value)) as RowData;
    await nextTick();
    expect(wrapper!.findAll('input').find((field) => field.element.value === '-1f')!.element).toBe(input.element);
    expect(document.activeElement).toBe(input.element);
  });
  it.each([
    ['strings', 1],
    ['engineStyles', 1],
    ['hullStyles', 1],
    ['sounds', 4],
    ['settings', 4],
  ] as const)('groups root objects in %s independently', async (kind, count) => {
    mountConfig(kind);
    const collapse = wrapper!.findAllComponents(EditorCollapse)[0]!;
    expect(collapse.getComponent(nCollapse).props('expandedNames')).toHaveLength(count);
    const input = wrapper!.get('input').element;
    collapse.vm.$emit('update:expandedNames', []);
    await nextTick();
    expect(collapse.getComponent(nCollapse).props('expandedNames')).toEqual([]);
    collapse.vm.$emit('update:expandedNames', ['1']);
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
    expect(wrapper!.findAllComponents({ name: 'SchemaCollectionInput' })[0]!.props('value')).toHaveProperty('plugins.newField', '');
    expect(
      wrapper!
        .findAllComponents({ name: 'SchemaCollectionInput' })
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
