import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { IMMERSIVE_FONTS } from '@/app/immersive-fonts';
import ImmersiveText from './ImmersiveText.vue';
const mocks = vi.hoisted(() => ({ atlas: vi.fn(), error: vi.fn() }));
vi.mock('@/app/immersive-fonts', async (original) => ({
  ...(await original<typeof import('@/app/immersive-fonts')>()),
  loadImmersiveAtlas: mocks.atlas,
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
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
  mocks.atlas.mockResolvedValue({});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
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
describe('bitmap text presentation lifecycle', () => {
  it('keeps accessible original text, ink baseline and missing character diagnostics', async () => {
    const own = mount(ImmersiveText, { props: { text: '舰🚀' } });
    await flushPromises();
    expect(own.find('.immersive-accessible-text').text()).toBe('舰🚀');
    expect(own.attributes('title')).toContain('U+1F680');
    const glyph = IMMERSIVE_FONTS.body.glyphs.get('舰'.codePointAt(0)!)!;
    expect(
      context.drawImage.mock.calls.some(
        (call) => call[0] instanceof HTMLCanvasElement && call[5] === glyph.xoffset && call[6] === glyph.yoffset,
      ),
    ).toBe(true);
    expect(context.strokeRect).toHaveBeenCalled();
    own.unmount();
  });
  it('reflows when its container changes and scales backing pixels while keeping layout size', async () => {
    vi.stubGlobal('devicePixelRatio', 2);
    const own = mount(ImmersiveText, { props: { text: '舰船名称舰船名称', block: true } });
    await flushPromises();
    resize([{ contentRect: { width: 30 } }] as ResizeObserverEntry[], {} as ResizeObserver);
    await flushPromises();
    expect(own.find('canvas').element.width).toBe(60);
    expect(Number.parseFloat(own.element.style.height)).toBeGreaterThan(17);
    expect(own.find('canvas').element.style.width).toBe('30px');
    expect(context.scale).not.toHaveBeenCalled();
    own.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it.each([1, 1.25, 1.5, 2])('aligns glyphs and canvas presentation to physical pixels at DPR %s', async (ratio) => {
    vi.stubGlobal('devicePixelRatio', ratio);
    let left = 10.25,
      top = 15.375;
    const bounds = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ left, top, width: 30, height: 17 }) as DOMRect);
    const own = mount(ImmersiveText, { props: { text: '舰船75' } });
    await flushPromises();
    const canvas = own.find('canvas').element;
    expect(Number.parseFloat(canvas.style.width) * ratio).toBeCloseTo(canvas.width);
    expect(Number.parseFloat(canvas.style.height) * ratio).toBeCloseTo(canvas.height);
    const aligned = () => {
      expect((left + Number.parseFloat(canvas.style.left)) * ratio).toBeCloseTo(Math.round(left * ratio));
      expect((top + Number.parseFloat(canvas.style.top)) * ratio).toBeCloseTo(Math.round(top * ratio));
    };
    aligned();
    const glyphs = context.drawImage.mock.calls.filter((call) => call[0] instanceof HTMLCanvasElement);
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.every((call) => call.slice(5).every(Number.isInteger))).toBe(true);
    expect(context.imageSmoothingEnabled).toBe(false);
    left = 10.625;
    top = 10.125;
    window.dispatchEvent(new Event('scroll'));
    aligned();
    own.unmount();
    bounds.mockClear();
    window.dispatchEvent(new Event('scroll'));
    expect(bounds).not.toHaveBeenCalled();
  });
  it('releases a waiting decode and ignores its late failure', async () => {
    let reject!: (error: Error) => void;
    mocks.atlas.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    const own = mount(ImmersiveText, { props: { text: 'Text' } });
    own.unmount();
    reject(new Error('late'));
    await flushPromises();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });
});
