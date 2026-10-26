import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { useSchemaPathPicker } from './use-schema-path-picker';

const mocks = vi.hoisted(() => ({ pick: vi.fn(), warning: vi.fn(), resolve: vi.fn(async () => 'graphics/custom/image.png') }));
vi.mock('@/shared/runtime/dialog.runtime', () => ({ pickImageFileDialog: mocks.pick, pickFileDialog: mocks.pick }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ warning: mocks.warning }) }));
vi.mock('@/services/resource-reference.service', () => ({ resolveModImageReference: mocks.resolve }));

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function mountPicker(args: Parameters<typeof useSchemaPathPicker>[0]) {
  let picker!: ReturnType<typeof useSchemaPathPicker>;
  wrappers.push(
    mount({
      setup() {
        picker = useSchemaPathPicker(args);
        return () => null;
      },
    }),
  );
  return picker;
}

describe('schema path bases', () => {
  it('uses the existing backend authorization for manually selected Mod images', async () => {
    const setPath = vi.fn();
    const picker = mountPicker({ runtimeContext: () => ({ sessionId: 's1', modRoot: 'M:/mod' }), setPath });
    mocks.pick.mockResolvedValueOnce('M:/mod/graphics/custom/image.png');
    await picker.pickPathFile({ imageFilter: true });
    expect(mocks.resolve).toHaveBeenCalledWith('s1', 'M:/mod', 'M:/mod/graphics/custom/image.png', expect.any(AbortSignal));
    expect(setPath).toHaveBeenCalledWith('graphics/custom/image.png');
  });
  it('stores the task-relative icon path and rejects files outside the task', async () => {
    const setPath = vi.fn();
    const picker = mountPicker({
      runtimeContext: () => ({ sessionId: 's1', modRoot: 'M:/mod', missionId: 'demo' }),
      pathBase: () => 'mission',
      setPath,
    });
    mocks.pick.mockResolvedValueOnce('M:/mod/data/missions/demo/icon.png');
    await picker.pickPathFile({ imageFilter: true });
    expect(setPath).toHaveBeenCalledWith('icon.png');
    expect('data/missions/demo/' + setPath.mock.calls[0]![0]).toBe('data/missions/demo/icon.png');
    setPath.mockClear();
    mocks.warning.mockClear();
    mocks.pick.mockResolvedValueOnce('M:/mod/graphics/icon.png');
    await picker.pickPathFile({ imageFilter: true });
    expect(setPath).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it.each(['target', 'release'])('revokes a pending path result on %s', async (boundary) => {
    let root = 'M:/A';
    let release!: (path: string) => void;
    mocks.pick.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const setPath = vi.fn();
    const picker = mountPicker({ runtimeContext: () => ({ sessionId: 's1', modRoot: root }), setPath });
    const pending = picker.pickPathFile();
    if (boundary === 'target') root = 'M:/B';
    else wrappers.at(-1)!.unmount();
    release('M:/A/file.txt');
    await pending;
    expect(setPath).not.toHaveBeenCalled();
  });
});
