import { projectChangeFixture, projectChangeListeners } from '@/test/unit/project-changes';
import { savedWriteFixture } from '@/test/fixtures/write-result';
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({ ...(await import('@/test/unit/project-changes')) }));
import { expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { EditContext, RowData } from '@/shared/types/index';
import type { SpecEditorTarget } from './spec-editor.types';
import { useSpecEditorDraftImages } from './use-spec-editor-draft-images';
import type { ResourceRef } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  feedback: vi.fn(),
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.feedback }) }));
it('accepts current projectile image status through edits, invalidation and release', async () => {
  const scope = effectScope(),
    target = ref<SpecEditorTarget | null>({ sessionId: 's', modRoot: 'M:/mod', kind: 'projectile', id: 'p' });
  const draft = ref<RowData>({ sprite: 'first.png' }),
    context = ref<EditContext | null>({ targetKey: 'p', baselineGeneration: 1, handoff: 'load' });
  type Result = { resourceRefs: ResourceRef[]; spriteData: Record<string, string> };
  const pending: Array<{ resolve: (result: Result) => void; reject: (error: Error) => void; signal: AbortSignal }> = [];
  const query = vi.fn(
    (_s: string, _id: string, _draft: RowData, signal?: AbortSignal) =>
      new Promise<Result>((resolve, reject) => {
        pending.push({ resolve, reject, signal: signal! });
      }),
  );
  const vm = scope.run(() => useSpecEditorDraftImages({ target, draft, context, fields: ['sprite'], query, errorPresentation: 'inline' }))!;
  await flushPromises();
  expect(vm.loading.value).toBe(true);
  draft.value = { sprite: 'second.png' };
  expect(pending[0]!.signal.aborted).toBe(true);
  await flushPromises();
  pending[0]!.resolve({ resourceRefs: [], spriteData: { sprite: 'old' } });
  pending[1]!.resolve({
    resourceRefs: [{ source: 'mod', relPath: 'second.png', ownerKind: 'weapon', ownerId: 'p', key: 'sprite' }],
    spriteData: { sprite: 'current' },
  });
  await flushPromises();
  expect(vm.value.value?.spriteData).toEqual({ sprite: 'current' });
  expect(vm.loading.value).toBe(false);
  const refreshing = projectChangeFixture('s', {
    ...savedWriteFixture().invalidation,
    resources: [{ source: 'mod', relPath: 'second.png' }],
  });
  const rejected = expect(refreshing).rejects.toThrow('read failed');
  await flushPromises();
  pending[2]!.reject(new Error('read failed'));
  await rejected;
  await flushPromises();
  expect(vm.errorText.value).toContain('read failed');
  expect(vm.loading.value).toBe(false);
  expect(mocks.feedback).not.toHaveBeenCalled();
  context.value = { targetKey: 'next', baselineGeneration: 2, handoff: 'identity' };
  target.value = { ...target.value!, id: 'next' };
  await flushPromises();
  expect(query.mock.lastCall?.[1]).toBe('next');
  scope.stop();
  expect(vm.loading.value).toBe(false);
  expect(pending[3]!.signal.aborted).toBe(true);
  pending[3]!.resolve({ resourceRefs: [], spriteData: { sprite: 'late' } });
  await flushPromises();
  expect(vm.value.value).toBeNull();
  expect(projectChangeListeners.size).toBe(0);
});
