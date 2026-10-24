import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h, provide, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpecFieldList from './SpecFieldList.vue';
import { specSchemaContext } from '@/app/composables/spec-editor/spec-schema-context';
import { SHIP_SECTIONS } from '@/domain/spec-editor/ship/spec-ship-fields';
import { weaponSections } from '@/domain/spec-editor/weapon/spec-weapon-fields';
import { EXPLOSION_FIELDS } from '@/domain/spec-editor/projectile/spec-projectile-fields';
import { SYSTEM_SOUND_FIELDS } from '@/domain/spec-editor/system/spec-system-fields';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { editorUiStubs, nSelect } from '@/test/ui-stubs';

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
].filter((field) => field[5]);

describe('Spec field source integration', () => {
  it.each(references.map((field) => ({ key: field[0], field })))('reads and edits the source for $key', async ({ field }) => {
    const query = vi.fn(async () => [
      {
        origin: 'mod' as const,
        options: [{ value: 'sample_new', label: 'Sample', description: null, resourceRef: null, origin: 'mod' as const }],
      },
    ]);
    const content = { [field[0]]: 'sample_existing' };
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
    expect(query).toHaveBeenCalledWith(field[5], expect.any(AbortSignal));
    const select = wrapper.getComponent(nSelect);
    expect(
      select
        .props('options')
        .flatMap((group: { children: { value: string }[] }) => group.children)
        .map((option: { value: string }) => option.value),
    ).toEqual(['sample_existing', 'sample_new']);
    expect(select.props('tag')).toBe(true);
    select.vm.$emit('update:value', 'sample_new');
    await flushPromises();
    const fields = wrapper.getComponent(SpecFieldList);
    expect(fields.emitted('update')!.at(-1)).toEqual([field[0], 'sample_new']);
    select.vm.$emit('update:value', null);
    await flushPromises();
    expect(fields.emitted('update')!.at(-1)).toEqual([field[0], '']);
    expect(content[field[0]]).toBe('sample_existing');
    useSettingsStore().setEditMode('plain');
    await flushPromises();
    const input = fields.get('input');
    await input.setValue('  sample_custom  ');
    expect(fields.emitted('update')!.at(-1)).toEqual([field[0], '  sample_custom  ']);
  });
});
