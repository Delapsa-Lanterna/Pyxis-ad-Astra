import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, computed } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { WeaponFirePreviewData, WeaponFirePreviewSource, WindowContextFor, WriteResult } from '@/shared/types';
import { entityTargetFixture } from '@/test/entity-target';
import { savedWriteFixture } from '@/test/write-result';
import { useWeaponFirePreviewWindowViewModel } from './use-weapon-fire-preview-window-view-model';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  error: vi.fn(),
  retarget: vi.fn(),
  request: null as null | ((request: WindowContextFor<'weapon-fire-preview'>) => void),
  identity: null as null | ((event: { sessionId: string; modRoot: string; result: WriteResult }) => Promise<void>),
  listenIdentity: vi.fn(),
}));
vi.mock('@/windows/window-context.window', () => ({ useWindowContext: () => computed(() => request({ kind: 'saved' })) }));
vi.mock('@/app/composables/use-managed-window-requests', () => ({
  useManagedWindowRequests: (handler: typeof mocks.request) => {
    mocks.request = handler;
  },
}));
vi.mock('@/services/weapon-fire-preview.service', () => ({
  queryWeaponFirePreviewData: mocks.query,
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/orchestrators/project-sync.orchestrator', () => ({
  listenEntityIdentityApplied: mocks.listenIdentity,
  listenProjectSessionInvalidated: vi.fn(async () => vi.fn()),
  invalidateProjectionCaches: vi.fn(),
}));

vi.mock('@/orchestrators/weapon-fire-preview.orchestrator', () => ({ retargetWeaponFirePreviewWindow: mocks.retarget }));
function request(source: WeaponFirePreviewSource): WindowContextFor<'weapon-fire-preview'> {
  return {
    kind: 'weapon-fire-preview',
    identity: { type: 'weapon-fire-preview', sessionId: 's', modRoot: 'M:/mod', id: 'w' },
    input: { kind: 'weapon-fire-preview', source },
    label: 'managed-1',
    title: '预览',
    receiverGeneration: 0,
    requestId: 1,
    revision: 1,
  };
}
function data(id = 'w'): WeaponFirePreviewData {
  return {
    sessionId: 's',
    weapon: { id, specClass: 'beam' },
    weaponCsvRow: { id },
    baseVersions: [],
    projectile: null,
    resources: { weapon: {}, projectile: {} },
  };
}
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockReset();
  mocks.query.mockResolvedValue(data());
  mocks.listenIdentity.mockImplementation(async (handler) => {
    mocks.identity = handler;
    return vi.fn();
  });
  mocks.retarget.mockResolvedValue(undefined);
});
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));
async function open() {
  const scope = effectScope();
  scopes.push(scope);
  const vm = scope.run(useWeaponFirePreviewWindowViewModel)!;
  await vm.initialize();
  await flushPromises();
  return vm;
}
function invalidate() {
  invalidateQueryCacheByProject('s', {
    paths: [],
    tables: [],
    entities: [{ kind: 'weapon', id: 'w' }],
    resources: [],
    queryScopes: [{ kind: 'entity-detail', entity: { kind: 'weapon', id: 'w' }, table: null, source: null, resource: null }],
    session: false,
  });
}
describe('weapon fire preview source and read lifetime', () => {
  it('accepts saved and draft requests in both directions with detached snapshots', async () => {
    const vm = await open();
    expect(mocks.query).toHaveBeenLastCalledWith('s', 'w', { kind: 'saved' }, expect.any(AbortSignal));
    const draft = { id: 'w', specClass: 'beam', glowColor: [12, 34, 56, 128] };
    mocks.request!(request({ kind: 'draft', weapon: draft }));
    draft.glowColor[0] = 99;
    await flushPromises();
    expect(vm.source.value).toEqual({ kind: 'draft', weapon: { ...draft, glowColor: [12, 34, 56, 128] } });
    expect(mocks.query.mock.lastCall![2]).toEqual(vm.source.value);
    mocks.request!(request({ kind: 'saved' }));
    await flushPromises();
    expect(vm.source.value).toEqual({ kind: 'saved' });
    expect(vm.contentReady.value).toBe(true);
  });
  it('hands off a newer source immediately and discards late reads and errors', async () => {
    const vm = await open();
    let older!: (value: WeaponFirePreviewData) => void;
    let latest!: (value: WeaponFirePreviewData) => void;
    mocks.query
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            older = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            latest = resolve;
          }),
      );
    mocks.request!(request({ kind: 'draft', weapon: { id: 'w', value: 1 } }));
    await flushPromises();
    const signal = mocks.query.mock.lastCall![3] as AbortSignal;
    mocks.request!(request({ kind: 'saved' }));
    expect(signal.aborted).toBe(true);
    await flushPromises();
    latest(data('latest'));
    await flushPromises();
    older(data('older'));
    await flushPromises();
    expect(vm.data.value?.weapon.id).toBe('latest');
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('keeps accepted content attached while refresh is pending and reports failure once', async () => {
    const vm = await open();
    const accepted = vm.data.value;
    let fail!: (error: Error) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    invalidate();
    await flushPromises();
    expect(vm.loading.value).toBe(true);
    expect(vm.contentReady.value).toBe(true);
    expect(vm.data.value).toBe(accepted);
    fail(new Error('读取失败'));
    await flushPromises();
    expect(vm.data.value).toBe(accepted);
    expect(vm.loading.value).toBe(false);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '刷新开火预览失败');
    invalidate();
    await flushPromises();
    expect(vm.data.value?.weapon.id).toBe('w');
  });
  it('presents an initial load error and recovers on a new source request', async () => {
    mocks.query.mockRejectedValueOnce(new Error('初次失败'));
    const vm = await open();
    expect(vm.contentReady.value).toBe(false);
    expect(vm.errorText.value).toContain('初次失败');
    mocks.request!(request({ kind: 'saved' }));
    await flushPromises();
    expect(vm.contentReady.value).toBe(true);
    expect(vm.errorText.value).toBe('');
  });
  it('maps draft identity before querying dependencies after a rename', async () => {
    const vm = await open();
    mocks.request!(request({ kind: 'draft', weapon: { id: 'w', specClass: 'beam', unknown: 42 } }));
    await flushPromises();
    const result = savedWriteFixture();
    result.identityChanges = [{ before: entityTargetFixture('weapon', 'w'), after: entityTargetFixture('weapon', 'next') }];
    await mocks.identity!({ sessionId: 's', modRoot: 'm:/MOD/', result });
    await flushPromises();
    expect(mocks.retarget).toHaveBeenCalledWith('s', 'M:/mod', 'next');
    expect(vm.target.value.id).toBe('next');
    expect(vm.source.value).toEqual({ kind: 'draft', weapon: { id: 'next', specClass: 'beam', unknown: 42 } });
    expect(mocks.query).toHaveBeenLastCalledWith('s', 'next', vm.source.value, expect.any(AbortSignal));
  });
  it('revokes reads and leaves accepted data intact after window disposal', async () => {
    const vm = await open();
    const accepted = vm.data.value;
    let finish!: (value: WeaponFirePreviewData) => void;
    mocks.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    invalidate();
    await flushPromises();
    const signal = mocks.query.mock.lastCall![3] as AbortSignal;
    vm.dispose();
    expect(signal.aborted).toBe(true);
    finish(data('late'));
    await flushPromises();
    expect(vm.data.value).toBe(accepted);
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('releases a registration whose completion arrives after disposal', async () => {
    let finish!: (stop: () => void) => void;
    mocks.listenIdentity.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const scope = effectScope();
    scopes.push(scope);
    const vm = scope.run(useWeaponFirePreviewWindowViewModel)!;
    const starting = vm.initialize();
    scope.stop();
    const stop = vi.fn();
    finish(stop);
    await starting;
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
