import { flushPromises, mount } from '@vue/test-utils';
import { computed, defineComponent, h, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provideOriginalFonts, useOriginalFont, useFontMeasurement } from './use-original-fonts';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { parseOriginalBitmapFont } from '@/domain/fonts/bitmap-font';
import { originalFontFixture } from '@/test/fixtures/font';
import type { FontId } from '@/domain/fonts/font.types';
import type { OriginalFontResult } from '@/shared/types/font.types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), decode: vi.fn(), log: vi.fn() }));
vi.mock('@/services/font.service', () => ({ queryOriginalFont: mocks.query }));
vi.mock('@/app/fonts/font-provider', () => ({ decodeOriginalFont: mocks.decode }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: mocks.log }));

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ starsectorRoot: 'C:/game' }));
  vi.resetAllMocks();
  mocks.query.mockImplementation(async (_session: string, _root: string, id: FontId) => originalFontFixture(id));
  mocks.decode.mockImplementation(async (source: Extract<OriginalFontResult, { status: 'available' }>) => ({
    definition: parseOriginalBitmapFont(source.definition),
    pages: new Map(source.pages.map((page) => [page.id, new Image()])),
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    font: '',
    measureText: (text: string) => ({ width: text.length * 5 }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

function harness(ids: FontId[] = ['insignia15LTaa']) {
  const session = ref('session');
  const visible = ref(true);
  let runtime!: ReturnType<typeof provideOriginalFonts>;
  const Consumer = defineComponent({
    props: { id: { type: String, required: true } },
    setup(props) {
      const loaded = useOriginalFont(() => props.id as FontId);
      return () => h('span', loaded.value ? 'bitmap' : 'default');
    },
  });
  const wrapper = mount(
    defineComponent({
      setup() {
        runtime = provideOriginalFonts(() => session.value);
        return () => h('div', visible.value ? ids.map((id, index) => h(Consumer, { id, key: index })) : []);
      },
    }),
  );
  return { wrapper, runtime, session, visible };
}

describe('independent original font lifecycle', () => {
  it('shares a pending request among consumers and retains its result for the window', async () => {
    let finish!: (value: OriginalFontResult) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise<OriginalFontResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { wrapper, runtime, visible } = harness(['insignia15LTaa', 'insignia15LTaa']);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(runtime.state('insignia15LTaa').status).toBe('loading');
    expect(wrapper.text()).toBe('defaultdefault');
    visible.value = false;
    await flushPromises();
    finish(originalFontFixture());
    await flushPromises();
    visible.value = true;
    await flushPromises();
    expect(wrapper.text()).toBe('bitmapbitmap');
    expect(mocks.decode).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(runtime.state('insignia15LTaa').status).toBe('idle');
  });
  it('adopts successful fonts while a different font fails and logs once per attempt', async () => {
    mocks.query.mockImplementation(async (_session: string, _root: string, id: FontId) => {
      if (id === 'victor14')
        throw { code: 'io.unexpected', message: 'Missing font', location: { path: 'C:/game/victor14.fnt', line: null, column: null } };
      return originalFontFixture(id);
    });
    const { wrapper, runtime } = harness(['insignia15LTaa', 'victor14', 'victor14']);
    await flushPromises();
    expect(wrapper.text()).toBe('bitmapdefaultdefault');
    expect(runtime.state('victor14').status).toBe('error');
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ path: 'C:/game/victor14.fnt', fields: expect.objectContaining({ fontId: 'victor14' }) }),
    );
    useSettingsStore().setImmersiveGameFont(false);
    expect(runtime.state('insignia15LTaa').font).toBeNull();
    await flushPromises();
    expect(wrapper.text()).toBe('defaultdefaultdefault');
    useSettingsStore().setImmersiveGameFont(true);
    await flushPromises();
    expect(wrapper.text()).toBe('bitmapdefaultdefault');
    expect(mocks.log).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
  it('skips disabled loading and treats unavailable Core as a default font state', async () => {
    useSettingsStore().setImmersiveGameFont(false);
    const { wrapper, runtime } = harness();
    expect(mocks.query).not.toHaveBeenCalled();
    mocks.query.mockResolvedValue({ status: 'unavailable' });
    useSettingsStore().setImmersiveGameFont(true);
    await flushPromises();
    expect(runtime.state('insignia15LTaa').status).toBe('unavailable');
    expect(wrapper.text()).toBe('default');
    expect(mocks.log).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it.each(['off', 'root', 'session', 'close'] as const)('rejects late success and failure after %s', async (reason) => {
    let finish!: (value: OriginalFontResult) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise<OriginalFontResult>((resolve) => {
          finish = resolve;
        }),
    );
    const { wrapper, runtime, session } = harness();
    if (reason === 'off') useSettingsStore().setImmersiveGameFont(false);
    if (reason === 'root') useSettingsStore().setStarsectorRoot('C:/other');
    if (reason === 'session') session.value = 'session2';
    if (reason === 'close') wrapper.unmount();
    await flushPromises();
    const current = runtime.state('insignia15LTaa');
    mocks.decode.mockRejectedValueOnce(new Error('obsolete decode'));
    finish(originalFontFixture());
    await flushPromises();
    expect(runtime.state('insignia15LTaa')).toEqual(current);
    expect(mocks.log).not.toHaveBeenCalled();
    if (reason !== 'close') wrapper.unmount();
  });
  it('isolates A-B-A loading generations and captures a nullable session-root input', async () => {
    const finishes: Array<(value: OriginalFontResult) => void> = [];
    mocks.query.mockImplementation(() => new Promise<OriginalFontResult>((resolve) => finishes.push(resolve)));
    const { wrapper, runtime } = harness();
    useSettingsStore().setStarsectorRoot('C:/other');
    useSettingsStore().setStarsectorRoot('C:/game');
    finishes[2]!(originalFontFixture());
    await flushPromises();
    const accepted = runtime.state('insignia15LTaa').font;
    finishes[0]!(originalFontFixture());
    finishes[1]!({ status: 'unavailable' });
    await flushPromises();
    expect(runtime.state('insignia15LTaa').font).toBe(accepted);
    useSettingsStore().setStarsectorRoot(null);
    expect(mocks.query).toHaveBeenLastCalledWith('session', null, 'insignia15LTaa');
    finishes[3]!({ status: 'unavailable' });
    await flushPromises();
    wrapper.unmount();
  });
  it('recomputes width from default metrics to question-mark bitmap metrics', async () => {
    let finish!: (value: OriginalFontResult) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise<OriginalFontResult>((resolve) => {
          finish = resolve;
        }),
    );
    const Child = defineComponent({
      setup() {
        const measure = useFontMeasurement('insignia15LTaa');
        const width = computed(() => measure([{ text: '🚀' }]));
        return () => h('span', width.value);
      },
    });
    const wrapper = mount(
      defineComponent({
        setup() {
          provideOriginalFonts(() => 'session');
          return () => h(Child);
        },
      }),
    );
    expect(wrapper.text()).toBe('10');
    finish(originalFontFixture());
    await flushPromises();
    expect(wrapper.text()).toBe('7');
    useSettingsStore().setImmersiveGameFont(false);
    await flushPromises();
    expect(wrapper.text()).toBe('10');
    wrapper.unmount();
  });
  it('recomputes default widths when the general font changes', async () => {
    useSettingsStore().setImmersiveGameFont(false);
    const fonts: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      font: '',
      measureText(this: CanvasRenderingContext2D) {
        fonts.push(this.font);
        return { width: this.font.includes('Arial') ? 12 : 8 };
      },
    } as unknown as CanvasRenderingContext2D);
    const Consumer = defineComponent({
      setup() {
        const measure = useFontMeasurement('insignia15LTaa');
        return () => h('span', measure([{ text: 'Demo' }]));
      },
    });
    const wrapper = mount(Consumer);
    expect(wrapper.text()).toBe('8');
    useSettingsStore().setGeneralFont('Arial');
    await flushPromises();
    expect(wrapper.text()).toBe('12');
    expect(fonts.at(-1)).toContain('"Arial"');
    wrapper.unmount();
  });
});
