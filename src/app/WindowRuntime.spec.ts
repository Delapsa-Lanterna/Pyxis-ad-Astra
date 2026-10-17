import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, h, nextTick, ref } from 'vue';
import { NConfigProvider } from 'naive-ui/es/config-provider';
import { NMessageProvider } from 'naive-ui/es/message';
import { NDialogProvider } from 'naive-ui/es/dialog';
import { NPopover } from 'naive-ui/es/popover';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WindowShell from './WindowShell.vue';
import { createWindowFeedback } from './app-feedback-assembly';
import { useAppFeedback } from './composables/use-app-feedback';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import type { AppFeedback } from '@/shared/types';
import { useWindowCloseState } from './composables/use-window-close-state';
import type { Ref } from 'vue';

const mocks = vi.hoisted(() => ({ stop: vi.fn(), listen: vi.fn(), register: vi.fn(async () => {}), log: vi.fn() }));
vi.mock('./app-feedback-assembly', async (original) => {
  const module = await original<typeof import('./app-feedback-assembly')>();
  return { ...module, createWindowFeedback: vi.fn(module.createWindowFeedback) };
});
vi.mock('@/orchestrators/edit-target-handoff.orchestrator', () => ({ listenEditTargetHandoff: mocks.listen }));
vi.mock('@/services/window.service', () => ({ updateEditTargetRegistration: mocks.register }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreAssetsLifecycle: vi.fn() }));
vi.mock('@/app/composables/use-window-image-cache', () => ({ useWindowImageCacheLifetime: vi.fn() }));
vi.mock('@/app/composables/use-app-lifecycle-assembly', async (original) => ({
  ...(await original<typeof import('@/app/composables/use-app-lifecycle-assembly')>()),
  useAppSettings: vi.fn(),
}));
vi.mock('@/app/composables/settings/use-theme-dom-effect', () => ({ useThemeDomEffect: vi.fn() }));

const wrappers: VueWrapper[] = [];
const consumers: AppFeedback[] = [];
const closingStates: Ref<boolean>[] = [];
const Probe = defineComponent({
  setup() {
    consumers.push(useAppFeedback());
    closingStates.push(useWindowCloseState()!);
    return () => h('span', 'page');
  },
});
function windowHarness(mode: 'main' | 'child' = 'main') {
  const page = ref(0);
  const wrapper = mount(WindowShell, {
    attachTo: document.body,
    props: { mode },
    global: { components: { NConfigProvider, NMessageProvider, NDialogProvider } },
    slots: { default: () => [h(Probe, { key: page.value }), h(Probe, { key: 'peer' })] },
  });
  wrappers.push(wrapper);
  return { wrapper, page };
}
beforeEach(() => {
  vi.clearAllMocks();
  consumers.length = 0;
  closingStates.length = 0;
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  mocks.listen.mockResolvedValue(mocks.stop);
});
afterEach(async () => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  await flushPromises();
});

describe('window-owned feedback', () => {
  it('locks existing and late content overlays while preserving feedback controls', async () => {
    const show = ref(true);
    const Host = defineComponent({
      setup() {
        closingStates.push(useWindowCloseState()!);
        consumers.push(useAppFeedback());
        return () =>
          show.value
            ? h(NPopover, { show: true, trigger: 'manual' }, { trigger: () => h('button', 'Open'), default: () => h('button', 'Overlay') })
            : null;
      },
    });
    const wrapper = mount(WindowShell, {
      attachTo: document.body,
      global: { components: { NConfigProvider, NMessageProvider, NDialogProvider } },
      slots: { default: () => h(Host) },
    });
    wrappers.push(wrapper);
    await flushPromises();
    const overlay = () => [...document.querySelectorAll('button')].find((button) => button.textContent === 'Overlay')!;
    expect(overlay().closest('.window-runtime-overlays')).toBeNull();
    closingStates[0]!.value = true;
    await nextTick();
    expect(overlay().closest('.window-runtime-overlays')).not.toBeNull();
    show.value = false;
    await nextTick();
    show.value = true;
    await flushPromises();
    expect(overlay().closest('.window-runtime-overlays')).not.toBeNull();
    consumers[0]!.info('窗口反馈');
    await flushPromises();
    expect(document.querySelector('.n-message')?.closest('[inert]')).toBeNull();
    closingStates[0]!.value = false;
    await nextTick();
    expect(overlay().closest('.window-runtime-overlays')).toBeNull();
  });
  it('shares the close lock within its window and keeps other window contents interactive', async () => {
    const first = windowHarness();
    const second = windowHarness('child');
    expect(closingStates[0]).toBe(closingStates[1]);
    expect(closingStates[0]).not.toBe(closingStates[2]);
    closingStates[0]!.value = true;
    await nextTick();
    expect(first.wrapper.get('.window-runtime').attributes('inert')).toBeDefined();
    expect(second.wrapper.get('.window-runtime').attributes('inert')).toBeUndefined();
    consumers[0]!.info('关闭结果');
    await flushPromises();
    expect(document.body.textContent).toContain('关闭结果');
    closingStates[0]!.value = false;
    await nextTick();
    expect(first.wrapper.get('.window-runtime').attributes('inert')).toBeUndefined();
  });
  it.each(['main', 'child'] as const)('creates one shared instance before %s contents and target handoff', async (mode) => {
    windowHarness(mode);
    await flushPromises();
    expect(createWindowFeedback).toHaveBeenCalledOnce();
    expect(consumers).toHaveLength(2);
    expect(consumers[0]).toBe(consumers[1]);
    expect(mocks.listen).toHaveBeenCalledExactlyOnceWith(consumers[0]);
    expect(mocks.register).toHaveBeenCalledWith([]);
  });
  it('keeps the instance and its feedback after replacing the source page', async () => {
    const { page } = windowHarness();
    const feedback = consumers[0]!;
    page.value++;
    await nextTick();
    expect(consumers.at(-1)).toBe(feedback);
    expect(createWindowFeedback).toHaveBeenCalledOnce();
    feedback.info('操作已完成');
    await flushPromises();
    expect(document.body.textContent).toContain('操作已完成');
  });
  it('isolates feedback between window roots and releases the matching listener', async () => {
    const first = windowHarness();
    windowHarness('child');
    await flushPromises();
    expect(consumers[0]).not.toBe(consumers[2]);
    first.wrapper.unmount();
    await flushPromises();
    expect(mocks.stop).toHaveBeenCalledOnce();
    consumers[2]!.info('另一个窗口');
    await flushPromises();
    expect(document.body.textContent).toContain('另一个窗口');
  });
  it('releases a listener that arrives after its window unmounts', async () => {
    let complete!: (stop: () => void) => void;
    mocks.listen.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          complete = resolve;
        }),
    );
    const { wrapper } = windowHarness();
    wrapper.unmount();
    complete(mocks.stop);
    await flushPromises();
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.register.mock.lastCall).toEqual([[]]);
  });
});
