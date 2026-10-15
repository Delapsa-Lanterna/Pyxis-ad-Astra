import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { h, ref, shallowRef } from 'vue';
import { NInput, NSelect, NButton } from 'naive-ui';
import type { JointVariantEntry } from '@/shared/types';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import VariantHullmodPicker from './VariantHullmodPicker.vue';
const mocks = vi.hoisted(() => ({ entries: [] as JointVariantEntry[], media: vi.fn(), dataUrl: vi.fn() }));
beforeEach(() => {
  mocks.dataUrl.mockReturnValue('');
  installCanvas2DStub();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
vi.mock('@/app/composables/immersive-editor/variant/use-variant-catalog', () => ({
  useVariantCatalog: () => ({
    entries: shallowRef(mocks.entries),
    snapshot: shallowRef({
      referenceSettings: {
        values: {},
        resources: {
          checkmark: { key: 'checkmark' },
          checkmark_locked: { key: 'checkmark_locked' },
          checkmark_unlocked: { key: 'checkmark_unlocked' },
        },
        versions: [],
      },
    }),
    loading: ref(false),
    errorText: ref(''),
    load: vi.fn(),
  }),
}));
vi.mock('@/app/composables/use-visible-resource-media', () => ({
  useVisibleResourceMedia: () => ({
    setMediaRoot: () => {},
    mediaRef: () => () => {},
    mediaVisible: () => true,
    mediaSrc: (resource: { key: string } | undefined) => (resource ? resource.key + '.png' : ''),
  }),
}));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ replaceCollection: mocks.media, dataUrl: mocks.dataUrl }),
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn() }) }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function harness(count = 6) {
  const source = { source: 'mod' as const, root: 'M:/mod', path: 'M:/mod/mods.csv', relPath: 'mods.csv' };
  mocks.entries = Array.from({ length: count }, (_, index) => ({
    id: 'mod_' + index,
    label: '插件 ' + index,
    data: {
      cost_cruiser: [5, 20, 10, 20, 0][index % 5]!,
      'tech/manufacturer': index % 2 ? 'High Tech' : '',
      uiTags: index % 2 ? 'Flux' : 'Weapons',
    },
    source,
    sourceVersion: { path: source.path, fingerprint: 'v' },
    resourceRefs: { icon: { source: 'mod', relPath: index + '.png', ownerKind: 'hullmods', ownerId: 'mod_' + index, key: 'icon' } },
    spec: null,
    specSource: null,
    specVersion: null,
    preview: null,
    projectile: null,
    primaryRole: null,
  }));
  mocks.entries.push({ ...mocks.entries[0]!, id: 'hidden', data: { hidden: 'TRUE' } });
  mocks.entries.push({ ...mocks.entries[0]!, id: '', label: '', data: {} });
  const variant = shallowRef(projectVariantPanel(variantJointFixture(), {}).variants[0]!);
  const inputs = createFieldInputs(ref('variant'));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () =>
          h(VariantHullmodPicker, { root: { sessionId: 's', modRoot: 'M:/mod', kind: 'variant', id: 'variant' }, variant: variant.value });
      },
    },
    {
      attachTo: document.body,
      global: {
        components: { NInput, NSelect, NButton },
        stubs: {
          ResourceThumbnail: { props: ['url', 'label'], template: '<img :src="url" :alt="label" />' },
          ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' },
          VariantHullmodDetails: { props: ['entry'], template: '<aside>{{entry.label}}</aside>' },
        },
      },
    },
  );
  return { wrapper, inputs, variant, picker: wrapper.findComponent(VariantHullmodPicker) };
}
describe('original hullmod picker', () => {
  it.each(['normal', 'permanent', 's'] as const)('uses visible %s status media and local icons through replacement', async (category) => {
    const own = harness();
    await flushPromises();
    own.variant.value = {
      ...own.variant.value,
      mods: [{ id: 'mod_1', name: 'Module', design: 'Common', cost: 0, category, strengthened: false, icon: null }],
    };
    await flushPromises();
    const status = own.wrapper.find('[data-entry-id=mod_1] .immersive-resource-icon');
    expect(status.find('svg path').exists()).toBe(true);
    const key = { normal: 'checkmark', permanent: 'checkmark_locked', s: 'checkmark_unlocked' }[category];
    expect(mocks.media).toHaveBeenLastCalledWith('s', 'hullmod-ui', [expect.objectContaining({ key })]);
    mocks.dataUrl.mockImplementation((_session, resource?: { key: string }) => (resource ? resource.key + '.png' : ''));
    own.variant.value = { ...own.variant.value, mods: [...own.variant.value.mods] };
    await flushPromises();
    expect(status.find('svg').exists()).toBe(false);
    expect(status.attributes('style')).toContain(key + '.png');
    expect(own.wrapper.findAll('.variant-hullmod-columns svg')).toHaveLength(4);
    own.wrapper.unmount();
  });
  it('shows details only for a hovered candidate when the catalogue contains an empty ID row', async () => {
    const own = harness();
    await flushPromises();
    expect(own.wrapper.find('.variant-hullmod-tooltip').exists()).toBe(false);
    expect(own.wrapper.find('[data-entry-id=""]').exists()).toBe(false);
    const row = own.wrapper.find('.variant-hullmod-row');
    await row.trigger('mouseenter');
    await flushPromises();
    expect(own.wrapper.find('.variant-hullmod-tooltip').text()).toBe('插件 1');
    await row.trigger('mouseleave', { relatedTarget: document.body });
    expect(own.wrapper.find('.variant-hullmod-tooltip').exists()).toBe(false);
    own.wrapper.unmount();
  });
  it('shows real icon images and current-hull OP ordering through search and header changes', async () => {
    const own = harness();
    await flushPromises();
    const list = own.wrapper.find('.variant-hullmod-list');
    Object.defineProperty(list.element, 'clientHeight', { value: 360, configurable: true });
    await list.trigger('scroll');
    const ids = () => own.wrapper.findAll('.variant-hullmod-row').map((row) => row.attributes('data-entry-id'));
    expect(ids()).toEqual(['mod_1', 'mod_3', 'mod_2', 'mod_0', 'mod_5', 'mod_4']);
    expect(own.wrapper.find('.variant-hullmod-name img').attributes('src')).toBe('icon.png');
    expect(own.wrapper.find('.variant-hullmod-columns').text()).toBe('插件设计类型OP已安装');
    await own.wrapper.find('input').setValue('mod_0');
    expect(ids()).toEqual(['mod_0']);
    await own.wrapper.find('input').setValue('');
    await own.wrapper.findAll('.variant-hullmod-columns button')[2]!.trigger('click');
    expect(ids()).toEqual(['mod_4', 'mod_0', 'mod_5', 'mod_2', 'mod_1', 'mod_3']);
    own.wrapper.unmount();
  });
  it('combines original modifier filters and immediately emits one row action while remaining open', async () => {
    const own = harness();
    await flushPromises();
    const list = own.wrapper.find('.variant-hullmod-list');
    Object.defineProperty(list.element, 'clientHeight', { value: 360 });
    await list.trigger('scroll');
    const checks = own.wrapper.findAll('.immersive-filter-group [role=checkbox]');
    await checks.find((check) => check.attributes('aria-label') === 'High Tech')!.trigger('click');
    expect(own.wrapper.findAll('.variant-hullmod-row').map((row) => row.attributes('data-entry-id'))).toEqual(['mod_1', 'mod_3', 'mod_5']);
    await checks.find((check) => check.attributes('aria-label') === 'Common')!.trigger('click', { ctrlKey: true });
    expect(own.wrapper.findAll('.variant-hullmod-row')).toHaveLength(6);
    await own.wrapper.find('.variant-hullmod-row').trigger('click');
    expect(own.picker.emitted('select')).toEqual([['mod_1', 'normal']]);
    expect(own.wrapper.find('[role=dialog]').exists()).toBe(true);
    own.wrapper.unmount();
  });
  it('reflects installation category and keeps built-in selection within existing permissions', async () => {
    const own = harness();
    await flushPromises();
    own.variant.value = {
      ...own.variant.value,
      mods: [{ id: 'mod_1', name: '插件 1', design: 'Common', cost: 0, category: 'builtin', strengthened: false, icon: null }],
    };
    await flushPromises();
    const row = own.wrapper.find('[data-entry-id=mod_1]');
    expect(row.attributes('aria-disabled')).toBe('true');
    expect(row.find('[aria-label=内置]').exists()).toBe(true);
    await row.trigger('click');
    expect(own.picker.emitted('select')).toBeUndefined();
    own.wrapper.unmount();
  });
  it('keeps manual input dirty, cancels on Escape and releases the selector', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('details input').setValue('missing_mod');
    expect(own.inputs.dirty.value).toBe(true);
    await own.inputs.commit();
    expect(own.picker.emitted('manual-commit')).toEqual([['missing_mod', 'normal']]);
    await own.wrapper.find('details input').setValue('cancelled');
    await own.wrapper.find('[role=dialog]').trigger('keydown', { key: 'Escape' });
    expect(own.inputs.dirty.value).toBe(false);
    expect(own.picker.emitted('close')).toHaveLength(1);
    own.wrapper.unmount();
  });
  it('mounts only visible rows, navigates to the last ID and clears removed hover details', async () => {
    const own = harness(200);
    await flushPromises();
    expect(own.wrapper.findAll('.variant-hullmod-row')).toHaveLength(2);
    const list = own.wrapper.find('.variant-hullmod-list');
    Object.defineProperty(list.element, 'clientHeight', { value: 108 });
    await list.trigger('scroll');
    expect(own.wrapper.findAll('.variant-hullmod-row')).toHaveLength(5);
    await own.wrapper.find('.variant-hullmod-row').trigger('mouseenter');
    await flushPromises();
    expect(own.wrapper.find('.variant-hullmod-tooltip').text()).toContain('插件');
    await own.wrapper.find('.variant-hullmod-row').trigger('keydown', { key: 'End' });
    await flushPromises();
    expect(document.activeElement?.getAttribute('data-entry-id')).toBe('mod_199');
    await own.wrapper.find('input').setValue('mod_0');
    await flushPromises();
    expect(own.wrapper.find('.variant-hullmod-tooltip').exists()).toBe(false);
    own.wrapper.unmount();
  });
});
