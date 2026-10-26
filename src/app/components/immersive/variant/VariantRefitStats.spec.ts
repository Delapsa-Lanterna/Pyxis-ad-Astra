import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { jointObject } from '@/domain/joint-edit';
import { editorUiStubs } from '@/test/unit/ui-stubs';
import type { useImmersiveVariantEditor } from '@/app/composables/immersive-editor/variant/use-immersive-variant-editor';
import VariantRefitStats from './VariantRefitStats.vue';
import { immersiveBlockedKey } from '../immersive-render-context';
const mocks = vi.hoisted(() => ({ query: vi.fn(), replace: vi.fn(async () => {}) }));
vi.mock('@/services/joint-edit.service', () => ({ queryJointVariantCatalog: mocks.query }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ replaceCollection: mocks.replace, dataUrl: () => '' }),
}));
vi.mock('@/app/composables/use-visible-resource-media', () => ({
  useVisibleResourceMedia: () => ({ setMediaRoot: vi.fn(), mediaRef: () => () => {}, mediaVisible: () => true }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('installed hullmod details', () => {
  it.each(['normal', 'builtin', 'permanent', 's'] as const)(
    'shows shared details for %s with pointer, focus and click dismissal',
    async (category) => {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          unobserve() {}
          disconnect() {}
        },
      );
      const snapshot = variantJointFixture();
      const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
      const variant = projectVariantPanel(snapshot, values).variants[0]!;
      variant.mods[0]!.category = category;
      const record = snapshot.records.find((record) => record.key === 'mod')!;
      const entry = {
        id: variant.mods[0]!.id,
        label: 'Sample hullmod',
        data: { ...jointObject(record.value), short: 'Short description', sModDesc: 'Strengthened description' },
      };
      mocks.query.mockResolvedValue({ root: snapshot.root, catalog: { entries: [entry] }, referenceSettings: snapshot.referenceSettings });
      const vm = {
        joint: { currentTarget: shallowRef(snapshot.root) },
        displaySnapshot: shallowRef(snapshot),
        displayValues: shallowRef(values),
      } as unknown as ReturnType<typeof useImmersiveVariantEditor>;
      const blocked = shallowRef(false);
      const own = mount(VariantRefitStats, {
        props: {
          variant,
          vm,
          pickerOpen: false,
          render: { mode: 'readonly', root: snapshot.root, records: snapshot.records, mediaUrl: () => '' },
        },
        global: {
          provide: { [immersiveBlockedKey as symbol]: blocked },
          stubs: {
            ...editorUiStubs,
            teleport: true,
            VariantShipInfo: true,
            ImmersivePanelRow: true,
            ImmersiveHullmodIcon: true,
            ImmersiveText: { props: ['text', 'runs'], template: '<span>{{ runs ? runs.map(run => run.text).join("") : text }}</span>' },
          },
        },
      });
      try {
        const button = own.get('.variant-mod-name');
        expect(button.attributes('title')).toBeUndefined();
        await button.trigger('mouseenter');
        await flushPromises();
        expect(own.find('[role=tooltip]').exists()).toBe(false);
        const label = button.get('.variant-mod-name-label');
        await label.trigger('mouseenter');
        await flushPromises();
        const details = own.get('[role=tooltip]');
        expect(details.text()).toContain('Sample hullmod');
        expect(details.text()).toContain('设计类型：High Tech');
        expect(details.text()).toContain('Base configuration sample');
        expect(details.text()).toContain('Short description');
        expect(details.text()).toContain('Strengthened description');
        vi.useFakeTimers();
        await label.trigger('mouseleave');
        await vi.advanceTimersByTimeAsync(100);
        expect(own.find('[role=tooltip]').exists()).toBe(false);
        vi.useRealTimers();
        await button.trigger('focus');
        await flushPromises();
        expect(own.find('[role=tooltip]').exists()).toBe(true);
        await button.trigger('click');
        expect(own.find('[role=tooltip]').exists()).toBe(false);
        await label.trigger('mouseenter');
        await flushPromises();
        blocked.value = true;
        await flushPromises();
        expect(own.find('[role=tooltip]').exists()).toBe(false);
        await button.trigger('focus');
        expect(own.find('[role=tooltip]').exists()).toBe(false);
        blocked.value = false;
        await label.trigger('mouseenter');
        await own.setProps({ variant: { ...variant, key: 'module' } });
        expect(own.find('[role=tooltip]').exists()).toBe(false);
      } finally {
        own.unmount();
      }
    },
  );
});
