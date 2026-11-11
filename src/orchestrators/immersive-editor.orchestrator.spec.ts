import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wingJointFixture } from '@/test/fixtures/joint-edit/wing-joint-edit';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import type { WindowContextFor } from '@/shared/types';
import { openEntityImmersiveEditor, openVariantImmersiveEditor, retargetImmersiveWindow } from './immersive-editor.orchestrator';
const mocks = vi.hoisted(() => ({
  focus: vi.fn(),
  open: vi.fn(),
  retarget: vi.fn(),
  publish: vi.fn(),
  row: vi.fn(),
  query: vi.fn(),
  context: { value: null as WindowContextFor<'immersive-editor'> | null },
}));
vi.mock('@/services/window.service', () => ({ focusNativeManagedWindow: mocks.focus, retargetNativeWindow: mocks.retarget }));
vi.mock('@/windows/immersive-editor.window', () => ({
  openImmersiveEditorWindow: mocks.open,
  immersiveWindowTitle: (root: { id: string }) => '战机联队 - ' + root.id,
}));
vi.mock('@/windows/window-context.window', () => ({ managedWindowContext: mocks.context, publishWindowContext: mocks.publish }));
vi.mock('@/orchestrators/joint-edit.orchestrator', () => ({ openJointEditRowSnapshot: mocks.row, openJointEditSnapshot: mocks.query }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.focus.mockResolvedValue(true);
  mocks.open.mockResolvedValue({ status: 'accepted' });
  mocks.context.value = null;
});
describe('immersive window structured handoff', () => {
  it('delivers a focus request to a reused wing and waits for its receiver', async () => {
    const snapshot = wingJointFixture();
    const request = {
      root: snapshot.root,
      rowKey: 'wing-current',
      csvTarget: { sessionId: snapshot.root.sessionId, modRoot: snapshot.root.modRoot, path: 'M:/mod/wings.csv' },
    };
    let finish!: () => void;
    mocks.open.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    let done = false;
    const opening = openEntityImmersiveEditor(request).then(() => {
      done = true;
    });
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledWith(snapshot.root, 'wing-current'));
    expect(done).toBe(false);
    finish();
    await opening;
    expect(done).toBe(true);
    expect(mocks.row).not.toHaveBeenCalled();
  });
  it('delivers the same formal focus request when reusing a variant', async () => {
    const root = variantJointFixture().root;
    await openVariantImmersiveEditor(root);
    expect(mocks.open).toHaveBeenCalledWith(root);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('retargets the formal wing row together with identity and reloadable context', async () => {
    const snapshot = wingJointFixture();
    const row = snapshot.records.find((record) => record.key === snapshot.bindings.csv)!;
    if (row.target.kind !== 'csv') throw new Error('csv fixture');
    row.target.rowKey = 'latest-wing-row';
    const context: WindowContextFor<'immersive-editor'> = {
      kind: 'immersive-editor',
      identity: { type: 'immersive', ...snapshot.root },
      input: { kind: 'immersive-editor', rowKey: 'latest-wing-row' },
      label: 'managed-1',
      receiverGeneration: 0,
      requestId: 9,
      revision: 12,
      title: '战机联队',
    };
    mocks.retarget.mockResolvedValue(context);
    await retargetImmersiveWindow(snapshot);
    expect(mocks.retarget).toHaveBeenCalledWith({ type: 'immersive', ...snapshot.root }, '战机联队 - ' + snapshot.root.id, {
      kind: 'immersive-editor',
      rowKey: 'latest-wing-row',
    });
    expect(mocks.publish).toHaveBeenCalledWith(context);
    mocks.context.value = { ...context, title: '战机联队 - ' + snapshot.root.id };
    mocks.retarget.mockClear();
    mocks.publish.mockClear();
    await retargetImmersiveWindow(snapshot);
    expect(mocks.retarget).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    row.target.rowKey = 'changed-wing-row';
    await retargetImmersiveWindow(snapshot);
    expect(mocks.retarget).toHaveBeenCalledTimes(1);
    expect(mocks.retarget.mock.lastCall![2]).toMatchObject({ rowKey: 'changed-wing-row' });
  });
});
