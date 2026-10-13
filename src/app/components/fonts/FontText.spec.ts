import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { getFont } from '@/app/fonts/font-provider';
import FontText from './FontText.vue';
import { parseBitmapFont } from '@/domain/fonts/bitmap-font';
const mocks = vi.hoisted(() => ({ atlas: vi.fn(), error: vi.fn() }));
vi.mock('@/app/fonts/font-provider', async (original) => ({
  ...(await original<typeof import('@/app/fonts/font-provider')>()),
  loadFontAtlas: mocks.atlas,
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
  it('keeps two consumers independent when one waiting component is released', async () => {
    let resolve!: (image: object) => void;
    mocks.atlas.mockReturnValue(
      new Promise((ready) => {
        resolve = ready;
      }),
    );
    const first = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰' } });
    const second = mount(FontText, { props: { font: 'insignia15LTaa', text: '船' } });
    first.unmount();
    resolve({});
    await flushPromises();
    expect(context.drawImage).toHaveBeenCalled();
    expect(second.find('.font-accessible-text').text()).toBe('船');
    expect(mocks.error).not.toHaveBeenCalled();
    second.unmount();
  });

  it('accepts the current font and ignores a replaced font late failure', async () => {
    let reject!: (error: Error) => void;
    mocks.atlas
      .mockReturnValueOnce(
        new Promise((_ready, fail) => {
          reject = fail;
        }),
      )
      .mockResolvedValue({});
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰' } });
    await own.setProps({ font: 'orbitron12condensed' });
    await flushPromises();
    reject(new Error('replaced'));
    await flushPromises();
    expect(mocks.atlas).toHaveBeenLastCalledWith('orbitron12condensed');
    expect(mocks.error).not.toHaveBeenCalled();
    expect(context.drawImage).toHaveBeenCalled();
    own.unmount();
  });

  it('uses the formal feedback entry for an active atlas failure', async () => {
    const error = new Error('active font failure');
    mocks.atlas.mockRejectedValue(error);
    const own = mount(FontText, { props: { font: 'victor14', text: '筛选' } });
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(error, '读取字体失败');
    own.unmount();
  });

  it('reserves negative glyph offsets and outline without clipping the canvas', async () => {
    const provider = await import('@/app/fonts/font-provider');
    vi.spyOn(provider, 'getFont').mockReturnValue(
      parseBitmapFont('common lineHeight=10 base=8\nchar id=65 x=0 y=0 width=12 height=14 xoffset=-2 yoffset=-3 xadvance=7 page=0'),
    );
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: 'A', outlined: true } });
    await flushPromises();
    expect(own.find('canvas').element.width).toBe(16);
    expect(own.find('canvas').element.height).toBe(16);
    expect(
      context.drawImage.mock.calls.filter((call) => call[0] instanceof HTMLCanvasElement).every((call) => call[5] >= 0 && call[6] >= 0),
    ).toBe(true);
    own.unmount();
  });

  it('reports every Unicode point of an unavailable grapheme and preserves original runs', async () => {
    const own = mount(FontText, { props: { font: 'insignia15LTaa', runs: [{ text: 'a' }, { text: '\u0301', color: '#ffd200' }] } });
    await flushPromises();
    expect(own.find('.font-accessible-text').text()).toBe('á');
    expect(own.attributes('title')).toContain('U+61 U+301');
    expect(context.strokeRect).toHaveBeenCalledOnce();
    own.unmount();
  });
  it('cancels a pending size measurement when the component is released', async () => {
    const schedule = vi.fn(() => 7);
    vi.stubGlobal('requestAnimationFrame', schedule);
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰船' } });
    await flushPromises();
    resize([{ contentRect: { width: 20 } }] as ResizeObserverEntry[], {} as ResizeObserver);
    expect(schedule).toHaveBeenCalledOnce();
    own.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(7);
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it('keeps accessible original text, ink baseline and missing character diagnostics', async () => {
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰🚀' } });
    await flushPromises();
    expect(own.find('.font-accessible-text').text()).toBe('舰🚀');
    expect(own.attributes('title')).toContain('U+1F680');
    const glyph = getFont('insignia15LTaa').glyphs.get('舰'.codePointAt(0)!)!;
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
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰船名称舰船名称', block: true } });
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
  it.each(
    [1, 1.25, 1.5, 2].flatMap((ratio) => [
      { ratio, outlined: false },
      { ratio, outlined: true },
    ]),
  )('aligns glyphs and canvas at DPR $ratio with outline $outlined', async ({ ratio, outlined }) => {
    vi.stubGlobal('devicePixelRatio', ratio);
    let left = 10.25,
      top = 15.375;
    const bounds = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ left, top, width: 30, height: 17 }) as DOMRect);
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: '舰船75', outlined } });
    await flushPromises();
    const canvas = own.find('canvas').element;
    expect(Number.parseFloat(canvas.style.width) * ratio).toBeCloseTo(canvas.width);
    expect(Number.parseFloat(canvas.style.height) * ratio).toBeCloseTo(canvas.height);
    const aligned = () => {
      const padding = outlined ? Math.max(1, Math.round(ratio)) : 0;
      expect((left + Number.parseFloat(canvas.style.left)) * ratio).toBeCloseTo(Math.round(left * ratio) - padding);
      expect((top + Number.parseFloat(canvas.style.top)) * ratio).toBeCloseTo(Math.round(top * ratio) - padding);
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
    const own = mount(FontText, { props: { font: 'insignia15LTaa', text: 'Text' } });
    own.unmount();
    reject(new Error('late'));
    await flushPromises();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });
  it('centers visible Chinese ink and reserves a physical black outline at fractional DPI', async () => {
    vi.stubGlobal('devicePixelRatio', 1.5);
    const own = mount(FontText, { props: { text: '容器', font: 'orbitron20aabold', inkAligned: true, outlined: true } });
    await flushPromises();
    const glyphs = Array.from('容器').map((character) => getFont('orbitron20aabold').glyphs.get(character.codePointAt(0)!)!);
    const top = Math.min(...glyphs.map((glyph) => glyph.yoffset)),
      bottom = Math.max(...glyphs.map((glyph) => glyph.yoffset + glyph.height));
    expect(Number.parseFloat(own.element.style.height)).toBe(bottom - top);
    expect(own.find('canvas').element.height).toBe(Math.ceil((bottom - top) * 1.5) + 4);
    expect(context.drawImage.mock.calls.filter((call) => call[0] instanceof HTMLCanvasElement)).toHaveLength(18);
    expect(own.find('.font-accessible-text').text()).toBe('容器');
    own.unmount();
  });
});
