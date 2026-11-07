vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({ ...(await import('@/test/unit/project-changes')) }));
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

function stepperHarness(onStep = vi.fn<NonNullable<InstanceType<typeof VariantRefitStats>['$props']['onStep']>>(async () => true)) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const snapshot = variantJointFixture(),
    values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value])),
    variant = projectVariantPanel(snapshot, values).variants[0]!,
    wrapper = mount(VariantRefitStats, {
      props: {
        variant,
        vm: {
          joint: { currentTarget: shallowRef(snapshot.root) },
          displaySnapshot: shallowRef(snapshot),
          displayValues: shallowRef(values),
        } as ReturnType<typeof useImmersiveVariantEditor>,
        pickerOpen: false,
        onStep,
        render: { mode: 'readonly', root: snapshot.root, records: snapshot.records, mediaUrl: () => '' },
      },
      global: {
        stubs: {
          ...editorUiStubs,
          VariantShipInfo: true,
          ImmersivePanelRow: true,
          ImmersiveHullmodIcon: true,
          ImmersiveText: true,
        },
      },
    });
  return { wrapper, onStep };
}

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
          onStep: vi.fn(async () => true),
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
  it.each(['ordinary', 'shift', 'ctrl', 'alt'])('repeats a held step with %s', async (modifier) => {
    const own = stepperHarness();
    const accelerated = modifier === 'shift';
    vi.useFakeTimers();
    try {
      const button = own.wrapper.find('[aria-label="增加幅能寄存器"]');
      button.element.dispatchEvent(
        Object.assign(
          new MouseEvent('pointerdown', { button: 0, shiftKey: accelerated, ctrlKey: modifier === 'ctrl', altKey: modifier === 'alt' }),
          { pointerId: 7 },
        ),
      );
      await flushPromises();
      expect(own.onStep).toHaveBeenCalledTimes(1);
      button.element.dispatchEvent(new MouseEvent('click', { detail: 1 }));
      await vi.advanceTimersByTimeAsync(499);
      expect(own.onStep).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(own.onStep).toHaveBeenCalledTimes(2);
      const interval = accelerated ? 25 : 250;
      await vi.advanceTimersByTimeAsync(interval - 1);
      expect(own.onStep).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(own.onStep).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(accelerated ? 12.5 : 125);
      expect(own.onStep).toHaveBeenCalledTimes(4);
      window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 7 }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(own.onStep).toHaveBeenCalledTimes(4);
    } finally {
      own.wrapper.unmount();
      vi.useRealTimers();
    }
  });
  it('stops a held stepper when the limit confirmation is declined', async () => {
    const onStep = vi.fn().mockResolvedValueOnce(false),
      own = stepperHarness(onStep);
    vi.useFakeTimers();
    try {
      own.wrapper
        .get('[aria-label="增加幅能寄存器"]')
        .element.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { button: 0 }), { pointerId: 3 }));
      await flushPromises();
      await vi.advanceTimersByTimeAsync(1000);
      expect(onStep).toHaveBeenCalledOnce();
    } finally {
      own.wrapper.unmount();
      vi.useRealTimers();
    }
  });
  it.each(['blur', 'pointercancel', 'module', 'unmount'])('stops a held adjustment on %s', async (ending) => {
    const own = stepperHarness();
    vi.useFakeTimers();
    try {
      own.wrapper
        .get('[aria-label="减少幅能寄存器"]')
        .element.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { button: 0 }), { pointerId: 2 }));
      await flushPromises();
      expect(own.onStep).toHaveBeenLastCalledWith('fluxCapacitors', -1);
      if (ending === 'unmount') own.wrapper.unmount();
      else if (ending === 'module') await own.wrapper.setProps({ variant: { ...own.wrapper.props('variant'), key: 'module' } });
      else window.dispatchEvent(Object.assign(new Event(ending), { pointerId: 2 }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(own.onStep).toHaveBeenCalledOnce();
    } finally {
      if (ending !== 'unmount') own.wrapper.unmount();
      vi.useRealTimers();
    }
  });
});
