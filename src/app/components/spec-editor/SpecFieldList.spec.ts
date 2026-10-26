import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h, provide, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpecFieldList from './SpecFieldList.vue';
import { specSchemaContext } from '@/app/composables/spec-editor/spec-schema-context';
import { SHIP_SECTIONS } from '@/domain/spec-editor/ship/spec-ship-fields';
import { weaponSections, WEAPON_OBJECT_FIELDS } from '@/domain/spec-editor/weapon/spec-weapon-fields';
import { EXPLOSION_FIELDS } from '@/domain/spec-editor/projectile/spec-projectile-fields';
import { SYSTEM_SOUND_FIELDS } from '@/domain/spec-editor/system/spec-system-fields';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { editorUiStubs, nSelect } from '@/test/unit/ui-stubs';
import { specSchema } from '@/domain/spec-editor/spec-schemas';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import type { RowData, SourceOptionGroup } from '@/shared/types';

vi.mock('@/app/composables/use-core-assets', () => ({ useCoreGraphics: () => ({ graphicsPaths: ref([]), loadGraphics: vi.fn() }) }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
let wrapper: VueWrapper;
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
afterEach(() => wrapper.unmount());
const references = [
  ...SHIP_SECTIONS.flatMap((section) => section.fields),
  ...weaponSections({ specClass: 'projectile' }).flatMap((section) => section.fields),
  ...EXPLOSION_FIELDS,
  ...SYSTEM_SOUND_FIELDS,
].filter((field) => field.source);

describe('Spec field source integration', () => {
  const ship = specSchema('spec-ship').definitions!,
    projectile = specSchema('spec-projectile').definitions!;
  const behavior = projectile.behavior!.nested!;
  const system = specSchema('spec-system').sections!.flatMap((section) => section.fields);
  const formal = [
    ship.builtInWeapon!,
    ship.builtInMods!,
    ship.builtInWings!,
    ship.customEngine!.nested![0]!,
    references.find((field) => field.key === 'projectileSpecId')!,
    projectile.customEngine!.nested![0]!,
    ...system.filter((field) => ['weaponDataId', 'droneVariant'].includes(field.key)),
    ...behavior.filter((field) => field.source || field.key === 'projectileSpec' || field.key === 'emptySpec'),
    behavior.find((field) => field.key === 'explosionSpec')!.nested![0]!,
  ];
  it.each(formal.map((field, index) => ({ field, index })))('commits, selects and clears formal reference $index', async ({ field }) => {
    const inputs = createFieldInputs(),
      content = ref<RowData>({ [field.key]: field.type === 'string-array' ? ['existing'] : 'existing' });
    const query = vi.fn(async () => [
      {
        origin: 'mod' as const,
        options: [{ value: 'selected', label: 'Selected', description: null, resourceRef: null, origin: 'mod' as const }],
      },
    ]);
    wrapper = mount(
      {
        setup() {
          provideFieldInputs(inputs);
          provide(specSchemaContext, ref({ sessionId: 'refs', modRoot: 'M:/refs', querySourceOptions: query }));
          return () =>
            h(SpecFieldList, {
              fields: [field],
              content: content.value,
              onUpdate: (key, value) => {
                content.value = { ...content.value, [key]: value };
              },
              onRemove: (key) => {
                delete content.value[key];
              },
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await flushPromises();
    expect(query).toHaveBeenCalledWith(field.source, expect.any(AbortSignal));
    const select = wrapper.getComponent(nSelect);
    select.vm.$emit('search', 'new_reference');
    expect(inputs.dirty.value).toBe(true);
    const matches = () =>
      select
        .props('options')
        .flatMap((option: { children?: { value: string }[]; value: string }) => option.children ?? [option])
        .filter((option: { value: string }) => option.value === 'new_reference');
    await flushPromises();
    expect(matches()).toHaveLength(1);
    await inputs.commit();
    expect(content.value[field.key]).toEqual(field.type === 'string-array' ? ['existing', 'new_reference'] : 'new_reference');
    await flushPromises();
    expect(matches()).toHaveLength(1);
    select.vm.$emit('update:value', field.type === 'string-array' ? ['selected'] : 'selected');
    await flushPromises();
    expect(content.value[field.key]).toEqual(field.type === 'string-array' ? ['selected'] : 'selected');
    select.vm.$emit('search', 'cancelled');
    inputs.cancel();
    await flushPromises();
    expect(content.value[field.key]).toEqual(field.type === 'string-array' ? ['selected'] : 'selected');
    if (!field.required) {
      select.vm.$emit('update:value', field.type === 'string-array' ? [] : null);
      await flushPromises();
      expect(content.value[field.key]).toEqual(field.type === 'string-array' ? [] : undefined);
    }
  });
  it('ends superseded source reads and retains the current reference across catalogue refreshes', async () => {
    const groups = (value: string): SourceOptionGroup[] => [
      { origin: 'mod', options: [{ value, label: value, description: null, resourceRef: null, origin: 'mod' }] },
    ];
    let release!: (groups: SourceOptionGroup[]) => void;
    const query = vi.fn<(source: string, signal?: AbortSignal) => Promise<SourceOptionGroup[]>>(async () => groups('current'));
    query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const context = ref({ sessionId: 'old', modRoot: 'M:/refs', sourceContextKey: 'old', querySourceOptions: query }),
      content = ref<RowData>({ projectile: 'original' });
    wrapper = mount(
      {
        setup() {
          provide(specSchemaContext, context);
          provideFieldInputs();
          return () =>
            h(SpecFieldList, {
              fields: [projectile.projectileReference!],
              content: content.value,
              onUpdate: (key, value) => {
                content.value[key] = value;
              },
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await flushPromises();
    const earlier = query.mock.calls[0]![1]!;
    context.value = { ...context.value, sessionId: 'new', sourceContextKey: 'new' };
    await flushPromises();
    expect(earlier.aborted).toBe(true);
    release(groups('stale'));
    await flushPromises();
    expect(JSON.stringify(wrapper.getComponent(nSelect).props('options'))).toContain('current');
    expect(JSON.stringify(wrapper.getComponent(nSelect).props('options'))).not.toContain('stale');
    expect(content.value.projectile).toBe('original');
    wrapper.getComponent(nSelect).vm.$emit('update:value', 'current');
    await flushPromises();
    context.value = { ...context.value, sourceContextKey: 'refresh' };
    await flushPromises();
    expect(content.value.projectile).toBe('current');
  });
  it('retains reference nodes and raw data across actual behavior branches', async () => {
    const inputs = createFieldInputs(),
      root = ref<RowData>({
        specClass: 'missile',
        missileType: 'MIRV',
        behaviorSpec: { behavior: 'MIRV', delay: 0, projectileSpec: 'kept', custom: { keep: true } },
      });
    wrapper = mount(
      {
        setup() {
          provideFieldInputs(inputs);
          return () =>
            h(SchemaValueInput, {
              field: projectile.behavior!,
              value: root.value.behaviorSpec,
              runtimeContext: { sessionId: 'refs', modRoot: 'M:/refs', querySourceOptions: async () => [], readValue: () => root.value },
              onUpdate: (update) => {
                if (update.kind === 'set') root.value.behaviorSpec = update.value as RowData;
              },
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await flushPromises();
    const row = (key: string) =>
      wrapper.findAll('[data-field-path]').find((node) => node.attributes('data-field-path') === `behaviorSpec[${JSON.stringify(key)}]`);
    const original = row('projectileSpec')!.element;
    expect(row('projectileSpec')!.isVisible()).toBe(true);
    expect(row('pingSound')).toBeUndefined();
    root.value.missileType = 'PHASE_MINE';
    await flushPromises();
    expect(row('projectileSpec')!.classes()).toContain('ui-retained-hidden');
    expect(row('pingSound')).toBeUndefined();
    (root.value.behaviorSpec as RowData).delay = 0.5;
    await flushPromises();
    expect(row('pingSound')!.isVisible()).toBe(true);
    row('pingSound')!.getComponent(nSelect).vm.$emit('search', 'manual_sound');
    await inputs.commit();
    root.value.missileType = 'MIRV';
    await flushPromises();
    expect(row('projectileSpec')!.element).toBe(original);
    expect(root.value.behaviorSpec).toMatchObject({ projectileSpec: 'kept', pingSound: 'manual_sound', custom: { keep: true } });
  });
  it('updates conditional required labels while preserving the value input', async () => {
    wrapper = mount(SpecFieldList, {
      props: {
        content: { muzzleFlashSpec: { particleCount: 0 } },
        fields: WEAPON_OBJECT_FIELDS.muzzleFlashSpec,
        prefix: 'muzzleFlashSpec.',
      },
      global: { stubs: editorUiStubs },
    });
    await flushPromises();
    const field = () => wrapper.get('[data-field-path="muzzleFlashSpec.length"]');
    const input = field().get('input').element;
    expect(field().find('.field-label-required').exists()).toBe(false);
    await wrapper.setProps({ content: { muzzleFlashSpec: { particleCount: 1 } } });
    expect(field().find('.field-label-required').exists()).toBe(true);
    expect(field().get('input').element).toBe(input);
    await wrapper.setProps({ content: { muzzleFlashSpec: { particleCount: 0 } } });
    expect(field().find('.field-label-required').exists()).toBe(false);
  });
  it.each(references.map((field) => ({ key: field.key, field })))('reads and edits the source for $key', async ({ field }) => {
    const query = vi.fn(async () => [
      {
        origin: 'mod' as const,
        options: [{ value: 'sample_new', label: 'Sample', description: null, resourceRef: null, origin: 'mod' as const }],
      },
    ]);
    const content = { [field.key]: 'sample_existing' };
    wrapper = mount(
      {
        setup() {
          provide(specSchemaContext, ref({ sessionId: 'sample-session', modRoot: 'M:/sample', querySourceOptions: query }));
          return () => h(SpecFieldList, { content, fields: [field] });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await flushPromises();
    expect(query).toHaveBeenCalledWith(field.source, expect.any(AbortSignal));
    const select = wrapper.getComponent(nSelect);
    expect(
      select
        .props('options')
        .flatMap((group: { children: { value: string }[] }) => group.children)
        .map((option: { value: string }) => option.value),
    ).toEqual(['sample_existing', 'sample_new']);
    select.vm.$emit('update:value', 'sample_new');
    await flushPromises();
    const fields = wrapper.getComponent(SpecFieldList);
    expect(fields.emitted('update')!.at(-1)).toEqual([field.key, 'sample_new']);
    if (!field.required) {
      select.vm.$emit('update:value', null);
      await flushPromises();
      expect(fields.emitted('remove')!.at(-1)).toEqual([field.key]);
    }
    expect(content[field.key]).toBe('sample_existing');
    useSettingsStore().setEditMode('plain');
    await flushPromises();
    const input = fields.get('input');
    await input.setValue('  sample_custom  ');
    expect(fields.emitted('update')!.at(-1)).toEqual([field.key, '  sample_custom  ']);
  });
});
