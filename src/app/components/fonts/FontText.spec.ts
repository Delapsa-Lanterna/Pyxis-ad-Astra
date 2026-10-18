import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { computed, shallowRef } from 'vue';
import FontText from './FontText.vue';
import { parseOriginalBitmapFont, parseBitmapFont } from '@/domain/fonts/bitmap-font';
import { originalFontFixture } from '@/test/font';
import type { LoadedFont } from '@/app/fonts/font-provider';

const current = shallowRef<LoadedFont | null>(null);
vi.mock('@/app/composables/use-original-fonts', () => ({ useOriginalFont: () => computed(() => current.value) }));
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
const context = {
  scale: vi.fn(),
  drawImage: vi.fn(),
  strokeRect: vi.fn(),
  fillRect: vi.fn(),
  imageSmoothingEnabled: true,
  globalCompositeOperation: 'source-over',
};
beforeEach(() => {
  vi.clearAllMocks();
  current.value = {
    definition: parseOriginalBitmapFont(originalFontFixture(undefined, 2).definition),
    pages: new Map([
      [0, new Image()],
      [1, new Image()],
    ]),
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnect();
      }
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('font text presentation', () => {
  it('keeps default text, colors and role style while its font is unavailable', async () => {
    current.value = null;
    const own = mount(FontText, {
      props: { font: 'orbitron20aabold', runs: [{ text: '舰船 ' }, { text: '75', color: '#ffd200' }], block: true, outlined: true },
    });
    expect(own.text()).toBe('舰船 75');
    expect(own.classes()).toContain('font-default');
    expect(own.element.style.fontSize).toBe('20px');
    expect(own.element.style.fontWeight).toBe('700');
    expect(own.findAll('span').some((element) => element.element.style.color === 'rgb(255, 210, 0)')).toBe(true);
    current.value = { definition: parseOriginalBitmapFont(originalFontFixture().definition), pages: new Map([[0, new Image()]]) };
    await flushPromises();
    expect(own.find('canvas').exists()).toBe(true);
    expect(own.find('.font-accessible-text').text()).toBe('舰船 75');
    current.value = null;
    await flushPromises();
    expect(own.text()).toBe('舰船 75');
    expect(own.element.style.height).toBe('');
    own.unmount();
  });
  it('uses the glyph page and renders missing graphemes as intentional question marks', async () => {
    const own = mount(FontText, { props: { font: 'insignia15LTaa', runs: [{ text: 'A' }, { text: '🚀á', color: '#ffd200' }] } });
    await flushPromises();
    expect(own.find('.font-accessible-text').text()).toBe('A🚀á');
    expect(own.attributes('title')).toContain('U+1F680');
    expect(own.attributes('title')).toContain('U+61 U+301');
    expect(context.strokeRect).not.toHaveBeenCalled();
    expect(context.drawImage.mock.calls.filter((call) => call[0] instanceof HTMLCanvasElement)).toHaveLength(3);
    own.unmount();
  });
  it('reserves negative glyph offsets and outline', async () => {
    current.value = {
      definition: parseBitmapFont(
        'common lineHeight=10 base=8\nchar id=65 x=0 y=0 width=12 height=14 xoffset=-2 yoffset=-3 xadvance=7 page=0',
      ),
      pages: new Map([[0, new Image()]]),
    };
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: 'A', outlined: true } });
    await flushPromises();
    expect(own.get('canvas').element.width).toBe(16);
    expect(own.get('canvas').element.height).toBe(16);
    expect(
      context.drawImage.mock.calls.filter((call) => call[0] instanceof HTMLCanvasElement).every((call) => call[5] >= 0 && call[6] >= 0),
    ).toBe(true);
    own.unmount();
  });
  it('reflows at the current container width and releases scheduled measurements', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰船名称舰船名称', block: true } });
    await flushPromises();
    resize([{ target: own.element, contentRect: { width: 30 } }] as ResizeObserverEntry[], {} as ResizeObserver);
    await flushPromises();
    expect(own.get('canvas').element.width).toBe(60);
    expect(Number.parseFloat(own.element.style.height)).toBeGreaterThan(10);
    expect(context.scale).not.toHaveBeenCalled();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 7),
    );
    resize([{ target: own.element, contentRect: { width: 20 } }] as ResizeObserverEntry[], {} as ResizeObserver);
    await own.vm.$nextTick();
    own.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it.each([1, 1.25, 1.5, 2].flatMap((ratio) => [false, true].map((outlined) => ({ ratio, outlined }))))(
    'aligns bitmap text at DPR $ratio with outline $outlined',
    async ({ ratio, outlined }) => {
      vi.stubGlobal('devicePixelRatio', ratio);
      let left = 10.25,
        top = 15.375;
      const bounds = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(() => ({ left, top, width: 30, height: 10 }) as DOMRect);
      const own = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰船', outlined } });
      await flushPromises();
      const canvas = own.get('canvas').element;
      const aligned = () => {
        const padding = outlined ? Math.max(1, Math.round(ratio)) : 0;
        expect((left + Number.parseFloat(canvas.style.left)) * ratio).toBeCloseTo(Math.round(left * ratio) - padding);
        expect((top + Number.parseFloat(canvas.style.top)) * ratio).toBeCloseTo(Math.round(top * ratio) - padding);
      };
      aligned();
      expect(Number.parseFloat(canvas.style.width) * ratio).toBeCloseTo(canvas.width);
      expect(
        context.drawImage.mock.calls
          .filter((call) => call[0] instanceof HTMLCanvasElement)
          .every((call) => call.slice(5).every(Number.isInteger)),
      ).toBe(true);
      left = 10.625;
      top = 10.125;
      window.dispatchEvent(new Event('scroll'));
      await flushPromises();
      aligned();
      own.unmount();
      bounds.mockClear();
      window.dispatchEvent(new Event('scroll'));
      expect(bounds).not.toHaveBeenCalled();
    },
  );
});
